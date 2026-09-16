import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  CUSTOM_STYLE,
  DEFAULTS,
  EDITOR_SCHEMA,
  EDITOR_TAG,
  FILL_HEIGHT,
  MAX_MAP_HEIGHT,
  MIN_MAP_HEIGHT,
  OBSOLETE_KEYS,
  resolveMapHeight,
  fallbackPersonColor,
  sanitizeStyles,
  SATELLITE_STYLES,
  STREET_STYLES,
  zoneVisual,
} from "./const";
import type { CustomTileLayer } from "./const";
import { localize } from "./localize";
import { notePreviewLayer } from "./preview-layer";
import type {
  FamilyTrackingCardConfig,
  HassEntity,
  HomeAssistant,
  LovelaceCardEditor,
} from "./types";



@customElement(EDITOR_TAG)
export class FamilyTrackingCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: FamilyTrackingCardConfig;

  /** Short hand for the translations; the language comes from Home Assistant. */
  private _t(key: string, vars?: Record<string, string | number>): string {
    return localize(this.hass?.locale?.language ?? this.hass?.language, key, vars);
  }

  public setConfig(config: FamilyTrackingCardConfig): void {
    this._config = config;
  }

  /** Defaults are shown in the form but only written once the user edits. */
  private get _data(): Record<string, unknown> {
    return {
      show_stays: DEFAULTS.show_stays,
      show_zones: DEFAULTS.show_zones,
      geocode: DEFAULTS.geocode,
      ...this._config,
    };
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._data}
        .schema=${EDITOR_SCHEMA}
        .computeLabel=${(entry: { name: string }) => this._t(`editor.${entry.name}`)}
        @value-changed=${this._valueChanged}
      ></ha-form>
      ${this._renderStyles()} ${this._renderColors()} ${this._renderZones()}
      <p class="note">
        ${this._t("editor.note")}
      </p>
    `;
  }

  /**
   * The two tile style pickers, built by hand rather than through `ha-form`.
   * The colour and visibility controls below use the same approach and reliably
   * reach the config, which the form-driven fields did not.
   */
  private _renderStyles(): TemplateResult {
    const styles = sanitizeStyles(this._config ?? {});
    const picker = (
      label: string,
      key: "street_style" | "satellite_style",
      options: Record<string, { label: string }>,
      current: string
    ) => html`
      <label class="style-field">
        <span class="style-label">${label}</span>
        <select
          .value=${current}
          @change=${(ev: Event) => this._setStyle(key, (ev.target as HTMLSelectElement).value)}
        >
          ${Object.keys(options).map(
            (value) => html`
              <option value=${value} ?selected=${value === current}>
                ${this._t(`style.${value}`)}
              </option>
            `
          )}
          <option value=${CUSTOM_STYLE} ?selected=${current === CUSTOM_STYLE}>${this._t("editor.custom_option")}</option>
        </select>
      </label>
    `;

    return html`
      ${this._renderHeight()}
      <div class="styles">
        ${picker(this._t("editor.street_map"), "street_style", STREET_STYLES, styles.street)}
        ${picker(this._t("editor.satellite_map"), "satellite_style", SATELLITE_STYLES, styles.satellite)}
      </div>
      ${styles.street === CUSTOM_STYLE
        ? this._renderCustomTile(this._t("editor.street_map"), "custom_street", this._config?.custom_street)
        : nothing}
      ${styles.satellite === CUSTOM_STYLE
        ? this._renderCustomTile(this._t("editor.satellite_map"), "custom_satellite", this._config?.custom_satellite)
        : nothing}
    `;
  }

  /**
   * Fixed height or fill. A select plus a conditional field, the same shape as
   * the custom tile URL below, because the number only matters in one of the
   * two cases and an input that does nothing is worse than no input.
   */
  private _renderHeight(): TemplateResult {
    const height = resolveMapHeight(this._config?.map_height);
    const fill = height === FILL_HEIGHT;

    return html`
      <div class="height">
        <label class="style-field">
          <span class="style-label">${this._t("editor.map_height")}</span>
          <select
            @change=${(ev: Event) =>
              this._setHeight(
                (ev.target as HTMLSelectElement).value === FILL_HEIGHT
                  ? FILL_HEIGHT
                  : DEFAULTS.map_height
              )}
          >
            <option value="fixed" ?selected=${!fill}>${this._t("editor.height_fixed")}</option>
            <option value=${FILL_HEIGHT} ?selected=${fill}>
              ${this._t("editor.height_fill")}
            </option>
          </select>
        </label>
        ${fill
          ? nothing
          : html`
              <label class="style-field">
                <span class="style-label">${this._t("editor.height_pixels")}</span>
                <input
                  type="number"
                  min=${MIN_MAP_HEIGHT}
                  max=${MAX_MAP_HEIGHT}
                  step="20"
                  .value=${String(height)}
                  @change=${(ev: Event) =>
                    this._setHeight(Number((ev.target as HTMLInputElement).value))}
                />
              </label>
            `}
      </div>
      ${fill
        ? html`<div class="height-hint">
            ${this._t("editor.height_hint")}
          </div>`
        : nothing}
    `;
  }

  private _setHeight(value: number | typeof FILL_HEIGHT): void {
    if (!this._config) return;
    this._emit({ ...this._config, map_height: resolveMapHeight(value) });
  }

  /** URL, subdomains and attribution for a hand-entered tile source. */
  private _renderCustomTile(
    title: string,
    key: "custom_street" | "custom_satellite",
    value: CustomTileLayer | undefined
  ): TemplateResult {
    const update = (patch: Partial<CustomTileLayer>) => {
      if (!this._config) return;
      // Same as the pickers: editing a URL should show the result of it.
      notePreviewLayer(key === "custom_satellite" ? "satellite" : "street");
      const next = { ...(value ?? { url: "" }), ...patch };
      this._emit({ ...this._config, [key]: next });
    };

    return html`
      <div class="custom">
        <div class="custom-title">${this._t("editor.custom_title", { name: title })}</div>
        <input
          type="text"
          class="custom-url"
          placeholder="https://tile.example.org/{z}/{x}/{y}.png"
          .value=${value?.url ?? ""}
          @change=${(ev: Event) => update({ url: (ev.target as HTMLInputElement).value.trim() })}
        />
        <div class="custom-row">
          <input
            type="text"
            placeholder=${this._t("editor.custom_subdomains")}
            .value=${value?.subdomains ?? ""}
            @change=${(ev: Event) =>
              update({ subdomains: (ev.target as HTMLInputElement).value.trim() || undefined })}
          />
          <input
            type="number"
            min="1"
            max="22"
            placeholder=${this._t("editor.custom_max_zoom")}
            .value=${value?.max_zoom ? String(value.max_zoom) : ""}
            @change=${(ev: Event) =>
              update({ max_zoom: Number((ev.target as HTMLInputElement).value) || undefined })}
          />
        </div>
        <input
          type="text"
          placeholder=${this._t("editor.custom_attribution")}
          .value=${value?.attribution ?? ""}
          @change=${(ev: Event) =>
            update({ attribution: (ev.target as HTMLInputElement).value.trim() || undefined })}
        />
        <label class="custom-check">
          <input
            type="checkbox"
            .checked=${value?.referrer_policy === "origin"}
            @change=${(ev: Event) =>
              update({
                referrer_policy: (ev.target as HTMLInputElement).checked ? "origin" : undefined,
              })}
          />
          <span>${this._t("editor.custom_referrer")}</span>
        </label>
        <div class="custom-hint">
          ${this._t("editor.custom_hint")}
        </div>
      </div>
    `;
  }

  private _setStyle(key: "street_style" | "satellite_style", value: string): void {
    if (!this._config) return;
    // Tell the preview which side to show, before the new config reaches it.
    notePreviewLayer(key === "satellite_style" ? "satellite" : "street");
    this._emit({ ...this._config, [key]: value });
  }

  /** Every zone with coordinates, by name. */
  private get _zones(): HassEntity[] {
    if (!this.hass) return [];
    return Object.keys(this.hass.states)
      .filter((id) => id.startsWith("zone."))
      .map((id) => this.hass!.states[id])
      .sort((a, b) => this._zoneName(a).localeCompare(this._zoneName(b)));
  }

  private _zoneName(entity: HassEntity): string {
    return entity.attributes.friendly_name ?? entity.entity_id.replace("zone.", "");
  }

  /**
   * Icon and colour per zone, shown only once the zones are switched on --
   * there is nothing to style while they are not on the map.
   */
  private _renderZones(): TemplateResult | typeof nothing {
    const enabled = this._config?.show_zones ?? DEFAULTS.show_zones;
    if (!enabled) return nothing;

    const zones = this._zones;
    if (zones.length === 0) {
      return html`<div class="zones">
        <div class="zones-title">${this._t("editor.zones")}</div>
        <div class="zones-hint">${this._t("editor.zones_none")}</div>
      </div>`;
    }

    return html`
      <div class="zones">
        <div class="zones-title">${this._t("editor.zones")}</div>
        <div class="zones-hint">
          ${this._t("editor.zones_hint")}
        </div>
        ${zones.map((zone) => {
          const id = zone.entity_id;
          const name = this._zoneName(zone);
          const { icon, color } = zoneVisual(id, zone.attributes, this._config ?? {});
          const shown = !(this._config?.hidden_zones ?? []).includes(id);
          const overridden =
            this._config?.zone_icons?.[id] !== undefined ||
            this._config?.zone_colors?.[id] !== undefined;
          return html`
            <div class=${shown ? "zone-row" : "zone-row muted"}>
              <input
                type="checkbox"
                .checked=${shown}
                aria-label=${this._t("editor.show_on_map", { name })}
                @change=${(ev: Event) =>
                  this._setZoneShown(id, (ev.target as HTMLInputElement).checked)}
              />
              <input
                type="color"
                .value=${color}
                aria-label=${this._t("editor.colour_for", { name })}
                @change=${(ev: Event) =>
                  this._setZoneColor(id, (ev.target as HTMLInputElement).value)}
              />
              ${this._renderIconField(id, name, icon)}
              <button
                class="color-reset"
                ?disabled=${!overridden}
                title=${this._t("editor.reset_zone")}
                @click=${() => this._resetZone(id)}
              >
                ✕
              </button>
            </div>
          `;
        })}
      </div>
    `;
  }

  /**
   * Home Assistant's icon picker when it is loaded, a plain field otherwise.
   *
   * `ha-icon-picker` is not part of any contract a custom card can rely on: it
   * is lazily loaded, and when it is missing the browser renders an unknown tag
   * with no size, leaving a row that silently cannot be edited. The text field
   * takes the same value, so the setting stays reachable either way.
   */
  private _renderIconField(id: string, name: string, icon: string): TemplateResult {
    if (customElements.get("ha-icon-picker")) {
      return html`
        <ha-icon-picker
          .hass=${this.hass}
          .label=${name}
          .value=${icon}
          @value-changed=${(ev: CustomEvent) => this._setZoneIcon(id, ev.detail.value)}
        ></ha-icon-picker>
      `;
    }

    return html`
      <label class="zone-icon-fallback">
        <span class="zone-icon-name">${name}</span>
        <input
          type="text"
          placeholder="mdi:map-marker-radius"
          .value=${icon}
          @change=${(ev: Event) =>
            this._setZoneIcon(id, (ev.target as HTMLInputElement).value.trim())}
        />
      </label>
    `;
  }

  /**
   * Stores which zones are left out, mirroring `hidden_persons`: a zone added
   * to Home Assistant later then shows up instead of silently going missing.
   */
  private _setZoneShown(entityId: string, shown: boolean): void {
    if (!this._config) return;
    const hidden = (this._config.hidden_zones ?? []).filter((id) => id !== entityId);
    if (!shown) hidden.push(entityId);

    const merged: FamilyTrackingCardConfig = { ...this._config, hidden_zones: hidden };
    if (hidden.length === 0) delete merged.hidden_zones;
    this._emit(merged);
  }

  private _setZoneIcon(entityId: string, icon: string | undefined): void {
    this._patchZoneMap("zone_icons", entityId, icon || undefined);
  }

  private _setZoneColor(entityId: string, color: string | undefined): void {
    this._patchZoneMap("zone_colors", entityId, color || undefined);
  }

  private _resetZone(entityId: string): void {
    if (!this._config) return;
    const icons = { ...(this._config.zone_icons ?? {}) };
    const colors = { ...(this._config.zone_colors ?? {}) };
    delete icons[entityId];
    delete colors[entityId];

    const merged: FamilyTrackingCardConfig = {
      ...this._config,
      zone_icons: icons,
      zone_colors: colors,
    };
    if (Object.keys(icons).length === 0) delete merged.zone_icons;
    if (Object.keys(colors).length === 0) delete merged.zone_colors;
    this._emit(merged);
  }

  /** Writes one entry of a per-zone map, dropping the key when it is cleared. */
  private _patchZoneMap(
    key: "zone_icons" | "zone_colors",
    entityId: string,
    value: string | undefined
  ): void {
    if (!this._config) return;
    const map = { ...(this._config[key] ?? {}) };
    if (value) map[entityId] = value;
    else delete map[entityId];

    const merged: FamilyTrackingCardConfig = { ...this._config, [key]: map };
    if (Object.keys(map).length === 0) delete merged[key];
    this._emit(merged);
  }

  /** Every person, in the same order as the card shows them. */
  private get _persons(): { id: string; name: string }[] {
    if (!this.hass) return [];
    return Object.keys(this.hass.states)
      .filter((id) => id.startsWith("person."))
      .map((id) => ({
        id,
        name: this.hass!.states[id].attributes.friendly_name ?? id.replace("person.", ""),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * One colour per person. `ha-form` has no selector for a map keyed by entity,
   * so this is a plain section next to the form rather than part of the schema.
   */
  private _renderColors(): TemplateResult | typeof nothing {
    const persons = this._persons;
    if (persons.length === 0) return nothing;

    return html`
      <div class="colors">
        <div class="colors-title">${this._t("editor.people")}</div>
        <div class="colors-hint">
          ${this._t("editor.people_hint")}
        </div>
        ${persons.map((person) => {
          const configured = this._config?.person_colors?.[person.id];
          const color = configured || fallbackPersonColor(person.id);
          const shown = !(this._config?.hidden_persons ?? []).includes(person.id);
          return html`
            <div class=${shown ? "color-row" : "color-row muted"}>
              <input
                type="checkbox"
                .checked=${shown}
                aria-label=${this._t("editor.show_on_open", { name: person.name })}
                @change=${(ev: Event) =>
                  this._setShown(person.id, (ev.target as HTMLInputElement).checked)}
              />
              <input
                type="color"
                .value=${color}
                aria-label=${this._t("editor.colour_for", { name: person.name })}
                @change=${(ev: Event) =>
                  this._setColor(person.id, (ev.target as HTMLInputElement).value)}
              />
              <span class="color-name">${person.name}</span>
              <span class="color-state">${configured ? color : this._t("editor.automatic")}</span>
              <button
                class="color-reset"
                ?disabled=${!configured}
                title=${this._t("editor.reset_colour")}
                @click=${() => this._setColor(person.id, undefined)}
              >
                ✕
              </button>
            </div>
          `;
        })}
      </div>
    `;
  }

  /**
   * Stores who is excluded rather than who is included. A person added later is
   * then part of the card by default instead of silently missing from it.
   */
  private _setShown(entityId: string, shown: boolean): void {
    if (!this._config) return;
    const hidden = (this._config.hidden_persons ?? []).filter((id) => id !== entityId);
    if (!shown) hidden.push(entityId);

    const merged: FamilyTrackingCardConfig = { ...this._config, hidden_persons: hidden };
    if (hidden.length === 0) delete merged.hidden_persons;
    this._emit(merged);
  }

  /** Writes one entry of `person_colors`, dropping the key when it is cleared. */
  private _setColor(entityId: string, color: string | undefined): void {
    if (!this._config) return;
    const colors = { ...(this._config.person_colors ?? {}) };
    if (color) colors[entityId] = color;
    else delete colors[entityId];

    const merged: FamilyTrackingCardConfig = { ...this._config, person_colors: colors };
    if (Object.keys(colors).length === 0) delete merged.person_colors;
    this._emit(merged);
  }

  private _valueChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    if (!this._config) return;

    const merged = { ...this._config, ...(ev.detail.value as Record<string, unknown>) };
    // Keep the stored YAML tidy: drop keys the user cleared again.
    for (const [key, value] of Object.entries(merged)) {
      if (value === "" || value === undefined || (Array.isArray(value) && value.length === 0)) {
        delete merged[key];
      }
    }
    for (const key of OBSOLETE_KEYS) delete merged[key];

    this._emit(merged as FamilyTrackingCardConfig);
  }

  private _emit(config: FamilyTrackingCardConfig): void {
    // Keep our own copy in step instead of waiting for Home Assistant to hand
    // the config back. It does call `setConfig` again, but not reliably before
    // the next render -- and the sections below are drawn from `_config`, so a
    // stale copy means a switch that is visibly on while its list stays away.
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
  }

  static override styles = css`
    .height,
    .styles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin: 16px 4px 0;
    }

    .height-hint {
      margin: 8px 4px 0;
      color: var(--secondary-text-color);
      font-size: 12px;
      line-height: 1.5;
    }

    .height input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 8px;
      background: var(--secondary-background-color, transparent);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 14px;
    }

    .style-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .style-label {
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    select {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 8px;
      background: var(--secondary-background-color, transparent);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 14px;
      cursor: pointer;
    }

    .custom {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 12px 4px 0;
      padding: 12px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 8px;
    }

    .custom-title {
      font-size: 13px;
      font-weight: 500;
    }

    .custom-row {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 8px;
    }

    .custom input {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 6px;
      background: var(--secondary-background-color, transparent);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 13px;
    }

    .custom-url {
      font-family: var(--code-font-family, monospace);
    }

    .custom-check {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .custom-check input {
      width: auto;
      inline-size: 18px;
      block-size: 18px;
      accent-color: var(--primary-color, #2d7ff9);
      cursor: pointer;
    }

    .custom-hint {
      color: var(--secondary-text-color);
      font-size: 12px;
      line-height: 1.5;
    }

    .zones,
    .colors {
      margin: 16px 4px 0;
    }

    .zones-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--primary-text-color);
      margin-bottom: 8px;
    }

    .zones-hint {
      color: var(--secondary-text-color);
      font-size: 12px;
      line-height: 1.5;
      margin-bottom: 8px;
    }

    /* The icon picker carries the zone name as its own label, so the row needs
       no separate name column and stays aligned however long the name is. */
    .zone-row {
      display: grid;
      grid-template-columns: auto auto 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 4px 0;
    }

    /* A hidden zone stays in the list, so the order never shifts under the
       cursor while switching several of them off. */
    .zone-row.muted ha-icon-picker,
    .zone-row.muted .zone-icon-fallback {
      opacity: 0.5;
    }

    .zone-row.muted input[type="color"] {
      filter: grayscale(1);
      opacity: 0.5;
    }

    .zone-icon-fallback {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .zone-icon-name {
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    .zone-icon-fallback input {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 6px;
      background: var(--secondary-background-color, transparent);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 13px;
    }

    .zone-row ha-icon-picker {
      display: block;
      width: 100%;
      min-width: 0;
    }

    .colors-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--primary-text-color);
      margin-bottom: 8px;
    }

    .colors-hint {
      color: var(--secondary-text-color);
      font-size: 12px;
      line-height: 1.5;
      margin-bottom: 8px;
    }

    .color-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 0;
    }

    /* A hidden person stays legible, just visibly switched off. */
    .color-row.muted .color-name,
    .color-row.muted .color-state {
      opacity: 0.5;
    }

    .color-row.muted input[type="color"] {
      filter: grayscale(1);
      opacity: 0.5;
    }

    input[type="checkbox"] {
      inline-size: 18px;
      block-size: 18px;
      accent-color: var(--primary-color, #2d7ff9);
      cursor: pointer;
      flex: 0 0 auto;
    }

    /* The native swatch carries its own chrome; strip it back to a dot. */
    input[type="color"] {
      inline-size: 28px;
      block-size: 28px;
      padding: 0;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 50%;
      background: none;
      cursor: pointer;
      flex: 0 0 auto;
    }

    input[type="color"]::-webkit-color-swatch-wrapper {
      padding: 2px;
    }

    input[type="color"]::-webkit-color-swatch,
    input[type="color"]::-moz-color-swatch {
      border: none;
      border-radius: 50%;
    }

    .color-name {
      flex: 1 1 auto;
      color: var(--primary-text-color);
    }

    .color-state {
      color: var(--secondary-text-color);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }

    .color-reset {
      border: none;
      background: none;
      color: var(--secondary-text-color);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 4px;
      border-radius: 50%;
    }

    .color-reset:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .color-reset:not(:disabled):hover {
      background: var(--secondary-background-color);
    }

    .note {
      margin: 12px 4px 0;
      color: var(--secondary-text-color);
      font-size: 12px;
      line-height: 1.5;
    }

    code {
      background: var(--secondary-background-color);
      padding: 1px 4px;
      border-radius: 4px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "family-tracking-card-editor": FamilyTrackingCardEditor;
  }
}
