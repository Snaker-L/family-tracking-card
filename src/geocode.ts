/**
 * Reverse geocoding via Nominatim (OpenStreetMap).
 *
 * Their usage policy allows this only under strict conditions: at most one
 * request per second, results must be cached, and the client has to identify
 * itself. A browser cannot set `User-Agent` (the header is forbidden by fetch),
 * so identification falls back to the Referer the browser sends automatically,
 * optionally strengthened by the `email` parameter Nominatim documents for
 * exactly this case.
 */

const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const MIN_REQUEST_GAP_MS = 1100;
/*
 * The `:2` is a version, and bumping it throws the stored labels away.
 *
 * Needed the moment the integration learned to name a shopping centre instead
 * of the street around it: this cache is consulted before anything is asked,
 * so a stay resolved last week would go on reading "Grinzinger Straße 112"
 * for a month no matter what the integration now answers.
 */
const CACHE_KEY = "family-tracking-card:geocode:2";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** ~11 m at the equator: fine enough for a stay, coarse enough to reuse. */
const CACHE_PRECISION = 4;

export interface GeocodeOptions {
  /** Contact address forwarded to Nominatim, see their usage policy. */
  email?: string;
  language?: string;
  /**
   * Home Assistant's websocket call. When the Family Tracking integration is
   * installed it answers `family_tracking/geocode`, and then the lookup belongs
   * there: one cache for every browser in the house instead of one per device,
   * one queue honouring the rate limit, and results that survive a cleared
   * browser storage. Without the integration the card asks Nominatim itself,
   * exactly as before.
   */
  callWS?: <T>(message: Record<string, unknown>) => Promise<T>;
}

/** Remembers a missing integration, so the card asks once and not per stay. */
let serverGeocoding: boolean | undefined;

/** Test helper: forget whether the integration answered. */
export function resetServerGeocoding(): void {
  serverGeocoding = undefined;
}

async function viaServer(
  lat: number,
  lon: number,
  options: GeocodeOptions
): Promise<string | undefined | null> {
  if (!options.callWS || serverGeocoding === false) return null;
  try {
    const result = await options.callWS<{ label?: string } | null>({
      type: "family_tracking/geocode",
      latitude: lat,
      longitude: lon,
      language: options.language,
    });
    serverGeocoding = true;
    return result?.label || undefined;
  } catch (err) {
    // Not the same thing twice. `unknown_command` means the integration is not
    // installed, and then asking again for every stay only costs a round trip
    // each time. Anything else -- most often "not_ready" while Home Assistant
    // is still starting up -- is over in a minute, and giving up on it for the
    // rest of the page would hand back the worse answer all evening.
    if ((err as { code?: string } | undefined)?.code === "unknown_command") {
      serverGeocoding = false;
    }
    return null;
  }
}

interface CacheEntry {
  label: string;
  at: number;
  /**
   * Set when the label came from asking Nominatim directly rather than from
   * the integration. Those answers know nothing about shopping centres, so
   * they are kept for this page and no longer: written to storage, a lookup
   * made while Home Assistant was still starting would outlive the reason it
   * was ever needed.
   */
  direct?: boolean;
}

export const cacheKeyFor = (lat: number, lon: number): string =>
  `${lat.toFixed(CACHE_PRECISION)},${lon.toFixed(CACHE_PRECISION)}`;

/**
 * Condenses a Nominatim address object into one readable line.
 * Pure function, kept separate so it can be tested without network access.
 */
export function shortLabel(result: any): string | undefined {
  const address = result?.address ?? {};
  const street = address.road ?? address.pedestrian ?? address.footway ?? address.path;
  const place =
    address.village ?? address.town ?? address.city ?? address.municipality ?? address.county;

  if (street) {
    const houseNumber = address.house_number ? ` ${address.house_number}` : "";
    return place ? `${street}${houseNumber}, ${place}` : `${street}${houseNumber}`;
  }
  const named = result?.name || address.amenity || address.shop || address.building;
  if (named) return place ? `${named}, ${place}` : named;
  if (place) return place;
  return typeof result?.display_name === "string"
    ? result.display_name.split(",").slice(0, 2).join(",").trim()
    : undefined;
}

let memoryCache: Map<string, CacheEntry> | undefined;

function cache(): Map<string, CacheEntry> {
  if (memoryCache) return memoryCache;
  memoryCache = new Map();
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) {
      const now = Date.now();
      for (const [key, entry] of Object.entries(JSON.parse(raw) as Record<string, CacheEntry>)) {
        if (entry && now - entry.at < CACHE_TTL_MS) memoryCache.set(key, entry);
      }
    }
  } catch {
    // A corrupt or unavailable localStorage must not break the card.
  }
  return memoryCache;
}

let persistHandle: number | undefined;

function persist(): void {
  if (persistHandle !== undefined) return;
  persistHandle = window.setTimeout(() => {
    persistHandle = undefined;
    try {
      const lasting = [...cache()].filter(([, entry]) => !entry.direct);
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(lasting)));
    } catch {
      // Quota exceeded or private mode: the in-memory cache still works.
    }
  }, 1000);
}

/** Serialises all lookups and keeps at least MIN_REQUEST_GAP_MS between them. */
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Resolves coordinates to a readable address. Returns `undefined` when the
 * lookup fails; the caller is expected to fall back to the raw coordinates.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  options: GeocodeOptions = {}
): Promise<string | undefined> {
  const key = cacheKeyFor(lat, lon);
  const hit = cache().get(key);
  if (hit) return hit.label;

  const server = await viaServer(lat, lon, options);
  if (server !== null) {
    // The server has its own cache; keeping a copy here saves the round trip
    // for the stays already on screen.
    if (server) cache().set(key, { label: server, at: Date.now() });
    persist();
    return server;
  }

  return schedule(async () => {
    // A second lookup may have filled the cache while this one was queued.
    const queued = cache().get(key);
    if (queued) return queued.label;

    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(lat),
      lon: String(lon),
      zoom: "18",
      addressdetails: "1",
    });
    if (options.language) params.set("accept-language", options.language);
    if (options.email) params.set("email", options.email);

    try {
      const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return undefined;
      const label = shortLabel(await response.json());
      if (!label) return undefined;
      cache().set(key, { label, at: Date.now(), direct: true });
      persist();
      return label;
    } catch {
      return undefined;
    }
  });
}

/** Test/debug helper: forgets every cached address. */
export function clearGeocodeCache(): void {
  memoryCache = undefined;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignored
  }
}
