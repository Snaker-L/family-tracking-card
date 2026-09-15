#!/usr/bin/env node
/**
 * Links the build output into the Home Assistant config so a `yarn build`
 * followed by a hard refresh is all it takes. A symlink is used on purpose:
 * rollup rewrites `dist/family-tracking-card.js` in place, so the link never
 * has to be refreshed.
 *
 *   HA_CONFIG=/path/to/config node scripts/deploy.mjs
 */
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, symlink, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "dist", "family-tracking-card.js");
const config = process.env.HA_CONFIG ?? resolve(root, "..", "ha-dev", "config");
const target = join(config, "www", "family-tracking-card.js");

try {
  await access(bundle, constants.R_OK);
} catch {
  console.error(`Build output missing: ${bundle}\nRun "yarn build" first.`);
  process.exit(1);
}

await mkdir(join(config, "www"), { recursive: true });

try {
  await lstat(target);
  await unlink(target);
} catch {
  // Nothing to replace.
}

/*
 * Copying is the default, not linking. When Home Assistant runs in a container
 * with the config directory bind-mounted, a symlink written on the host points
 * at a repository path the container cannot see: it dangles inside /config and
 * Home Assistant answers 404, while `ls` on the host shows a perfectly valid
 * link. That failure is invisible from the outside, so the safe route wins.
 * `--link` is there for a Home Assistant running directly on this machine,
 * where the link saves a copy after every build.
 */
if (process.argv.includes("--link")) {
  await symlink(bundle, target);
  console.log(`Linked ${target} -> ${bundle}`);
} else {
  await copyFile(bundle, target);
  console.log(`Copied ${bundle} -> ${target}`);
}

/*
 * Home Assistant serves /local/ with `Cache-Control: public, max-age=2678400`,
 * so a rebuilt bundle can sit unseen behind a month-old copy in the browser.
 * A hard refresh does not reliably help: the card is injected as a `<script>`
 * element from JavaScript, and that request is answered from cache. The URL
 * therefore carries a hash of the file, which changes exactly when the bundle
 * does -- so a rebuild is fetched and an unchanged one still is not.
 */
const version = createHash("sha256").update(await readFile(bundle)).digest("hex").slice(0, 12);
const url = `/local/family-tracking-card.js?v=${version}`;

if (process.env.HA_TOKEN) {
  const api = join(root, "dev", "ha-api.mjs");
  const result = spawnSync(process.execPath, [api, "resource", url], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nCould not update the resource. Set it by hand to:\n  ${url}`);
    process.exit(1);
  }
  console.log("\nDone. Reload the dashboard.");
  process.exit(0);
}

console.log(
  [
    "",
    `Set the resource URL to (the hash busts the browser cache):`,
    `  ${url}`,
    "",
    "Or export HA_TOKEN and this script will do it for you.",
    "",
    "Register it once under Settings > Dashboards > Resources:",
    "  URL : /local/family-tracking-card.js",
    "  Type: JavaScript module",
    "",
    "A relative URL is served by Home Assistant itself, from the same origin as",
    "the dashboard. That avoids the separate dev server of dev/serve.mjs and the",
    "port forwarding it depends on -- both of which can fail while Home Assistant",
    "keeps working, which looks exactly like a broken card.",
    "",
    "After each build: run this again, then hard refresh (Ctrl+Shift+R).",
  ].join("\n")
);
