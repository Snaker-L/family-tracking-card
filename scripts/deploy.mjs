#!/usr/bin/env node
/**
 * Copies the integration into the development Home Assistant and restarts it.
 *
 * Since the card lives inside the integration, deploying means syncing one
 * folder: Home Assistant serves the bundle itself and adds it to the frontend,
 * so there is no Lovelace resource to register or version any more.
 *
 *   HA_CONFIG=/path/to/config node scripts/deploy.mjs
 *   HA_TOKEN=... node scripts/deploy.mjs      # restarts Home Assistant too
 */
import { constants } from "node:fs";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "custom_components", "family_tracking");
const bundle = join(source, "www", "family-tracking-card.js");
const config = process.env.HA_CONFIG ?? resolve(root, "..", "ha-dev", "config");
const target = join(config, "custom_components", "family_tracking");

try {
  await access(bundle, constants.R_OK);
} catch {
  console.error(`Card bundle missing at ${bundle}\nRun "yarn build" first.`);
  process.exit(1);
}

await mkdir(dirname(target), { recursive: true });

/*
 * Clear the target first, so a module deleted here disappears there too rather
 * than being imported from a stale copy. Home Assistant runs as root inside its
 * container and leaves its `__pycache__` owned by root, which this user cannot
 * remove -- that is not worth failing over. An orphaned `.pyc` is inert: Python
 * refuses to import one whose source is gone.
 */
try {
  await rm(target, { recursive: true, force: true });
} catch (err) {
  if (err.code !== "EACCES" && err.code !== "EPERM") throw err;
  console.log("Note: leftover __pycache__ belongs to the container and stays.");
}

await cp(source, target, {
  recursive: true,
  force: true,
  filter: (path) => !path.includes("__pycache__"),
});
console.log(`Copied ${source} -> ${target}`);

const token = process.env.HA_TOKEN;
const url = process.env.HA_URL ?? "http://localhost:8123";
if (!token) {
  console.log("\nRestart Home Assistant to pick it up (set HA_TOKEN to do it from here).");
  process.exit(0);
}

const response = await fetch(`${url}/api/services/homeassistant/restart`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) {
  console.error(`Restart refused: HTTP ${response.status}`);
  process.exit(1);
}
process.stdout.write("Restarting");
for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
  try {
    if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok) {
      console.log("\nHome Assistant is back. Hard refresh the browser (Ctrl+Shift+R).");
      process.exit(0);
    }
  } catch {
    // still down
  }
}
console.log("\nStill not answering -- check 'dev/ha.sh logs'.");
process.exit(1);
