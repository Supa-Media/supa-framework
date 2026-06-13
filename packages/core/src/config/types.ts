/**
 * Supa framework configuration types.
 *
 * These types define the shape of `supa.config.ts` — the single configuration
 * file that drives all framework behavior.
 */

/** Authentication method configuration */
export interface AuthConfig {
  /** Primary auth method */
  method: "phone-otp" | "email-otp" | "magic-link" | "phone-and-email";
  /** OTP code length (default: 6) */
  otpLength?: number;
  /** Session duration in milliseconds (default: 30 days) */
  sessionDurationMs?: number;
  /** Whether to require profile completion after first sign-in */
  requireProfileCompletion?: boolean;
}

/** Tenancy model configuration */
export interface TenancyConfig {
  /** Whether the app supports multiple tenants (communities) */
  enabled: boolean;
  /** How tenants are identified in URLs */
  slugStrategy?: "subdomain" | "path";
  /** Maximum number of tenants a user can belong to */
  maxTenantsPerUser?: number;
}

/** Mobile app configuration */
export interface MobileConfig {
  /** Expo project slug */
  slug: string;
  /** Bundle identifier (iOS) */
  bundleIdentifier?: string;
  /** Package name (Android) */
  packageName?: string;
  /** Expo project owner */
  owner?: string;
  /** EAS project ID */
  easProjectId?: string;
  /** Whether OTA updates are enabled */
  otaUpdates?: boolean;
}

/** Feature flags that can be toggled in config */
export interface FeaturesConfig {
  /** Enable push notifications */
  pushNotifications?: boolean;
  /** Enable real-time chat */
  chat?: boolean;
  /** Enable file/image uploads */
  fileUploads?: boolean;
  /** Enable map features */
  maps?: boolean;
  /** Enable payments/subscriptions */
  payments?: boolean;
  /** Enable analytics */
  analytics?: boolean;
  /** Custom feature flags */
  [key: string]: boolean | undefined;
}

/** Build and CI configuration */
export interface BuildConfig {
  /** EAS build profile overrides */
  easProfiles?: Record<string, Record<string, unknown>>;
}

/** Secret/environment variable declarations */
export interface SecretsConfig {
  /** Required environment variables — build fails if missing */
  required: string[];
  /** Optional environment variables */
  optional?: string[];
}

/** Deployment target configuration */
export interface DeployConfig {
  /** Convex deployment name for each environment */
  convex: {
    dev?: string;
    staging?: string;
    production?: string;
  };
}

/** Payment provider configuration */
export interface PaymentsConfig {
  provider: "stripe" | "revenuecat";
  /** Whether to use test/sandbox mode */
  testMode?: boolean;
}

/** Development workflow configuration */
export interface DevConfig {
  /** Port for the Metro bundler */
  metroPort?: number;
  /** Seed script path for development data */
  seedScript?: string;
  /** Test credentials for development */
  testCredentials?: {
    phone?: string;
    otpCode?: string;
  };
}

/** Shared package configuration */
export interface SharedConfig {
  /** Packages to include in the shared workspace */
  packages?: string[];
}

/** Convex-specific configuration */
export interface ConvexConfig {
  /** Path to the Convex functions directory */
  functionsDir?: string;
  /** Whether to enable Convex component support */
  components?: boolean;
}

/**
 * Root configuration type for `supa.config.ts`.
 *
 * @example
 * ```ts
 * // supa.config.ts
 * import { defineConfig } from '@supa-media/core/config';
 *
 * export default defineConfig({
 *   app: { name: 'MyApp' },
 *   auth: { method: 'phone-otp' },
 *   tenancy: { enabled: true },
 * });
 * ```
 */
export interface SupaConfig {
  /** Application metadata */
  app: {
    /** Display name */
    name: string;
    /** App description */
    description?: string;
    /** App version (semver) */
    version?: string;
  };

  /** Convex backend configuration */
  convex?: ConvexConfig;

  /** Authentication configuration */
  auth: AuthConfig;

  /** Multi-tenancy configuration */
  tenancy?: TenancyConfig;

  /** Mobile app configuration */
  mobile?: MobileConfig;

  /** Feature flags */
  features?: FeaturesConfig;

  /** Build configuration */
  build?: BuildConfig;

  /** Secret/environment variable declarations */
  secrets?: SecretsConfig;

  /** Deployment targets */
  deploy?: DeployConfig;

  /** Payment configuration */
  payments?: PaymentsConfig;

  /** Development workflow */
  dev?: DevConfig;

  /** Shared package configuration */
  shared?: SharedConfig;
}
