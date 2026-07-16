/**
 * Stripe configuration utilities.
 *
 * Provides environment-aware config lookup so apps can use different
 * Stripe keys for development, staging, and production.
 */

import type { StripeConfig, StripeEnvironment, StripeConfigMap } from "../types/index.js";

// =============================================================================
// Config Store
// =============================================================================

let configMap: StripeConfigMap | null = null;

/**
 * Register Stripe configuration for all environments.
 *
 * Call this once at app initialization (e.g., in your root layout)
 * before using any payment hooks or components.
 *
 * @example
 * ```ts
 * import { configureStripe } from "@supa-media/payments/config";
 *
 * configureStripe({
 *   development: {
 *     publishableKey: "pk_test_...",
 *   },
 *   staging: {
 *     publishableKey: "pk_test_...",
 *   },
 *   production: {
 *     publishableKey: "pk_live_...",
 *   },
 * });
 * ```
 */
export function configureStripe(config: StripeConfigMap): void {
  configMap = config;
}

/**
 * Get Stripe configuration for a specific environment.
 *
 * @throws if configureStripe() has not been called
 */
export function getStripeConfig(environment: StripeEnvironment): StripeConfig {
  if (!configMap) {
    throw new Error(
      "Stripe not configured. Call configureStripe() before using payment features."
    );
  }
  return configMap[environment];
}

/**
 * Detect the current environment from common environment variable patterns.
 *
 * Checks (in order):
 * 1. STRIPE_ENV
 * 2. APP_ENV
 * 3. NODE_ENV
 *
 * Falls back to "development" if none are set.
 */
export function detectEnvironment(): StripeEnvironment {
  // Check for explicit Stripe environment override
  const stripeEnv = getEnvVar("STRIPE_ENV");
  if (isValidEnvironment(stripeEnv)) return stripeEnv;

  // Check for app-level environment
  const appEnv = getEnvVar("APP_ENV");
  if (isValidEnvironment(appEnv)) return appEnv;

  // Check NODE_ENV
  const nodeEnv = getEnvVar("NODE_ENV");
  if (nodeEnv === "production") return "production";

  return "development";
}

/**
 * Get the Stripe config for the auto-detected environment.
 */
export function getStripeConfigAuto(): StripeConfig {
  return getStripeConfig(detectEnvironment());
}

// =============================================================================
// Helpers
// =============================================================================

const VALID_ENVIRONMENTS = new Set<string>([
  "development",
  "staging",
  "production",
]);

function isValidEnvironment(
  value: string | undefined
): value is StripeEnvironment {
  return value != null && VALID_ENVIRONMENTS.has(value);
}

function getEnvVar(name: string): string | undefined {
  try {
    // Access process.env safely — may not exist in all runtimes
    const env = (globalThis as Record<string, unknown>).process as
      | { env?: Record<string, string | undefined> }
      | undefined;
    return env?.env?.[name];
  } catch {
    return undefined;
  }
}
