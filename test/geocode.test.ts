import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { cacheKeyFor, shortLabel } from "../src/geocode.ts";

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
