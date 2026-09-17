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
from typing import Any

from aiohttp import ClientError, ClientSession
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .address import Address, cache_key, parse
from .const import (
    CACHE_TTL_DAYS,
    MIN_REQUEST_INTERVAL,
    NOMINATIM_URL,
    STORAGE_KEY,
    STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)

# Re-exported so the rest of the integration keeps importing from one place.
__all__ = ["Address", "Geocoder", "cache_key", "parse"]

_TTL_SECONDS = CACHE_TTL_DAYS * 24 * 60 * 60


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
