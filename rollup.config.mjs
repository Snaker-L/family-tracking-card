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

export default {
  input: "src/family-tracking-card.ts",
  output: {
    file: "dist/family-tracking-card.js",
    format: "es",
    inlineDynamicImports: true,
    sourcemap: dev,
  },
  plugins: [
    cssAsString(),
    resolve({ browser: true }),
    typescript({ tsconfig: "tsconfig.json", noEmitOnError: true }),
    ...(dev ? [] : [terser({ format: { comments: false } })]),
  ],
};
