import type { TrackPoint } from "../../src/types.ts";

/** Reference location: Vienna city centre. */
export const HOME_LAT = 48.2082;
export const HOME_LON = 16.3738;

export const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

export const minutes = (n: number): number => T0 + n * 60_000;

export const northOf = (lat: number, metres: number): number => lat + metres / 111_320;

export const eastOf = (lat: number, lon: number, metres: number): number =>
  lon + metres / (111_320 * Math.cos((lat * Math.PI) / 180));

export function point(
  minute: number,
  lat: number,
  lon: number,
  zone: string,
  accuracy?: number
): TrackPoint {
  return { t: minutes(minute), lat, lon, zone, accuracy };
}
