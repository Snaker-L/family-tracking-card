/**
 * Stay-point detection.
 *
 * Pure functions only: no Lit, no DOM, no Home Assistant objects. The module is
 * kept isolated on purpose, because this logic is the candidate for moving into
 * a Python integration later (stage 3).
 */
import type { TrackPoint } from "./types";

/** States that do not denote a named zone. */
const UNNAMED_STATES = new Set(["not_home", "unknown", "unavailable", "none", ""]);

export interface StayPointOptions {
  /** Grouping radius in metres. */
  radius: number;
  /** Minimum dwell time in milliseconds. */
  minDurationMs: number;
  /** Drop samples whose reported GPS accuracy is worse than this (metres). */
  maxAccuracy?: number;
}

export interface Stay {
  kind: "stay";
  /** Epoch milliseconds. */
  start: number;
  end: number;
  lat: number;
  lon: number;
  /** Set when the stay was derived from a named zone. */
  zone?: string;
  /** How the stay was found. Zone stays are exact, clusters are estimated. */
  source: "zone" | "cluster";
  /** Number of samples that formed the stay. */
  samples: number;
  /** Largest distance of a member from the centroid, in metres. */
  spread: number;
}

export interface Trip {
  kind: "trip";
  start: number;
  end: number;
  /** Distance along the sampled path, in metres. */
  distance: number;
  path: TrackPoint[];
}

export type Segment = Stay | Trip;

export const isNamedZone = (state: string): boolean =>
  !UNNAMED_STATES.has((state ?? "").toLowerCase());

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance between two coordinates, in metres. */
export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const distance = (a: TrackPoint, b: TrackPoint) => haversine(a.lat, a.lon, b.lat, b.lon);

/** Arithmetic mean of the member coordinates. Good enough at city scale. */
export function centroid(points: TrackPoint[]): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / points.length, lon: lon / points.length };
}

/** Summed distance along the sampled path, in metres. */
export function pathLength(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/**
 * Drops unusable samples, sorts chronologically and removes duplicate
 * timestamps. Every other function in this module assumes sanitized input.
 */
export function sanitizePoints(points: TrackPoint[], maxAccuracy?: number): TrackPoint[] {
  const usable = points.filter(
    (p) =>
      Number.isFinite(p.t) &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lon) <= 180 &&
      !(p.lat === 0 && p.lon === 0) &&
      (maxAccuracy === undefined || p.accuracy === undefined || p.accuracy <= maxAccuracy)
  );
  usable.sort((a, b) => a.t - b.t);
  return usable.filter((p, i) => i === 0 || p.t !== usable[i - 1].t);
}

function makeStay(
  members: TrackPoint[],
  source: Stay["source"],
  start: number,
  end: number,
  zone?: string
): Stay {
  const { lat, lon } = centroid(members);
  let spread = 0;
  for (const p of members) spread = Math.max(spread, haversine(lat, lon, p.lat, p.lon));
  return { kind: "stay", start, end, lat, lon, zone, source, samples: members.length, spread };
}

/**
 * Anchor-based stay-point detection: walk the samples chronologically and grow a
 * group as long as the following samples stay within `radius` of the group
 * anchor. A group that also spans at least `minDurationMs` is a stay.
 *
 * Input must be sanitized. Zone information is ignored here, see
 * `buildTimeline` for the zone-first variant.
 */
export function detectStays(points: TrackPoint[], opts: StayPointOptions): Stay[] {
  const stays: Stay[] = [];
  let i = 0;
  while (i < points.length) {
    let j = i + 1;
    while (j < points.length && distance(points[i], points[j]) <= opts.radius) j++;
    const lastIndex = j - 1;
    const duration = points[lastIndex].t - points[i].t;
    if (lastIndex > i && duration >= opts.minDurationMs) {
      const members = points.slice(i, j);
      stays.push(makeStay(members, "cluster", members[0].t, members[members.length - 1].t));
      i = j;
    } else {
      i++;
    }
  }
  return mergeNeighbours(stays, opts);
}

/**
 * GPS jitter can tear a single dwell into two neighbouring clusters. Merge them
 * back together when their centres are within the radius and the interruption
 * was shorter than the minimum dwell time.
 */
function mergeNeighbours(stays: Stay[], opts: StayPointOptions): Stay[] {
  const merged: Stay[] = [];
  for (const stay of stays) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.source === stay.source &&
      previous.zone === stay.zone &&
      stay.start - previous.end <= opts.minDurationMs &&
      haversine(previous.lat, previous.lon, stay.lat, stay.lon) <= opts.radius
    ) {
      const weight = previous.samples + stay.samples;
      merged[merged.length - 1] = {
        ...previous,
        end: stay.end,
        lat: (previous.lat * previous.samples + stay.lat * stay.samples) / weight,
        lon: (previous.lon * previous.samples + stay.lon * stay.samples) / weight,
        samples: weight,
        spread: Math.max(previous.spread, stay.spread),
      };
    } else {
      merged.push({ ...stay });
    }
  }
  return merged;
}

interface ZoneRun {
  zone: string;
  points: TrackPoint[];
  /** Timestamp at which the person left this state, if a later state exists. */
  leftAt?: number;
}

/** Splits the track into runs of consecutive samples sharing the same state. */
function splitByZone(points: TrackPoint[]): ZoneRun[] {
  const runs: ZoneRun[] = [];
  for (const point of points) {
    const current = runs[runs.length - 1];
    if (current && current.zone === point.zone) current.points.push(point);
    else runs.push({ zone: point.zone, points: [point] });
  }
  for (let i = 0; i < runs.length - 1; i++) runs[i].leftAt = runs[i + 1].points[0].t;
  return runs;
}

/**
 * Turns a raw track into an alternating list of stays and trips.
 *
 * Named zones win: for `home` or a custom zone the person entity state changes
 * already mark arrival and departure to the second, so no clustering, and no
 * geocoding, is needed. Only stretches outside any known zone are run through
 * `detectStays`.
 */
export function buildTimeline(points: TrackPoint[], opts: StayPointOptions): Segment[] {
  const track = sanitizePoints(points, opts.maxAccuracy);
  if (track.length === 0) return [];

  const stays: Stay[] = [];
  for (const run of splitByZone(track)) {
    if (isNamedZone(run.zone)) {
      const start = run.points[0].t;
      const end = run.leftAt ?? run.points[run.points.length - 1].t;
      if (end - start >= opts.minDurationMs) {
        stays.push(makeStay(run.points, "zone", start, end, run.zone));
      }
    } else {
      stays.push(...detectStays(run.points, opts));
    }
  }
  stays.sort((a, b) => a.start - b.start);

  return withTrips(track, stays);
}

/** Fills the gaps between stays with trip segments. */
function withTrips(track: TrackPoint[], stays: Stay[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = track[0].t;

  const pushTrip = (from: number, to: number) => {
    if (to <= from) return;
    const path = track.filter((p) => p.t >= from && p.t <= to);
    if (path.length < 2) return;
    const travelled = pathLength(path);
    if (travelled <= 0) return;
    segments.push({ kind: "trip", start: from, end: to, distance: travelled, path });
  };

  for (const stay of stays) {
    pushTrip(cursor, stay.start);
    segments.push(stay);
    cursor = stay.end;
  }
  pushTrip(cursor, track[track.length - 1].t);

  return segments;
}

/** Convenience filter for the UI, which lists stays only. */
export const staysOf = (segments: Segment[]): Stay[] =>
  segments.filter((s): s is Stay => s.kind === "stay");
