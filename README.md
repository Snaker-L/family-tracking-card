# Family Tracking Card

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories)
[![Release](https://img.shields.io/github/v/release/Snaker-L/family-tracking-card)](https://github.com/Snaker-L/family-tracking-card/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A Lovelace card that puts every Home Assistant person on one map and turns their
location history into a readable list of stays instead of raw coordinates.

<p>
  <img src="https://raw.githubusercontent.com/Snaker-L/family-tracking-card/main/docs/screenshot-card.png" alt="The card: person chips, range buttons, a map with a track, and the stay list with addresses below" width="370">
  <img src="https://raw.githubusercontent.com/Snaker-L/family-tracking-card/main/docs/screenshot-satellite.jpg" alt="The same card on satellite tiles, with the view unchanged" width="370">
</p>

- Every person at once, each in their own colour, with chips to show and hide them
- Preset ranges plus a calendar for an exact window — one day, or date and time to date and time
- Street and satellite tiles, switchable above the map, without losing pan or zoom
- Stays with arrival, departure, duration and the distance travelled after them
- Addresses resolved through Nominatim, cached and rate limited
- Zones as circles, with a per-zone icon and colour
- Full GUI editor — no YAML required

## Install

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Snaker-L&repository=family-tracking-card&category=dashboard)

The button adds this repository to HACS on your own instance; then click
**Download**. By hand: HACS → Dashboard → ⋮ → *Custom repositories* → URL
`https://github.com/Snaker-L/family-tracking-card`, category **Dashboard**.

Without HACS: take `family-tracking-card.js` from the
[latest release](https://github.com/Snaker-L/family-tracking-card/releases/latest),
drop it in `config/www/`, and add `/local/family-tracking-card.js` as a
**JavaScript module** under Settings → Dashboards → ⋮ → Resources.

## Usage

Add the card from the picker and set it up in the editor. In YAML this is
enough — every person is included by default:

```yaml
type: custom:family-tracking-card
```

Filling the screen in a panel view:

```yaml
views:
  - type: panel
    cards:
      - type: custom:family-tracking-card
        map_height: fill
        show_zones: true
```

<img src="https://raw.githubusercontent.com/Snaker-L/family-tracking-card/main/docs/screenshot-editor.png" alt="The card editor: toggles, map height, tile styles, a colour per person and an icon per zone, with a live preview" width="740">

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `title` | string | – | Card header |
| `time_ranges` | list | `[1, 4, 6, 8, 12, 16]` | Preset ranges in hours; the calendar is always there |
| `map_height` | number \| `fill` | `480` | Height in pixels, or fill the space the card is given |
| `street_style` | see below | `esri_gray` | Street tiles |
| `satellite_style` | see below | `esri_imagery` | Satellite tiles |
| `custom_street` / `custom_satellite` | map | – | Own tile URL, when the style is `custom` |
| `person_colors` | map | palette | Colour per entity id, e.g. `person.anna: "#7c4dff"` |
| `hidden_persons` | list | `[]` | Persons the card leaves out entirely |
| `show_stays` | boolean | `true` | Stay list below the map |
| `show_zones` | boolean | `false` | Draw zones as circles with their icon |
| `zone_icons` / `zone_colors` | map | – | Icon and colour per zone |
| `hidden_zones` | list | `[]` | Zones the card leaves out |
| `geocode` | boolean | `true` | Resolve addresses via Nominatim |
| `zone_addresses` | boolean | `false` | Also show an address for stays inside a zone |
| `geocode_email` | string | – | Contact address, see the Nominatim usage policy |

`hidden_persons` and `hidden_zones` store what is *excluded*, so anything you
add to Home Assistant later shows up instead of going missing.

### Tile styles

`street_style`: `osm`, `esri_gray` (follows your theme), `esri_streets`,
`esri_topo`, `esri_relief`, `osm_hot`, `opentopo`, `basemap_at`,
`basemap_at_gray`, `custom`

`satellite_style`: `esri_imagery`, `esri_hybrid`, `basemap_at_ortho`,
`basemap_at_ortho_labels`, `custom`

The `basemap_at` styles cover Austria only. A custom source takes a `url` plus
optional `subdomains`, `attribution`, `max_zoom` and `referrer_policy`.

## Good to know

- **The recorder keeps 10 days by default**, so longer ranges come up empty.
  Raise `purge_keep_days` if you need more.
- **A stay inside a zone is exact** — arrival and departure come from the state
  changes. Only the parts outside any zone are clustered, which is why those
  markers look different.
- **The map re-frames only when you change who is on it.** A new time range,
  incoming positions and switching to satellite all leave your view alone.
- **Nominatim allows one request per second and requires caching.** The card
  does both; results live in `localStorage` for 30 days, per device. A browser
  cannot set `User-Agent`, so `geocode_email` is how you identify yourself.
- **Person pictures** come from the person entity; without one you get initials.

## License

MIT — see [LICENSE](LICENSE).
