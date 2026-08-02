import { defineConfig } from "vitest/config";

/**
 * `edge-runtime` because that is the environment convex-test emulates: a V8
 * isolate with Web APIs and no Node built-ins. Running these tests under the
 * default `node` environment would let a `node:crypto` import pass here and
 * then fail in the real deployment, which is exactly the class of bug the
 * hand-rolled HMAC in `convex/lib/auth.ts` exists to avoid.
 */
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["__tests__/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
