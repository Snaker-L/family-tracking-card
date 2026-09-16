import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { LANGUAGES, languageOf, localize, personStateKey } from "../src/localize.ts";
import { EDITOR_SCHEMA, SATELLITE_STYLES, STREET_STYLES } from "../src/const.ts";

describe("Sprache bestimmen", () => {
  it("nimmt die Sprache, die Home Assistant meldet", () => {
    strictEqual(languageOf("de"), "de");
    strictEqual(languageOf("en"), "en");
  });

  /* Home Assistant meldet oft eine Region mit -- de-AT ist dieselbe Tabelle. */
  it("ignoriert die Region", () => {
    strictEqual(languageOf("de-AT"), "de");
    strictEqual(languageOf("de_DE"), "de");
    strictEqual(languageOf("DE-at"), "de");
  });

  it("fällt auf Englisch zurück", () => {
    strictEqual(languageOf(undefined), "en");
    strictEqual(languageOf(""), "en");
    strictEqual(languageOf("kl"), "en");
  });
});

describe("Übersetzen", () => {
  it("liefert die Sprache des Nutzers", () => {
    strictEqual(localize("de", "card.stays"), "Aufenthalte");
    strictEqual(localize("en", "card.stays"), "Stays");
    strictEqual(localize("de-AT", "card.stays"), "Aufenthalte");
  });

  it("setzt Platzhalter ein", () => {
    strictEqual(localize("de", "card.hide_person", { name: "Anna" }), "Anna ausblenden");
    strictEqual(localize("en", "card.hide_person", { name: "Anna" }), "Hide Anna");
  });

  it("lässt einen Platzhalter stehen, für den nichts übergeben wurde", () => {
    ok(localize("en", "card.hide_person", {}).includes("{name}"));
  });

  /* Ein vergessener Schlüssel soll auffallen, nicht leer bleiben. */
  it("gibt einen unbekannten Schlüssel zurück", () => {
    strictEqual(localize("en", "gibt.es.nicht"), "gibt.es.nicht");
  });

  it("fällt bei fehlender Übersetzung auf Englisch zurück", () => {
    // osm ist nur einmal hinterlegt, weil der Name in beiden Sprachen gleich ist.
    strictEqual(localize("de", "style.osm"), "OpenStreetMap");
  });
});

describe("Vollständigkeit", () => {
  it("übersetzt jeden Kachelstil", () => {
    for (const id of [...Object.keys(STREET_STYLES), ...Object.keys(SATELLITE_STYLES), "custom"]) {
      ok(localize("en", `style.${id}`) !== `style.${id}`, `style.${id} fehlt`);
    }
  });

  it("übersetzt jedes Formularfeld", () => {
    const namen: string[] = [];
    for (const entry of EDITOR_SCHEMA) {
      const e = entry as { name: string; schema?: readonly { name: string }[] };
      if (e.schema) namen.push(...e.schema.map((x) => x.name));
      else if (e.name) namen.push(e.name);
    }
    for (const name of namen) {
      ok(localize("en", `editor.${name}`) !== `editor.${name}`, `editor.${name} fehlt`);
    }
  });

  /* Deutsch darf lückenhaft sein -- Englisch nicht, es ist der Rückfall. */
  it("kennt genau die gepflegten Sprachen", () => {
    deepStrictEqual(LANGUAGES, ["en", "de"]);
  });
});

describe("Zustände einer Person", () => {
  /* Die Karte zeigte bisher das rohe Wort aus Home Assistant. */
  it("benennt die technischen Zustände", () => {
    strictEqual(localize("de", personStateKey("not_home")!), "Unterwegs");
    strictEqual(localize("de", personStateKey("unknown")!), "Unterwegs");
    strictEqual(localize("en", personStateKey("not_home")!), "Away");
    strictEqual(localize("de", personStateKey("home")!), "Zuhause");
  });

  it("hält einen ausgefallenen Tracker davon getrennt", () => {
    strictEqual(localize("de", personStateKey("unavailable")!), "Nicht verfügbar");
    strictEqual(localize("en", personStateKey("unavailable")!), "Unavailable");
  });

  it("ignoriert Groß- und Kleinschreibung", () => {
    strictEqual(personStateKey("NOT_HOME"), personStateKey("not_home"));
  });

  /* Ein selbst benannter Zonenname muss unangetastet durchgehen. */
  it("lässt echte Zonennamen in Ruhe", () => {
    strictEqual(personStateKey("Arbeit"), undefined);
    strictEqual(personStateKey("Schule"), undefined);
  });

  it("behandelt Fehlendes wie unterwegs", () => {
    strictEqual(localize("de", personStateKey("")!), "Unterwegs");
    strictEqual(localize("de", personStateKey(undefined)!), "Unterwegs");
  });
});
