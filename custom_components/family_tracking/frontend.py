"""
Shipping the card with the integration.

The point of putting both in one repository is that nobody has to add a Lovelace
resource by hand, or remember to update it after an upgrade. So the integration
registers that resource itself.

Registering it as a resource rather than as an extra frontend module is not a
detail. An extra module is imported from the page head, before the frontend has
installed the custom element registry it later looks cards up in -- the card
then registers into a registry nobody reads, and the dashboard says the element
does not exist while the file loaded perfectly. Resources go through the
frontend's own loader, after that registry is in place. HACS registers every
card it manages the same way.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace import DOMAIN as LOVELACE_DOMAIN
from homeassistant.core import HomeAssistant

from .const import CARD_FILENAME, CARD_URL_BASE, DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_register_card(hass: HomeAssistant, version: str) -> None:
    """Serve the bundle and make sure the dashboard loads it."""
    url = f"{CARD_URL_BASE}/{CARD_FILENAME}?v={version}"

    if not hass.data.get(DOMAIN, {}).get("_static_registered"):
        directory = Path(__file__).parent / "www"
        if not (directory / CARD_FILENAME).is_file():
            _LOGGER.error("Card bundle missing in %s -- the card will not load", directory)
            return
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_URL_BASE, str(directory), cache_headers=False)]
        )
        hass.data.setdefault(DOMAIN, {})["_static_registered"] = True

    await _async_register_resource(hass, url)


async def _async_register_resource(hass: HomeAssistant, url: str) -> None:
    lovelace = hass.data.get(LOVELACE_DOMAIN)
    resources = getattr(lovelace, "resources", None)

    # Dashboards kept in YAML have no resource list to add to; there the extra
    # module is the only way in, and the user is editing YAML anyway.
    if resources is None or getattr(lovelace, "resource_mode", None) != "storage":
        _LOGGER.debug("Lovelace is in YAML mode -- falling back to an extra module")
        add_extra_js_url(hass, url)
        return

    if not resources.loaded:
        await resources.async_load()
        resources.loaded = True

    for item in resources.async_items():
        if CARD_FILENAME not in item.get("url", ""):
            continue
        if item["url"] == url:
            return
        # Same card, different version: repoint it rather than adding a second
        # entry. Two resources loading the same bundle would define the custom
        # element twice and take the card down.
        await resources.async_update_item(item["id"], {"url": url})
        _LOGGER.debug("Updated the card resource to %s", url)
        return

    await resources.async_create_item({"res_type": "module", "url": url})
    _LOGGER.debug("Registered the card resource %s", url)


async def async_remove_resource(hass: HomeAssistant) -> None:
    """Take the resource out again when the integration is removed for good."""
    lovelace = hass.data.get(LOVELACE_DOMAIN)
    resources = getattr(lovelace, "resources", None)
    if resources is None:
        return
    if not resources.loaded:
        await resources.async_load()
        resources.loaded = True

    for item in list(resources.async_items()):
        if CARD_FILENAME in item.get("url", ""):
            await resources.async_delete_item(item["id"])
            _LOGGER.debug("Removed the card resource %s", item["url"])
