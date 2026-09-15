#!/usr/bin/env python3
"""Feed a Home Assistant instance with a simulated location history.

A fresh instance has neither persons nor a location history, so the timeline and
the stay detection have nothing to work on. This script drives a
``device_tracker`` along a route through the States API and deliberately
stands still at the waypoints, which is what produces the long runs of nearly
identical coordinates the card has to condense into a single line.

Only the standard library is used, so it runs anywhere Python 3.9+ does.

    export HA_TOKEN="<long-lived access token>"
    python3 scripts/simulate_route.py --profile quick

Before the data shows up as a *person*:

1. Settings > People > Add person, then attach the device tracker
   ``device_tracker.<--dev-id>`` to it (it appears after the first sample).
2. Settings > Areas & Zones: create the zones you want to see by name,
   for example "Arbeit" at the office waypoint. Stays inside a zone are read
   straight from the person's state changes and never need geocoding.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import List

EARTH_RADIUS_M = 6371008.8


@dataclass
class Waypoint:
    name: str
    lat: float
    lon: float
    dwell_minutes: float


@dataclass
class Profile:
    name: str
    waypoints: List[Waypoint]
    #: Seconds between two samples.
    interval: float = 30.0
    #: Metres covered per sample while travelling.
    step_metres: float = 250.0
    #: Random offset added to every sample, in metres.
    jitter_metres: float = 15.0
    gps_accuracy: int = 20
    battery: int = 78
    log: List[str] = field(default_factory=list)


# A plausible Vienna commute. Replace the coordinates with your own area; the
# absolute position does not matter for the detection, only the distances do.
HOME = (48.2082, 16.3738)
OFFICE = (48.2380, 16.3730)
SHOP = (48.2246, 16.3602)

PROFILES = {
    # Short enough to watch end to end. Set stay_min_duration to 2 minutes in
    # the card while using this one.
    "quick": Profile(
        name="quick",
        waypoints=[
            Waypoint("Zuhause", *HOME, dwell_minutes=4),
            Waypoint("Arbeit", *OFFICE, dwell_minutes=6),
            Waypoint("Supermarkt", *SHOP, dwell_minutes=3),
            Waypoint("Zuhause", *HOME, dwell_minutes=4),
        ],
        interval=10.0,
        step_metres=300.0,
    ),
    # Roughly a working day compressed into about three hours of wall clock.
    "day": Profile(
        name="day",
        waypoints=[
            Waypoint("Zuhause", *HOME, dwell_minutes=25),
            Waypoint("Arbeit", *OFFICE, dwell_minutes=104),
            Waypoint("Supermarkt", *SHOP, dwell_minutes=18),
            Waypoint("Zuhause", *HOME, dwell_minutes=30),
        ],
    ),
}


def haversine(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Great-circle distance in metres."""
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.sin(d_lon / 2) ** 2 * math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat))
    )
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def offset(lat: float, lon: float, north_m: float, east_m: float):
    """Shifts a coordinate by a distance in metres."""
    new_lat = lat + north_m / 111_320.0
    new_lon = lon + east_m / (111_320.0 * math.cos(math.radians(lat)))
    return new_lat, new_lon


def jittered(lat: float, lon: float, metres: float):
    if metres <= 0:
        return lat, lon
    angle = random.uniform(0, 2 * math.pi)
    radius = random.uniform(0, metres)
    return offset(lat, lon, radius * math.cos(angle), radius * math.sin(angle))


class HomeAssistantClient:
    def __init__(self, base_url: str, token: str, dry_run: bool = False):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.dry_run = dry_run

    def pause(self, seconds: float) -> None:
        """A dry run should print the plan immediately, not wait it out."""
        if not self.dry_run:
            time.sleep(seconds)

    def _request(self, path: str, payload=None, method: str = "GET"):
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=None if payload is None else json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                body = response.read()
            return json.loads(body) if body else None
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", "replace")[:200]
            raise SystemExit(f"Home Assistant rejected the request ({err.code}): {detail}")
        except urllib.error.URLError as err:
            raise SystemExit(f"Cannot reach {self.base_url}: {err.reason}")

    def load_zones(self) -> None:
        """
        Reads the zones once, so the tracker state can be derived locally.

        A dry run reads them too when a token is available, otherwise its plan
        would claim every waypoint is outside every zone.
        """
        self.zones = []
        if not self.token:
            return
        states = self._request("/api/states") or []
        self.zones = [
            {
                "id": entry["entity_id"],
                "name": entry["attributes"].get("friendly_name", entry["entity_id"]),
                "lat": entry["attributes"]["latitude"],
                "lon": entry["attributes"]["longitude"],
                "radius": entry["attributes"].get("radius", 100),
            }
            for entry in states
            if entry["entity_id"].startswith("zone.")
            and not entry["attributes"].get("passive")
            and "latitude" in entry["attributes"]
        ]

    def zone_state(self, lat: float, lon: float) -> str:
        """Mirrors what Home Assistant does: smallest matching zone wins."""
        matches = [
            zone
            for zone in getattr(self, "zones", [])
            if haversine(lat, lon, zone["lat"], zone["lon"]) <= zone["radius"]
        ]
        if not matches:
            return "not_home"
        best = min(matches, key=lambda zone: zone["radius"])
        return "home" if best["id"] == "zone.home" else best["name"]

    def see(self, dev_id: str, lat: float, lon: float, accuracy: int, battery: int) -> None:
        """
        Writes the tracker state directly.

        `device_tracker.see` would be the obvious call, but it is deprecated and
        disappears in Home Assistant 2027.5. Setting the state through the REST
        API has one consequence: nobody resolves the zone for us any more, so
        `zone_state` does it here.
        """
        state = self.zone_state(lat, lon)
        payload = {
            "state": state,
            "attributes": {
                "source_type": "gps",
                "latitude": round(lat, 6),
                "longitude": round(lon, 6),
                "gps_accuracy": accuracy,
                "battery_level": battery,
                "friendly_name": dev_id.replace("_", " ").title(),
            },
        }
        if self.dry_run:
            print(f"  [dry-run] {dev_id} = {state} {json.dumps(payload['attributes'])}")
            return

        self._request(f"/api/states/device_tracker.{dev_id}", payload, method="POST")


def travel(client, dev_id, profile, start, end, speed):
    """Walks a straight line between two waypoints, one sample at a time."""
    total = haversine(start.lat, start.lon, end.lat, end.lon)
    steps = max(1, int(total / profile.step_metres))
    print(f"  fahrt {start.name} -> {end.name}: {total / 1000:.1f} km in {steps} Schritten")

    for step in range(1, steps + 1):
        ratio = step / steps
        lat = start.lat + (end.lat - start.lat) * ratio
        lon = start.lon + (end.lon - start.lon) * ratio
        lat, lon = jittered(lat, lon, profile.jitter_metres)
        client.see(dev_id, lat, lon, profile.gps_accuracy, profile.battery)
        client.pause(profile.interval / speed)


def dwell(client, dev_id, profile, waypoint, speed):
    """Stands still and keeps reporting, the way a real tracker does."""
    seconds = waypoint.dwell_minutes * 60 / speed
    samples = max(2, int(seconds / profile.interval))
    print(
        f"  aufenthalt {waypoint.name}: {waypoint.dwell_minutes:.0f} min "
        f"({samples} Messpunkte, real {seconds / 60:.1f} min)"
    )

    for _ in range(samples):
        lat, lon = jittered(waypoint.lat, waypoint.lon, profile.jitter_metres)
        client.see(dev_id, lat, lon, profile.gps_accuracy, profile.battery)
        client.pause(profile.interval)


def estimate_seconds(profile: Profile, speed: float) -> float:
    total = 0.0
    for index, waypoint in enumerate(profile.waypoints):
        total += waypoint.dwell_minutes * 60 / speed
        if index + 1 < len(profile.waypoints):
            nxt = profile.waypoints[index + 1]
            distance = haversine(waypoint.lat, waypoint.lon, nxt.lat, nxt.lon)
            steps = max(1, int(distance / profile.step_metres))
            total += steps * profile.interval / speed
    return total


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Simulate a location history for the Family Tracking Card.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Note that the recorder timestamps every sample in real time. A stay "
            "only becomes a stay once that much wall-clock time has actually "
            "passed, so --speed shortens the recorded stays as well. Lower the "
            "card's stay_min_duration accordingly when speeding things up."
        ),
    )
    parser.add_argument("--url", default=os.environ.get("HA_URL", "http://localhost:8123"))
    parser.add_argument("--token", default=os.environ.get("HA_TOKEN", ""))
    parser.add_argument("--dev-id", default="sim_phone", help="device_tracker id to feed")
    parser.add_argument("--profile", choices=sorted(PROFILES), default="quick")
    parser.add_argument(
        "--speed",
        type=float,
        default=1.0,
        help="compress the run by this factor (1 = real time)",
    )
    parser.add_argument("--jitter", type=float, default=None, help="GPS noise in metres")
    parser.add_argument("--loop", action="store_true", help="repeat the route until stopped")
    parser.add_argument("--dry-run", action="store_true", help="print samples instead of sending")
    parser.add_argument("--seed", type=int, default=None, help="make the jitter reproducible")
    parser.add_argument(
        "--home",
        default=None,
        metavar="LAT,LON",
        help=(
            "move the whole route so that its home waypoint lands here, keeping "
            "the relative geometry. Use your zone.home, otherwise the office "
            "waypoint may fall inside it and every stay is reported as home."
        ),
    )
    return parser.parse_args(argv)


def relocate(profile: Profile, lat: float, lon: float) -> None:
    """Shifts every waypoint by the offset that puts the home waypoint on lat/lon.

    Only the distances between the waypoints matter for the detection, so moving
    the route as a whole keeps the scenario intact while making it fit a given
    Home Assistant instance.
    """
    origin = profile.waypoints[0]
    d_lat = lat - origin.lat
    d_lon = lon - origin.lon
    for waypoint in profile.waypoints:
        waypoint.lat += d_lat
        waypoint.lon += d_lon


def main(argv=None) -> int:
    args = parse_args(argv or sys.argv[1:])

    if not args.token and not args.dry_run:
        print(
            "No token. Create a long-lived access token in your Home Assistant "
            "profile and pass it via --token or HA_TOKEN.",
            file=sys.stderr,
        )
        return 2

    if args.speed <= 0:
        print("--speed must be greater than 0", file=sys.stderr)
        return 2

    if args.seed is not None:
        random.seed(args.seed)

    profile = PROFILES[args.profile]
    if args.jitter is not None:
        profile.jitter_metres = args.jitter
    if args.home:
        try:
            home_lat, home_lon = (float(part) for part in args.home.split(","))
        except ValueError:
            print("--home expects LAT,LON, for example 48.2385,16.3774", file=sys.stderr)
            return 2
        relocate(profile, home_lat, home_lon)

    client = HomeAssistantClient(args.url, args.token, args.dry_run)
    client.load_zones()
    estimate = estimate_seconds(profile, args.speed)

    print(f"Profil '{profile.name}' auf {args.url} als device_tracker.{args.dev_id}")
    print(f"Geschätzte Laufzeit: {estimate / 60:.0f} min (Speed {args.speed}x)")
    print("Abbruch jederzeit mit Strg+C.\n")

    try:
        while True:
            for index, waypoint in enumerate(profile.waypoints):
                dwell(client, args.dev_id, profile, waypoint, args.speed)
                if index + 1 < len(profile.waypoints):
                    travel(
                        client,
                        args.dev_id,
                        profile,
                        waypoint,
                        profile.waypoints[index + 1],
                        args.speed,
                    )
            if not args.loop:
                break
            print("\nRoute beendet, starte erneut.\n")
    except KeyboardInterrupt:
        print("\nAbgebrochen.")
        return 130

    print("\nFertig. Die Karte zeigt den Verlauf nach einem Hard-Refresh (Strg+Shift+R).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
