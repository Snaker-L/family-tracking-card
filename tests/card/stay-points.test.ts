import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildTimeline,
  detectStays,
  haversine,
  isNamedZone,
  pathLength,
  sanitizePoints,
  staysOf,
  type Stay,
} from "../../src/stay-points.ts";
import { HOME_LAT, HOME_LON, eastOf, minutes, northOf, point } from "./helpers.ts";

const OPTS = { radius: 120, minDurationMs: 5 * 60_000 };

describe("haversine", () => {
  it("returns zero for identical coordinates", () => {
    assert.equal(haversine(HOME_LAT, HOME_LON, HOME_LAT, HOME_LON), 0);
  });

  it("matches a known distance within one percent", () => {
    // Vienna to Graz is roughly 145 km.
    const metres = haversine(48.2082, 16.3738, 47.0707, 15.4395);
    assert.ok(Math.abs(metres - 145_000) / 145_000 < 0.01, `got ${metres}`);
  });

  it("is symmetric", () => {
    const a = haversine(48.2, 16.3, 48.3, 16.5);
    const b = haversine(48.3, 16.5, 48.2, 16.3);
    assert.ok(Math.abs(a - b) < 1e-6);
  });
});

describe("sanitizePoints", () => {
  it("sorts, deduplicates timestamps and drops unusable samples", () => {
    const input = [
      point(10, HOME_LAT, HOME_LON, "home"),
      point(0, HOME_LAT, HOME_LON, "home"),
      point(0, HOME_LAT, HOME_LON, "home"),
      point(5, Number.NaN, HOME_LON, "home"),
      point(6, 0, 0, "home"),
      point(7, 200, HOME_LON, "home"),
    ];
    const result = sanitizePoints(input);
    assert.deepEqual(
      result.map((p) => p.t),
      [minutes(0), minutes(10)]
    );
  });

  it("honours the accuracy limit but keeps samples without accuracy", () => {
    const input = [
      point(0, HOME_LAT, HOME_LON, "home", 20),
      point(1, HOME_LAT, HOME_LON, "home", 5000),
      point(2, HOME_LAT, HOME_LON, "home"),
    ];
    assert.equal(sanitizePoints(input, 100).length, 2);
  });
});

describe("detectStays", () => {
  it("finds a dwell that exceeds the minimum duration", () => {
    const points = [0, 4, 8, 12, 16, 20].map((m) =>
      point(m, northOf(HOME_LAT, m % 3 === 0 ? 0 : 25), HOME_LON, "not_home")
    );
    const stays = detectStays(points, OPTS);
    assert.equal(stays.length, 1);
    assert.equal(stays[0].source, "cluster");
    assert.equal(stays[0].end - stays[0].start, 20 * 60_000);
  });

  it("ignores a pass-through where every step leaves the radius", () => {
    const points = [0, 4, 8, 12, 16].map((m) =>
      point(m, northOf(HOME_LAT, m * 500), HOME_LON, "not_home")
    );
    assert.deepEqual(detectStays(points, OPTS), []);
  });

  it("ignores a stop that is shorter than the minimum duration", () => {
    const points = [0, 1, 2].map((m) => point(m, HOME_LAT, HOME_LON, "not_home"));
    assert.deepEqual(detectStays(points, OPTS), []);
  });

  it("merges two clusters torn apart by a single jittered sample", () => {
    const near = (m: number) => point(m, northOf(HOME_LAT, 20), HOME_LON, "not_home");
    const points = [
      point(0, HOME_LAT, HOME_LON, "not_home"),
      near(6),
      // One outlier 400 m away breaks the anchor group.
      point(8, northOf(HOME_LAT, 400), HOME_LON, "not_home"),
      point(10, HOME_LAT, HOME_LON, "not_home"),
      near(16),
    ];
    const stays = detectStays(points, OPTS);
    assert.equal(stays.length, 1);
    assert.equal(stays[0].start, minutes(0));
    assert.equal(stays[0].end, minutes(16));
  });
});

/**
 * A full day fragment: half an hour at home, a drive, a long stop at an address
 * outside any zone, then back home.
 */
function commuteTrack() {
  const work = northOf(HOME_LAT, 5000);
  const home = [0, 5, 10, 15, 20, 25].map((m) => point(m, HOME_LAT, HOME_LON, "home"));
  const drive = [30, 35, 40, 45, 50, 55].map((m) =>
    point(m, northOf(HOME_LAT, (m - 25) * 800), HOME_LON, "not_home")
  );
  const stop: ReturnType<typeof point>[] = [];
  for (let m = 60; m <= 164; m += 4) {
    const jitter = ((m / 4) % 3) * 15 - 15;
    stop.push(point(m, northOf(work, jitter), eastOf(work, HOME_LON, jitter), "not_home"));
  }
  const back = [170, 175, 180].map((m) => point(m, HOME_LAT, HOME_LON, "home"));
  return [...home, ...drive, ...stop, ...back];
}

describe("buildTimeline", () => {
  it("returns an empty timeline for an empty track", () => {
    assert.deepEqual(buildTimeline([], OPTS), []);
  });

  it("alternates stays and trips", () => {
    const segments = buildTimeline(commuteTrack(), OPTS);
    assert.deepEqual(
      segments.map((s) => s.kind),
      ["stay", "trip", "stay", "trip", "stay"]
    );
  });

  it("takes arrival and departure of a zone straight from the state changes", () => {
    const stays = staysOf(buildTimeline(commuteTrack(), OPTS));
    const first = stays[0];
    assert.equal(first.source, "zone");
    assert.equal(first.zone, "home");
    assert.equal(first.start, minutes(0));
    // Departure is the moment the state flipped, not the last sample at 25 min.
    assert.equal(first.end, minutes(30));
  });

  it("condenses the long stop outside any zone into a single stay", () => {
    const stays = staysOf(buildTimeline(commuteTrack(), OPTS));
    const stop = stays[1];
    assert.equal(stop.source, "cluster");
    assert.equal(stop.zone, undefined);
    assert.equal(stop.end - stop.start, 104 * 60_000);
    assert.ok(stop.samples > 20, "the raw samples collapse into one entry");
    assert.ok(stop.spread < 50, `spread was ${stop.spread}`);
  });

  it("does not turn a short pass through a zone into a stay", () => {
    const track = [
      point(0, HOME_LAT, HOME_LON, "not_home"),
      point(4, northOf(HOME_LAT, 2000), HOME_LON, "Arbeit"),
      point(6, northOf(HOME_LAT, 4000), HOME_LON, "not_home"),
      point(10, northOf(HOME_LAT, 6000), HOME_LON, "not_home"),
    ];
    assert.deepEqual(staysOf(buildTimeline(track, OPTS)), []);
  });

  it("keeps a named zone even when it is visited briefly but long enough", () => {
    const track = [
      point(0, HOME_LAT, HOME_LON, "not_home"),
      point(4, northOf(HOME_LAT, 2000), HOME_LON, "Arbeit"),
      point(12, northOf(HOME_LAT, 2010), HOME_LON, "Arbeit"),
      point(16, northOf(HOME_LAT, 4000), HOME_LON, "not_home"),
    ];
    const stays = staysOf(buildTimeline(track, OPTS));
    assert.equal(stays.length, 1);
    assert.equal(stays[0].zone, "Arbeit");
    assert.equal(stays[0].end - stays[0].start, 12 * 60_000);
  });

  it("measures the driven distance along the path", () => {
    const segments = buildTimeline(commuteTrack(), OPTS);
    const trip = segments.find((s) => s.kind === "trip");
    assert.ok(trip && trip.kind === "trip");
    assert.ok(trip.distance > 4000, `distance was ${trip.distance}`);
  });
});

describe("isNamedZone", () => {
  it("treats home and custom zones as named", () => {
    assert.equal(isNamedZone("home"), true);
    assert.equal(isNamedZone("Arbeit"), true);
  });

  it("treats not_home and unavailable states as unnamed", () => {
    for (const state of ["not_home", "unknown", "unavailable", ""]) {
      assert.equal(isNamedZone(state), false, state);
    }
  });
});

describe("pathLength", () => {
  it("sums the leg distances", () => {
    const track = [
      point(0, HOME_LAT, HOME_LON, "not_home"),
      point(1, northOf(HOME_LAT, 1000), HOME_LON, "not_home"),
      point(2, northOf(HOME_LAT, 2000), HOME_LON, "not_home"),
    ];
    assert.ok(Math.abs(pathLength(track) - 2000) < 5);
  });
});

/** Keeps the Stay type referenced so the test file type-checks as written. */
const _typeCheck: Stay["source"] = "zone";
void _typeCheck;
