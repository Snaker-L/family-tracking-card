#!/usr/bin/env node
/**
 * Serves `dist/` over HTTP so Home Assistant can load the card as a Lovelace
 * resource by absolute URL.
 *
 * This exists for the case where the build and Home Assistant live in different
 * containers and no shared directory is available -- a dev container without a
 * Docker socket, for instance. The regular route is the `dist/` volume mount in
 * dev/docker-compose.yml; this is the fallback when that mount cannot be set up.
 *
 * Cross-origin matters here: Home Assistant injects resources as
 * `<script type="module" src="...">`, and a module script from another origin is
 * only executed when the response carries CORS headers. Hence the wildcard.
 *
 *   node dev/serve.mjs [--port 8099]
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag === -1 ? process.env.PORT ?? 8099 : process.argv[portFlag + 1]);

const TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    // The bundle is rewritten in place by rollup, so a cached copy is the enemy
    // of the edit-build-refresh loop.
    "Cache-Control": "no-store",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // Strip the query string and refuse anything that climbs out of dist/.
  const requested = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = join(dist, normalize(requested));
  if (!file.startsWith(dist)) {
    res.writeHead(403, cors);
    res.end("Forbidden\n");
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      ...cors,
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
    console.log(`200 ${requested}`);
  } catch {
    res.writeHead(404, cors);
    res.end("Not found\n");
    console.log(`404 ${requested}`);
  }
});

/**
 * Dual stack, and that detail is the whole point. Windows resolves `localhost`
 * to `::1` before `127.0.0.1`, so a server bound to `0.0.0.0` is simply not
 * there for a browser on the Windows side of WSL -- while curl inside WSL gets
 * a clean 200 over IPv4 and everything looks fine. Home Assistant's container
 * publishes dual stack, which is why the card went missing but Home Assistant
 * itself stayed reachable. `::` accepts IPv4 too, via v4-mapped addresses.
 */
server.listen(port, "::", () => {
  console.log(`Serving ${dist} on http://[::]:${port} (IPv4 and IPv6)`);
  console.log("");
  console.log("Register it under Settings > Dashboards > Resources:");
  console.log(`  URL : http://localhost:${port}/family-tracking-card.js`);
  console.log("  Type: JavaScript module");
});
