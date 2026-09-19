"""Shared names and defaults for the Family Tracking integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "family_tracking"

# --- configuration keys -----------------------------------------------------

CONF_PERSONS: Final = "persons"
CONF_EMAIL: Final = "geocode_email"
CONF_LANGUAGE: Final = "language"
CONF_MAX_ACCURACY: Final = "max_accuracy"
CONF_HOME_ZONE: Final = "home_zone"
CONF_GEOCODE: Final = "geocode"

# --- defaults ---------------------------------------------------------------

#: A fix reported as worse than this many metres says more about the radio
#: conditions than about where somebody is, so it is not allowed to move them.
DEFAULT_MAX_ACCURACY: Final = 100

#: Zero accuracy is not a perfect fix. Several trackers report it when they have
#: no fix at all, which is the opposite of what the number says.
ZERO_ACCURACY_IS_UNKNOWN: Final = True

DEFAULT_HOME_ZONE: Final = "zone.home"

#: How long a person stays marked as just arrived or just left. Long enough to
#: drive an automation from it, short enough not to lie about the present.
TRANSITION_SECONDS: Final = 180

# --- presence ---------------------------------------------------------------

PRESENCE_HOME: Final = "home"
PRESENCE_JUST_ARRIVED: Final = "just_arrived"
PRESENCE_JUST_LEFT: Final = "just_left"
PRESENCE_AWAY: Final = "away"
PRESENCE_UNKNOWN: Final = "unknown"

# --- attributes exposed on the location sensor ------------------------------

ATTR_SOURCE: Final = "source"
ATTR_PERSON: Final = "person_entity_id"
ATTR_PRESENCE: Final = "presence"
ATTR_ZONE: Final = "zone"
ATTR_DISTANCE: Final = "distance_from_home"
ATTR_DIRECTION: Final = "direction"
ATTR_BEARING: Final = "bearing"
ATTR_UPDATED: Final = "location_updated"
ATTR_REASON: Final = "last_decision"

# --- reverse geocoding ------------------------------------------------------

NOMINATIM_URL: Final = "https://nominatim.openstreetmap.org/reverse"

#: Their usage policy allows one request per second. Staying a little under it
#: costs nothing and keeps the card working for everybody else too.
MIN_REQUEST_INTERVAL: Final = 1.1

#: Coordinates are rounded to this many decimals before they become a cache
#: key. Four is about eleven metres -- fine enough to tell two addresses apart,
#: coarse enough that standing still does not produce a new lookup every minute.
CACHE_PRECISION: Final = 4

CACHE_TTL_DAYS: Final = 90
STORAGE_KEY: Final = f"{DOMAIN}.geocode_cache"
STORAGE_VERSION: Final = 1

#: Bumped whenever a stored label would come out differently today. Entries
#: written under an older schema are dropped on load rather than migrated:
#: they are a convenience, and keeping them would hide the very change that
#: raised the number -- a shopping centre visited last week would go on
#: reading as the street outside it.
CACHE_SCHEMA: Final = 2

# --- enclosing places -------------------------------------------------------

OVERPASS_URL: Final = "https://overpass-api.de/api/interpreter"

#: Overpass is donated capacity, and containment queries are cheap only for the
#: person asking. One every two seconds, on top of a cache that holds for
#: months, keeps this well inside what the service asks of a client.
VENUE_MIN_REQUEST_INTERVAL: Final = 2.0

#: Containment queries are answered in about a second, but the public instance
#: sometimes queues them. Waiting is free -- the label appears when it appears,
#: and nothing in the card is blocked on it.
VENUE_TIMEOUT: Final = 30

#: Answers that mean "busy, not wrong". Worth one more ask; anything else is a
#: real no.
VENUE_RETRY_STATUS: Final = frozenset({429, 502, 503, 504})

# --- frontend ---------------------------------------------------------------

CARD_FILENAME: Final = "family-tracking-card.js"
CARD_URL_BASE: Final = f"/{DOMAIN}"
