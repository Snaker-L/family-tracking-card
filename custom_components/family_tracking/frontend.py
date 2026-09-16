"""
Shipping the card with the integration.

The point of putting both in one repository is that nobody has to add a Lovelace
resource by hand, or remember to update it. The integration serves the file and
tells the frontend to load it, with the version in the URL so a browser cannot
keep yesterday's copy.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import CARD_FILENAME, CARD_URL_BASE, DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_register_card(hass: HomeAssistant, version: str) -> None:
    """Serve the bundle and add it to the frontend, once per Home Assistant run."""
    if hass.data.get(DOMAIN, {}).get("_frontend_registered"):
        return

    directory = Path(__file__).parent / "www"
    bundle = directory / CARD_FILENAME
    if not bundle.is_file():
        _LOGGER.error("Card bundle missing at %s -- the dashboard card will not load", bundle)
        return

    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL_BASE, str(directory), cache_headers=False)]
    )
    add_extra_js_url(hass, f"{CARD_URL_BASE}/{CARD_FILENAME}?v={version}")

    hass.data.setdefault(DOMAIN, {})["_frontend_registered"] = True
    _LOGGER.debug("Registered %s/%s", CARD_URL_BASE, CARD_FILENAME)
