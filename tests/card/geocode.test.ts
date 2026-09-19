import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  cacheKeyFor,
  clearGeocodeCache,
  resetServerGeocoding,
  reverseGeocode,
  shortLabel,
} from "../../src/geocode.ts";

describe("cacheKeyFor", () => {
  it("rounds to about eleven metres so nearby samples share a lookup", () => {
    assert.equal(cacheKeyFor(48.20821234, 16.37384321), "48.2082,16.3738");
    assert.equal(cacheKeyFor(48.20821, 16.37381), cacheKeyFor(48.20822, 16.37382));
  });
});

describe("shortLabel", () => {
  it("prefers street and house number", () => {
    const label = shortLabel({
      address: { road: "Hauptstraße", house_number: "12", city: "Wien" },
    });
    assert.equal(label, "Hauptstraße 12, Wien");
  });

  it("omits the house number when Nominatim has none", () => {
    assert.equal(shortLabel({ address: { road: "Hauptstraße", town: "Krems" } }), "Hauptstraße, Krems");
  });

  it("falls back to a named place", () => {
    assert.equal(
      shortLabel({ name: "Stadtpark", address: { city: "Wien" } }),
      "Stadtpark, Wien"
    );
  });

  it("falls back to the first parts of the display name", () => {
    assert.equal(
      shortLabel({ display_name: "12, Hauptstraße, Wien, Österreich" }),
      "12, Hauptstraße"
    );
  });

  it("returns undefined when there is nothing usable", () => {
    assert.equal(shortLabel({}), undefined);
    assert.equal(shortLabel(undefined), undefined);
  });
});

/*
 * The card keeps its own cache in localStorage and consults it before anything
 * is asked. That makes two things matter more than they look: what gets stored,
 * and how long the card gives up on the integration after one failure. Getting
 * either wrong means a shopping centre reads as the street outside it for a
 * month, which is exactly what happened once.
 */
describe("asking the integration rather than Nominatim", () => {
  const store = new Map<string, string>();

  const withBrowser = async (run: () => Promise<void>) => {
    const before = (globalThis as any).window;
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
    };
    try {
      await run();
    } finally {
      (globalThis as any).window = before;
    }
  };

  const failing = (code: string) => async () => {
    throw { code, message: code };
  };

  it("keeps asking after a failure that is only temporary", async () => {
    await withBrowser(async () => {
      clearGeocodeCache();
      resetServerGeocoding();
      let asked = 0;
      const callWS = async () => {
        asked += 1;
        if (asked === 1) throw { code: "not_ready", message: "still starting" };
        return { label: "Q19 Einkaufsquartier Döbling, Wien" };
      };
      // First stay: Home Assistant is still starting, so the card falls back.
      await reverseGeocode(48.2536, 16.3675, { callWS: callWS as any });
      // A different stay, moments later: the integration must be asked again.
      const second = await reverseGeocode(48.2095, 16.4229, { callWS: callWS as any });
      assert.equal(asked, 2);
      assert.equal(second, "Q19 Einkaufsquartier Döbling, Wien");
    });
  });

  it("stops asking when the integration is not installed at all", async () => {
    await withBrowser(async () => {
      clearGeocodeCache();
      resetServerGeocoding();
      let asked = 0;
      const callWS = async () => {
        asked += 1;
        return failing("unknown_command")();
      };
      await reverseGeocode(48.2536, 16.3675, { callWS: callWS as any });
      await reverseGeocode(48.2095, 16.4229, { callWS: callWS as any });
      assert.equal(asked, 1);
    });
  });

  it("does not store a label it had to look up itself", async () => {
    await withBrowser(async () => {
      clearGeocodeCache();
      resetServerGeocoding();
      store.clear();
      const fetchBefore = globalThis.fetch;
      globalThis.fetch = (async () => ({
        ok: true,
        json: async () => ({ address: { road: "Grinzinger Straße", house_number: "112", city: "Wien" } }),
      })) as any;
      try {
        const label = await reverseGeocode(48.2536, 16.3675, {
          callWS: failing("not_ready") as any,
        });
        assert.equal(label, "Grinzinger Straße 112, Wien");
      } finally {
        globalThis.fetch = fetchBefore;
      }
      const written = [...store.values()].join("");
      assert.equal(written.includes("Grinzinger"), false);
    });
  });
});
