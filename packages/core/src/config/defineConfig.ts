import type { SupaConfig } from "./types";

/**
 * Type-safe configuration helper for `supa.config.ts`.
 *
 * Returns the config object unchanged — this function exists purely to
 * provide TypeScript autocompletion and validation at the config definition site.
 *
 * @example
 * ```ts
 * // supa.config.ts
 * import { defineConfig } from '@supa-media/core/config';
 *
 * export default defineConfig({
 *   app: { name: 'MyApp' },
 *   auth: { method: 'phone-otp' },
 * });
 * ```
 */
export function defineConfig(config: SupaConfig): SupaConfig {
  return config;
}
