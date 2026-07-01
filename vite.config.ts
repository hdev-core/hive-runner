import { defineConfig } from "vite";

export default defineConfig({
  // relative base so it works on any static host (root domain or subpath / GitHub Pages)
  base: "./",
  // Pixi v8 Application.init() is async; we use top-level await in main.ts.
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
});
