#!/usr/bin/env node
/**
 * Small client for the Home Assistant WebSocket API, so the development setup
 * can be done from a shell instead of by clicking through the UI.
 *
 * Lovelace resources are deliberately not part of the REST API -- registering a
 * card resource is only possible over WebSocket, which is why this exists.
 *
 *   HA_TOKEN=... node dev/ha-api.mjs state
 *   HA_TOKEN=... node dev/ha-api.mjs resource http://localhost:8099/family-tracking-card.js
 *   HA_TOKEN=... node dev/ha-api.mjs dashboard
 *
 * The host defaults to HA_URL, then to localhost. Inside a dev container the
 * host is usually reachable as host.docker.internal.
 */
const url = process.env.HA_URL ?? "http://localhost:8123";
const token = process.env.HA_TOKEN ?? "";

if (!token) {
  console.error("HA_TOKEN is missing. Profile > Security > Long-lived access tokens.");
  process.exit(1);
}

/** Opens the socket, authenticates, and returns a `call(payload)` helper. */
async function connect() {
  const socket = new WebSocket(`${url.replace(/^http/, "ws")}/api/websocket`);
  const pending = new Map();
  let nextId = 1;
  let version = "unknown";

  await new Promise((resolve, reject) => {
    socket.addEventListener("error", () => reject(new Error(`Cannot reach ${url}`)));
    socket.addEventListener("close", () => {
      for (const { reject: fail } of pending.values()) fail(new Error("Connection closed"));
      pending.clear();
    });
    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "auth_required") {
        version = msg.ha_version ?? version;
        socket.send(JSON.stringify({ type: "auth", access_token: token }));
      } else if (msg.type === "auth_ok") {
        version = msg.ha_version ?? version;
        resolve();
      } else if (msg.type === "auth_invalid") {
        reject(new Error(`Authentication rejected: ${msg.message ?? "invalid token"}`));
      } else if (msg.type === "result") {
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.success) entry.resolve(msg.result);
        else entry.reject(new Error(msg.error?.message ?? "command failed"));
      }
    });
  });

  const call = (payload) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, ...payload }));
    });

  return { call, close: () => socket.close(), version: () => version };
}

/** Registers the resource, or repoints an existing entry with the same file name. */
async function ensureResource(call, target) {
  const resources = await call({ type: "lovelace/resources" });
  // The file name without any `?v=` cache buster: a new version of the same
  // bundle has to repoint the existing entry, not add a second one. Two
  // resources loading the same bundle would make the second
  // `customElements.define()` throw and take the card down with it.
  const nameOf = (url) => url.split("/").pop().split("?")[0];
  const file = nameOf(target);
  const existing = resources.find((r) => r.url === target);
  if (existing) return { action: "unchanged", id: existing.id };

  const stale = resources.find((r) => nameOf(r.url) === file);
  if (stale) {
    await call({
      type: "lovelace/resources/update",
      resource_id: stale.id,
      url: target,
      res_type: "module",
    });
    return { action: "updated", id: stale.id, from: stale.url };
  }

  const created = await call({ type: "lovelace/resources/create", res_type: "module", url: target });
  return { action: "created", id: created.id };
}

/** Creates a dedicated dashboard, so an existing one is never overwritten. */
async function ensureDashboard(call) {
  const boards = await call({ type: "lovelace/dashboards/list" });
  const path = "family-tracking";
  let board = boards.find((b) => b.url_path === path);
  if (!board) {
    board = await call({
      type: "lovelace/dashboards/create",
      url_path: path,
      title: "Family Tracking",
      icon: "mdi:map-marker-path",
      show_in_sidebar: true,
      require_admin: false,
    });
  }
  await call({
    type: "lovelace/config/save",
    url_path: path,
    config: {
      views: [
        {
          title: "Verlauf",
          cards: [
            {
              type: "custom:family-tracking-card",
              title: "Familie",
              time_ranges: [1, 6, 24, 72],
            },
          ],
        },
      ],
    },
  });
  return path;
}

/** Creates the zone, or moves an existing one of the same name. */
async function ensureZone(call, name, lat, lon, radius) {
  const zones = await call({ type: "zone/list" });
  const existing = zones.find((z) => z.name === name);
  const fields = { name, latitude: lat, longitude: lon, radius, icon: "mdi:briefcase", passive: false };
  if (existing) {
    await call({ type: "zone/update", zone_id: existing.id, ...fields });
    return "moved";
  }
  await call({ type: "zone/create", ...fields });
  return "created";
}

/** Attaches a device tracker to a person without dropping the existing ones. */
async function attachTracker(call, personId, tracker) {
  const { storage } = await call({ type: "person/list" });
  const person = storage.find((p) => p.id === personId || p.name.toLowerCase() === personId);
  if (!person) throw new Error(`No editable person '${personId}'`);
  const trackers = [...new Set([...(person.device_trackers ?? []), tracker])];
  await call({
    type: "person/update",
    person_id: person.id,
    name: person.name,
    device_trackers: trackers,
    user_id: person.user_id ?? null,
  });
  return { name: person.name, trackers };
}

const [command, argument] = process.argv.slice(2);

let ha;
try {
  ha = await connect();
} catch (err) {
  // A stack trace helps nobody here: the two realistic causes are a wrong token
  // and a wrong host, and both are worth saying out loud.
  console.error(err.message);
  console.error(`URL in use: ${url} (override with HA_URL)`);
  process.exit(1);
}
console.log(`Connected to ${url} (Home Assistant ${ha.version()})`);

try {
  if (command === "state") {
    const resources = await call_state(ha);
    console.log(resources);
  } else if (command === "resource") {
    const target = argument ?? "http://localhost:8099/family-tracking-card.js";
    const result = await ensureResource(ha.call, target);
    console.log(`Resource ${result.action}: ${target}`);
    if (result.from) console.log(`  previously: ${result.from}`);
  } else if (command === "zone") {
    const [name, lat, lon, radius] = process.argv.slice(3);
    const action = await ensureZone(ha.call, name, Number(lat), Number(lon), Number(radius ?? 100));
    console.log(`Zone ${action}: ${name} at ${lat},${lon} r=${radius ?? 100}m`);
  } else if (command === "zone-delete") {
    const zones = await ha.call({ type: "zone/list" });
    const zone = zones.find((z) => z.name === process.argv[3]);
    if (!zone) throw new Error(`No editable zone '${process.argv[3]}'`);
    await ha.call({ type: "zone/delete", zone_id: zone.id });
    console.log(`Zone deleted: ${zone.name}`);
  } else if (command === "person") {
    const [personId, tracker] = process.argv.slice(3);
    const result = await attachTracker(ha.call, personId, tracker);
    console.log(`Person ${result.name}: ${result.trackers.join(", ")}`);
  } else if (command === "dashboard") {
    const path = await ensureDashboard(ha.call);
    console.log(`Dashboard ready: ${url}/${path}`);
  } else {
    console.error(
      "usage: ha-api.mjs {state | resource [url] | dashboard | " +
        "zone <name> <lat> <lon> [radius] | person <id> <device_tracker>}"
    );
    process.exitCode = 1;
  }
} finally {
  ha.close();
}

/** Everything worth knowing before adding the card. */
async function call_state(ha) {
  const resources = await ha.call({ type: "lovelace/resources" });
  const states = await ha.call({ type: "get_states" });
  const pick = (prefix) => states.filter((s) => s.entity_id.startsWith(prefix));
  return {
    version: ha.version(),
    resources: resources.map((r) => `${r.type} ${r.url}`),
    persons: pick("person.").map((s) => `${s.entity_id} = ${s.state}`),
    zones: pick("zone.").map((s) => s.entity_id),
    device_trackers: pick("device_tracker.").map((s) => `${s.entity_id} = ${s.state}`),
  };
}
