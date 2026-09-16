"""
The command the card uses instead of talking to Nominatim itself.

Moving the lookup here is the whole point of the integration for the card: one
cache for every browser in the house, one queue that respects the rate limit,
and a result that survives clearing browser storage.
"""

from __future__ import annotations

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .geocode import Geocoder


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, _handle_geocode)


def _any_geocoder(hass: HomeAssistant) -> Geocoder | None:
    for data in (hass.data.get(DOMAIN) or {}).values():
        geocoder = data.get("geocoder")
        if geocoder is not None:
            return geocoder
    return None


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/geocode",
        vol.Required("latitude"): vol.Coerce(float),
        vol.Required("longitude"): vol.Coerce(float),
        vol.Optional("language"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def _handle_geocode(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    geocoder = _any_geocoder(hass)
    if geocoder is None:
        connection.send_error(msg["id"], "not_ready", "Family Tracking is not set up")
        return

    address = await geocoder.async_resolve(msg["latitude"], msg["longitude"], msg.get("language"))
    connection.send_result(msg["id"], address.as_dict() if address else None)
