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

from .address import Address, cache_key, merge_venue, parse
from .const import (
    CACHE_SCHEMA,
    CACHE_TTL_DAYS,
    MIN_REQUEST_INTERVAL,
    NOMINATIM_URL,
    OVERPASS_URL,
    STORAGE_KEY,
    STORAGE_VERSION,
    VENUE_MIN_REQUEST_INTERVAL,
    VENUE_RETRY_STATUS,
    VENUE_TIMEOUT,
)
from .venue import build_query, pick_name

_LOGGER = logging.getLogger(__name__)

# Re-exported so the rest of the integration keeps importing from one place.
__all__ = ["Address", "Geocoder", "cache_key", "merge_venue", "parse"]

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
        self._last_venue = 0.0
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
            if isinstance(entry, dict)
            and now - entry.get("at", 0) < _TTL_SECONDS
            and entry.get("schema") == CACHE_SCHEMA
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

            # Two questions about the same spot, asked at once: what is the
            # nearest thing called, and what is this spot inside of. They go to
            # different services, so waiting for them one after the other would
            # only add up the two waits.
            address, venue = await asyncio.gather(
                self._nominatim(latitude, longitude, language),
                self._venue(latitude, longitude),
            )

        address = merge_venue(address, venue or "")
        if address is None:
            return None

        # Only a definite answer is worth keeping. Where Overpass could not be
        # asked, the address still goes back to the caller -- it is a usable
        # line today -- but the next fix at this spot asks again instead of
        # inheriting a label that was only ever second best.
        if venue is not None:
            self._cache[key] = {
                "address": address.as_dict(),
                "at": time.time(),
                "schema": CACHE_SCHEMA,
            }
            self._dirty = True
            self._schedule_save()
        return address

    async def _nominatim(
        self, latitude: float, longitude: float, language: str | None
    ) -> Address | None:
        # The rate limit lives here rather than around the call, because the two
        # services are now asked at the same time and each has its own pace to
        # keep. Nominatim's usage policy is one request per second.
        wait = self._last_request + MIN_REQUEST_INTERVAL - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        self._last_request = time.monotonic()

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

    async def _venue(self, latitude: float, longitude: float) -> str | None:
        """
        The name of the place this coordinate is inside.

        Three outcomes, and the difference between the last two matters: a name,
        `""` for "nothing encloses this spot", and `None` for "could not ask".
        Overpass is donated capacity and answers a burst with 429; treating that
        like an empty result would write the street address into a cache that
        holds for months, and the shopping centre would stay misnamed long after
        the service was happy again.
        """
        query = build_query(latitude, longitude)

        # One retry, because the public instance turns a busy moment away with a
        # 429 or a 504 and is usually fine seconds later. Beyond that it is not
        # worth pressing: the address is already on screen, and the next fix at
        # this spot will ask again.
        for attempt in (1, 2):
            wait = self._last_venue + VENUE_MIN_REQUEST_INTERVAL - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_venue = time.monotonic()

            try:
                async with self._session.post(
                    OVERPASS_URL,
                    data={"data": query},
                    headers={"User-Agent": "home-assistant-family-tracking"},
                    timeout=VENUE_TIMEOUT,
                ) as response:
                    if response.status in VENUE_RETRY_STATUS and attempt == 1:
                        _LOGGER.debug("Overpass is busy (%s), asking once more", response.status)
                        continue
                    if response.status != 200:
                        _LOGGER.debug("Overpass answered %s", response.status)
                        return None
                    # Overpass reports its own errors as XML with a 200, so the
                    # content type is not something to insist on here -- but
                    # then the body will not parse, which lands in the same
                    # place as any other failure.
                    payload = await response.json(content_type=None)
            except (ClientError, asyncio.TimeoutError, ValueError) as err:
                _LOGGER.debug("Could not ask what encloses the fix: %s", err)
                return None

            return pick_name(payload)

        return None

    def _schedule_save(self) -> None:
        """Write at most once every half minute rather than per lookup."""
        if self._save_handle is not None:
            return

        def _write() -> None:
            self._save_handle = None
            self._hass.async_create_task(self.async_save())

        self._save_handle = self._hass.loop.call_later(30, _write)
