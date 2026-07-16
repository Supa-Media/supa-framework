/**
 * Minimal, dependency-free ESM resolve hook so `node --test` can run this
 * package's raw TypeScript source directly.
 *
 * `@supa-media/convex` ships source (no build step) and is normally consumed
 * by Convex's own bundler, which — like `moduleResolution: "bundler"` in this
 * package's tsconfig — resolves extensionless relative specifiers
 * (`import ... from "./hmac"`) against `./hmac.ts` for you. Plain Node's ESM
 * loader requires an explicit extension. Rather than rewriting every source
 * import to carry a literal `.ts` (which would fight the package's actual
 * consumption model), this hook retries a failed relative-specifier
 * resolution with `.ts` appended — Node's own type-stripping support (stable
 * by default since Node 22.x, no flag needed) then runs the file.
 *
 * Registered via `node --import ./test/register.mjs --test test/*.test.ts`.
 * No external dependency (ts-node/tsx/etc.) — only `node:module`.
 */
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);

  if (isRelative && !hasExtension) {
    try {
      return await nextResolve(specifier + ".ts", context);
    } catch {
      // Fall through to the default resolution/error below.
    }
  }

  return nextResolve(specifier, context);
}
