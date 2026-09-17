"""The sensors the integration publishes, one set per person."""

from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfLength
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    ATTR_BEARING,
    ATTR_DIRECTION,
    ATTR_DISTANCE,
    ATTR_PERSON,
    ATTR_PRESENCE,
    ATTR_REASON,
    ATTR_SOURCE,
    ATTR_UPDATED,
    ATTR_ZONE,
    DOMAIN,
)
from .coordinator import FamilyTrackingCoordinator, PersonState


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: FamilyTrackingCoordinator = hass.data[DOMAIN][entry.entry_id]["coordinator"]
    entities: list[SensorEntity] = []
    for person in coordinator.people.values():
        entities.append(LocationSensor(coordinator, entry, person))
        entities.append(DistanceSensor(coordinator, entry, person))
    async_add_entities(entities)


class _Base(SensorEntity):
    """Shared plumbing: one device per person, updates pushed not polled."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(
        self, coordinator: FamilyTrackingCoordinator, entry: ConfigEntry, person: PersonState
    ) -> None:
        self._coordinator = coordinator
        self._person = person
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, person.person_id)},
            name=person.name,
            manufacturer="Family Tracking",
            entry_type=None,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._coordinator.subscribe(self._changed))

    @callback
    def _changed(self) -> None:
        self.async_write_ha_state()


class LocationSensor(_Base):
    """Where the person is, in words."""

    _attr_icon = "mdi:map-marker-account"
    _attr_translation_key = "location"

    def __init__(self, coordinator, entry, person) -> None:
        super().__init__(coordinator, entry, person)
        self._attr_unique_id = f"{person.person_id}_location"
        self._attr_name = "Location"

    @property
    def native_value(self) -> str | None:
        """
        The zone name when there is one, the address otherwise.

        A zone is what its owner called it, which beats any street: "School"
        says more than the road it sits on.
        """
        fix = self._person.fix
        if fix is None:
            return None
        if fix.zone and fix.zone not in {"not_home", "unknown", "unavailable", "none", ""}:
            # `home` is the keyword, not the name. Whoever renamed their home
            # zone wants to read that name here.
            if fix.zone == "home":
                zone = self.hass.states.get("zone.home")
                if zone is not None:
                    return zone.attributes.get("friendly_name") or "Home"
            return fix.zone
        if self._person.address is not None:
            return self._person.address.label
        return "Away"

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        person = self._person
        fix = person.fix
        data: dict[str, object] = {
            ATTR_PERSON: person.person_id,
            ATTR_PRESENCE: person.presence,
            ATTR_REASON: person.last_reason,
            "last_rejected": person.last_rejected,
            "integration": DOMAIN,
        }
        if fix is not None:
            data.update(
                {
                    ATTR_SOURCE: fix.source,
                    ATTR_ZONE: fix.zone,
                    "latitude": fix.latitude,
                    "longitude": fix.longitude,
                    "gps_accuracy": fix.accuracy,
                    ATTR_UPDATED: fix.at,
                }
            )
        if person.distance is not None:
            data[ATTR_DISTANCE] = round(person.distance)
            data[ATTR_DIRECTION] = person.direction
            if person.bearing:
                data[ATTR_BEARING] = person.bearing
        if person.address is not None:
            data.update(person.address.as_dict())
        return data


class DistanceSensor(_Base):
    """How far from home, so an automation can act before somebody arrives."""

    _attr_icon = "mdi:map-marker-distance"
    _attr_device_class = SensorDeviceClass.DISTANCE
    _attr_native_unit_of_measurement = UnitOfLength.KILOMETERS
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(self, coordinator, entry, person) -> None:
        super().__init__(coordinator, entry, person)
        self._attr_unique_id = f"{person.person_id}_distance"
        self._attr_name = "Distance from home"

    @property
    def native_value(self) -> float | None:
        if self._person.distance is None:
            return None
        return round(self._person.distance / 1000, 3)

    @property
    def extra_state_attributes(self) -> dict[str, object]:
        return {
            ATTR_PERSON: self._person.person_id,
            ATTR_DIRECTION: self._person.direction,
            ATTR_BEARING: self._person.bearing,
        }
