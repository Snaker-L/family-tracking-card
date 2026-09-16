import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import leafletCss from "leaflet/dist/leaflet.css";

import {
  CARD_TAG,
  CARD_VERSION,
  DEFAULTS,
  EDITOR_TAG,
  fallbackPersonColor,
  editedLayer,
  FILL_HEIGHT,
  resolveMapHeight,
  resolveStyle,
  sanitizeStyles,
  zoneGeometry,
  zoneVisual,
  type MapLayerId,
} from "./const";
import { fetchPersonHistory, HistoryError, withCurrentState } from "./history";
import { buildTimeline, staysOf, type Segment, type Stay } from "./stay-points";
import { cacheKeyFor, reverseGeocode } from "./geocode";
import { peekPreviewLayer } from "./preview-layer";
import { TrackMap, type MapZone, type TileStyleChoice } from "./track-map";
import { formatCoordinates, formatDistance, formatDuration, formatRange, formatSpan } from "./format";
import {
  formatAbsoluteRange,
  resolveRange,
  toDateField,
  toTimeField,
  type AbsoluteRange,
  type RangeFields,
} from "./time-range";
import type { FamilyTrackingCardConfig, HassEntity, HomeAssistant, TrackPoint } from "./types";

import "./editor";

/* eslint-disable no-console */
console.info(
  `%c FAMILY-TRACKING-CARD %c ${CARD_VERSION} `,
  "color:#fff;background:#2d7ff9;font-weight:700",
  "color:#2d7ff9;background:#eee"
);

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: CARD_TAG,
  name: "Family Tracking Card",
  description: "Persons on a map, with a readable list of stays instead of raw coordinates.",
  preview: true,
  documentationURL: "https://github.com/Snaker-L/family-tracking-card",
});

/** Everything the card holds for one person. */
interface PersonTrack {
  points: TrackPoint[];
  segments: Segment[];
  current?: TrackPoint;
}

/** One row of the merged stay list, and one marker on the map. */
interface StayEntry {
  stay: Stay;
  person: HassEntity;
  color: string;
  /** Distance of the trip that follows, for the same person. */
  distance?: number;
}

@customElement(CARD_TAG)
export class FamilyTrackingCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  /**
   * Set by Home Assistant on the preview inside the card editor and the card
   * picker. Part of its `LovelaceCard` interface, and the only honest way for a
   * card to know it is not on a dashboard.
   */
  @property({ type: Boolean }) public preview = false;

  @state() private _config?: FamilyTrackingCardConfig;
  /** Reactive UI state, deliberately separate from the config. */
  @state() private _hidden: string[] = [];
  @state() private _staysOpen = true;
  @state() private _timeRange = DEFAULTS.hours_to_show;
  /** An absolute range picked from the calendar; overrides the rolling window. */
  @state() private _range?: AbsoluteRange;
  @state() private _pickerOpen = false;
  @state() private _fields: RangeFields = { fromDate: "", toDate: "", fromTime: "", toTime: "" };
  @state() private _mapLayer: MapLayerId = DEFAULTS.map_layer;

  @state() private _tracks: Record<string, PersonTrack> = {};
  @state() private _labels: Record<string, string> = {};
  @state() private _loading = false;
  @state() private _error?: string;

  /** Held outside the reactive state so Lit never touches the map instance. */
  private _map = new TrackMap();
  private _resizeObserver?: ResizeObserver;
  private _lastQuery = "";
  private _lastPaint = "";
  /** Last seen state per person, to spot a live position without a reload. */
  private _stamps: Record<string, string> = {};
  private _loadToken = 0;
  private _restoreView?: { center: [number, number]; zoom: number };
  private _resizeFrame?: number;
  /**
   * Derived lists, memoised by the identity of what they are built from. Both
   * are read several times per render -- by the map, the header and the list --
   * and each one sorts, so recomputing them is the card's most expensive work.
   */
  private _personsCache?: {
    states: HomeAssistant["states"];
    config: FamilyTrackingCardConfig | undefined;
    result: HassEntity[];
  };
  private _visibleCache?: { persons: HassEntity[]; hidden: string[]; result: HassEntity[] };
  private _zoneCache?: {
    states: HomeAssistant["states"];
    config: FamilyTrackingCardConfig | undefined;
    result: MapZone[];
  };
  private _stayCache?: {
    persons: HassEntity[];
    tracks: Record<string, PersonTrack>;
    result: StayEntry[];
  };

  public static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement(EDITOR_TAG);
  }

  public static getStubConfig(): Partial<FamilyTrackingCardConfig> {
    // Every person is shown by default, so a usable card needs no options.
    return {};
  }

  public setConfig(config: FamilyTrackingCardConfig): void {
    if (!config) throw new Error("Invalid configuration");

    const previous = this._config;
    this._config = { ...config };

    // Which layer the user just worked on, if any. The note from the editor
    // comes first, because it also survives the preview element being rebuilt;
    // the config comparison covers the YAML editor, where nothing leaves a note.
    const layer = peekPreviewLayer() ?? (previous ? editedLayer(previous, config) : undefined);

    if (!previous) {
      // `hidden_persons` removes a person from the card altogether, so the
      // runtime toggles start clean: everything still listed is also shown.
      this._hidden = [];
      this._timeRange = DEFAULTS.hours_to_show;
      this._range = undefined;
      this._mapLayer = layer ?? DEFAULTS.map_layer;
      // Force the first load.
      this._lastQuery = "";
      return;
    }

    // Every keystroke in the editor lands here. Only the person selection
    // changes which histories have to be fetched, so everything else -- title,
    // colours, tile styles -- keeps the data and the map view it already has.
    const before = (previous.hidden_persons ?? []).join(",");
    const after = (config.hidden_persons ?? []).join(",");
    if (before !== after) {
      this._hidden = [];
      this._lastQuery = "";
    }

    // Picking a tile style should show that style straight away instead of
    // making the user find the toggle above the map.
    if (layer) this._mapLayer = layer;
  }

  public getCardSize(): number {
    const height = resolveMapHeight(this._config?.map_height);
    // One unit is roughly 50 px; the chips, buttons and list come on top.
    const map = height === FILL_HEIGHT ? 10 : Math.round(height / 50);
    if (this._config?.show_stays === false || !this._staysOpen) return map + 2;
    return map + 6;
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    // Lit does not re-render on reconnect, but the map was torn down in
    // disconnectedCallback and has to be rebuilt.
    this.requestUpdate();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    if (this._resizeFrame !== undefined) cancelAnimationFrame(this._resizeFrame);
    this._resizeFrame = undefined;
    this._restoreView = this._map.viewState();
    this._map.destroy();
  }

  /**
   * Home Assistant hands out a new `hass` object for every state change in the
   * whole system, several times a second in a busy install. Re-rendering the
   * card for a light switch means rebuilding the stay list and re-walking every
   * track for nothing, which is what made the card feel sluggish. Only a change
   * the card actually shows gets through here.
   */
  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (!this.hass || !this._config) return true;
    if (changed.size > 1 || !changed.has("hass")) return true;
    return this._hassAffectsCard(changed.get("hass") as HomeAssistant | undefined);
  }

  private _hassAffectsCard(previous: HomeAssistant | undefined): boolean {
    const next = this.hass!;
    if (!previous) return true;
    if (previous.themes?.darkMode !== next.themes?.darkMode) return true;
    if (previous.locale?.language !== next.locale?.language) return true;
    if (previous.language !== next.language) return true;
    if (previous.states === next.states) return false;
    // The list shows the zone's friendly name, not its state (the head count).
    if (
      previous.states["zone.home"]?.attributes.friendly_name !==
      next.states["zone.home"]?.attributes.friendly_name
    ) {
      return true;
    }

    // Home Assistant replaces a state object only when that entity changed, so
    // identity is enough; the counter catches a person being added or removed.
    const zones = this._showZones;
    let balance = 0;
    let nextZones = "";
    let previousZones = "";

    for (const id in next.states) {
      if (id.startsWith("person.")) {
        if (previous.states[id] !== next.states[id]) return true;
        balance += 1;
      } else if (zones && id.startsWith("zone.")) {
        nextZones += zoneFingerprint(id, next.states[id]);
      }
    }
    for (const id in previous.states) {
      if (id.startsWith("person.")) balance -= 1;
      else if (zones && id.startsWith("zone.")) {
        previousZones += zoneFingerprint(id, previous.states[id]);
      }
    }

    if (balance !== 0) return true;
    // Identity is useless for zones: their state is the head count, which
    // changes whenever somebody arrives, while the circle stays exactly where
    // it was. Only the handful of attributes the map draws are compared.
    return zones && nextZones !== previousZones;
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    // The fill layout has to reach the host: a card can only stretch when the
    // element Home Assistant placed in the view stretches with it, and `:host`
    // rules apply to that element rather than to anything in the template.
    this.classList.toggle("ftc-fill", this._fillHeight);
    this._ensureMap();
    this._maybeReload();
    // Called unconditionally: layer, theme and style each change it, and the
    // call is a no-op when the resulting layer set is the same one already up.
    // Guessing which property changed is how the editor preview got stuck.
    this._map.setTileLayer(this._mapLayer, this.hass?.themes?.darkMode ?? false, this._styles);
    this._paint();
  }

  /* ---------------------------------------------------------------- data -- */

  /**
   * Every person the card deals with: all of them, minus the ones unticked in
   * the editor. Those are gone entirely -- no chip, no track, and no recorder
   * request either.
   */
  private get _persons(): HassEntity[] {
    if (!this.hass) return [];
    const cached = this._personsCache;
    if (cached && cached.states === this.hass.states && cached.config === this._config) {
      return cached.result;
    }

    const excluded = this._config?.hidden_persons ?? [];
    const result = Object.keys(this.hass.states)
      .filter((id) => id.startsWith("person.") && !excluded.includes(id))
      .map((id) => this.hass!.states[id])
      .sort((a, b) => this._name(a).localeCompare(this._name(b)));

    this._personsCache = { states: this.hass.states, config: this._config, result };
    return result;
  }

  private _isVisible(entityId: string): boolean {
    return !this._hidden.includes(entityId);
  }

  private get _visiblePersons(): HassEntity[] {
    const persons = this._persons;
    const cached = this._visibleCache;
    if (cached && cached.persons === persons && cached.hidden === this._hidden) {
      return cached.result;
    }

    const result = persons.filter((person) => this._isVisible(person.entity_id));
    this._visibleCache = { persons, hidden: this._hidden, result };
    return result;
  }

  private _name(entity: HassEntity): string {
    return entity.attributes.friendly_name ?? entity.entity_id.split(".")[1];
  }

  /**
   * Whether the map should stretch. `fill` needs a container with a height to
   * fill, and a preview box has none -- it sizes itself to whatever is inside
   * it. The map would collapse to nothing there while every control around it
   * stayed, which looks like a broken card rather than a layout that has no
   * room. The preview therefore falls back to the fixed default height, which
   * is all it has to do: show what the card looks like, not how tall it gets.
   */
  private get _fillHeight(): boolean {
    return !this.preview && resolveMapHeight(this._config?.map_height) === FILL_HEIGHT;
  }

  /** Whether the shown window reaches up to now and keeps following it. */
  private get _isLive(): boolean {
    return !this._range || this._range.end >= Date.now();
  }

  private get _showZones(): boolean {
    return this._config?.show_zones ?? DEFAULTS.show_zones;
  }

  /**
   * Every zone that can actually be drawn, in the order Home Assistant lists
   * them. Zones are configuration rather than history, so they need no recorder
   * request and are read straight off the current state.
   */
  private get _zones(): MapZone[] {
    if (!this.hass || !this._showZones) return [];
    const cached = this._zoneCache;
    if (cached && cached.states === this.hass.states && cached.config === this._config) {
      return cached.result;
    }

    const excluded = this._config?.hidden_zones ?? [];
    const result: MapZone[] = [];
    for (const id of Object.keys(this.hass.states)) {
      if (!id.startsWith("zone.") || excluded.includes(id)) continue;
      const entity = this.hass.states[id];
      const geometry = zoneGeometry(entity.attributes);
      if (!geometry) continue;

      const { icon, color } = zoneVisual(id, entity.attributes, this._config ?? {});
      result.push({
        ...geometry,
        label: entity.attributes.friendly_name ?? id.replace("zone.", ""),
        icon,
        color,
        passive: entity.attributes.passive === true,
      });
    }

    this._zoneCache = { states: this.hass.states, config: this._config, result };
    return result;
  }

  private get _styles(): TileStyleChoice {
    return sanitizeStyles(this._config ?? {});
  }

  private get _options() {
    return {
      radius: DEFAULTS.stay_radius,
      minDurationMs: DEFAULTS.stay_min_duration * 60_000,
    };
  }

  /**
   * A `hass` update arrives for every entity in the system, so the recorder is
   * only queried when the set of persons or the time range changed. A new
   * position is folded into the existing track instead.
   */
  private _maybeReload(): void {
    if (!this.hass) return;
    const persons = this._persons;
    if (persons.length === 0) return;

    const ids = persons.map((person) => person.entity_id);
    const query = this._range
      ? `${this._range.start}-${this._range.end}|${ids.join(",")}`
      : `${this._timeRange}|${ids.join(",")}`;

    if (query !== this._lastQuery) {
      this._lastQuery = query;
      this._stamps = Object.fromEntries(
        persons.map((person) => [person.entity_id, `${person.state}|${person.last_updated}`])
      );
      void this._loadAll(ids);
      return;
    }

    for (const person of persons) {
      const stamp = `${person.state}|${person.last_updated}`;
      if (this._stamps[person.entity_id] === stamp) continue;
      this._stamps[person.entity_id] = stamp;
      // A range that ended in the past must not grow a line to where somebody
      // happens to be right now. The stamp is still taken, so the position is
      // not replayed later as if it were new.
      if (this._isLive) this._appendCurrent(person.entity_id);
    }
  }

  private async _loadAll(ids: string[]): Promise<void> {
    if (!this.hass) return;
    const token = ++this._loadToken;

    this._loading = true;
    this._error = undefined;

    const end = this._range ? new Date(this._range.end) : new Date();
    const start = this._range
      ? new Date(this._range.start)
      : new Date(end.getTime() - this._timeRange * 3_600_000);

    // One request per person, in parallel. `allSettled` because a single person
    // without recorder data must not blank out everybody else.
    const results = await Promise.allSettled(
      ids.map((id) => fetchPersonHistory(this.hass!, id, start, end))
    );
    if (token !== this._loadToken) return;

    const tracks: Record<string, PersonTrack> = {};
    const errors: string[] = [];

    results.forEach((result, index) => {
      const id = ids[index];
      if (result.status === "rejected") {
        const reason = result.reason;
        errors.push(reason instanceof HistoryError ? reason.message : String(reason));
        return;
      }
      // Same reason as above: the live position belongs to a window that
      // reaches up to now, not to a historical one.
      tracks[id] = this._trackOf(
        this._isLive ? withCurrentState(result.value, this.hass!, id) : result.value
      );
    });

    this._tracks = tracks;
    const anyPoints = Object.values(tracks).some((track) => track.points.length > 0);
    this._error = anyPoints ? undefined : errors[0] ?? "no-data";
    this._loading = false;
    void this._resolveLabels(token);
  }

  /** Extends one track by the live position, without touching the recorder. */
  private _appendCurrent(entityId: string): void {
    const existing = this._tracks[entityId];
    if (!this.hass || !existing) return;

    const points = withCurrentState(existing.points, this.hass, entityId);
    if (points === existing.points) return;

    this._tracks = { ...this._tracks, [entityId]: this._trackOf(points) };
    void this._resolveLabels(this._loadToken);
  }

  private _trackOf(points: TrackPoint[]): PersonTrack {
    return {
      points,
      current: points[points.length - 1],
      segments: buildTimeline(points, this._options),
    };
  }

  /**
   * Every stay of every visible person, merged into one chronological list.
   * The numbering of the markers on the map follows this order, so both stay
   * in step.
   */
  private get _stayEntries(): StayEntry[] {
    const persons = this._visiblePersons;
    const cached = this._stayCache;
    if (cached && cached.persons === persons && cached.tracks === this._tracks) {
      return cached.result;
    }

    const entries: StayEntry[] = [];

    for (const person of persons) {
      const track = this._tracks[person.entity_id];
      if (!track) continue;

      track.segments.forEach((segment, index) => {
        if (segment.kind !== "stay") return;
        const next = track.segments[index + 1];
        entries.push({
          stay: segment,
          person,
          color: this._colorOf(person.entity_id),
          // The trip that follows belongs to the same person, not to whoever
          // happens to come next in the merged list.
          distance: next?.kind === "trip" ? next.distance : undefined,
        });
      });
    }

    entries.sort((a, b) => a.stay.start - b.stay.start);
    this._stayCache = { persons, tracks: this._tracks, result: entries };
    return entries;
  }

  /**
   * Looks up addresses for stays outside any known zone. Zone stays already
   * carry a name, so they never cost a request.
   */
  private async _resolveLabels(token: number): Promise<void> {
    if (this._config?.geocode === false) return;

    for (const track of Object.values(this._tracks)) {
      for (const stay of staysOf(track.segments)) {
        if (stay.zone) continue;
        const key = cacheKeyFor(stay.lat, stay.lon);
        if (this._labels[key]) continue;

        const label = await reverseGeocode(stay.lat, stay.lon, {
          email: this._config?.geocode_email,
          language: this.hass?.locale?.language ?? this.hass?.language,
        });
        if (token !== this._loadToken) return;
        if (label) this._labels = { ...this._labels, [key]: label };
      }
    }
  }

  private _labelOf(stay: Stay): string {
    if (stay.zone) return this._zoneName(stay.zone);
    return this._labels[cacheKeyFor(stay.lat, stay.lon)] ?? formatCoordinates(stay.lat, stay.lon);
  }

  /** `home` and `not_home` are technical states; show what a zone is called. */
  private _zoneName(state: string): string {
    if (state === "home") {
      return this.hass?.states["zone.home"]?.attributes.friendly_name ?? "Zuhause";
    }
    return state;
  }

  /* ----------------------------------------------------------------- map -- */

  private _ensureMap(): void {
    if (this._map.ready) return;
    const host = this.renderRoot?.querySelector<HTMLDivElement>("#map-host");
    if (!host) return;

    const fallbackCenter: [number, number] = [
      this.hass?.config?.latitude ?? 51.1657,
      this.hass?.config?.longitude ?? 10.4515,
    ];

    this._map.attach(host, {
      layer: this._mapLayer,
      styles: this._styles,
      dark: this.hass?.themes?.darkMode ?? false,
      zoom: this._restoreView?.zoom ?? DEFAULTS.zoom,
      center: this._restoreView?.center ?? fallbackCenter,
    });
    this._restoreView = undefined;
    this._lastPaint = "";

    if (!this._resizeObserver && "ResizeObserver" in window) {
      // A drag on the dashboard fires this per frame, and every call makes
      // Leaflet re-measure and reload tiles. One call per frame is enough.
      this._resizeObserver = new ResizeObserver(() => {
        if (this._resizeFrame !== undefined) return;
        this._resizeFrame = requestAnimationFrame(() => {
          this._resizeFrame = undefined;
          this._map.invalidateSize();
        });
      });
      this._resizeObserver.observe(host);
    }
  }

  private _paint(): void {
    if (!this._map.ready) return;

    const visible = this._visiblePersons;
    const entries = this._stayEntries;

    const zones = this._zones;

    /*
     * What moves the view, and nothing else: which persons are on the map.
     *
     * The rule used to be "a new data set", which quietly covered far too much.
     * Every incoming position and every address returned by Nominatim counted,
     * so the map re-fitted seconds after the user had zoomed somewhere. The time
     * range counted too, so reaching for another button zoomed back out -- and
     * that is the one moment where the view matters most, because the question
     * is what happened *here* over a longer stretch.
     *
     * Switching persons still re-frames, because that is a deliberate change of
     * what the map is about.
     */
    const fitSignature = visible.map((person) => person.entity_id).join(",");

    /** Everything that changes what is drawn, so the overlay stays current. */
    const paintSignature = [
      fitSignature,
      entries.length,
      Object.keys(this._labels).length,
      visible
        .map((person) => {
          const track = this._tracks[person.entity_id];
          return `${person.entity_id}:${this._colorOf(person.entity_id)}:${track?.current?.t ?? 0}`;
        })
        .join("|"),
    ].join("|");

    // Zones are deliberately kept out of the fit signature: switching them on
    // must redraw the overlay, but it must not yank the map back to the
    // auto-fit and throw away wherever the user had panned to.
    const signature = `${paintSignature}|${zones
      .map((zone) => `${zone.lat},${zone.lon},${zone.radius},${zone.icon},${zone.color}`)
      .join(";")}`;
    if (signature === this._lastPaint) return;
    this._lastPaint = signature;

    this._map.render({
      zones,
      tracks: visible.flatMap((person) => {
        const track = this._tracks[person.entity_id];
        if (!track) return [];
        return [
          {
            segments: track.segments,
            current: track.current,
            picture: person.attributes.entity_picture,
            initials: initials(this._name(person)),
            color: this._colorOf(person.entity_id),
          },
        ];
      }),
      stays: entries.map((entry, index) => ({
        lat: entry.stay.lat,
        lon: entry.stay.lon,
        number: index + 1,
        color: entry.color,
        label: `${this._name(entry.person)}: ${this._labelOf(entry.stay)}`,
        source: entry.stay.source,
      })),
      onStayClick: (number) => this._scrollToStay(number - 1),
      signature: fitSignature,
    });
  }

  private _scrollToStay(index: number): void {
    this.renderRoot
      ?.querySelector(`.stay[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /* -------------------------------------------------------------- events -- */

  /** Shows or hides one person. Only reactive state changes, the map survives. */
  private _togglePerson(entityId: string): void {
    this._hidden = this._isVisible(entityId)
      ? [...this._hidden, entityId]
      : this._hidden.filter((id) => id !== entityId);
  }

  private _selectRange(hours: number): void {
    if (this._timeRange === hours && !this._range) return;
    this._timeRange = hours;
    this._range = undefined;
    this._pickerOpen = false;
  }

  /**
   * Opens the calendar, prefilled with the window currently on screen so there
   * is something to adjust rather than four empty fields.
   */
  private _togglePicker(): void {
    if (!this._pickerOpen && !this._range) {
      const end = Date.now();
      const start = end - this._timeRange * 3_600_000;
      this._fields = {
        fromDate: toDateField(start),
        toDate: toDateField(end),
        fromTime: toTimeField(start),
        toTime: toTimeField(end),
      };
    }
    this._pickerOpen = !this._pickerOpen;
  }

  private _setField(key: keyof RangeFields, value: string): void {
    this._fields = { ...this._fields, [key]: value };
  }

  private _applyRange(): void {
    const range = resolveRange(this._fields);
    if (!range) return;
    this._range = range;
    this._pickerOpen = false;
  }

  private _clearRange(): void {
    this._range = undefined;
    this._pickerOpen = false;
  }

  private _toggleLayer(): void {
    this._mapLayer = this._mapLayer === "street" ? "satellite" : "street";
  }

  private _focusStay(entry: StayEntry, index: number): void {
    this._map.focus(entry.stay.lat, entry.stay.lon);
    this._map.openStay(index);
  }

  /* -------------------------------------------------------------- render -- */

  protected override render(): TemplateResult {
    const persons = this._persons;
    const ranges = this._config?.time_ranges?.length
      ? this._config.time_ranges
      : DEFAULTS.time_ranges;
    const configured = resolveMapHeight(this._config?.map_height);
    const fill = this._fillHeight;
    const height = configured === FILL_HEIGHT ? DEFAULTS.map_height : configured;
    const locale = this._locale;

    return html`
      <ha-card .header=${this._config?.title}>
        <div class="people">
          ${persons.map((person) => this._renderPerson(person))}
          ${persons.length === 0 ? html`<div class="hint">Keine person-Entität gefunden.</div>` : nothing}
        </div>

        <div class="controls">
          <div class="ranges">
            ${ranges.map(
              (hours) => html`
                <button
                  class=${hours === this._timeRange && !this._range ? "chip selected" : "chip"}
                  @click=${() => this._selectRange(hours)}
                >
                  ${formatRange(hours)}
                </button>
              `
            )}
            <button
              class=${this._range ? "chip picked selected" : "chip picked"}
              @click=${this._togglePicker}
              aria-expanded=${this._pickerOpen ? "true" : "false"}
              title="Zeitraum über Kalender und Uhrzeit wählen"
            >
              <svg class="picker-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M9 10H7v2h2v-2m4 0h-2v2h2v-2m4 0h-2v2h2v-2m2-7h-1V1h-2v2H8V1H6v2H5a2 2 0 0
                     0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m0 16H5V8h14v11Z"
                />
              </svg>
              ${this._range ? formatAbsoluteRange(this._range, locale) : "Zeitraum"}
            </button>
          </div>
          <button
            class="chip layer"
            @click=${this._toggleLayer}
            title=${`Aktuell: ${resolveStyle(this._mapLayer, this.hass?.themes?.darkMode ?? false, this._styles).label}`}
          >
            ${this._mapLayer === "street" ? "Satellit" : "Karte"}
          </button>
        </div>

        ${this._pickerOpen ? this._renderPicker() : nothing}

        <div class="map-wrap" style=${fill ? "" : `height:${height}px`}>
          <div id="map-host"></div>
          ${this._loading ? html`<div class="overlay">Lade Verlauf …</div>` : nothing}
          ${this._error ? html`<div class="overlay error">${this._errorText()}</div>` : nothing}
        </div>

        ${this._config?.show_stays === false ? nothing : this._renderStaySection()}
      </ha-card>
    `;
  }

  private get _locale(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "de";
  }

  /**
   * Calendar and clocks. Native inputs rather than Home Assistant's own date and
   * time elements: those are loaded on demand and are not something a custom
   * card can count on being there, and a picker that silently renders as an
   * empty box is worse than a plain one that works.
   */
  private _renderPicker(): TemplateResult {
    const fields = this._fields;
    const resolved = resolveRange(fields);

    const field = (
      label: string,
      dateKey: "fromDate" | "toDate",
      timeKey: "fromTime" | "toTime",
      datePlaceholder?: string
    ) => html`
      <label class="picker-field">
        <span class="picker-label">${label}</span>
        <input
          type="date"
          .value=${fields[dateKey]}
          placeholder=${datePlaceholder ?? ""}
          @change=${(ev: Event) => this._setField(dateKey, (ev.target as HTMLInputElement).value)}
        />
        <input
          type="time"
          .value=${fields[timeKey]}
          @change=${(ev: Event) => this._setField(timeKey, (ev.target as HTMLInputElement).value)}
        />
      </label>
    `;

    return html`
      <div class="picker">
        ${field("Von", "fromDate", "fromTime")}
        ${field("Bis", "toDate", "toTime", "gleicher Tag")}
        <div class="picker-foot">
          <span class="picker-hint">
            ${resolved
              ? formatAbsoluteRange(resolved, this._locale)
              : "Mindestens ein Startdatum wählen."}
          </span>
          <button class="chip" ?disabled=${!this._range} @click=${this._clearRange}>
            Zurücksetzen
          </button>
          <button class="chip apply" ?disabled=${!resolved} @click=${this._applyRange}>
            Anwenden
          </button>
        </div>
      </div>
    `;
  }

  /**
   * The configured colour, otherwise one from the palette. Falling back per
   * person rather than to a single accent means the chips already read as a
   * legend before anything is configured.
   */
  private _colorOf(entityId: string): string {
    return this._config?.person_colors?.[entityId] || fallbackPersonColor(entityId);
  }

  private _renderPerson(person: HassEntity): TemplateResult {
    const picture = person.attributes.entity_picture;
    const color = this._colorOf(person.entity_id);
    const visible = this._isVisible(person.entity_id);
    return html`
      <button
        class=${visible ? "person shown" : "person hidden"}
        style=${`--ftc-person-color:${color}`}
        @click=${() => this._togglePerson(person.entity_id)}
        title=${visible ? `${this._name(person)} ausblenden` : `${this._name(person)} einblenden`}
        aria-pressed=${visible ? "true" : "false"}
      >
        <span class="avatar">
          ${picture
            ? html`<img src=${picture} alt="" />`
            : html`<span>${initials(this._name(person))}</span>`}
        </span>
        <span class="person-text">
          <span class="person-name">${this._name(person)}</span>
          <span class="person-zone">${this._zoneName(person.state)}</span>
        </span>
      </button>
    `;
  }

  /** The list plus its header, which folds it away. */
  private _renderStaySection(): TemplateResult {
    const count = this._stayEntries.length;
    return html`
      <div class="stays-head">
        <button
          class="stays-toggle"
          @click=${() => (this._staysOpen = !this._staysOpen)}
          aria-expanded=${this._staysOpen ? "true" : "false"}
        >
          <span class=${this._staysOpen ? "caret open" : "caret"}>▸</span>
          <span>Aufenthalte</span>
          <span class="stays-count">${count}</span>
        </button>
      </div>
      ${this._staysOpen ? this._renderStays() : nothing}
    `;
  }

  private _renderStays(): TemplateResult {
    const entries = this._stayEntries;
    if (entries.length === 0) {
      return html`<div class="stays empty">${this._loading ? "" : "Keine Aufenthalte im Zeitraum."}</div>`;
    }

    const locale = this.hass?.locale?.language ?? this.hass?.language ?? "de";

    return html`
      <div class="stays">
        ${entries.map((entry, index) => {
          return html`
            <button
              class="stay"
              data-index=${index}
              style=${`--ftc-person-color:${entry.color}`}
              @click=${() => this._focusStay(entry, index)}
            >
              <span class="badge ${entry.stay.source}">${index + 1}</span>
              <span class="stay-text">
                <span class="stay-label">
                  <span class="stay-person">${this._name(entry.person)}</span>
                  ${this._labelOf(entry.stay)}
                </span>
                <span class="stay-meta">
                  ${formatSpan(entry.stay.start, entry.stay.end, locale)} ·
                  ${formatDuration(entry.stay.end - entry.stay.start)}
                </span>
              </span>
              ${entry.distance
                ? html`<span class="stay-trip">→ ${formatDistance(entry.distance)}</span>`
                : nothing}
            </button>
          `;
        })}
      </div>
    `;
  }

  private _errorText(): string {
    if (this._error === "no-data") {
      return "Keine Positionsdaten im Zeitraum. Der Recorder hält standardmäßig nur 10 Tage vor.";
    }
    return `Verlauf konnte nicht geladen werden: ${this._error}`;
  }

  static override styles = css`
    ${unsafeCSS(leafletCss)}

    :host {
      --ftc-track-color: var(--ftc-accent, var(--primary-color, #2d7ff9));
    }

    ha-card {
      overflow: hidden;
    }

    .people {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 12px 12px 4px;
      scrollbar-width: thin;
    }

    .person {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
      padding: 6px 12px 6px 6px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 999px;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease;
    }

    .person:hover {
      background: var(--secondary-background-color);
    }

    .person.shown {
      border-color: var(--ftc-person-color, var(--ftc-track-color));
      background: color-mix(
        in srgb,
        var(--ftc-person-color, var(--ftc-track-color)) 12%,
        transparent
      );
    }

    /* Hidden persons stay in the row, so the legend keeps its order. */
    .person.hidden {
      opacity: 0.45;
    }

    .person.hidden .avatar {
      background: var(--secondary-text-color, #727272);
      box-shadow: none;
    }

    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      overflow: hidden;
      display: grid;
      place-items: center;
      background: var(--ftc-person-color, var(--ftc-track-color));
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      flex: 0 0 auto;
      /* A ring keeps the colour readable even behind a profile picture. */
      box-shadow: 0 0 0 2px var(--ftc-person-color, var(--ftc-track-color));
    }

    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .person-text {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      line-height: 1.2;
    }

    .person-name {
      font-size: 14px;
    }

    .person-zone {
      font-size: 11px;
      color: var(--secondary-text-color);
    }

    .controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
    }

    .ranges {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .chip {
      padding: 4px 12px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 999px;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }

    .chip.selected {
      border-color: var(--ftc-track-color);
      background: var(--ftc-track-color);
      color: #fff;
    }

    .chip.picked {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-variant-numeric: tabular-nums;
    }

    /* Drawn rather than an emoji. A glyph the font does not carry shows up as
       an empty box, which is exactly what happened here on both Firefox and
       headless Chromium -- a path is always there. */
    .picker-icon {
      width: 15px;
      height: 15px;
      fill: currentColor;
      flex: 0 0 auto;
    }

    .picker {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 12px;
      margin: 0 12px 8px;
      padding: 12px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 10px;
      background: var(--secondary-background-color, transparent);
    }

    .picker-field {
      display: grid;
      grid-template-columns: auto auto;
      gap: 6px;
      align-items: center;
    }

    .picker-label {
      grid-column: 1 / -1;
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    .picker input {
      padding: 6px 8px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 6px;
      background: var(--card-background-color, transparent);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 13px;
      /* The browser draws its own calendar icon; on a dark theme it is black
         on black without this. */
      color-scheme: light dark;
    }

    .picker-foot {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    .picker-hint {
      color: var(--secondary-text-color);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }

    .chip.apply:not(:disabled) {
      border-color: var(--ftc-track-color);
      background: var(--ftc-track-color);
      color: #fff;
    }

    .chip:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .map-wrap {
      position: relative;
      width: 100%;
    }

    /* Fill mode. The height is passed down the chain -- host, card, wrapper --
       because each of them defaults to the height of its contents, and a single
       missing link collapses the map back to its minimum. */
    :host(.ftc-fill) {
      display: block;
      height: 100%;
    }

    :host(.ftc-fill) ha-card {
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
    }

    :host(.ftc-fill) .map-wrap {
      flex: 1 1 auto;
      /* Keeps the map usable when the chips and the stay list eat the space. */
      min-height: 160px;
    }

    #map-host {
      width: 100%;
      height: 100%;
      background: var(--secondary-background-color, #f2f2f2);
    }

    .overlay {
      position: absolute;
      inset: auto 8px 8px 8px;
      z-index: 500;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--card-background-color, #fff);
      color: var(--secondary-text-color);
      font-size: 13px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }

    .overlay.error {
      color: var(--error-color, #c62828);
    }

    .stays-head {
      border-top: 1px solid var(--divider-color, #e0e0e0);
    }

    .stays-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 10px 12px;
      border: 0;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
    }

    .stays-toggle:hover {
      background: var(--secondary-background-color);
    }

    .caret {
      display: inline-block;
      transition: transform 120ms ease;
      color: var(--secondary-text-color);
    }

    .caret.open {
      transform: rotate(90deg);
    }

    .stays-count {
      margin-left: auto;
      color: var(--secondary-text-color);
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }

    .stays {
      display: flex;
      flex-direction: column;
      max-height: 260px;
      overflow-y: auto;
      padding: 4px 0 8px;
    }

    .stays.empty {
      padding: 12px;
      color: var(--secondary-text-color);
      font-size: 13px;
    }

    .stay {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 12px;
      border: 0;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .stay:hover {
      background: var(--secondary-background-color);
    }

    .badge {
      width: 24px;
      height: 24px;
      flex: 0 0 auto;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      background: var(--ftc-person-color, var(--ftc-track-color));
    }

    /* A cluster stay is an estimate; the ring says so without losing the colour. */
    .badge.cluster {
      background: transparent;
      color: var(--ftc-person-color, var(--ftc-track-color));
      box-shadow: inset 0 0 0 2px var(--ftc-person-color, var(--ftc-track-color));
    }

    .stay-person {
      font-weight: 600;
      margin-right: 6px;
    }

    .stay-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1 1 auto;
    }

    .stay-label {
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stay-meta,
    .stay-trip {
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    .hint {
      padding: 8px 4px;
      color: var(--secondary-text-color);
      font-size: 13px;
    }

    /* Markers are injected by Leaflet into this shadow root. */
    .ftc-marker {
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      width: 100%;
      height: 100%;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      background: var(--ftc-marker-color, var(--ftc-track-color, #2d7ff9));
      border: 2px solid #fff;
      box-sizing: border-box;
    }

    /* The zone icon sits on the map with no plate behind it, so it needs its
       own outline to stay readable over both a street map and a satellite
       image. ha-icon is Home Assistant's element and takes its colour from the
       CSS color property, which is why the marker colour is set there rather
       than as a fill. */
    .ftc-zone {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      color: var(--ftc-zone-color, #727272);
    }

    .ftc-zone ha-icon {
      --mdc-icon-size: 22px;
      filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.9))
        drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }

    .ftc-marker--cluster {
      background: var(--ftc-marker-color, #727272);
      opacity: 0.85;
    }

    .ftc-marker--person {
      overflow: hidden;
      font-size: 14px;
      position: relative;
    }

    /* Laid over the initials rather than replacing them, so a picture that
       fails to load falls back to them instead of to an empty disc. */
    .ftc-marker--person img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `;
}

/** The attributes the map draws for a zone, as one comparable string. */
function zoneFingerprint(id: string, entity: HassEntity | undefined): string {
  const a = entity?.attributes;
  if (!a) return `${id}:-`;
  return `${id}:${a.latitude},${a.longitude},${a.radius},${a.icon},${a.friendly_name},${a.passive};`;
}

/** `Anna Beispiel` becomes `AB`, single names keep two letters. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

declare global {
  interface HTMLElementTagNameMap {
    "family-tracking-card": FamilyTrackingCard;
  }
}
