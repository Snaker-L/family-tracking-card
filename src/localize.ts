/**
 * Translations.
 *
 * Home Assistant tells every card which language the user picked, so the card
 * follows that rather than the browser or a setting of its own. English is the
 * base: an untranslated key falls back to it instead of showing the raw key,
 * which keeps a half-finished language usable.
 *
 * Only languages someone actually speaks belong here. Machine-translating the
 * rest would produce text nobody has ever read, and a wrong label is worse than
 * an English one.
 */

/** `de-AT`, `de_AT` and `de` all mean the same table. */
export function languageOf(hassLanguage: string | undefined): string {
  if (!hassLanguage) return "en";
  const base = hassLanguage.toLowerCase().split(/[-_]/)[0];
  return base in TRANSLATIONS ? base : "en";
}

type Vars = Record<string, string | number>;

/**
 * The translated string, with `{name}` placeholders filled in. An unknown key
 * returns itself, which makes a forgotten string obvious in the interface
 * rather than silently empty.
 */
export function localize(hassLanguage: string | undefined, key: string, vars?: Vars): string {
  const table = TRANSLATIONS[languageOf(hassLanguage)];
  const text = table[key] ?? TRANSLATIONS.en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  );
}

const en: Record<string, string> = {
  // -- card ---------------------------------------------------------------
  "card.no_persons": "No person entity found.",
  "card.layer_current": "Current: {label}",
  "card.layer_to_satellite": "Satellite",
  "card.layer_to_street": "Map",
  "card.range": "Range",
  "card.range_title": "Pick a range from the calendar",
  "card.from": "From",
  "card.to": "To",
  "card.same_day": "same day",
  "card.pick_start": "Pick a start date.",
  "card.reset": "Reset",
  "card.apply": "Apply",
  "card.loading": "Loading history …",
  "card.stays": "Stays",
  "card.no_stays": "No stays in this range.",
  "card.no_data": "No location data in this range. The recorder keeps only 10 days by default.",
  "card.load_error": "Could not load history: {error}",
  "card.home": "Home",
  "card.hide_person": "Hide {name}",
  "card.show_person": "Show {name}",

  // -- editor -------------------------------------------------------------
  "editor.title": "Title",
  "editor.show_stays": "Show the stay list",
  "editor.show_zones": "Show zones on the map",
  "editor.geocode": "Resolve addresses (Nominatim)",
  "editor.geocode_email": "Contact address for Nominatim",
  "editor.map_height": "Map height",
  "editor.height_fixed": "Fixed height",
  "editor.height_fill": "Fill the available space",
  "editor.height_pixels": "Height in pixels",
  "editor.height_hint":
    "The card takes whatever height the dashboard gives it. That only works in a " +
    "panel view, which hands a single card the whole screen — in a normal column " +
    "view a fixed height is the right answer.",
  "editor.street_map": "Street map",
  "editor.satellite_map": "Satellite map",
  "editor.custom_option": "Custom URL …",
  "editor.custom_title": "Custom tile URL · {name}",
  "editor.custom_subdomains": "Subdomains, e.g. abc",
  "editor.custom_max_zoom": "Max zoom",
  "editor.custom_attribution": "Attribution, e.g. © OpenStreetMap contributors",
  "editor.custom_referrer": "Send the origin (OpenStreetMap needs it)",
  "editor.custom_hint":
    "A URL containing {s} needs the subdomains set. Home Assistant suppresses the " +
    "Referer, and some providers — OpenStreetMap among them — answer that with a " +
    "blocked tile. The checkbox sends them your instance host so they serve. Mind " +
    "the provider's terms of use as well.",
  "editor.people": "People",
  "editor.people_hint":
    "Without the checkbox a person is not on the card at all — no chip, no track. " +
    "The chips on the card only hide the others temporarily and leave the " +
    "configuration alone.",
  "editor.show_on_open": "Show {name} on open",
  "editor.colour_for": "Colour for {name}",
  "editor.automatic": "automatic",
  "editor.reset_colour": "Reset to the automatic colour",
  "editor.zones": "Zones",
  "editor.zones_hint":
    "Without the checkbox the zone is not drawn. Without an icon of its own the " +
    "one from Home Assistant applies; the ✕ resets icon and colour back to that " +
    "default.",
  "editor.zones_none": "No zone entity with coordinates found.",
  "editor.show_on_map": "Show {name} on the map",
  "editor.reset_zone": "Reset icon and colour to the Home Assistant default",
  "editor.note":
    "The button above the map on the right switches between the two styles chosen " +
    "here. The preset ranges can only be changed in YAML, e. g. time_ranges: " +
    "[1, 4, 6, 8, 12, 16]; the calendar next to them is always available. Note " +
    "that the recorder keeps only 10 days by default (purge_keep_days).",

  // -- tile styles --------------------------------------------------------
  "style.osm": "OpenStreetMap",
  "style.esri_gray": "Esri Gray (follows your theme)",
  "style.esri_streets": "Esri Streets",
  "style.esri_topo": "Esri Topographic",
  "style.esri_relief": "Esri Hillshade (terrain)",
  "style.osm_hot": "OpenStreetMap Humanitarian",
  "style.opentopo": "OpenTopoMap",
  "style.basemap_at": "basemap.at (Austria only)",
  "style.basemap_at_gray": "basemap.at Gray (Austria only)",
  "style.esri_imagery": "Esri Imagery",
  "style.esri_hybrid": "Esri Imagery with labels",
  "style.basemap_at_ortho": "basemap.at Orthophoto 30 cm (Austria only)",
  "style.basemap_at_ortho_labels": "basemap.at Orthophoto with labels (Austria only)",
  "style.custom": "Custom URL",
};

const de: Record<string, string> = {
  "card.no_persons": "Keine person-Entität gefunden.",
  "card.layer_current": "Aktuell: {label}",
  "card.layer_to_satellite": "Satellit",
  "card.layer_to_street": "Karte",
  "card.range": "Zeitraum",
  "card.range_title": "Zeitraum über Kalender und Uhrzeit wählen",
  "card.from": "Von",
  "card.to": "Bis",
  "card.same_day": "gleicher Tag",
  "card.pick_start": "Mindestens ein Startdatum wählen.",
  "card.reset": "Zurücksetzen",
  "card.apply": "Anwenden",
  "card.loading": "Lade Verlauf …",
  "card.stays": "Aufenthalte",
  "card.no_stays": "Keine Aufenthalte im Zeitraum.",
  "card.no_data":
    "Keine Positionsdaten im Zeitraum. Der Recorder hält standardmäßig nur 10 Tage vor.",
  "card.load_error": "Verlauf konnte nicht geladen werden: {error}",
  "card.home": "Zuhause",
  "card.hide_person": "{name} ausblenden",
  "card.show_person": "{name} einblenden",

  "editor.title": "Titel",
  "editor.show_stays": "Aufenthaltsliste anzeigen",
  "editor.show_zones": "Zonen auf der Karte anzeigen",
  "editor.geocode": "Adressen auflösen (Nominatim)",
  "editor.geocode_email": "Kontakt-Adresse für Nominatim",
  "editor.map_height": "Kartenhöhe",
  "editor.height_fixed": "Feste Höhe",
  "editor.height_fill": "Verfügbaren Platz füllen",
  "editor.height_pixels": "Höhe in Pixeln",
  "editor.height_hint":
    "Die Karte nimmt sich die Höhe, die das Dashboard ihr gibt. Das wirkt nur in " +
    "einer Panel-Ansicht, die der Karte den ganzen Bildschirm überlässt – in einer " +
    "normalen Spaltenansicht ist eine feste Höhe richtig.",
  "editor.street_map": "Straßenkarte",
  "editor.satellite_map": "Satellitenkarte",
  "editor.custom_option": "Eigene URL …",
  "editor.custom_title": "Eigene Kachel-URL · {name}",
  "editor.custom_subdomains": "Subdomains, z. B. abc",
  "editor.custom_max_zoom": "Max. Zoom",
  "editor.custom_attribution": "Quellenangabe, z. B. © OpenStreetMap contributors",
  "editor.custom_referrer": "Herkunft mitsenden (nötig für OpenStreetMap)",
  "editor.custom_hint":
    "Enthält die URL {s}, müssen die Subdomains gesetzt sein. Home Assistant " +
    "unterdrückt den Referer; manche Dienste – OpenStreetMap etwa – antworten " +
    "darauf mit einer Sperrkachel. Der Haken sendet ihnen die Adresse deiner " +
    "Instanz, damit sie ausliefern. Beachte außerdem die Nutzungsbedingungen.",
  "editor.people": "Personen",
  "editor.people_hint":
    "Ohne Haken erscheint die Person gar nicht in der Karte – weder als Chip noch " +
    "als Spur. Die Chips in der Karte blenden die übrigen Personen nur " +
    "vorübergehend aus und ändern die Konfiguration nicht.",
  "editor.show_on_open": "{name} beim Öffnen anzeigen",
  "editor.colour_for": "Farbe für {name}",
  "editor.automatic": "automatisch",
  "editor.reset_colour": "Auf die automatische Farbe zurücksetzen",
  "editor.zones": "Zonen",
  "editor.zones_hint":
    "Ohne Haken wird die Zone nicht gezeichnet. Ohne eigenes Icon gilt das der " +
    "Zone aus Home Assistant; das ✕ setzt Icon und Farbe wieder auf diesen " +
    "Standard zurück.",
  "editor.zones_none": "Keine zone-Entität mit Koordinaten gefunden.",
  "editor.show_on_map": "{name} auf der Karte anzeigen",
  "editor.reset_zone": "Auf Icon und Farbe von Home Assistant zurücksetzen",
  "editor.note":
    "Der Knopf rechts über der Karte schaltet zwischen den beiden hier gewählten " +
    "Stilen um. Die Vorgabe-Zeiträume lassen sich nur in YAML ändern, z. B. " +
    "time_ranges: [1, 4, 6, 8, 12, 16]; der Kalender daneben ist immer da. " +
    "Beachte, dass der Recorder standardmäßig nur 10 Tage vorhält (purge_keep_days).",

  "style.esri_gray": "Esri Grau (folgt dem Theme)",
  "style.esri_streets": "Esri Straßen",
  "style.esri_topo": "Esri Topografisch",
  "style.esri_relief": "Esri Relief (Gelände)",
  "style.basemap_at": "basemap.at (nur Österreich)",
  "style.basemap_at_gray": "basemap.at Grau (nur Österreich)",
  "style.esri_imagery": "Esri Luftbild",
  "style.esri_hybrid": "Esri Luftbild mit Beschriftung",
  "style.basemap_at_ortho": "basemap.at Orthofoto 30 cm (nur Österreich)",
  "style.basemap_at_ortho_labels": "basemap.at Orthofoto mit Beschriftung (nur Österreich)",
  "style.custom": "Eigene URL",
};

const TRANSLATIONS: Record<string, Record<string, string>> = { en, de };

/** The languages with their own table; everything else falls back to English. */
export const LANGUAGES = Object.keys(TRANSLATIONS);
