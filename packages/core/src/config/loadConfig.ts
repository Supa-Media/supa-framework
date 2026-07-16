import type { SupaConfig } from "./types.js";

/**
 * Loads the Supa configuration from `supa.config.ts` at the project root.
 *
 * This is intended for use in CLI tools and build scripts — not at runtime
 * in the mobile app. The function dynamically imports the config file.
 *
 * @param configPath - Absolute path to the config file. Defaults to
 *   `supa.config.ts` in the current working directory.
 * @returns The resolved SupaConfig object.
 * @throws If the config file cannot be found or does not export a valid config.
 */
export async function loadConfig(
  configPath?: string,
): Promise<SupaConfig> {
  const resolvedPath = configPath ?? `${process.cwd()}/supa.config`;

  try {
    // Dynamic import handles both .ts (via tsx/ts-node) and .js
    const mod = await import(resolvedPath);
    const config: SupaConfig = mod.default ?? mod;

    if (!config.app?.name) {
      throw new Error(
        `Invalid supa.config: "app.name" is required. Got: ${JSON.stringify(config.app)}`,
      );
    }

    if (!config.auth?.method) {
      throw new Error(
        `Invalid supa.config: "auth.method" is required. Got: ${JSON.stringify(config.auth)}`,
      );
    }

    return config;
  } catch (error: any) {
    if (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND") {
      throw new Error(
        `Could not find supa.config.ts at ${resolvedPath}. ` +
          "Create one using: npx supa init",
      );
    }
    throw error;
  }
}
