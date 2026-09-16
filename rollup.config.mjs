import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

const dev = process.env.ROLLUP_WATCH === "true";

/**
 * Turns `import css from "...css"` into a plain string export.
 * Leaflet ships its stylesheet as a file; the card injects it into its own
 * shadow root, so a full-blown CSS plugin would be overkill.
 */
const cssAsString = () => ({
  name: "css-as-string",
  transform(code, id) {
    if (!id.endsWith(".css")) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: { mappings: "" } };
  },
});

/*
 * The bundle lands inside the integration. Shipping both from one repository is
 * the point: Home Assistant serves this file itself and adds it to the
 * frontend, so nobody registers a Lovelace resource by hand or forgets to
 * update it. `dist/` stays as the build output for the development container.
 */
const TARGET = "custom_components/family_tracking/www/family-tracking-card.js";

export default {
  input: "src/family-tracking-card.ts",
  output: {
    file: TARGET,
    format: "es",
    inlineDynamicImports: true,
    sourcemap: dev,
  },
  plugins: [
    cssAsString(),
    resolve({ browser: true }),
    // `outDir` has to sit next to the bundle; the plugin refuses otherwise.
    typescript({
      tsconfig: "tsconfig.json",
      noEmitOnError: true,
      outDir: "custom_components/family_tracking/www",
    }),
    ...(dev ? [] : [terser({ format: { comments: false } })]),
  ],
};
