import { strictEqual } from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  clearPreviewLayer,
  notePreviewLayer,
  peekPreviewLayer,
} from "../../src/preview-layer.ts";

describe("Notiz des Editors an die Vorschau", () => {
  beforeEach(() => clearPreviewLayer());

  it("meldet nichts, solange niemand etwas hinterlegt hat", () => {
    strictEqual(peekPreviewLayer(), undefined);
  });

  it("gibt die zuletzt gewählte Ebene zurück", () => {
    notePreviewLayer("satellite");
    strictEqual(peekPreviewLayer(), "satellite");
  });

  /* Home Assistant kann pro Änderung mehr als ein Element bauen; eine Notiz,
     die beim ersten Lesen verschwindet, ginge dabei verloren. */
  it("überlebt mehrmaliges Lesen", () => {
    notePreviewLayer("satellite");
    strictEqual(peekPreviewLayer(), "satellite");
    strictEqual(peekPreviewLayer(), "satellite");
  });

  it("überschreibt eine ältere Notiz", () => {
    notePreviewLayer("satellite");
    notePreviewLayer("street");
    strictEqual(peekPreviewLayer(), "street");
  });

  it("verfällt, damit sie nicht in eine fremde Karte durchschlägt", () => {
    const t = 1_000_000;
    notePreviewLayer("satellite", t);
    strictEqual(peekPreviewLayer(t + 2_999), "satellite");
    strictEqual(peekPreviewLayer(t + 3_001), undefined);
  });

  it("vergisst die verfallene Notiz endgültig", () => {
    const t = 1_000_000;
    notePreviewLayer("satellite", t);
    peekPreviewLayer(t + 5_000);
    strictEqual(peekPreviewLayer(t), undefined);
  });
});
