/** Types for `@supa-media/desktop/build`. `esbuild` is an optional peer. */

export const DEFAULT_TARGETS: Readonly<{ node: string; chrome: string }>;

export interface DesktopBuildOptions {
  /** The app directory. Every relative path below is resolved against it. */
  root: string;
  /** Defaults to `<root>/dist`. */
  outDir?: string;
  /** The main-process entry point. Always bundled ESM with `electron` external. */
  main: string;
  /** Output filename → entry point. Always bundled **CommonJS** — see the module header. */
  preloads?: Record<string, string>;
  /** Output filename → entry point. Always bundled browser ESM. */
  renderers?: Record<string, string>;
  /** Copied verbatim into the renderer output directory. */
  static?: readonly string[];
  watch?: boolean;
  targets?: { node?: string; chrome?: string };
  external?: readonly string[];
  sourcemap?: boolean;
  minify?: boolean;
  /** Injection seam for tests. Defaults to the installed esbuild. */
  esbuild?: { build: (config: any) => Promise<any>; context: (config: any) => Promise<any> };
}

export function buildDesktop(
  options: DesktopBuildOptions,
): Promise<{ out: string; watching: unknown[] | null }>;
