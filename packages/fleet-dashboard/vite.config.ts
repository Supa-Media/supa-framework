import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * A completely static build: no env vars are read at build time (the GitHub
 * token is entered at runtime), so `pnpm build` is safe to run anywhere —
 * including the repo's `release.yml`, which runs `turbo run build` across every
 * workspace package on every push to main.
 *
 * `base: "./"` keeps asset URLs relative so the `dist/` output works whether
 * it's served from a domain root or a subpath.
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
