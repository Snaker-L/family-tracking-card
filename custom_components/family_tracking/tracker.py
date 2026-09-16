"""
Deciding which device tracker gets to move a person.

A person usually carries several trackers -- the companion app, iCloud, a router
that sees the phone on WLAN, a Bluetooth beacon -- and they disagree constantly.
Averaging them produces a position where nobody is, and taking the newest one
makes the person teleport between the router's idea of home and a stale GPS fix.

So each update is judged on its own and either accepted or dropped, and the
sensor follows one tracker at a time until a better reason to switch comes
along. Everything here is a pure function over plain values: no Home Assistant
objects, no clock, no I/O, so the rules can be read and tested on their own.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import atan2, cos, degrees, radians, sin
from typing import Final

from .const import (
    DEFAULT_MAX_ACCURACY,
    PRESENCE_AWAY,
    PRESENCE_HOME,
    PRESENCE_JUST_ARRIVED,
    PRESENCE_JUST_LEFT,
    PRESENCE_UNKNOWN,
    TRANSITION_SECONDS,
)

#: States a `device_tracker` reports that carry no location at all.
NON_LOCATIONS: Final = frozenset({"unknown", "unavailable", "none", ""})


@dataclass(frozen=True, slots=True)
class Fix:
    """One position report from one tracker."""

    source: str
    latitude: float
    longitude: float
    #: Epoch seconds of the report, not of when we saw it.
    at: float
    #: Reported radius in metres. `None` when the tracker does not say.
    accuracy: float | None = None
    #: The zone the tracker thinks the person is in, or `not_home`.
    zone: str = ""


@dataclass(frozen=True, slots=True)
class Decision:
    """Whether a fix may move the person, and the reason either way."""

    accept: bool
    reason: str


def judge(fix: Fix, current: Fix | None, max_accuracy: float = DEFAULT_MAX_ACCURACY) -> Decision:
    """
    Decide whether `fix` should replace `current`.

    The order matters: the rejections come first so that a bad reading can never
    be accepted merely because it happens to come from the tracker we follow.
    """
    if fix.zone.lower() in NON_LOCATIONS and not _has_position(fix):
        return Decision(False, "no-position")

    # Zero is the value several trackers report when they have no fix at all,
    # which reads as perfect accuracy if taken at face value.
    if fix.accuracy is not None and fix.accuracy <= 0:
        return Decision(False, "accuracy-zero")

    if fix.accuracy is not None and fix.accuracy > max_accuracy:
        return Decision(False, "accuracy-poor")

    if current is None:
        return Decision(True, "first-fix")

    if fix.at < current.at:
        return Decision(False, "stale")

    # A tracker that sees the person cross a zone boundary knows something the
    # others do not, whatever its accuracy.
    if fix.zone != current.zone:
        return Decision(True, "zone-change")

    if fix.source == current.source:
        return Decision(True, "same-source")

    if _better(fix.accuracy, current.accuracy):
        return Decision(True, "more-accurate")

    return Decision(False, "less-accurate")


def _has_position(fix: Fix) -> bool:
    return fix.latitude is not None and fix.longitude is not None


def _better(candidate: float | None, incumbent: float | None) -> bool:
    """A known accuracy beats an unknown one; a smaller radius beats a larger."""
    if candidate is None:
        return False
    if incumbent is None:
        return True
    return candidate < incumbent


def presence_of(
    zone: str,
    previous_zone: str | None,
    seconds_since_change: float,
    transition: float = TRANSITION_SECONDS,
) -> str:
    """
    Presence as something other than a yes/no.

    "Home" and "away" are the two answers a binary sensor can give, and they are
    both useless in the minutes that matter: the moment somebody pulls into the
    driveway, and the moment they leave. Those get their own states so an
    automation can tell "has been home all evening" from "just walked in".
    """
    if zone.lower() in NON_LOCATIONS:
        return PRESENCE_UNKNOWN

    at_home = zone == "home"
    if previous_zone is None:
        return PRESENCE_HOME if at_home else PRESENCE_AWAY

    was_home = previous_zone == "home"
    if at_home == was_home or seconds_since_change >= transition:
        return PRESENCE_HOME if at_home else PRESENCE_AWAY

    return PRESENCE_JUST_ARRIVED if at_home else PRESENCE_JUST_LEFT


def bearing(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> float:
    """Compass bearing in degrees from one point to the other."""
    lat1, lat2 = radians(from_lat), radians(to_lat)
    delta = radians(to_lon - from_lon)
    y = sin(delta) * cos(lat2)
    x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(delta)
    return (degrees(atan2(y, x)) + 360) % 360


#: Eight points is what somebody can picture. Sixteen reads as false precision
#: on a position that is accurate to a few dozen metres anyway.
COMPASS: Final = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def compass_point(degrees_: float) -> str:
    """`N`, `NE`, ... for a bearing."""
    return COMPASS[round((degrees_ % 360) / 45) % 8]


def direction_of_travel(
    distance_now: float, distance_before: float | None, threshold: float = 50.0
) -> str:
    """
    Whether the person is heading home, away, or has not really moved.

    The threshold keeps a stationary person from flickering between "towards"
    and "away from" as their reported position jitters by a few metres.
    """
    if distance_before is None:
        return "stationary"
    delta = distance_now - distance_before
    if abs(delta) < threshold:
        return "stationary"
    return "towards home" if delta < 0 else "away from home"
