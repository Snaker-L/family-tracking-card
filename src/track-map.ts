/**
 * Leaflet wrapper.
 *
 * The map instance lives here rather than inside the Lit element on purpose:
 * Lit re-renders its template on every property change, which would tear down
 * and rebuild the map and reset centre and zoom. This class owns one map for
 * the lifetime of the card and only ever mutates it.
 */
import * as L from "leaflet/dist/leaflet-src.esm.js";
import { MAX_ZOOM, resolveStyle, type MapLayerId, type StyleChoice } from "./const";

export type TileStyleChoice = StyleChoice;
import type { Segment, Stay } from "./stay-points";
import type { TrackPoint } from "./types";

export interface TrackMapOptions {
  layer: MapLayerId;
  styles: StyleChoice;
  zoom: number;
  center: [number, number];
  /** Picks the dark tile variant, following the Home Assistant theme. */
  dark?: boolean;
}

/** One person's path and current position, drawn in that person's colour. */
export interface MapTrack {
  segments: Segment[];
  current?: TrackPoint;
  picture?: string;
  initials: string;
  color: string;
}

/**
 * A stay marker. The numbering is handed in rather than counted here, because
 * the list below the map merges every person chronologically and the numbers
 * have to match between the two.
 */
export interface MapStay {
  lat: number;
  lon: number;
  number: number;
  color: string;
  label: string;
  source: Stay["source"];
}

/** One zone: the circle Home Assistant defines, plus its icon in the middle. */
export interface MapZone {
  lat: number;
  lon: number;
  /** Metres, straight from the zone entity. */
  radius: number;
  label: string;
  icon: string;
  color: string;
  /** A passive zone never triggers presence; the circle says so. */
  passive: boolean;
}

export interface TrackRenderOptions {
  tracks: MapTrack[];
  stays: MapStay[];
  zones: MapZone[];
  onStayClick?: (number: number) => void;
  /** Changes whenever a new data set was loaded; triggers one auto-fit. */
  signature: string;
}

export class TrackMap {
  private map?: L.Map;
  /**
   * Keyed by layer and theme. A value is a group, because the grey basemaps
   * need their label overlay drawn on top of them.
   */
  private tiles = new Map<string, L.LayerGroup>();
  private activeKey?: string;
  private dark = false;
  private styles: StyleChoice = { street: "esri_gray", satellite: "esri_imagery" };
  private overlay?: L.LayerGroup;
  private stayMarkers: L.Marker[] = [];
  /** Guards the one-time auto-fit per data set. */
  private fittedSignature = "";

  get ready(): boolean {
    return this.map !== undefined;
  }

  attach(container: HTMLElement, options: TrackMapOptions): void {
    if (this.map) return;
    this.map = L.map(container, { zoomControl: true, attributionControl: true });
    this.map.setView(options.center, options.zoom);
    this.overlay = L.layerGroup().addTo(this.map);
    this.dark = options.dark ?? false;
    this.styles = options.styles;
    this.setTileLayer(options.layer, this.dark, options.styles);
  }

  destroy(): void {
    this.map?.remove();
    this.map = undefined;
    this.overlay = undefined;
    this.tiles.clear();
    this.activeKey = undefined;
    this.stayMarkers = [];
    this.fittedSignature = "";
  }

  /**
   * Swaps the tile layer in place. Centre and zoom survive because the map
   * itself is never recreated, which is exactly where the built-in map card
   * falls short.
   */
  setTileLayer(id: MapLayerId, dark = this.dark, styles = this.styles): void {
    if (!this.map) return;
    this.dark = dark;
    this.styles = styles;

    const style = resolveStyle(id, dark, styles);
    const key = style.key;
    if (this.activeKey === key) return;

    if (!this.tiles.has(key)) {
      const group = L.layerGroup(
        style.layers.map((layer, index) =>
          L.tileLayer(layer.url, {
            maxZoom: MAX_ZOOM,
            maxNativeZoom: layer.maxNativeZoom,
            ...(layer.subdomains ? { subdomains: layer.subdomains } : {}),
            ...(layer.referrerPolicy ? { referrerPolicy: layer.referrerPolicy } : {}),
            // Only the base layer carries the attribution, otherwise Leaflet
            // repeats the same credit once per overlay.
            ...(index === 0 ? { attribution: style.attribution } : {}),
          })
        )
      );
      this.tiles.set(key, group);
    }

    const next = this.tiles.get(key)!;
    const previous = this.activeKey ? this.tiles.get(this.activeKey) : undefined;

    this.map.addLayer(next);
    if (previous) this.map.removeLayer(previous);
    // No bringToBack needed: Leaflet keeps tiles in their own pane below the
    // overlays, and inside the group the label layer is added after the base.
    this.activeKey = key;
  }

  invalidateSize(): void {
    this.map?.invalidateSize();
  }

  /** Current centre and zoom, so a detach/attach cycle can restore the view. */
  viewState(): { center: [number, number]; zoom: number } | undefined {
    if (!this.map) return undefined;
    const center = this.map.getCenter();
    return { center: [center.lat, center.lng], zoom: this.map.getZoom() };
  }

  focus(lat: number, lon: number, zoom?: number): void {
    if (!this.map) return;
    this.map.setView([lat, lon], zoom ?? Math.max(this.map.getZoom(), 16), { animate: true });
  }

  openStay(index: number): void {
    this.stayMarkers[index]?.openPopup();
  }

  /** Redraws the overlay. The base map, centre and zoom stay untouched. */
  render(options: TrackRenderOptions): void {
    if (!this.map || !this.overlay) return;

    this.overlay.clearLayers();
    this.stayMarkers = [];

    const bounds: L.LatLngTuple[] = [];

    // Zones go down first so that no track or marker ends up underneath one.
    // They stay out of `bounds` on purpose: a zone with a kilometre radius
    // would otherwise decide the zoom, and the point of the fit is the people.
    for (const zone of options.zones) {
      L.circle([zone.lat, zone.lon], {
        radius: zone.radius,
        color: zone.color,
        weight: 2,
        opacity: 0.7,
        fillOpacity: 0.08,
        ...(zone.passive ? { dashArray: "5 5" } : {}),
        // Clicks belong to the stay markers underneath, not to the circle.
        interactive: false,
      }).addTo(this.overlay);

      L.marker([zone.lat, zone.lon], {
        icon: zoneIcon(zone.icon, zone.color),
        // Below stays (200) and persons (1000): the zone is the backdrop.
        zIndexOffset: 100,
        title: zone.label,
        interactive: false,
      }).addTo(this.overlay);
    }

    for (const track of options.tracks) {
      for (const segment of track.segments) {
        if (segment.kind !== "trip") continue;
        const line = segment.path.map((p) => [p.lat, p.lon] as L.LatLngTuple);
        L.polyline(line, {
          color: track.color,
          weight: 4,
          opacity: 0.85,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(this.overlay);
        bounds.push(...line);
      }
    }

    for (const stay of options.stays) {
      const marker = L.marker([stay.lat, stay.lon], {
        icon: stayIcon(stay.number, stay.source, stay.color),
        zIndexOffset: 200,
        title: stay.label,
      });
      if (stay.label) marker.bindPopup(escapeHtml(stay.label));
      if (options.onStayClick) marker.on("click", () => options.onStayClick!(stay.number));
      marker.addTo(this.overlay);
      this.stayMarkers.push(marker);
      bounds.push([stay.lat, stay.lon]);
    }

    // Drawn last so a person marker is never hidden under somebody's track.
    for (const track of options.tracks) {
      if (!track.current) continue;
      const { lat, lon, accuracy } = track.current;
      if (accuracy && accuracy > 0) {
        L.circle([lat, lon], {
          radius: accuracy,
          color: track.color,
          weight: 1,
          opacity: 0.4,
          fillOpacity: 0.12,
        }).addTo(this.overlay);
      }
      L.marker([lat, lon], {
        icon: personIcon(track.picture, track.initials, track.color),
        zIndexOffset: 1000,
      }).addTo(this.overlay);
      bounds.push([lat, lon]);
    }

    if (bounds.length > 0 && this.fittedSignature !== options.signature) {
      this.fittedSignature = options.signature;
      this.map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 17 });
    }
  }

  /** Re-runs the auto-fit on the next render, e.g. after a person switch. */
  resetFit(): void {
    this.fittedSignature = "";
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

/**
 * Markers are built as div icons so the card ships without image assets.
 * Leaflet injects the markup into the map pane, which sits inside the card
 * shadow root, so the card stylesheet applies to them.
 */
function stayIcon(number: number, source: Stay["source"], color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html:
      `<div class="ftc-marker ftc-marker--${source}" ` +
      `style="--ftc-marker-color:${escapeHtml(color)}">${number}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

/**
 * The zone icon. `ha-icon` is Home Assistant's own element and is defined
 * globally, so it resolves inside the card's shadow root as well -- which is
 * what makes every Material Design icon available here without shipping any.
 */
function zoneIcon(icon: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html:
      `<div class="ftc-zone" style="--ftc-zone-color:${escapeHtml(color)}">` +
      `<ha-icon icon="${escapeHtml(icon)}"></ha-icon></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function personIcon(picture: string | undefined, initials: string, color: string): L.DivIcon {
  const inner = picture
    ? `<img src="${escapeHtml(picture)}" alt="" />`
    : `<span>${escapeHtml(initials)}</span>`;
  return L.divIcon({
    className: "",
    html:
      `<div class="ftc-marker ftc-marker--person" ` +
      `style="--ftc-marker-color:${escapeHtml(color)}">${inner}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}
