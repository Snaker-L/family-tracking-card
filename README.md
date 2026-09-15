# Family Tracking Card

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories)
[![Release](https://img.shields.io/github/v/release/Snaker-L/family-tracking-card)](https://github.com/Snaker-L/family-tracking-card/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A Lovelace card that puts every Home Assistant person on one map and turns their
location history into a **readable list of stays** instead of raw coordinates:

```
1  Home                 06:12 – 07:48 · 1 h 36 min    → 8.4 km
2  Hauptstraße 12, Wien 08:03 – 09:47 · 1 h 44 min    → 2.1 km
3  Work                 10:02 – 17:30 · 7 h 28 min
```

- Every person at once, each in their own colour, with chips to show and hide them
- Street and satellite tiles, switchable above the map, without losing pan or zoom
- Addresses resolved through Nominatim, cached and rate limited
- Zones drawn as circles, with a per-zone icon and colour
- Full GUI editor — no YAML required

## Install

### HACS

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Snaker-L&repository=family-tracking-card&category=dashboard)

The button adds this repository to HACS on your own instance. Then click
**Download**; HACS registers the resource for you.

Adding it by hand: HACS → Dashboard → ⋮ → *Custom repositories* → URL
`https://github.com/Snaker-L/family-tracking-card`, category **Dashboard**.

### Manual

1. Download `family-tracking-card.js` from the
   [latest release](https://github.com/Snaker-L/family-tracking-card/releases/latest)
   into `config/www/`.
2. Settings → Dashboards → ⋮ → Resources → Add resource:
   URL `/local/family-tracking-card.js`, type **JavaScript module**.

## Usage

Add the card from the picker and configure it in the editor. In YAML, this is
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

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `title` | string | – | Card header |
| `time_ranges` | list | `[6, 24, 72, 168]` | Selectable ranges, in hours |
| `map_height` | number \| `fill` | `480` | Height in pixels, or fill the space the card is given |
| `street_style` | see below | `esri_gray` | Street tiles |
| `satellite_style` | see below | `esri_imagery` | Satellite tiles |
| `custom_street` | map | – | Own tile URL, when `street_style: custom` |
| `custom_satellite` | map | – | Own tile URL, when `satellite_style: custom` |
| `person_colors` | map | palette | Colour per entity id, e.g. `person.anna: "#7c4dff"` |
| `hidden_persons` | list | `[]` | Persons the card leaves out entirely |
| `show_stays` | boolean | `true` | Stay list below the map |
| `show_zones` | boolean | `false` | Draw zones as circles with their icon |
| `zone_icons` | map | – | Icon per zone, e.g. `zone.school: mdi:school` |
| `zone_colors` | map | – | Icon and circle colour per zone |
| `hidden_zones` | list | `[]` | Zones the card leaves out |
| `geocode` | boolean | `true` | Resolve addresses via Nominatim |
| `geocode_email` | string | – | Contact address, see the Nominatim usage policy |

`hidden_persons` and `hidden_zones` store what is *excluded*, so anything you add
to Home Assistant later shows up instead of silently going missing.

### Tile styles

**`street_style`** — `osm`, `esri_gray` (follows your theme), `esri_streets`,
`esri_topo`, `esri_relief`, `osm_hot`, `opentopo`, `basemap_at`,
`basemap_at_gray`, `custom`

**`satellite_style`** — `esri_imagery`, `esri_hybrid`, `basemap_at_ortho`,
`basemap_at_ortho_labels`, `custom`

The `basemap_at` styles cover Austria only. A custom source takes a URL plus
optional `subdomains`, `attribution`, `max_zoom` and `referrer_policy`:

```yaml
street_style: custom
custom_street:
  url: https://tile.example.org/{z}/{x}/{y}.png
  attribution: © Example
```

If OpenStreetMap tiles come back as a "blocked" image, that is the missing
referrer, not the URL: Home Assistant sends `Referrer-Policy: no-referrer`, and
OSM rejects those requests. The built-in `osm` style already overrides it; for a
custom source, set `referrer_policy: origin`. Be aware this reveals your
instance host to the tile provider.

## Good to know

- **Recorder retention.** By default the recorder keeps only 10 days, so longer
  ranges will come up empty. Raise `purge_keep_days` if you need more.
- **Nominatim.** Its usage policy allows one request per second and requires
  caching. The card does both: requests are serialised, results live in
  `localStorage` for 30 days. A browser cannot set `User-Agent`, so the card
  identifies itself through the referer and, optionally, `geocode_email`.
  The cache is per device — every browser geocodes once for itself.
- **Stays inside a known zone** come straight from the state changes, so arrival
  and departure are exact. Only the parts outside any zone go through
  clustering, which is why those are marked differently on the map.

## Development

```bash
yarn install
yarn build          # bundle to dist/
yarn test           # unit tests
yarn typecheck
```

`dev/ha.sh up` starts a Home Assistant container with this repository's `dist/`
mounted, so a rebuild plus a refresh is the whole loop. See `dev/` for the
helper scripts.

## License

MIT — see [LICENSE](LICENSE).
