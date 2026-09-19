"""
Working out which larger place a fix is *inside*.

Reverse geocoding answers "what is nearest", which is the wrong question in a
shopping centre. Standing in the Donauzentrum, Nominatim offers the A1 shop a
few metres away; in the Q19 it offers a Nespresso, in the Stadion Center a
Thalia. None of those is where the person would say they are, and the street
address is no better -- nobody meets at Wagramer Straße 94.

Containment is a different query, and Overpass answers it directly: `is_in`
returns every area a coordinate falls within, and among those the named
shopping centre is the one worth showing.

Kept free of aiohttp and Home Assistant imports so it can be tested with
nothing installed but pytest; the client lives in geocode.py next to the
Nominatim one.
"""

from __future__ import annotations

from typing import Any

#: Which enclosing areas are worth naming instead of the address around them.
#:
#: Deliberately short. A shopping centre is a building with a door and a name
#: everyone uses, so containment means what it says. Sprawling grounds -- a
#: university campus, a hospital estate -- often swallow public streets too,
#: and then walking past would be reported as being inside. Add to this list
#: only where the outline really is the place.
VENUE_TAGS: tuple[tuple[str, str], ...] = (
    ("shop", "mall"),
    ("shop", "department_store"),
)


def build_query(latitude: float, longitude: float, tags: tuple[tuple[str, str], ...] = VENUE_TAGS) -> str:
    """
    The Overpass query asking which of `tags` the coordinate lies inside.

    One request covers every tag, so the list costs nothing to extend.
    """
    grouped: dict[str, list[str]] = {}
    for key, value in tags:
        grouped.setdefault(key, []).append(value)

    filters = "".join(
        f'area.a["{key}"~"^({"|".join(values)})$"];out tags;' for key, values in grouped.items()
    )
    return f"[out:json][timeout:25];is_in({latitude:.6f},{longitude:.6f})->.a;{filters}"


def pick_name(payload: dict[str, Any]) -> str:
    """
    The name to show, out of whatever the query returned.

    More than one area can contain a point -- a centre inside a larger complex,
    or the same place mapped twice. The smallest wins, because the more specific
    outline is the one somebody is actually standing in, and Overpass reports an
    area's size in `tags` only sometimes; where it does not, the first named hit
    is as good an answer as any.
    """
    best_name = ""
    best_area: float | None = None

    for element in payload.get("elements") or []:
        tags = element.get("tags") or {}
        name = tags.get("name") or ""
        if not name:
            continue

        try:
            area = float(tags["area"]) if "area" in tags else None
        except (TypeError, ValueError):
            area = None

        if best_name and not (best_area is None or (area is not None and area < best_area)):
            continue
        best_name, best_area = name, area

    return best_name
