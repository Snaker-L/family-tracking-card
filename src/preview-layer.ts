/**
 * A short-lived hand-off from the editor to the card preview.
 *
 * Picking a satellite style should show that style straight away. Comparing the
 * old config with the new one inside the card does not achieve it: Home
 * Assistant throws the preview element away and builds a fresh one for every
 * edit, so the card never sees a "before" to compare against and falls back to
 * its default layer. Measured against the real bundle -- same instance switches
 * correctly, a new instance stays on the street map.
 *
 * The editor and the card ship in one bundle and therefore share module scope,
 * which survives that rebuild. The editor leaves a note here, the card reads it.
 *
 * Two deliberate choices. The note is read, not consumed: Home Assistant may
 * construct more than one element per edit, and a card that silently misses the
 * note is exactly the bug this replaces -- whereas reading it twice just sets
 * the same layer twice. And it expires, so a note left behind by an editor
 * session cannot leak into an unrelated card minutes later.
 */
import type { MapLayerId } from "./const";

/** Long enough for the rebuild, short enough to not outlive the edit. */
const TTL_MS = 3_000;

let pending: { layer: MapLayerId; at: number } | undefined;

/** Called by the editor when the user picks a style or edits a custom URL. */
export function notePreviewLayer(layer: MapLayerId, now: number = Date.now()): void {
  pending = { layer, at: now };
}

/** The layer the editor last asked for, or `undefined` once it has gone stale. */
export function peekPreviewLayer(now: number = Date.now()): MapLayerId | undefined {
  if (!pending) return undefined;
  if (now - pending.at > TTL_MS) {
    pending = undefined;
    return undefined;
  }
  return pending.layer;
}

/** Test helper, and a way back to a clean slate. */
export function clearPreviewLayer(): void {
  pending = undefined;
}
