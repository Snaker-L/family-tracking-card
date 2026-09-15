/**
 * Recorder history access.
 *
 * `history/history_during_period` answers in the compressed form: `s` state,
 * `a` attributes, `lu` last_updated as epoch seconds. Attributes are only
 * transmitted when they change, so they have to be carried forward.
 */
import type { HomeAssistant, TrackPoint } from "./types";

interface CompressedState {
  s?: string;
  a?: Record<string, any>;
  lu?: number;
  lc?: number;
}

type HistoryResponse = Record<string, CompressedState[]>;

export class HistoryError extends Error {}

export async function fetchPersonHistory(
  hass: HomeAssistant,
  entityId: string,
  start: Date,
  end: Date
): Promise<TrackPoint[]> {
  let response: HistoryResponse;
  try {
    response = await hass.callWS<HistoryResponse>({
      type: "history/history_during_period",
      entity_ids: [entityId],
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      // Without this the coordinates are missing entirely.
      no_attributes: false,
      minimal_response: false,
      significant_changes_only: false,
    });
  } catch (err: any) {
    throw new HistoryError(err?.message ?? String(err));
  }

  return toTrackPoints(response[entityId] ?? []);
}

/** Exported for the unit tests: the parsing is the fiddly part, not the call. */
export function toTrackPoints(entries: CompressedState[]): TrackPoint[] {
  const points: TrackPoint[] = [];
  let state = "";
  let attributes: Record<string, any> = {};

  for (const entry of entries) {
    if (entry.s !== undefined) state = entry.s;
    if (entry.a !== undefined) attributes = entry.a;

    const lat = Number(attributes.latitude);
    const lon = Number(attributes.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const seconds = entry.lu ?? entry.lc;
    if (!Number.isFinite(seconds)) continue;

    const accuracy = Number(attributes.gps_accuracy);
    points.push({
      t: Math.round((seconds as number) * 1000),
      lat,
      lon,
      accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
      zone: state,
      source: attributes.source,
    });
  }

  return points;
}

/**
 * Appends the live state as the newest sample. The recorder only writes on
 * change, so without this the track stops at the last state change rather than
 * at "now".
 */
export function withCurrentState(
  points: TrackPoint[],
  hass: HomeAssistant,
  entityId: string
): TrackPoint[] {
  const entity = hass.states[entityId];
  if (!entity) return points;

  const lat = Number(entity.attributes.latitude);
  const lon = Number(entity.attributes.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return points;

  const t = new Date(entity.last_updated).getTime();
  if (!Number.isFinite(t)) return points;
  if (points.length > 0 && points[points.length - 1].t >= t) return points;

  const accuracy = Number(entity.attributes.gps_accuracy);
  return [
    ...points,
    {
      t,
      lat,
      lon,
      accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
      zone: entity.state,
      source: entity.attributes.source,
    },
  ];
}
