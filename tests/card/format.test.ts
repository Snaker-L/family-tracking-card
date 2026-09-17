import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  formatDistance,
  formatDuration,
  formatRange,
  formatSpan,
} from "../../src/format.ts";

describe("formatDuration", () => {
  it("renders the example from the specification", () => {
    assert.equal(formatDuration(104 * 60_000), "1 h 44 min");
  });

  it("renders seconds, minutes, hours and days", () => {
    assert.equal(formatDuration(30_000), "30 s");
    assert.equal(formatDuration(12 * 60_000), "12 min");
    assert.equal(formatDuration(2 * 3_600_000), "2 h");
    assert.equal(formatDuration(50 * 3_600_000), "2 d 2 h");
  });

  it("returns an empty string for nonsense input", () => {
    assert.equal(formatDuration(Number.NaN), "");
    assert.equal(formatDuration(-5), "");
  });
});

describe("formatSpan", () => {
  const start = Date.UTC(2026, 0, 5, 13, 3);
  const end = Date.UTC(2026, 0, 5, 14, 47);

  it("shows two times when the stay stays within one day", () => {
    const span = formatSpan(start, end, "de-DE");
    assert.match(span, /^\d{2}:\d{2} – \d{2}:\d{2}$/);
  });

  it("adds the date when the stay crosses midnight", () => {
    const span = formatSpan(start, end + 24 * 3_600_000, "de-DE");
    assert.ok(span.length > 13, span);
  });
});

describe("formatDistance", () => {
  it("rounds metres to ten and switches to kilometres", () => {
    assert.equal(formatDistance(344), "340 m");
    assert.equal(formatDistance(1500), "1.5 km");
  });
});

describe("formatRange", () => {
  it("expresses whole days as days", () => {
    assert.equal(formatRange(6), "6 h");
    assert.equal(formatRange(24), "1 d");
    assert.equal(formatRange(168), "7 d");
  });
});
