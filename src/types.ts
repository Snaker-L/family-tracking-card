import type { CustomTileLayer, SatelliteStyleId, StreetStyleId } from "./const";


/**
 * Minimal local typings for the objects the Home Assistant frontend hands to a
 * custom card. Deliberately hand-written instead of pulling in
 * `custom-card-helpers`, so the card has no third-party runtime or type
 * dependency beyond Lit and Leaflet.
 */
export interface HassEntity {
  entity_id: string;
  state: string;
  last_changed: string;
  last_updated: string;
  attributes: Record<string, any>;
}

export interface HassLocale {
  language: string;
  time_zone?: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  language: string;
  locale: HassLocale;
  themes?: { darkMode?: boolean };
  config?: { latitude?: number; longitude?: number };
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
}

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: LovelaceCardConfig): void;
}

/**
 * The card always shows every person, so it needs no entity or selection
 * options. Map height, zoom, layer, stay radius and minimum dwell time are
 * fixed in `DEFAULTS`; time range and layer remain switchable at runtime.
 */
export interface FamilyTrackingCardConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  /** Selectable ranges in hours, rendered as buttons. */
  time_ranges?: number[];
  /** Tile style behind the "Karte" button, or `custom` to use `custom_street`. */
  street_style?: StreetStyleId | "custom";
  /** Tile style behind the "Satellit" button, or `custom` to use `custom_satellite`. */
  satellite_style?: SatelliteStyleId | "custom";
  custom_street?: CustomTileLayer;
  custom_satellite?: CustomTileLayer;
  /** Per person track colour, keyed by entity id. Unset persons fall back to the palette. */
  person_colors?: Record<string, string>;
  /**
   * Persons the card leaves out completely -- no chip, no track, no query.
   * Storing who is excluded rather than who is included means a person added
   * to Home Assistant later shows up instead of silently going missing.
   */
  hidden_persons?: string[];
  /** Height of the map in pixels, or `fill` to use the space the card is given. */
  map_height?: number | "fill";
  show_stays?: boolean;
  /** Draws every zone as a circle with its icon at the centre. */
  show_zones?: boolean;
  /** Per zone icon, keyed by entity id. Unset zones use the one from Home Assistant. */
  zone_icons?: Record<string, string>;
  /** Per zone icon colour, keyed by entity id. */
  zone_colors?: Record<string, string>;
  /** Zones the map leaves out, stored the same way round as `hidden_persons`. */
  hidden_zones?: string[];
  geocode?: boolean;
  /**
   * Also resolve an address for stays that already sit inside a zone, shown as
   * a second line under the zone name. Off by default: a zone already carries
   * the name the user gave it, and every extra lookup costs a Nominatim request.
   */
  zone_addresses?: boolean;
  /** Optional contact address appended to Nominatim requests (their usage policy). */
  geocode_email?: string;
}

/** A single position sample taken from the recorder history. */
export interface TrackPoint {
  /** Epoch milliseconds. */
  t: number;
  lat: number;
  lon: number;
  accuracy?: number;
  /** The person's state at that time: `home`, `not_home` or a zone name. */
  zone: string;
  source?: string;
}
