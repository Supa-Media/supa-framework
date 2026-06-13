import { defineConfig } from "@supa-media/core/config";

export default defineConfig({
  app: {
    name: "{{APP_NAME}}",
    slug: "{{APP_SLUG}}",
    scheme: "{{URL_SCHEME}}",
    bundleId: {
      production: "{{BUNDLE_ID}}",
      staging: "{{STAGING_BUNDLE_ID}}",
    },
  },

  multiTenant: {{MULTI_TENANT}},
  tenantName: "{{TENANT_NAME}}",

  auth: {
    providers: [{{AUTH_PROVIDERS_LIST}}],
  },

  features: {
{{CONFIG_FEATURES}}
  },

  deployment: {
    strictness: "{{STRICTNESS}}",
  },

  infrastructure: {
    vault: "{{VAULT_NAME}}",
    easProjectId: "{{EAS_PROJECT_ID}}",
    expoOwner: "{{EXPO_OWNER}}",
  },
});
