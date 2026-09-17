import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { toTrackPoints } from "../../src/history.ts";

describe("toTrackPoints", () => {
  it("carries state and attributes forward across compressed entries", () => {
    const points = toTrackPoints([
      { s: "home", a: { latitude: 48.2, longitude: 16.3, gps_accuracy: 12 }, lu: 1_700_000_000 },
      // Neither state nor attributes changed, only the timestamp.
      { lu: 1_700_000_060 },
      { s: "not_home", lu: 1_700_000_120 },
      { a: { latitude: 48.21, longitude: 16.31, gps_accuracy: 8 }, lu: 1_700_000_180 },
    ]);

    assert.equal(points.length, 4);
    assert.deepEqual(
      points.map((p) => p.zone),
      ["home", "home", "not_home", "not_home"]
    );
    assert.deepEqual(
      points.map((p) => p.lat),
      [48.2, 48.2, 48.2, 48.21]
    );
    assert.equal(points[3].accuracy, 8);
  });

  it("converts epoch seconds to milliseconds", () => {
    const points = toTrackPoints([
      { s: "home", a: { latitude: 48.2, longitude: 16.3 }, lu: 1_700_000_000.5 },
    ]);
    assert.equal(points[0].t, 1_700_000_000_500);
  });

  it("skips entries without usable coordinates", () => {
    const points = toTrackPoints([
      { s: "unknown", a: {}, lu: 1_700_000_000 },
      { s: "home", a: { latitude: 48.2, longitude: 16.3 }, lu: 1_700_000_060 },
      { s: "not_home", a: { latitude: "n/a", longitude: 16.3 }, lu: 1_700_000_120 },
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0].zone, "home");
  });

  it("falls back to last_changed when last_updated is absent", () => {
    const points = toTrackPoints([
      { s: "home", a: { latitude: 48.2, longitude: 16.3 }, lc: 1_700_000_000 },
    ]);
    assert.equal(points[0].t, 1_700_000_000_000);
  });

  it("returns nothing for an empty history", () => {
    assert.deepEqual(toTrackPoints([]), []);
  });
});
