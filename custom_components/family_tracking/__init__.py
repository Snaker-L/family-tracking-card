"""
Family Tracking: one integration for the map card and the data behind it.

The card alone could only work with what the browser could reach: it asked
Nominatim itself, cached the answers per device, and had no way to tell which of
a person's trackers was worth believing. All three belong on the server, where
there is one cache, one queue and one view of every tracker -- which is why this
integration exists and why it ships the card with it.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import websocket
from .const import (
    CONF_EMAIL,
    CONF_GEOCODE,
    CONF_HOME_ZONE,
    CONF_LANGUAGE,
    CONF_MAX_ACCURACY,
    CONF_PERSONS,
    DEFAULT_HOME_ZONE,
    DEFAULT_MAX_ACCURACY,
    DOMAIN,
)
from .coordinator import FamilyTrackingCoordinator
from .frontend import async_register_card
from .geocode import Geocoder

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]


def _version() -> str:
    manifest = json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8"))
    return manifest.get("version", "0")


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    options = dict(entry.options)

    geocoder = Geocoder(
        hass,
        async_get_clientsession(hass),
        (options.get(CONF_EMAIL) or "").strip() or None,
    )
    await geocoder.async_load()

    coordinator = FamilyTrackingCoordinator(
        hass,
        geocoder,
        person_ids=options.get(CONF_PERSONS) or None,
        max_accuracy=float(options.get(CONF_MAX_ACCURACY) or DEFAULT_MAX_ACCURACY),
        home_zone=options.get(CONF_HOME_ZONE) or DEFAULT_HOME_ZONE,
        language=(options.get(CONF_LANGUAGE) or "").strip() or hass.config.language,
        geocode=options.get(CONF_GEOCODE, True),
    )
    await coordinator.async_start()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "coordinator": coordinator,
        "geocoder": geocoder,
    }

    websocket.async_register(hass)
    await async_register_card(hass, _version())

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        data = hass.data[DOMAIN].pop(entry.entry_id)
        await data["coordinator"].async_stop()
        # Write the cache out now rather than losing whatever the delayed save
        # was still holding.
        await data["geocoder"].async_save()
    return unloaded


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
