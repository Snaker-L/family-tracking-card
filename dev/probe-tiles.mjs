#!/usr/bin/env node
/**
 * Checks every configured tile style by fetching real tiles.
 *
 * This exists because an HTTP status says nothing here: OpenStreetMap answered
 * 200 while serving an "Access blocked" image. Two tiles far apart are fetched
 * and compared instead -- a placeholder is byte identical for every coordinate,
 * a real map is not.
 *
 * Known limit: this does not catch a watermark. CARTO serves the real map with
 * "API KEY REQUIRED" stamped across it, and those tiles still differ from each
 * other, so this script calls them fine. Before adding a source, download one
 * tile and look at it.
 *
 *   node dev/probe-tiles.mjs [--zooms 13,16,19] [--lat 48.2385 --lon 16.3774]
 */
import { createHash } from "node:crypto";

import { MAX_ZOOM, SATELLITE_STYLES, STREET_STYLES } from "../src/const.ts";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

const lat = Number(arg("lat", 48.2385));
const lon = Number(arg("lon", 16.3774));
const zooms = arg("zooms", "13,16,19").split(",").map(Number);

/** Web Mercator, the same maths Leaflet uses. */
function tile(latitude, longitude, z) {
  const n = 2 ** z;
  const rad = (latitude * Math.PI) / 180;
  return {
    x: Math.floor(((longitude + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n),
  };
}

const fill = (template, z, { x, y }, subdomains) =>
  template
    .replace("{s}", subdomains ? subdomains[0] : "a")
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y)
    .replace("{r}", "");

async function digest(url) {
  const response = await fetch(url, { headers: { "User-Agent": "family-tracking-card/dev" } });
  if (!response.ok) return { error: `HTTP ${response.status}` };
  const body = Buffer.from(await response.arrayBuffer());
  return { hash: createHash("md5").update(body).digest("hex").slice(0, 8), bytes: body.length };
}

/**
 * Two tiles roughly 3 km apart. Identical bytes mean the server is not actually
 * rendering this area -- either a placeholder, or no coverage.
 */
async function probeLayer(template, z, subdomains) {
  const [a, b] = await Promise.all([
    digest(fill(template, z, tile(lat, lon, z), subdomains)),
    digest(fill(template, z, tile(lat + 0.03, lon, z), subdomains)),
  ]);
  if (a.error) return { state: a.error, bytes: 0 };
  if (b.error) return { state: b.error, bytes: a.bytes };
  return { state: a.hash === b.hash ? "leer" : "ok", bytes: a.bytes };
}

let failures = 0;

async function probeStyle(id, style) {
  const rows = [];
  for (const [index, layer] of style.layers.entries()) {
    // Only the base map has to differ between two places. Label overlays are
    // mostly transparent, so two tiles without a place name in them are byte
    // identical by nature -- for those an HTTP error is the only real failure.
    const isBase = index === 0;
    const results = [];
    for (const z of zooms) {
      const { state } = await probeLayer(layer.url, z, layer.subdomains);
      const withinRange = z <= layer.maxNativeZoom;
      // Beyond maxNativeZoom an empty answer is fine: Leaflet upscales instead.
      const bad = withinRange && (isBase ? state !== "ok" : state.startsWith("HTTP"));
      if (bad) failures += 1;
      const note = bad ? " ✗" : withinRange ? "" : " (skaliert)";
      results.push(`z${z}:${state}${note}`);
    }
    const kind = isBase ? "Basis" : "Overlay";
    rows.push(`    ${kind} (bis z${layer.maxNativeZoom}): ${results.join("  ")}`);
  }
  console.log(`  ${id} — ${style.label}`);
  for (const row of rows) console.log(row);
}

console.log(`Prüfpunkt ${lat},${lon} · Zoomstufen ${zooms.join(", ")} · MAX_ZOOM ${MAX_ZOOM}\n`);

console.log("Straßenkarten:");
for (const [id, style] of Object.entries(STREET_STYLES)) await probeStyle(id, style);

console.log("\nSatellitenkarten:");
for (const [id, style] of Object.entries(SATELLITE_STYLES)) await probeStyle(id, style);

if (failures > 0) {
  console.error(`\n${failures} Ebene(n) liefern innerhalb ihres Zoombereichs keine echten Kacheln.`);
  process.exit(1);
}
console.log("\nAlle Ebenen liefern innerhalb ihres Zoombereichs echte Kacheln.");
