"""
Turning a Nominatim answer into something a person can read.

Separate from the client on purpose: this is the fiddly part -- the service
answers with whatever it happens to know, and every case has to land somewhere
sensible. Keeping it free of Home Assistant and aiohttp imports means it can be
tested with nothing installed but pytest.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .const import CACHE_PRECISION


def cache_key(latitude: float, longitude: float) -> str:
    """The key two nearby fixes share, so standing still costs one lookup."""
    return f"{latitude:.{CACHE_PRECISION}f},{longitude:.{CACHE_PRECISION}f}"


@dataclass(slots=True)
class Address:
    """The parts of an address the card and the sensors actually use."""

    label: str
    name: str = ""
    house_number: str = ""
    street: str = ""
    postcode: str = ""
    city: str = ""
    county: str = ""
    state: str = ""
    country: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "label": self.label,
            "name": self.name,
            "house_number": self.house_number,
            "street": self.street,
            "postcode": self.postcode,
            "city": self.city,
            "county": self.county,
            "state": self.state,
            "country": self.country,
        }


def parse(payload: dict[str, Any]) -> Address:
    """
    Turn a Nominatim answer into one readable line plus its parts.

    Written against what the service actually returns rather than its schema: a
    footpath has no `road`, a shop has no house number, and a field in the middle
    of nowhere has neither. Each step falls back to the next thing a person would
    recognise, and the raw `display_name` is the last resort because it is long
    enough to break any layout.
    """
    address: dict[str, str] = payload.get("address") or {}

    street = (
        address.get("road")
        or address.get("pedestrian")
        or address.get("footway")
        or address.get("path")
        or ""
    )
    city = (
        address.get("village")
        or address.get("town")
        or address.get("city")
        or address.get("municipality")
        or ""
    )
    name = payload.get("name") or address.get("amenity") or address.get("shop") or ""
    house_number = address.get("house_number") or ""

    if street:
        head = f"{street} {house_number}".strip()
    elif name:
        head = name
    else:
        head = city or address.get("county") or ""

    label = ", ".join(part for part in (head, city if head != city else "") if part)
    if not label:
        display = payload.get("display_name") or ""
        # Each part carries the space that followed the comma; joining them
        # again without stripping produces "Somewhere,  Somehow".
        label = ", ".join(part.strip() for part in display.split(",")[:2] if part.strip())

    return Address(
        label=label,
        name=name,
        house_number=house_number,
        street=street,
        postcode=address.get("postcode") or "",
        city=city,
        county=address.get("county") or "",
        state=address.get("state") or "",
        country=address.get("country") or "",
    )


def merge_venue(address: Address | None, venue: str) -> Address | None:
    """
    Let the enclosing place speak for the address it contains.

    Reverse geocoding answers "what is nearest", and inside a shopping centre
    that is a coffee bar, a bookshop, or the street the car park faces -- never
    the name on the building everybody uses. Where something encloses the fix,
    it is the better answer, and the parts of the address stay untouched so the
    sensor attributes still carry the street and the postcode.
    """
    if not venue:
        return address
    if address is None:
        # No address at all, but a name for the place is an answer in itself.
        return Address(label=venue, name=venue)

    address.label = ", ".join(part for part in (venue, address.city) if part)
    address.name = venue
    return address
