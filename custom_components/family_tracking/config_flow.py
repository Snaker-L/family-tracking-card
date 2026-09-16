"""Setting the integration up from the interface, with no YAML involved."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector

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


def _schema(defaults: dict[str, Any]) -> vol.Schema:
    """
    The options, in the order somebody reads them.

    Leaving the person list empty means every person, which is the right default:
    somebody added to Home Assistant later is then included instead of quietly
    missing from the card.
    """
    return vol.Schema(
        {
            vol.Optional(CONF_PERSONS, default=defaults.get(CONF_PERSONS, [])): selector.
            EntitySelector(
                selector.EntitySelectorConfig(domain="person", multiple=True)
            ),
            vol.Optional(CONF_GEOCODE, default=defaults.get(CONF_GEOCODE, True)): selector.
            BooleanSelector(),
            vol.Optional(CONF_EMAIL, default=defaults.get(CONF_EMAIL, "")): selector.TextSelector(
                selector.TextSelectorConfig(type=selector.TextSelectorType.EMAIL)
            ),
            vol.Optional(
                CONF_MAX_ACCURACY, default=defaults.get(CONF_MAX_ACCURACY, DEFAULT_MAX_ACCURACY)
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(min=10, max=2000, step=10, unit_of_measurement="m")
            ),
            vol.Optional(
                CONF_HOME_ZONE, default=defaults.get(CONF_HOME_ZONE, DEFAULT_HOME_ZONE)
            ): selector.EntitySelector(selector.EntitySelectorConfig(domain="zone")),
            vol.Optional(CONF_LANGUAGE, default=defaults.get(CONF_LANGUAGE, "")): selector.
            TextSelector(),
        }
    )


class FamilyTrackingConfigFlow(ConfigFlow, domain=DOMAIN):
    """Only one entry: the integration watches the whole household."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="Family Tracking", data={}, options=user_input)

        return self.async_show_form(step_id="user", data_schema=_schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> OptionsFlow:
        return FamilyTrackingOptionsFlow()


class FamilyTrackingOptionsFlow(OptionsFlow):
    """The same form again, so nothing has to be removed to be changed."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init", data_schema=_schema(dict(self.config_entry.options))
        )
