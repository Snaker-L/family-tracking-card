/**
 * Leaflet 1.9 only declares `main`, which points at the UMD build. Rollup would
 * bundle that one and lose the named exports, so the card imports the ESM build
 * by path and borrows the published typings for it.
 */
declare module "leaflet/dist/leaflet-src.esm.js" {
  export * from "leaflet";
}
