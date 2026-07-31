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
    // No source map. It was 4.6x the bundle and would be deployed beside a page
    // that holds a PAT, handing anyone past Cloudflare Access a readable map of
    // the token-handling code for zero runtime benefit. Use "hidden" if an
    // error reporter ever needs maps without publishing the reference.
    sourcemap: false,
  },
});
