"""
Reverse geocoding, once for the whole household.

The card used to ask Nominatim straight from the browser. That works, but every
browser keeps its own cache, so the same street gets looked up again on the
phone, on the tablet and after every cleared browser storage -- and each of
those is a request against a service that asks for one per second, worldwide,
from everyone.

Doing it here means one cache for the whole instance, kept on disk across
restarts, and one queue that honours the rate limit no matter how many browsers
are open.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from aiohttp import ClientError, ClientSession
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    CACHE_PRECISION,
    CACHE_TTL_DAYS,
    MIN_REQUEST_INTERVAL,
    NOMINATIM_URL,
    STORAGE_KEY,
    STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)

_TTL_SECONDS = CACHE_TTL_DAYS * 24 * 60 * 60


def cache_key(latitude: float, longitude: float) -> str:
    """The key two nearby fixes share, so standing still costs one lookup."""
    return f"{latitude:.{CACHE_PRECISION}f},{longitude:.{CACHE_PRECISION}f}"


@dataclass(slots=True)
class Address:
    """The parts of an address the card and the sensors actually use."""

    label: str
    name: str = ""
    house_number: str = ""
    street: str = ""
    postcode: str = ""
    city: str = ""
    county: str = ""
    state: str = ""
    country: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "label": self.label,
            "name": self.name,
            "house_number": self.house_number,
            "street": self.street,
            "postcode": self.postcode,
            "city": self.city,
            "county": self.county,
            "state": self.state,
            "country": self.country,
        }


def parse(payload: dict[str, Any]) -> Address:
    """
    Turn a Nominatim answer into one readable line plus its parts.

    Written against what the service actually returns rather than its schema: a
    footpath has no `road`, a shop has no house number, and a field in the middle
    of nowhere has neither. Each step falls back to the next thing a person would
    recognise, and the raw `display_name` is the last resort because it is long
    enough to break any layout.
    """
    address: dict[str, str] = payload.get("address") or {}

    street = (
        address.get("road")
        or address.get("pedestrian")
        or address.get("footway")
        or address.get("path")
        or ""
    )
    city = (
        address.get("village")
        or address.get("town")
        or address.get("city")
        or address.get("municipality")
        or ""
    )
    name = payload.get("name") or address.get("amenity") or address.get("shop") or ""
    house_number = address.get("house_number") or ""

    if street:
        head = f"{street} {house_number}".strip()
    elif name:
        head = name
    else:
        head = city or address.get("county") or ""

    label = ", ".join(part for part in (head, city if head != city else "") if part)
    if not label:
        display = payload.get("display_name") or ""
        # Each part carries the space that followed the comma; joining them
        # again without stripping produces "Somewhere,  Somehow".
        label = ", ".join(part.strip() for part in display.split(",")[:2] if part.strip())

    return Address(
        label=label,
        name=name,
        house_number=house_number,
        street=street,
        postcode=address.get("postcode") or "",
        city=city,
        county=address.get("county") or "",
        state=address.get("state") or "",
        country=address.get("country") or "",
    )


class Geocoder:
    """One queue, one cache, one place that talks to Nominatim."""

    def __init__(self, hass: HomeAssistant, session: ClientSession, email: str | None) -> None:
        self._hass = hass
        self._session = session
        self._email = email
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._cache: dict[str, dict[str, Any]] = {}
        # Serialises the requests. Without it a dashboard opening with twelve
        # stays would fire twelve lookups in the same tick.
        self._lock = asyncio.Lock()
        self._last_request = 0.0
        self._save_handle: asyncio.TimerHandle | None = None
        self._dirty = False

    async def async_load(self) -> None:
        """Read the cache from disk and drop whatever has gone stale."""
        stored = await self._store.async_load() or {}
        now = time.time()
        entries: dict[str, dict[str, Any]] = stored.get("entries", {})
        self._cache = {
            key: entry
            for key, entry in entries.items()
            if isinstance(entry, dict) and now - entry.get("at", 0) < _TTL_SECONDS
        }
        _LOGGER.debug("Loaded %d cached addresses", len(self._cache))

    async def async_save(self) -> None:
        if not self._dirty:
            return
        await self._store.async_save({"entries": self._cache})
        self._dirty = False

    def cached(self, latitude: float, longitude: float) -> Address | None:
        entry = self._cache.get(cache_key(latitude, longitude))
        if not entry:
            return None
        return Address(**entry["address"])

    async def async_resolve(
        self, latitude: float, longitude: float, language: str | None = None
    ) -> Address | None:
        """The address for a position, from the cache when possible."""
        key = cache_key(latitude, longitude)
        if (hit := self._cache.get(key)) is not None:
            return Address(**hit["address"])

        async with self._lock:
            # A second caller may have filled the cache while this one queued.
            if (hit := self._cache.get(key)) is not None:
                return Address(**hit["address"])

            wait = self._last_request + MIN_REQUEST_INTERVAL - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_request = time.monotonic()

            address = await self._fetch(latitude, longitude, language)

        if address is None:
            return None

        self._cache[key] = {"address": address.as_dict(), "at": time.time()}
        self._dirty = True
        self._schedule_save()
        return address

    async def _fetch(
        self, latitude: float, longitude: float, language: str | None
    ) -> Address | None:
        params = {
            "format": "jsonv2",
            "lat": f"{latitude}",
            "lon": f"{longitude}",
            "zoom": "18",
            "addressdetails": "1",
        }
        if language:
            params["accept-language"] = language
        if self._email:
            params["email"] = self._email

        try:
            async with self._session.get(
                NOMINATIM_URL,
                params=params,
                headers={"User-Agent": "home-assistant-family-tracking"},
                timeout=15,
            ) as response:
                if response.status != 200:
                    _LOGGER.debug("Nominatim answered %s", response.status)
                    return None
                payload = await response.json(content_type=None)
        except (ClientError, asyncio.TimeoutError) as err:
            _LOGGER.debug("Nominatim unreachable: %s", err)
            return None

        address = parse(payload)
        return address if address.label else None

    def _schedule_save(self) -> None:
        """Write at most once every half minute rather than per lookup."""
        if self._save_handle is not None:
            return

        def _write() -> None:
            self._save_handle = None
            self._hass.async_create_task(self.async_save())

        self._save_handle = self._hass.loop.call_later(30, _write)
