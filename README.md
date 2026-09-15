# Family Tracking Card

Eine Lovelace-Karte für Home Assistant, die alle Personen auf einer Karte zeigt
und ihren Standortverlauf als **lesbare Aufenthaltsliste** aufbereitet statt als
rohe Koordinatenpunkte:

```
1  Zuhause              06:12 – 07:48 · 1 h 36 min    → 8.4 km
2  Hauptstraße 12, Wien 08:03 – 09:47 · 1 h 44 min    → 2.1 km
3  Arbeit               10:02 – 17:30 · 7 h 28 min
```

**Element:** `family-tracking-card` · **YAML-Typ:** `custom:family-tracking-card`

---

## Funktionen

- **Alle Personen gleichzeitig**, jede in ihrer Farbe. Im Editor entscheidet ein
  Haken je Person, wer überhaupt Teil der Karte ist; ohne Haken gibt es weder
  Chip noch Spur noch Recorder-Abfrage. Gespeichert wird bewusst die Liste der
  *ausgenommenen* Personen, damit eine später angelegte Person dabei ist statt
  stillschweigend zu fehlen. Die Chip-Zeile oben ist
  zugleich Legende und Schalter: Ein Klick blendet eine Person aus oder wieder
  ein. Das Umschalten baut die Karte nicht neu auf, die Leaflet-Instanz bleibt
  bestehen.
- **Karte mit Layer-Umschaltung** zwischen Straßenkarte und Satellitenbild,
  beide Stile im Editor wählbar.
  Beim Wechsel wird nur der Tile-Layer getauscht, deshalb bleiben Mittelpunkt und
  Zoom erhalten – genau das, woran die eingebaute Map-Karte scheitert. Die
  Straßenkarte folgt dem Theme und schaltet auf dunkle Kacheln um.
  Beide Ebenen kommen von ArcGIS Online und brauchen keinen API-Schlüssel.
  `tile.openstreetmap.org` ist bewusst nicht die Quelle: Deren Usage Policy
  deckt eine Karte, die bei jedem Zeitraumwechsel nachlädt, nicht ab, und sie
  antworten solchen Clients mit einer *Access blocked*-Kachel. CARTO scheidet
  ebenfalls aus, es liefert im Browser *API KEY REQUIRED*.
- **Zeitraumfilter** über Schaltflächen, Daten kommen per WebSocket aus dem
  Recorder (`history/history_during_period`) – eine Abfrage je Person, parallel.
  Fällt eine davon aus, bleiben die übrigen Spuren stehen.
- **Aufenthaltserkennung** fasst hunderte nahezu identischer Koordinaten zu je
  einer Zeile mit Ankunft, Abfahrt und Dauer zusammen.
- **Zonen zuerst:** Für `home` und eigene Zonen liefern die State-Wechsel der
  Person Ankunft und Abfahrt sekundengenau. Nur Aufenthalte ausserhalb bekannter
  Zonen werden per Reverse Geocoding aufgelöst.
- **Farbe je Person**, im visuellen Editor einstellbar. Spur, Marker und der
  Personen-Chip nehmen sie an, dadurch liest sich die Chip-Zeile als Legende.
  Ohne Konfiguration bekommt jede Person eine feste Farbe aus einer Palette,
  abgeleitet aus ihrer Entity-ID – sie bleibt damit gleich, wenn jemand
  hinzukommt oder wegfällt.
- **Gemeinsame Aufenthaltsliste** über alle eingeblendeten Personen, chronologisch
  sortiert und über die Kopfzeile ein- und ausklappbar. Jede Zeile nennt die
  Person; die Nummerierung entspricht den Markern auf der Karte.

## Installation

### HACS

1. HACS → Dashboard → Dreipunkt-Menü → *Benutzerdefinierte Repositories*.
2. Repository-URL eintragen, Kategorie **Dashboard**.
3. *Family Tracking Card* installieren.
4. Die Ressource wird von HACS automatisch registriert.

### Manuell

1. `family-tracking-card.js` aus dem Release nach `config/www/` kopieren.
2. Einstellungen → Dashboards → Ressourcen → Ressource hinzufügen:
   - URL: `/local/family-tracking-card.js`
   - Typ: **JavaScript-Modul**

## Konfiguration

Minimal – und in den meisten Fällen ausreichend:

```yaml
type: custom:family-tracking-card
```

Vollständig:

```yaml
type: custom:family-tracking-card
title: Familie
time_ranges: [6, 24, 72, 168]
street_style: esri_gray
satellite_style: esri_imagery
person_colors:
  person.anna: "#7c4dff"
  person.ben: "#00b894"
hidden_persons:
  - person.gast
show_stays: true
geocode: true
geocode_email: du@example.org
```

| Option | Typ | Standard | Bedeutung |
|---|---|---|---|
| `title` | string | – | Kopfzeile der Karte |
| `time_ranges` | list | `[6, 24, 72, 168]` | Auswählbare Zeiträume, in Stunden |
| `street_style` | siehe unten | `esri_gray` | Stil der Straßenkarte |
| `satellite_style` | siehe unten | `esri_imagery` | Stil der Satellitenkarte |
| `custom_street` | map | – | Eigene Kachel-URL, wenn `street_style: custom` |
| `custom_satellite` | map | – | Eigene Kachel-URL, wenn `satellite_style: custom` |
| `person_colors` | map | Palette | Farbe je Entity-ID, z.&nbsp;B. `person.anna: "#7c4dff"` |
| `hidden_persons` | list | `[]` | Personen, die die Karte ganz auslässt; alle übrigen sind dabei |
| `map_height` | number \| `fill` | `480` | Kartenhöhe in Pixeln, oder den verfügbaren Platz füllen |
| `show_stays` | boolean | `true` | Aufenthaltsliste unter der Karte |
| `show_zones` | boolean | `false` | Zonen als Kreis mit Icon auf der Karte |
| `zone_icons` | map | – | Icon je Zone, z.&nbsp;B. `zone.schule: mdi:school` |
| `zone_colors` | map | – | Icon- und Kreisfarbe je Zone |
| `hidden_zones` | list | `[]` | Zonen, die die Karte auslässt; alle übrigen sind dabei |
| `geocode` | boolean | `true` | Adressauflösung über Nominatim |
| `geocode_email` | string | – | Kontaktadresse, siehe Nutzungsregeln von Nominatim |

### Kartenhöhe

`map_height` nimmt eine Pixelzahl zwischen 160 und 2000 oder `fill`. Mit `fill`
nimmt sich die Karte die Höhe, die das Dashboard ihr gibt – gedacht für eine
**Panel-Ansicht**, die einer einzigen Karte den ganzen Bildschirm überlässt:

```yaml
views:
  - type: panel
    cards:
      - type: custom:family-tracking-card
        map_height: fill
```

In einer normalen Spaltenansicht ist eine feste Zahl richtig. Dort ist eine
Karte nur so hoch wie ihr Inhalt, und `fill` hätte nichts, woran es sich
orientieren könnte – die Karte fiele auf ihre Mindesthöhe zurück.

### Zonen

Mit `show_zones: true` zeichnet die Karte jede Zone aus Home Assistant als Kreis
mit ihrem Icon in der Mitte. Im Editor erscheint dann ganz unten eine Liste aller
Zonen: je Zeile ein Haken, ein Farbfeld und die Icon-Auswahl. Ohne Haken lässt
die Karte diese eine Zone weg, ohne eigenes Icon gilt das, das die Zone in Home
Assistant ohnehin hat. Eine passive Zone – eine, die keine Anwesenheit auslöst –
bekommt einen gestrichelten Rand.

Wie bei den Personen speichert `hidden_zones`, wer *nicht* dabei ist. Eine später
angelegte Zone ist damit automatisch auf der Karte, statt stillschweigend zu
fehlen.

Zwei Entscheidungen dahinter sind absichtlich so: Die Voreinstellung ist `false`,
damit eine bestehende Karte nicht plötzlich Kreise bekommt. Und die Zonen zählen
nicht in den automatischen Kartenausschnitt hinein – eine Zone mit einem
Kilometer Radius würde sonst den Zoom bestimmen, obwohl es um die Personen geht.

Zonen ohne Koordinaten oder ohne Radius werden übersprungen statt falsch
gezeichnet.

### Kartenstile

| `street_style` | Quelle | Kacheln bis |
|---|---|---|
| `osm` | OpenStreetMap | z19 |
| `esri_gray` | Esri Canvas, hell/dunkel je Theme | z16 |
| `esri_streets` | Esri World Street Map | z19 |
| `esri_topo` | Esri World Topo Map | z19 |
| `esri_relief` | Esri Hillshade mit Beschriftung | z16 |
| `osm_hot` | OpenStreetMap Humanitarian (OSM France) | z19 |
| `opentopo` | OpenTopoMap | z17 |
| `basemap_at` | basemap.at, **nur Österreich** | z20 |
| `basemap_at_gray` | basemap.at Grau, **nur Österreich** | z20 |

| `satellite_style` | Quelle | Kacheln bis |
|---|---|---|
| `esri_imagery` | Esri World Imagery | z19 |
| `esri_hybrid` | Esri World Imagery mit Beschriftung | z19 |
| `basemap_at_ortho` | basemap.at Orthofoto 30 cm, **nur Österreich** | z20 |
| `basemap_at_ortho_labels` | dasselbe mit Beschriftung, **nur Österreich** | z20 |

Im Editor zeigt die Vorschau immer den Stil, den du gerade ausgewählt hast:
greifst du zur Satellitenkarte, schaltet die Vorschau selbst dorthin um. Auf dem
Dashboard startet die Karte wie bisher mit der Straßenkarte.

Über die Kachelgrenze hinaus skaliert Leaflet hoch, statt weiße Flächen zu
zeigen – dafür sorgt `maxNativeZoom`, das pro Ebene gesetzt ist. Die
basemap.at-Stile decken ausschließlich Österreich ab und antworten außerhalb mit
HTTP-Fehlern; für alles andere sind die Esri-Stile die richtige Wahl.

Ob eine Quelle noch liefert, beantwortet [`dev/probe-tiles.mjs`](dev/probe-tiles.mjs):

```bash
node --import tsx dev/probe-tiles.mjs
node --import tsx dev/probe-tiles.mjs --lat 52.52 --lon 13.405   # anderer Ort
```

Das Skript holt je Ebene zwei rund 3 km auseinanderliegende Kacheln und
vergleicht die Bytes. Ein Platzhalter ist für jede Koordinate identisch, eine
echte Karte nicht. Ein HTTP-Status taugt dafür nicht: `tile.openstreetmap.org`
antwortet mit `200` und liefert dabei eine *Access blocked*-Kachel.

**Das Skript erkennt keine Wasserzeichen.** CARTO liefert die echte Karte mit
„API KEY REQUIRED" quer darüber – solche Kacheln unterscheiden sich sehr wohl
voneinander, das Skript hält sie also für in Ordnung. Eine neue Quelle braucht
deshalb zusätzlich einen Blick auf eine heruntergeladene Kachel. Aus genau
diesem Grund sind `light_all` und `dark_all` von CARTO nicht dabei.

### Eigene Kachel-URL

Reicht die Auswahl nicht, lässt sich jede beliebige Quelle eintragen – im Editor
über den Eintrag *Eigene URL …*, in YAML so:

```yaml
street_style: custom
custom_street:
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  subdomains: abc
  attribution: "© OpenStreetMap contributors"
  max_zoom: 19
  referrer_policy: origin
```

`subdomains` ist Pflicht, sobald die URL `{s}` enthält. Ohne `url` fällt die
Karte auf den Standardstil zurück, statt leer zu bleiben. Für den
Satellitenlayer heißen die Schlüssel `satellite_style: custom` und
`custom_satellite`.

Die Verantwortung für die Nutzungsbedingungen liegt damit bei dir: Manche
Dienste sperren Clients aus oder verlangen einen Schlüssel und liefern dann
Platzhalter statt einer Karte.

### Warum OpenStreetMap in Home Assistant blockiert wirkt

Home Assistant sendet `Referrer-Policy: no-referrer` und dazu
`<meta name="referrer" content="same-origin">`. Der Browser schickt aus einer
HA-Seite heraus also keinen `Referer` mit – auch nicht beim Laden der Kacheln.
OpenStreetMap beantwortet referrerlose Anfragen mit seiner *Access blocked*-
Kachel. Gemessen:

```
ohne Referer  → Platzhalter   (unabhängig von {s} und User-Agent)
mit Referer   → echte Karte   (auch mit {s}, auch von localhost)
```

Die abgekündigte `{s}`-Form ist also nicht die Ursache. Der `osm`-Stil setzt
deshalb `referrerPolicy: "origin"` auf die Kachel-Elemente, was die Richtlinie
der Seite überschreibt. Preis dafür: Der Kachelserver erfährt die Adresse deiner
Instanz. Nur dort gesetzt, wo der Anbieter es braucht.

Funktioniert dieselbe URL in einer anderen Installation, lohnt ein Blick auf
deren Kopfzeilen – eine abweichende Richtlinie erklärt den Unterschied:

```bash
curl -sD- -o /dev/null https://deine-instanz/ | grep -i referrer
```

**Warum nicht einfach das, was HA nutzt:** Die eingebaute Map-Karte von Home
Assistant verwendet CARTO und zeigt derzeit deren Wasserzeichen. Den Standard
davon abzuleiten würde das Problem erben.

Die OSM-Stile laufen auf gespendeter Infrastruktur. Sie liefern derzeit
sauber, sind aber bewusst nicht der Standard – dasselbe Risiko hat
`tile.openstreetmap.org` bereits eingelöst.

Bewusst **nicht** konfigurierbar: Es werden immer alle `person`-Entitäten
gezeigt, und Kartenhöhe, Start-Zoom, Startebene, Aufenthalts-Radius sowie
Mindestdauer stehen fest in `DEFAULTS` (`src/const.ts`). `esri_gray` folgt dem
Theme und schaltet auf dunkle Kacheln um; die übrigen Stile haben keine dunkle
Variante. Der Editor bleibt
dadurch auf das beschränkt, was tatsächlich verstellt wird. Zeitraum und
Kartenebene lassen sich weiterhin zur Laufzeit umschalten.

Das Aussehen lässt sich über CSS-Variablen anpassen: `--ftc-accent` färbt
Schaltflächen und dient als Rückfallwert, sobald eine Person keine eigene Farbe
hat und auch die Palette nicht greift.

## Wie die Aufenthaltserkennung arbeitet

1. Die Rohspur wird bereinigt: unbrauchbare Koordinaten fliegen raus, die Punkte
   werden chronologisch sortiert, doppelte Zeitstempel entfernt.
2. Die Spur wird in Läufe gleichen Zustands zerlegt. Ein Lauf mit einem
   **Zonennamen** (`home` oder eine eigene Zone) ist direkt ein Aufenthalt –
   Ankunft und Abfahrt stammen aus den State-Wechseln und sind exakt.
3. Nur Läufe ausserhalb bekannter Zonen laufen durch die eigentliche
   Stay-Point-Detection: Punkte werden gruppiert, solange sie innerhalb von
   `stay_radius` um den ersten Punkt der Gruppe bleiben. Überspannt die Gruppe
   zusätzlich mindestens `stay_min_duration`, ist es ein Aufenthalt.
4. Zwei benachbarte Gruppen, die GPS-Rauschen auseinandergerissen hat, werden
   wieder zusammengeführt.
5. Alles zwischen zwei Aufenthalten ist eine Fahrt, deren Länge entlang der Spur
   aufsummiert wird.

Die Logik liegt in [`src/stay-points.ts`](src/stay-points.ts) und besteht
ausschliesslich aus reinen Funktionen ohne Lit-, DOM- oder Home-Assistant-Bezug.
Das ist Absicht: Sie ist der Kandidat für einen späteren Umzug nach Python.

## Grenzen

- **Recorder-Aufbewahrung.** Standardmässig hält der Recorder nur 10 Tage vor.
  Für längere Zeiträume muss `purge_keep_days` erhöht werden:

  ```yaml
  recorder:
    purge_keep_days: 30
  ```

- **Nominatim.** Die Nutzungsregeln erlauben maximal eine Anfrage pro Sekunde und
  verlangen Caching. Beides setzt die Karte um: Anfragen laufen durch eine
  serialisierte Warteschlange, Ergebnisse landen für 30 Tage im `localStorage`.
  Ein Browser darf den `User-Agent` nicht setzen, deshalb identifiziert sich die
  Karte über den vom Browser gesendeten Referer und optional über
  `geocode_email`.
- **Der Cache ist pro Gerät.** Jeder Browser geocodiert einmal für sich.

Beide letzten Punkte sind der Grund, warum eine zusätzliche Python-Integration
langfristig sinnvoll wäre: Sie würde Aufenthalte serverseitig berechnen, einmalig
geocodieren und persistent ablegen. Bewusst nicht Teil des ersten Wurfs.

## Entwicklung

```bash
corepack enable
yarn install
yarn test        # Unit-Tests der reinen Module
yarn typecheck   # Quellen und Tests
yarn build       # dist/family-tracking-card.js
yarn deploy      # verlinkt dist/ nach $HA_CONFIG/www/
```

Home Assistant als eigener Container mit persistentem Config-Ordner, damit die
Standorthistorie über Tage erhalten bleibt:

```bash
./dev/ha.sh up        # http://localhost:8123
./dev/ha.sh recreate  # nach Änderungen an docker-compose.yml, prüft die Ressource
./dev/ha.sh logs
./dev/ha.sh down
```

Der Config-Ordner liegt daneben unter `../ha-dev/config`. Der Container mountet
`dist/` zusätzlich nach `/config/www/ftc`, deshalb ist nach dem ersten Start nur
einmal die Ressource einzutragen:

- URL: `/local/ftc/family-tracking-card.js`
- Typ: **JavaScript-Modul**

Danach genügt `yarn build` plus Hard-Refresh (Strg+Shift+R). `yarn deploy` wird
für diesen Container nicht gebraucht – es ist für eine bestehende
Home-Assistant-Installation gedacht, die den Repository-Ordner ohnehin sieht.
Ein Symlink aus `dist/` in ein Config-Verzeichnis, das ein anderer Container
bereitstellt, zeigt dort ins Leere und endet in einem 404.

#### Ohne Docker-Zugriff: Bundle direkt ausliefern

Läuft die Entwicklung in einem Devcontainer ohne Docker-Socket, lässt sich der
Volume-Mount nicht einrichten. Dann liefert [`dev/serve.mjs`](dev/serve.mjs) das
Bundle per HTTP aus, und die Ressource zeigt auf eine absolute URL:

```bash
node dev/serve.mjs --port 8099
```

Ressource: `http://localhost:8099/family-tracking-card.js`, Typ
**JavaScript-Modul**. Der Server setzt `Access-Control-Allow-Origin: *`, weil
Home Assistant Ressourcen als `<script type="module">` einbindet und ein
Modul-Skript fremder Herkunft sonst nicht ausgeführt wird. `Cache-Control:
no-store` sorgt dafür, dass nach einem Build wirklich die neue Datei kommt.

Das ist ein Notnagel für die Entwicklung, kein Weg für eine Installation: Der
Server hat keine Authentifizierung, und die Karte ist nur erreichbar, solange er
läuft.

Den Ressourcen-Eintrag selbst muss man dafür nicht klicken.
[`dev/ha-api.mjs`](dev/ha-api.mjs) erledigt ihn über die WebSocket-API – über
REST geht es nicht, Lovelace-Ressourcen gibt es dort schlicht nicht:

```bash
export HA_TOKEN="<Langlebiges Zugriffstoken>"
node dev/ha-api.mjs state       # Version, Ressourcen, Personen, Zonen
node dev/ha-api.mjs resource    # Ressource anlegen oder auf neue URL umbiegen
node dev/ha-api.mjs dashboard   # eigenes Dashboard mit der Karte
```

`resource` ist idempotent und biegt einen bestehenden Eintrag auf denselben
Dateinamen um, statt einen zweiten anzulegen. `dashboard` legt bewusst ein
eigenes Dashboard an und fasst vorhandene nicht an.

Erscheint die Karte nicht in der Kartenauswahl, ist fast immer die Ressource
schuld und nicht der Code. Genau das prüft `./dev/ha.sh recreate` am Ende selbst,
von Hand geht es mit einem Einzeiler:

```bash
curl -o /dev/null -w '%{http_code}\n' http://localhost:8123/local/ftc/family-tracking-card.js
```

`200` heisst: Bundle wird ausgeliefert, die Registrierung über
`window.customCards` greift und die Karte steht in der Auswahl. `404` heisst:
Ressource fehlt oder der Pfad stimmt nicht – am Code liegt es dann nicht.

### Testdaten

Eine frische Instanz hat weder Personen noch Standortverlauf.
[`scripts/simulate_route.py`](scripts/simulate_route.py) fährt eine Route per
die States-API ab und baut dabei absichtlich längere Standzeiten ein. Die
Zonenzuordnung rechnet das Skript selbst – nach derselben Regel wie Home
Assistant, die kleinste passende Zone gewinnt –, weil das bei direkt gesetzten
Zuständen niemand sonst übernimmt:

```bash
export HA_TOKEN="<Langlebiges Zugriffstoken>"
python3 scripts/simulate_route.py --profile quick --dry-run   # Plan ansehen
python3 scripts/simulate_route.py --profile quick             # ~21 min
python3 scripts/simulate_route.py --profile day               # ~3 h
```

Danach in Home Assistant:

1. Einstellungen → Personen → Person anlegen und `device_tracker.sim_phone`
   zuordnen.
2. Einstellungen → Bereiche & Zonen → Zone *Arbeit* am Büro-Wegpunkt anlegen.
   Erst dann ist zu sehen, dass Aufenthalte in Zonen ohne Geocoding auskommen.

Wichtig: Der Recorder stempelt jede Messung in Echtzeit. Ein Aufenthalt wird also
erst dann zu einem Aufenthalt, wenn diese Zeit real vergangen ist – `--speed`
verkürzt damit auch die aufgezeichneten Aufenthalte. Beim Beschleunigen daher
`stay_min_duration` in der Karte entsprechend senken.

Alternativen bleiben die Home-Assistant-App auf dem Handy (realistisch, braucht
aber Sammelzeit) und die `demo`-Integration.

## Projektstruktur

| Datei | Inhalt |
|---|---|
| `src/family-tracking-card.ts` | Das Lit-Element: Zustand, Laden, Darstellung |
| `src/track-map.ts` | Leaflet-Instanz, bewusst ausserhalb des Lit-Renderzyklus |
| `src/stay-points.ts` | Aufenthaltserkennung, reine Funktionen |
| `src/history.ts` | Recorder-Abfrage und Parsen der komprimierten Antwort |
| `src/geocode.ts` | Nominatim mit Warteschlange und Cache |
| `src/editor.ts` | Visueller Editor auf Basis von `ha-form` |
| `src/format.ts` | Zeit-, Dauer- und Distanzformatierung |

## Lizenz

MIT
