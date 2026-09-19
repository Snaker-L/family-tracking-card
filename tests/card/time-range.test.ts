import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatAbsoluteRange,
  resolveRange,
  toDateField,
  toTimeField,
  windowStart,
} from "../../src/time-range.ts";
import { DEFAULTS, TODAY } from "../../src/const.ts";

/** Local time, so the expectations survive whatever zone the tests run in. */
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(y, m - 1, d, h, min, s, ms).getTime();

describe("Zeitraum aus Kalender und Uhrzeit", () => {
  it("nimmt einen Bereich über mehrere Tage", () => {
    deepStrictEqual(
      resolveRange({ fromDate: "2026-09-10", toDate: "2026-09-12", fromTime: "08:00", toTime: "17:30" }),
      { start: at(2026, 9, 10, 8, 0), end: at(2026, 9, 12, 17, 30, 0, 999) }
    );
  });

  /* Ein einzelner Tag ist der häufigste Fall: Datum hin, zwei Uhrzeiten, fertig. */
  it("bleibt ohne Enddatum auf demselben Tag", () => {
    deepStrictEqual(
      resolveRange({ fromDate: "2026-09-10", toDate: "", fromTime: "08:00", toTime: "17:30" }),
      { start: at(2026, 9, 10, 8, 0), end: at(2026, 9, 10, 17, 30, 0, 999) }
    );
  });

  it("deckt ohne Uhrzeiten den ganzen Tag ab", () => {
    deepStrictEqual(
      resolveRange({ fromDate: "2026-09-10", toDate: "", fromTime: "", toTime: "" }),
      { start: at(2026, 9, 10, 0, 0), end: at(2026, 9, 10, 23, 59, 59, 999) }
    );
  });

  /* Eine ausdrückliche Endzeit meint deren Beginn, eine fehlende das Tagesende --
     sonst wären "bis 23:00" und "der ganze Tag" nicht zu unterscheiden. */
  it("unterscheidet eine gesetzte von einer fehlenden Endzeit", () => {
    const explicit = resolveRange({ fromDate: "2026-09-10", toDate: "", fromTime: "", toTime: "23:59" })!;
    const open = resolveRange({ fromDate: "2026-09-10", toDate: "", fromTime: "", toTime: "" })!;
    strictEqual(explicit.end, at(2026, 9, 10, 23, 59, 0, 999));
    ok(open.end > explicit.end);
  });

  it("dreht eine verkehrt herum eingegebene Spanne um", () => {
    const range = resolveRange({ fromDate: "2026-09-10", toDate: "", fromTime: "18:00", toTime: "08:00" })!;
    deepStrictEqual(range, { start: at(2026, 9, 10, 8, 0, 0, 999), end: at(2026, 9, 10, 18, 0) });
  });

  it("meldet nichts ohne Startdatum", () => {
    strictEqual(resolveRange({ fromDate: "", toDate: "", fromTime: "", toTime: "" }), undefined);
  });

  it("weist unbrauchbare Eingaben ab", () => {
    const base = { fromDate: "2026-09-10", toDate: "", fromTime: "", toTime: "" };
    strictEqual(resolveRange({ ...base, fromDate: "10.09.2026" }), undefined);
    strictEqual(resolveRange({ ...base, toDate: "morgen" }), undefined);
    strictEqual(resolveRange({ ...base, fromTime: "25:00" }), undefined);
    strictEqual(resolveRange({ ...base, toTime: "12:70" }), undefined);
    strictEqual(resolveRange({ ...base, fromTime: "8:00" }), undefined);
  });

  /* Die Zeitzone ist die des Nutzers; ein als UTC gelesener Zeitstempel würde
     den ganzen Bereich um den Offset verschieben. */
  it("liest die Angaben in Ortszeit", () => {
    const range = resolveRange({ fromDate: "2026-09-10", toDate: "", fromTime: "08:00", toTime: "09:00" })!;
    strictEqual(new Date(range.start).getHours(), 8);
    strictEqual(new Date(range.start).getDate(), 10);
  });
});

describe("Zeitraum anzeigen und zurückschreiben", () => {
  it("kürzt einen Bereich innerhalb eines Tages auf eine Datumsangabe", () => {
    const range = { start: at(2026, 9, 10, 8, 0), end: at(2026, 9, 10, 17, 30) };
    strictEqual(formatAbsoluteRange(range, "de"), "10.09. 08:00 – 17:30");
  });

  it("nennt bei mehreren Tagen beide Daten", () => {
    const range = { start: at(2026, 9, 10, 8, 0), end: at(2026, 9, 12, 17, 30) };
    strictEqual(formatAbsoluteRange(range, "de"), "10.09. 08:00 – 12.09. 17:30");
  });

  it("füllt die Felder wieder korrekt", () => {
    const moment = at(2026, 9, 3, 7, 5);
    strictEqual(toDateField(moment), "2026-09-03");
    strictEqual(toTimeField(moment), "07:05");
  });

  /* Über toISOString gebaut, wäre hier je nach Zeitzone der Vortag entstanden. */
  it("bleibt kurz vor Mitternacht auf demselben Tag", () => {
    strictEqual(toDateField(at(2026, 9, 3, 23, 59)), "2026-09-03");
    strictEqual(toDateField(at(2026, 9, 3, 0, 1)), "2026-09-03");
  });
});

describe("Startfenster der Karte", () => {
  it("beginnt bei TODAY um Mitternacht desselben Tages", () => {
    strictEqual(windowStart(at(2026, 9, 19, 14, 37), TODAY), at(2026, 9, 19));
  });

  /* Kurz nach Mitternacht ist das Fenster fast leer -- richtig so: gefragt ist
     der heutige Tag, nicht die letzten 24 Stunden. */
  it("liefert um 00:05 nur fünf Minuten", () => {
    const end = at(2026, 9, 19, 0, 5);
    strictEqual(end - windowStart(end, TODAY), 5 * 60_000);
  });

  it("rechnet eine Stundenzahl weiterhin rückwärts", () => {
    strictEqual(windowStart(at(2026, 9, 19, 14, 0), 6), at(2026, 9, 19, 8, 0));
  });

  /* Über Mitternacht zurück, das darf die Stundenvariante ausdrücklich. */
  it("greift bei 12 h auf den Vortag zurück", () => {
    strictEqual(windowStart(at(2026, 9, 19, 6, 0), 12), at(2026, 9, 18, 18, 0));
  });

  /* Der Grund für setHours statt einer Subtraktion: An der Zeitumstellung ist
     ein Tag 23 oder 25 Stunden lang. In Europa/Wien fällt sie auf den 29.03.2026,
     anderswo nicht -- deshalb wird hier nur die Kalendergrenze selbst geprüft. */
  it("trifft die Kalendergrenze auch am Tag der Zeitumstellung", () => {
    const mittags = at(2026, 3, 29, 12, 0);
    const start = new Date(windowStart(mittags, TODAY));
    strictEqual(start.getDate(), 29);
    strictEqual(start.getHours(), 0);
    strictEqual(start.getMinutes(), 0);
  });

  it("verwendet TODAY als Werkseinstellung", () => {
    strictEqual(DEFAULTS.range, TODAY);
  });

  it("bietet Stunden bis 24 an", () => {
    deepStrictEqual(DEFAULTS.time_ranges, [1, 4, 6, 8, 12, 16, 18, 20, 22, 24]);
  });
});
