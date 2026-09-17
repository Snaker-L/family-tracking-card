"""
One place that watches every tracker and keeps one answer per person.

Home Assistant's own `person` entity already picks a device tracker, but it only
tells you the zone. What is missing is everything around it: which tracker the
answer came from, how far away that is, whether the person is heading home, and
what the position is actually called. That is what this keeps.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from homeassistant.const import ATTR_GPS_ACCURACY, ATTR_LATITUDE, ATTR_LONGITUDE
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, State, callback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.util import dt as dt_util
from homeassistant.util.location import distance

from .const import (
    DEFAULT_HOME_ZONE,
    DEFAULT_MAX_ACCURACY,
    PRESENCE_UNKNOWN,
)
from .geocode import Address, Geocoder
from .tracker import Fix, bearing, compass_point, direction_of_travel, judge, presence_of

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class PersonState:
    """Everything the integration knows about one person right now."""

    person_id: str
    name: str
    fix: Fix | None = None
    previous_zone: str | None = None
    zone_changed_at: float = 0.0
    presence: str = PRESENCE_UNKNOWN
    distance: float | None = None
    previous_distance: float | None = None
    #: How the person is moving relative to home.
    direction: str = "stationary"
    #: Where they are from home, as a compass point. A different question from
    #: the one above, and mixing the two into one attribute made both useless.
    bearing: str = ""
    address: Address | None = None
    #: Why the fix in use was accepted.
    last_reason: str = ""
    #: Why the most recent report was turned down, for looking into a tracker
    #: that never seems to win.
    last_rejected: str = ""
    followed_trackers: list[str] = field(default_factory=list)


class FamilyTrackingCoordinator:
    """Listens to the trackers and holds the merged result."""

    def __init__(
        self,
        hass: HomeAssistant,
        geocoder: Geocoder,
        *,
        person_ids: list[str] | None,
        max_accuracy: float = DEFAULT_MAX_ACCURACY,
        home_zone: str = DEFAULT_HOME_ZONE,
        language: str | None = None,
        geocode: bool = True,
    ) -> None:
        self.hass = hass
        self.geocoder = geocoder
        self.people: dict[str, PersonState] = {}
        self._configured_ids = person_ids
        self._max_accuracy = max_accuracy
        self._home_zone = home_zone
        self._language = language
        self._geocode = geocode
        self._listeners: list[callable] = []
        self._subscribers: list[callable] = []

    # -- wiring --------------------------------------------------------------

    @property
    def person_ids(self) -> list[str]:
        """
        The persons to follow: the ones configured, otherwise every one there is.

        Defaulting to all of them means a person added to Home Assistant later
        shows up by itself instead of quietly going missing.
        """
        if self._configured_ids:
            return [pid for pid in self._configured_ids if self.hass.states.get(pid)]
        return sorted(state.entity_id for state in self.hass.states.async_all("person"))

    async def async_start(self) -> None:
        for person_id in self.person_ids:
            state = self.hass.states.get(person_id)
            if state is None:
                continue
            self.people[person_id] = PersonState(
                person_id=person_id,
                name=state.attributes.get("friendly_name") or person_id.split(".")[1],
            )
            await self._async_seed(person_id)

        watched = self._watched_entities()
        _LOGGER.debug("Watching %d entities for %d people", len(watched), len(self.people))
        self._listeners.append(
            async_track_state_change_event(self.hass, watched, self._handle_change)
        )

    async def async_stop(self) -> None:
        for remove in self._listeners:
            remove()
        self._listeners.clear()

    def subscribe(self, callback_: callable) -> callable:
        """Entities register here to be told when their person moved."""
        self._subscribers.append(callback_)

        def _unsubscribe() -> None:
            self._subscribers.remove(callback_)

        return _unsubscribe

    def _watched_entities(self) -> list[str]:
        """Every person plus every device tracker that person is built from."""
        entities: list[str] = []
        for person_id in self.people:
            entities.append(person_id)
            state = self.hass.states.get(person_id)
            if state:
                entities.extend(state.attributes.get("device_trackers") or [])
        return sorted(set(entities))

    # -- the work ------------------------------------------------------------

    async def _async_seed(self, person_id: str) -> None:
        """Take whatever is already known, so a restart is not a blank slate."""
        for entity_id in self._sources_of(person_id):
            state = self.hass.states.get(entity_id)
            if state is not None:
                await self._async_offer(person_id, state)

    def _sources_of(self, person_id: str) -> list[str]:
        """
        The trackers to listen to for one person.

        The person entity is a fallback, not an addition. Home Assistant copies
        the winning tracker's position onto it, so counting both means judging
        the same fix twice under two names -- and the second one loses against
        itself for being "another tracker", which is nonsense. Only a person
        without any tracker falls back to the entity.
        """
        state = self.hass.states.get(person_id)
        trackers = list(state.attributes.get("device_trackers") or []) if state else []
        return trackers or [person_id]

    @callback
    def _handle_change(self, event: Event[EventStateChangedData]) -> None:
        new_state = event.data["new_state"]
        if new_state is None:
            return
        for person_id in self.people:
            if event.data["entity_id"] in self._sources_of(person_id):
                self.hass.async_create_task(self._async_offer(person_id, new_state))

    async def _async_offer(self, person_id: str, state: State) -> None:
        """Judge one report and, if it wins, recompute everything around it."""
        person = self.people.get(person_id)
        if person is None:
            return

        latitude = state.attributes.get(ATTR_LATITUDE)
        longitude = state.attributes.get(ATTR_LONGITUDE)
        if latitude is None or longitude is None:
            return

        accuracy = state.attributes.get(ATTR_GPS_ACCURACY)
        fix = Fix(
            source=state.entity_id,
            latitude=float(latitude),
            longitude=float(longitude),
            at=(state.last_updated or dt_util.utcnow()).timestamp(),
            accuracy=float(accuracy) if accuracy is not None else None,
            zone=state.state or "",
        )

        decision = judge(fix, person.fix, self._max_accuracy)
        if not decision.accept:
            # Keep it apart from the accepted one: `last_reason` has to describe
            # the position actually on display, not whatever came last.
            person.last_rejected = decision.reason
            return
        person.last_reason = decision.reason

        if person.fix is not None and person.fix.zone != fix.zone:
            person.previous_zone = person.fix.zone
            person.zone_changed_at = time.time()
        elif person.previous_zone is None:
            person.previous_zone = fix.zone
            person.zone_changed_at = time.time()

        person.fix = fix
        if fix.source not in person.followed_trackers:
            person.followed_trackers.append(fix.source)

        self._recompute(person)
        await self._async_address(person)
        self._notify()

    def _recompute(self, person: PersonState) -> None:
        fix = person.fix
        if fix is None:
            return

        home = self.hass.states.get(self._home_zone)
        if home is not None:
            home_lat = home.attributes.get(ATTR_LATITUDE)
            home_lon = home.attributes.get(ATTR_LONGITUDE)
            if home_lat is not None and home_lon is not None:
                metres = distance(fix.latitude, fix.longitude, float(home_lat), float(home_lon))
                if metres is not None:
                    person.previous_distance = person.distance
                    person.distance = metres
                    person.direction = direction_of_travel(metres, person.previous_distance)
                    person.bearing = compass_point(
                        bearing(float(home_lat), float(home_lon), fix.latitude, fix.longitude)
                    )

        person.presence = presence_of(
            fix.zone,
            person.previous_zone,
            time.time() - person.zone_changed_at,
        )

    async def _async_address(self, person: PersonState) -> None:
        """
        Resolve the position, but only outside a zone.

        A zone already carries the name its owner gave it, and that name is
        better than any address: "Grandma" says more than her street does.
        """
        fix = person.fix
        if fix is None:
            return
        if not self._geocode:
            person.address = None
            return
        if fix.zone and fix.zone.lower() not in {"not_home", "unknown", "unavailable", "none", ""}:
            person.address = None
            return

        person.address = await self.geocoder.async_resolve(
            fix.latitude, fix.longitude, self._language
        )

    def _notify(self) -> None:
        for subscriber in list(self._subscribers):
            subscriber()
