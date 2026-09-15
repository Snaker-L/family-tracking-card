export const CARD_VERSION = "0.1.0";

export const CARD_TAG = "family-tracking-card";
export const EDITOR_TAG = "family-tracking-card-editor";

/**
 * Tile styles. Everything here comes from ArcGIS Online and needs no API key.
 *
 * Two sources were tried and dropped, which is worth recording so they do not
 * come back. CARTO serves a real map but stamps "API KEY REQUIRED" across it --
 * light_all and dark_all included. That one is a warning about testing: the
 * watermarked tiles still differ from each other, so comparing bytes says
 * "fine". Only looking at the image finds it. `dev/probe-tiles.mjs` therefore
 * catches blank and blocked tiles, not watermarks; a new source needs one look
 * with human eyes.
 *
 * Home Assistant's own map card uses CARTO, so it currently shows that watermark
 * too -- copying "whatever Home Assistant uses" would inherit the problem. The
 * default is therefore Esri, which follows the theme and works worldwide.
 *
 * OpenStreetMap needed a second look: it is not the deprecated `{s}` subdomains
 * that get blocked, it is the missing referrer. See `TileSpec.referrerPolicy`.
 *
 * A style is a list of layers drawn in order: a base map, optionally overlays
 * with labels. `maxNativeZoom` is per layer because they run out at different
 * levels; Leaflet then upscales instead of showing nothing.
 */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const BASEMAP_AT = "https://mapsneu.wien.gv.at/basemap";

const ESRI_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
const ESRI_IMAGERY_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics";
/** basemap.at is CC BY 4.0 and asks to be named. */
const BASEMAP_AT_ATTRIBUTION =
  'Datenquelle: <a href="https://www.basemap.at">basemap.at</a>';

export interface TileSpec {
  url: string;
  maxNativeZoom: number;
  /** Required for `{s}` URLs; Leaflet has no sensible default for them. */
  subdomains?: string;
  /**
   * Set on the tile `<img>`, overriding the page policy. Home Assistant sends
   * `Referrer-Policy: no-referrer`, and OpenStreetMap answers requests without
   * a referrer with its "Access blocked" image -- which is why OSM tiles look
   * broken inside Home Assistant while the same URL works elsewhere. Only set
   * this where the provider needs it: it reveals the instance host to them.
   */
  referrerPolicy?: ReferrerPolicy;
}

export interface TileStyle {
  label: string;
  attribution: string;
  /** Base map first, overlays after it. */
  layers: TileSpec[];
  /** Used when Home Assistant is in dark mode; falls back to `layers`. */
  darkLayers?: TileSpec[];
}

export const MAX_ZOOM = 20;

export const STREET_STYLES = {
  osm: {
    label: "OpenStreetMap",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    layers: [
      {
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        maxNativeZoom: 19,
        // Without this the tiles come back as "Access blocked"; see TileSpec.
        referrerPolicy: "origin",
      },
    ],
  },
  esri_gray: {
    label: "Esri Grau (folgt dem Theme)",
    attribution: ESRI_ATTRIBUTION,
    layers: [
      { url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
      {
        url: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
        maxNativeZoom: 16,
      },
    ],
    darkLayers: [
      { url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
      {
        url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
        maxNativeZoom: 16,
      },
    ],
  },
  esri_streets: {
    label: "Esri Straßen",
    attribution: ESRI_ATTRIBUTION,
    layers: [{ url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 19 }],
  },
  esri_topo: {
    label: "Esri Topografisch",
    attribution: ESRI_ATTRIBUTION,
    layers: [{ url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 19 }],
  },
  esri_relief: {
    label: "Esri Relief (Gelände)",
    attribution: ESRI_ATTRIBUTION,
    layers: [
      { url: `${ESRI}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
      {
        url: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
        maxNativeZoom: 16,
      },
    ],
  },
  osm_hot: {
    label: "OpenStreetMap Humanitarian",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
      'Kacheln: <a href="https://www.hotosm.org/">HOT</a> &amp; ' +
      '<a href="https://openstreetmap.fr/">OSM France</a>',
    layers: [
      {
        url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
        subdomains: "abc",
        maxNativeZoom: 19,
      },
    ],
  },
  opentopo: {
    label: "OpenTopoMap",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
      'SRTM, Kacheln: <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    layers: [
      {
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        subdomains: "abc",
        maxNativeZoom: 17,
      },
    ],
  },
  basemap_at: {
    label: "basemap.at (nur Österreich)",
    attribution: BASEMAP_AT_ATTRIBUTION,
    layers: [
      { url: `${BASEMAP_AT}/geolandbasemap/normal/google3857/{z}/{y}/{x}.png`, maxNativeZoom: 20 },
    ],
  },
  basemap_at_gray: {
    label: "basemap.at Grau (nur Österreich)",
    attribution: BASEMAP_AT_ATTRIBUTION,
    layers: [
      { url: `${BASEMAP_AT}/bmapgrau/normal/google3857/{z}/{y}/{x}.png`, maxNativeZoom: 20 },
    ],
  },
} as const satisfies Record<string, TileStyle>;

export const SATELLITE_STYLES = {
  esri_imagery: {
    label: "Esri Luftbild",
    attribution: ESRI_IMAGERY_ATTRIBUTION,
    layers: [{ url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 19 }],
  },
  esri_hybrid: {
    label: "Esri Luftbild mit Beschriftung",
    attribution: ESRI_IMAGERY_ATTRIBUTION,
    layers: [
      { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 19 },
      {
        url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
        maxNativeZoom: 16,
      },
      {
        url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
        maxNativeZoom: 19,
      },
    ],
  },
  basemap_at_ortho: {
    label: "basemap.at Orthofoto 30 cm (nur Österreich)",
    attribution: BASEMAP_AT_ATTRIBUTION,
    layers: [
      {
        url: `${BASEMAP_AT}/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg`,
        maxNativeZoom: 20,
      },
    ],
  },
  basemap_at_ortho_labels: {
    label: "basemap.at Orthofoto mit Beschriftung (nur Österreich)",
    attribution: BASEMAP_AT_ATTRIBUTION,
    layers: [
      {
        url: `${BASEMAP_AT}/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg`,
        maxNativeZoom: 20,
      },
      { url: `${BASEMAP_AT}/bmapoverlay/normal/google3857/{z}/{y}/{x}.png`, maxNativeZoom: 20 },
    ],
  },
} as const satisfies Record<string, TileStyle>;

export type StreetStyleId = keyof typeof STREET_STYLES;
export type SatelliteStyleId = keyof typeof SATELLITE_STYLES;

export const DEFAULT_STREET_STYLE: StreetStyleId = "esri_gray";
export const DEFAULT_SATELLITE_STYLE: SatelliteStyleId = "esri_imagery";

export type MapLayerId = "street" | "satellite";

/**
 * Fallback colours for persons that have none configured. Picking by a hash of
 * the entity id rather than by list position keeps a person's colour stable when
 * somebody else is added or removed.
 */
export const PERSON_PALETTE = [
  "#7c4dff",
  "#00b894",
  "#2d7ff9",
  "#ff7043",
  "#e91e63",
  "#00acc1",
  "#8d6e63",
  "#fbc02d",
] as const;

export function fallbackPersonColor(entityId: string): string {
  let hash = 0;
  for (let i = 0; i < entityId.length; i += 1) {
    hash = (hash * 31 + entityId.charCodeAt(i)) >>> 0;
  }
  return PERSON_PALETTE[hash % PERSON_PALETTE.length];
}

/**
 * Zones.
 *
 * Home Assistant already gives every zone an icon, so the card follows that by
 * default and only stores what the user actually overrode. A single neutral
 * colour is the default rather than one per zone: the person palette carries
 * the meaning on this map, and zones tinted in eight colours would compete with
 * it. Anyone who wants a green shop and a blue school can set them.
 */
export const DEFAULT_ZONE_COLOR = "#727272";
export const DEFAULT_ZONE_ICON = "mdi:map-marker-radius";

export interface ZoneStyleConfig {
  zone_icons?: Record<string, string>;
  zone_colors?: Record<string, string>;
}

export interface ZoneVisual {
  icon: string;
  color: string;
}

/** Icon and colour for one zone: the override first, then Home Assistant's. */
export function zoneVisual(
  entityId: string,
  attributes: Record<string, any>,
  config: ZoneStyleConfig
): ZoneVisual {
  return {
    icon: config.zone_icons?.[entityId] || attributes.icon || DEFAULT_ZONE_ICON,
    color: config.zone_colors?.[entityId] || DEFAULT_ZONE_COLOR,
  };
}

export interface ZoneGeometry {
  lat: number;
  lon: number;
  radius: number;
}

/**
 * The circle to draw, or `undefined` when the zone has none.
 *
 * Not every `zone.*` entity can be drawn: Home Assistant also exposes zones
 * without coordinates, and a radius of zero would be an invisible circle with a
 * marker floating at its centre. Those are skipped rather than drawn wrong.
 */
export function zoneGeometry(attributes: Record<string, any>): ZoneGeometry | undefined {
  const lat = Number(attributes.latitude);
  const lon = Number(attributes.longitude);
  const radius = Number(attributes.radius);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (!Number.isFinite(radius) || radius <= 0) return undefined;
  return { lat, lon, radius };
}

/**
 * Map height.
 *
 * `fill` lets the card take whatever height it is given instead of a fixed
 * number of pixels, which is what a panel view is for -- there the dashboard
 * hands the card the whole screen and a fixed 480 px leaves most of it empty.
 * It needs a container with a height to fill, so in a masonry view, where the
 * card is only as tall as its contents, a number is the right answer.
 */
export const FILL_HEIGHT = "fill";

/** Below this the map is unusable, above it no screen follows anyway. */
export const MIN_MAP_HEIGHT = 160;
export const MAX_MAP_HEIGHT = 2000;

/**
 * Fixed behaviour of the card. Only `time_ranges`, `show_stays`, `show_zones`
 * and `geocode` are still configurable; the rest was removed from the config on
 * purpose, to keep the editor down to the handful of things that actually get
 * changed.
 */
export const DEFAULTS = {
  hours_to_show: 24,
  zoom: 13,
  time_ranges: [6, 24, 72, 168],
  map_layer: "street" as MapLayerId,
  map_height: 480 as number | typeof FILL_HEIGHT,
  stay_radius: 120,
  stay_min_duration: 5,
  show_stays: true,
  // Off by default: an existing card must not suddenly grow circles on its map.
  show_zones: false,
  geocode: true,
};

/** A tile source entered by hand, in the spirit of map-card's tile_layer_url. */
export interface CustomTileLayer {
  url: string;
  /** Needed when the URL contains `{s}`, for example `abc`. */
  subdomains?: string;
  attribution?: string;
  max_zoom?: number;
  /** See `TileSpec.referrerPolicy`; `origin` is what OpenStreetMap needs. */
  referrer_policy?: string;
}

export const CUSTOM_STYLE = "custom";

/** The values the browser accepts; anything else would be silently ignored. */
const REFERRER_POLICIES: ReferrerPolicy[] = [
  "",
  "no-referrer",
  "no-referrer-when-downgrade",
  "origin",
  "origin-when-cross-origin",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
];

/** Config comes from YAML, so a typo must not end up on the image element. */
export function toReferrerPolicy(value: string | undefined): ReferrerPolicy | undefined {
  return value && (REFERRER_POLICIES as string[]).includes(value)
    ? (value as ReferrerPolicy)
    : undefined;
}

export interface ResolvedStyle {
  /** Identifies the exact layer set; two different choices must never match. */
  key: string;
  label: string;
  attribution: string;
  layers: readonly TileSpec[];
}

/**
 * Turns "which layer, which theme, which styles" into the concrete tile set.
 *
 * Pure on purpose: the map swaps layers only when the key changes, so a bug
 * here shows up as "the picker does nothing". That is worth a test, and a test
 * needs this out of the Leaflet code.
 */
export interface StyleChoice {
  street: StreetStyleId | typeof CUSTOM_STYLE;
  satellite: SatelliteStyleId | typeof CUSTOM_STYLE;
  customStreet?: CustomTileLayer;
  customSatellite?: CustomTileLayer;
}

export function resolveStyle(layer: MapLayerId, dark: boolean, styles: StyleChoice): ResolvedStyle {
  const id = layer === "street" ? styles.street : styles.satellite;

  if (id === CUSTOM_STYLE) {
    const custom = layer === "street" ? styles.customStreet : styles.customSatellite;
    // An empty URL would leave a blank map with no way back, so fall through to
    // the built-in default until something is actually entered.
    if (custom?.url) {
      return {
        key: `${layer}:custom:${custom.url}`,
        label: "Eigene URL",
        attribution: custom.attribution ?? "",
        layers: [
          {
            url: custom.url,
            maxNativeZoom: custom.max_zoom ?? 19,
            ...(custom.subdomains ? { subdomains: custom.subdomains } : {}),
            ...(toReferrerPolicy(custom.referrer_policy)
              ? { referrerPolicy: toReferrerPolicy(custom.referrer_policy) }
              : {}),
          },
        ],
      };
    }
  }

  const streetId = id === CUSTOM_STYLE ? DEFAULT_STREET_STYLE : (id as StreetStyleId);
  const satelliteId = id === CUSTOM_STYLE ? DEFAULT_SATELLITE_STYLE : (id as SatelliteStyleId);
  const style: TileStyle = layer === "street" ? STREET_STYLES[streetId] : SATELLITE_STYLES[satelliteId];
  const useDark = dark && style.darkLayers !== undefined;
  return {
    key: `${layer}:${layer === "street" ? streetId : satelliteId}:${useDark ? "dark" : "light"}`,
    label: style.label,
    attribution: style.attribution,
    layers: useDark ? style.darkLayers! : style.layers,
  };
}

/** The part of the card config that decides which tiles are drawn. */
export interface StyleConfig {
  street_style?: string;
  satellite_style?: string;
  custom_street?: CustomTileLayer;
  custom_satellite?: CustomTileLayer;
}

/** Falls back when a config names a style that no longer exists. */
export function sanitizeStyles(config: StyleConfig): StyleChoice {
  const street = config.street_style;
  const satellite = config.satellite_style;
  return {
    street:
      street === CUSTOM_STYLE
        ? CUSTOM_STYLE
        : street && street in STREET_STYLES
          ? (street as StreetStyleId)
          : DEFAULT_STREET_STYLE,
    satellite:
      satellite === CUSTOM_STYLE
        ? CUSTOM_STYLE
        : satellite && satellite in SATELLITE_STYLES
          ? (satellite as SatelliteStyleId)
          : DEFAULT_SATELLITE_STYLE,
    customStreet: config.custom_street,
    customSatellite: config.custom_satellite,
  };
}

/**
 * Which of the two tile pickers was just touched, if either. The editor preview
 * uses it to show the style that was chosen: selecting a satellite map and then
 * still having to press "Satellit" over the preview to see it is a step nobody
 * expects. The custom URLs count as part of their side.
 */
export function editedLayer(previous: StyleConfig, next: StyleConfig): MapLayerId | undefined {
  const before = sanitizeStyles(previous);
  const after = sanitizeStyles(next);

  if (
    before.satellite !== after.satellite ||
    JSON.stringify(before.customSatellite) !== JSON.stringify(after.customSatellite)
  ) {
    return "satellite";
  }
  if (
    before.street !== after.street ||
    JSON.stringify(before.customStreet) !== JSON.stringify(after.customStreet)
  ) {
    return "street";
  }
  return undefined;
}

/**
 * The `ha-form` schema of the editor. Pure data, and here rather than next to
 * the editor so a test can reach it without a DOM.
 *
 * The empty grid name is the load-bearing part. `ha-form` reads a named group
 * from `data[name]` and writes it straight back there, so `name: "toggles"`
 * quietly stored the switches as `toggles: { show_zones: true }` -- a key the
 * card never looks at. The switch then showed its own nested value and looked
 * perfectly on while nothing happened, and the stray `toggles` and `layers`
 * objects in existing configurations are the fossils of exactly that. A grid
 * with an empty name hands the whole object down and keeps the keys flat.
 */
export const EDITOR_SCHEMA = [
  { name: "title", selector: { text: {} } },
  {
    name: "",
    type: "grid",
    schema: [
      { name: "show_stays", selector: { boolean: {} } },
      { name: "show_zones", selector: { boolean: {} } },
      { name: "geocode", selector: { boolean: {} } },
    ],
  },
  { name: "geocode_email", selector: { text: { type: "email" } } },
] as const;

/**
 * Keys written by that bug. They mirror real option names, so leaving them in
 * place means a configuration that permanently reads as if it said something
 * it does not. The card never looked at either of them.
 */
export const OBSOLETE_KEYS = ["toggles", "layers"] as const;

/**
 * The map height a config asks for, or the default when it asks for nonsense.
 * Config comes from YAML, so "480px", an empty string and a negative number all
 * have to land somewhere sensible rather than on the element.
 */
export function resolveMapHeight(value: unknown): number | typeof FILL_HEIGHT {
  if (value === FILL_HEIGHT) return FILL_HEIGHT;
  const height = Number(value);
  if (!Number.isFinite(height)) return DEFAULTS.map_height;
  if (height < MIN_MAP_HEIGHT || height > MAX_MAP_HEIGHT) return DEFAULTS.map_height;
  return height;
}
