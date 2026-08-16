/**
 * Build script: bundle the TypeScript entry point into a single browser-loadable
 * ES module that FoundryVTT loads via the `esmodules` manifest entry.
 *
 * FoundryVTT serves module files statically and loads them in the browser; it does
 * not run a bundler. We therefore compile `src/main.ts` (and its imports) down to
 * one plain ESM file at `scripts/main.js`.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "scripts/main.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  legalComments: "none",
  // Foundry provides these as globals at runtime; never bundle them.
  banner: {
    js: "/* tactical-initiative — bundled by esbuild. Do not edit; edit src/*.ts. */"
  }
});

console.log("Built scripts/main.js");
