/**
 * The module map convex-test needs to load this app's functions.
 *
 * `import.meta.glob` is resolved by Vite at build time, so it has to be written
 * out literally here rather than computed — and it has to live next to the
 * functions it globs, which is why this file sits at the package root beside
 * `convex/` rather than inside `__tests__/`.
 */
export const modules = import.meta.glob(
  ["./convex/**/*.ts", "./convex/_generated/**/*.js"],
  { eager: false },
);
