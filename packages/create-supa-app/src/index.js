#!/usr/bin/env node

import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = resolve(__dirname, "..", "templates");

// ── Helpers ──

function toKebabCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toPascalCase(str) {
  return str
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function createPrompt() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    ask(question) {
      return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
      });
    },
    close() {
      rl.close();
    },
  };
}

function applyTemplate(content, vars) {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function copyTemplateDir(srcDir, destDir, vars, conditionals) {
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destName = applyTemplate(entry.name, vars);

    if (entry.isDirectory()) {
      const destPath = join(destDir, destName);
      mkdirSync(destPath, { recursive: true });
      copyTemplateDir(srcPath, destPath, vars, conditionals);
    } else {
      // Handle conditional files: skip files with .conditional-{flag} suffix
      const conditionalMatch = entry.name.match(/\.conditional-(\w+)/);
      if (conditionalMatch) {
        const flag = conditionalMatch[1];
        if (!conditionals[flag]) continue;
      }

      const destPath = join(destDir, destName.replace(/\.conditional-\w+/, ""));
      const raw = readFileSync(srcPath, "utf-8");
      const content = applyTemplate(raw, vars);
      writeFileSync(destPath, content);
    }
  }
}

// ── Main ──

async function main() {
  const rawArgs = process.argv.slice(2);
  const appNameArg =
    rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : undefined;

  // Optional non-interactive mode: `create-supa-app "Name" --config app.json`
  // The JSON may contain any of the prompt fields (appName, appSlug, urlScheme,
  // bundleId, stagingBundleId, multiTenant, tenantName, phoneOtp, emailOtp,
  // pushNotifications, chat, payments, strictness, vaultName, easProjectId,
  // expoOwner). Missing fields fall back to the same defaults as the prompts.
  let cfg = null;
  const cfgIdx = rawArgs.findIndex(
    (a) => a === "--config" || a.startsWith("--config="),
  );
  if (cfgIdx !== -1) {
    const flag = rawArgs[cfgIdx];
    const cfgPath = flag.includes("=")
      ? flag.slice(flag.indexOf("=") + 1)
      : rawArgs[cfgIdx + 1];
    if (!cfgPath) {
      console.error("Error: --config requires a path to a JSON file.");
      process.exit(1);
    }
    cfg = JSON.parse(readFileSync(resolve(process.cwd(), cfgPath), "utf-8"));
  }

  console.log("");
  console.log("  create-supa-app v0.2.0");
  console.log("  Set up a new Supa app in ~2 minutes.");
  console.log("");

  try {
    // Answers resolved from either --config (non-interactive) or prompts.
    let appName, appSlug, urlScheme, bundleId, stagingBundleId;
    let multiTenant, tenantName;
    let phoneOtp, emailOtp, pushNotifications, chat, payments;
    let strictness, vaultName, easProjectId, expoOwner;

    const truthy = (v, dflt) => {
      if (v === undefined || v === null || v === "") return dflt;
      if (typeof v === "boolean") return v;
      const s = String(v).toLowerCase();
      return s === "y" || s === "yes" || s === "true";
    };

    if (cfg) {
      appName = cfg.appName || appNameArg;
      if (!appName) {
        console.error("Error: 'appName' is required (in config or as argument).");
        process.exit(1);
      }
      appSlug = cfg.appSlug || toKebabCase(appName);
      urlScheme = cfg.urlScheme || appSlug;
      bundleId = cfg.bundleId || `com.${appSlug.replace(/-/g, "")}.mobile`;
      stagingBundleId =
        cfg.stagingBundleId || `com.${appSlug.replace(/-/g, "")}.staging`;
      multiTenant = truthy(cfg.multiTenant, false);
      tenantName = multiTenant ? cfg.tenantName || "organizations" : "";
      phoneOtp = truthy(cfg.phoneOtp, true);
      emailOtp = truthy(cfg.emailOtp, true);
      pushNotifications = truthy(cfg.pushNotifications, true);
      chat = truthy(cfg.chat, false);
      payments = truthy(cfg.payments, false);
      strictness = ["relaxed", "standard", "strict"].includes(
        String(cfg.strictness || "").toLowerCase(),
      )
        ? String(cfg.strictness).toLowerCase()
        : "standard";
      vaultName = cfg.vaultName || "";
      easProjectId = cfg.easProjectId || "";
      expoOwner = cfg.expoOwner || "";
      console.log(`Using config for "${appName}" (non-interactive).`);
      console.log("");
    } else {
      const prompt = createPrompt();
      try {
        // ── App Identity ──
        console.log("── App Identity ──");
        appName = appNameArg || (await prompt.ask("? App name: "));
        if (!appName) {
          console.error("Error: App name is required.");
          process.exit(1);
        }

        const defaultSlug = toKebabCase(appName);
        appSlug =
          (await prompt.ask(`? App slug: (${defaultSlug}) `)) || defaultSlug;

        urlScheme =
          (await prompt.ask(`? URL scheme (for deep links): (${appSlug}) `)) ||
          appSlug;

        const defaultBundleId = `com.${appSlug.replace(/-/g, "")}.mobile`;
        bundleId =
          (await prompt.ask(
            `? Bundle ID (production): (${defaultBundleId}) `,
          )) || defaultBundleId;

        const defaultStagingBundleId = `com.${appSlug.replace(/-/g, "")}.staging`;
        stagingBundleId =
          (await prompt.ask(
            `? Bundle ID (staging): (${defaultStagingBundleId}) `,
          )) || defaultStagingBundleId;

        console.log("");

        // ── Architecture ──
        console.log("── Architecture ──");
        multiTenant = /^y(es)?$/i.test(
          await prompt.ask("? Is this a multi-tenant app? (y/N) "),
        );
        tenantName = "";
        if (multiTenant) {
          tenantName =
            (await prompt.ask(
              "? What are tenants called? (e.g., communities, organizations) ",
            )) || "organizations";
        }

        console.log("");

        // ── Auth ──
        console.log("── Auth ──");
        phoneOtp = !/^n(o)?$/i.test(
          await prompt.ask("? Enable Phone OTP (Twilio)? (Y/n) "),
        );
        emailOtp = !/^n(o)?$/i.test(
          await prompt.ask("? Enable Email OTP (Resend)? (Y/n) "),
        );

        console.log("");

        // ── Features ──
        console.log("── Features ──");
        pushNotifications = !/^n(o)?$/i.test(
          await prompt.ask("? Enable push notifications? (Y/n) "),
        );
        chat = /^y(es)?$/i.test(
          await prompt.ask("? Enable chat module? (y/N) "),
        );
        payments = /^y(es)?$/i.test(
          await prompt.ask("? Enable payments (Stripe)? (y/N) "),
        );

        console.log("");

        // ── Deployment ──
        console.log("── Deployment ──");
        const strictnessInput = (
          await prompt.ask(
            "? Deployment strictness: (relaxed/standard/strict) [standard] ",
          )
        ).toLowerCase();
        strictness = ["relaxed", "standard", "strict"].includes(strictnessInput)
          ? strictnessInput
          : "standard";

        console.log("");

        // ── Infrastructure ──
        console.log("── Infrastructure ──");
        vaultName = await prompt.ask("? 1Password vault name: ");
        easProjectId = await prompt.ask(
          "? EAS Project ID: (can leave blank, fill later) ",
        );
        expoOwner = await prompt.ask("? Expo owner: ");
      } finally {
        prompt.close();
      }
    }

    console.log("");
    console.log("Scaffolding your app...");
    console.log("");

    // ── Build template variables ──
    const appNamePascal = toPascalCase(appName);
    const tenantNameSingular = tenantName ? tenantName.replace(/s$/, "") : "";

    // Build auth providers string for schema and config
    const authProviders = [];
    if (phoneOtp) authProviders.push("phone");
    if (emailOtp) authProviders.push("email");

    // Build feature flags
    const features = [];
    if (pushNotifications) features.push("notifications");
    if (chat) features.push("chat");
    if (payments) features.push("payments");

    // Schema composables — names match @supa/convex/schema exports.
    // supaAuthTables is always imported + spread by the template itself.
    const schemaImports = ["supaAuthTables"];
    const schemaSpread = [];
    if (multiTenant) {
      schemaImports.push("supaTenantTables");
      schemaSpread.push(
        `  ...supaTenantTables({ tenantName: "${tenantNameSingular}" }),`,
      );
    }
    if (pushNotifications) {
      schemaImports.push("supaNotificationTables");
      schemaSpread.push("  ...supaNotificationTables,");
    }
    if (chat) {
      schemaImports.push("supaChatTables");
      schemaSpread.push("  ...supaChatTables,");
    }
    if (payments) {
      schemaImports.push("supaPaymentTables");
      schemaSpread.push("  ...supaPaymentTables,");
    }

    const schemaImportsList = schemaImports.join(", ");
    const schemaSpreadLines =
      schemaSpread.length > 0 ? schemaSpread.join("\n") + "\n" : "";

    // Auth config for auth.ts — drives createSupaAuth({ methods, resend, twilio }).
    const authMethodsList = [];
    if (emailOtp) authMethodsList.push('"email"');
    if (phoneOtp) authMethodsList.push('"phone"');

    const authConfigBlocks = [];
    if (emailOtp) {
      authConfigBlocks.push(
        "  resend: {\n" +
          `    fromAddress: process.env.AUTH_EMAIL_FROM ?? "auth@${appSlug}.com",\n` +
          `    emailSubject: (code) => \`\${code} is your ${appName} code\`,\n` +
          "  },",
      );
    }
    if (phoneOtp) {
      authConfigBlocks.push(
        "  twilio: {\n" +
          '    tokenBridgePath: "/api/internal/phone-token",\n' +
          "  },",
      );
    }

    // Primary login method drives the generated login screen fields.
    const primaryProvider = emailOtp ? "email" : "phone";
    const authIdField = emailOtp ? "email" : "phone";
    const authPlaceholder = emailOtp ? "you@example.com" : "+1 555 123 4567";
    const authKeyboard = emailOtp ? "email-address" : "phone-pad";
    const authAutocomplete = emailOtp ? "email" : "tel";

    // HTTP imports + routes injected into http.ts only when a feature needs them.
    const httpImports = [];
    const httpRoutes = [];
    if (payments) {
      httpImports.push('import { httpAction } from "./_generated/server";');
      httpImports.push(
        'import { handleStripeWebhook, verifyStripeSignature } from "@supa/convex/payments";',
      );
      httpRoutes.push(
        [
          "",
          "// Stripe webhook endpoint",
          "http.route({",
          '  path: "/stripe/webhook",',
          '  method: "POST",',
          "  handler: httpAction(async (ctx, request) => {",
          "    const body = await request.text();",
          '    const signature = request.headers.get("stripe-signature") ?? "";',
          "    try {",
          "      const event = await verifyStripeSignature(body, signature);",
          "      await handleStripeWebhook(ctx, event);",
          '      return new Response("ok", { status: 200 });',
          "    } catch {",
          '      return new Response("Invalid signature", { status: 400 });',
          "    }",
          "  }),",
          "});",
        ].join("\n"),
      );
    }

    // Provider injection for _layout.tsx. SafeAreaProvider + SupaConvexProvider
    // (Convex client + @convex-dev/auth) are already in the template; we only
    // inject optional providers that nest inside them.
    const providerImports = [];
    const providerOpen = [];
    const providerClose = [];

    if (pushNotifications) {
      providerImports.push(
        'import { NotificationProvider } from "@supa/notifications";',
      );
      providerOpen.push("        <NotificationProvider>");
      providerClose.push("        </NotificationProvider>");
    }

    // Conditional mobile dependencies — feature packages and their native peers
    // are only added when the feature is enabled, so unused deps don't ship.
    const extraMobileDeps = [];
    if (pushNotifications) {
      extraMobileDeps.push('"@supa/notifications": "^0.2.0"');
      extraMobileDeps.push('"expo-notifications": "~0.32.16"');
      extraMobileDeps.push('"expo-device": "~8.0.10"');
    }
    if (chat) {
      extraMobileDeps.push('"@supa/chat": "^0.2.0"');
      extraMobileDeps.push('"@react-native-async-storage/async-storage": "2.2.0"');
      extraMobileDeps.push('"zustand": "^5.0.2"');
    }
    if (payments) {
      extraMobileDeps.push('"@supa/payments": "^0.2.0"');
    }
    const extraMobileDepsBlock =
      extraMobileDeps.length > 0
        ? extraMobileDeps.map((d) => `    ${d},`).join("\n")
        : "";

    // Supa config features section
    const configFeatures = [];
    configFeatures.push(`    phoneOtp: ${phoneOtp},`);
    configFeatures.push(`    emailOtp: ${emailOtp},`);
    configFeatures.push(`    pushNotifications: ${pushNotifications},`);
    configFeatures.push(`    chat: ${chat},`);
    configFeatures.push(`    payments: ${payments},`);

    // Env vars for .env.example
    const envVars = [];
    envVars.push("# Convex");
    envVars.push("CONVEX_DEPLOYMENT=");
    envVars.push("EXPO_PUBLIC_CONVEX_URL=");
    envVars.push("");
    if (phoneOtp) {
      envVars.push("# Twilio (Phone OTP)");
      envVars.push(`TWILIO_ACCOUNT_SID=op://${vaultName || "Vault"}/Twilio/account-sid`);
      envVars.push(`TWILIO_AUTH_TOKEN=op://${vaultName || "Vault"}/Twilio/auth-token`);
      envVars.push(`TWILIO_PHONE_NUMBER=op://${vaultName || "Vault"}/Twilio/phone-number`);
      envVars.push("");
    }
    if (emailOtp) {
      envVars.push("# Resend (Email OTP)");
      envVars.push(`RESEND_API_KEY=op://${vaultName || "Vault"}/Resend/api-key`);
      envVars.push("");
    }
    if (pushNotifications) {
      envVars.push("# Expo Push Notifications");
      envVars.push(`EXPO_ACCESS_TOKEN=op://${vaultName || "Vault"}/Expo/access-token`);
      envVars.push("");
    }
    if (payments) {
      envVars.push("# Stripe");
      envVars.push(`STRIPE_SECRET_KEY=op://${vaultName || "Vault"}/Stripe/secret-key`);
      envVars.push(`STRIPE_WEBHOOK_SECRET=op://${vaultName || "Vault"}/Stripe/webhook-secret`);
      envVars.push("");
    }
    envVars.push("# Sentry");
    envVars.push(`SENTRY_DSN=op://${vaultName || "Vault"}/Sentry/dsn`);

    const vars = {
      APP_NAME: appName,
      APP_NAME_PASCAL: appNamePascal,
      APP_SLUG: appSlug,
      URL_SCHEME: urlScheme,
      BUNDLE_ID: bundleId,
      STAGING_BUNDLE_ID: stagingBundleId,
      MULTI_TENANT: String(multiTenant),
      TENANT_NAME: tenantName,
      TENANT_NAME_SINGULAR: tenantNameSingular,
      PHONE_OTP: String(phoneOtp),
      EMAIL_OTP: String(emailOtp),
      PUSH_NOTIFICATIONS: String(pushNotifications),
      CHAT: String(chat),
      PAYMENTS: String(payments),
      STRICTNESS: strictness,
      VAULT_NAME: vaultName || "Vault",
      EAS_PROJECT_ID: easProjectId || "YOUR_EAS_PROJECT_ID",
      EXPO_OWNER: expoOwner || "your-expo-owner",
      SCHEMA_IMPORTS: schemaImportsList,
      SCHEMA_SPREAD_LINES: schemaSpreadLines,
      AUTH_METHODS_LIST: authMethodsList.join(", "),
      AUTH_CONFIG: authConfigBlocks.join("\n"),
      AUTH_PRIMARY_PROVIDER: primaryProvider,
      AUTH_ID_FIELD: authIdField,
      AUTH_PLACEHOLDER: authPlaceholder,
      AUTH_KEYBOARD: authKeyboard,
      AUTH_AUTOCOMPLETE: authAutocomplete,
      HTTP_IMPORTS: httpImports.join("\n"),
      HTTP_ROUTES: httpRoutes.join("\n"),
      EXTRA_MOBILE_DEPS: extraMobileDepsBlock,
      PROVIDER_IMPORTS: providerImports.join("\n"),
      PROVIDER_OPEN: providerOpen.join("\n"),
      PROVIDER_CLOSE: providerClose.reverse().join("\n"),
      CONFIG_FEATURES: configFeatures.join("\n"),
      ENV_VARS: envVars.join("\n"),
      AUTH_PROVIDERS_LIST: authProviders.map((p) => `"${p}"`).join(", "),
      FEATURES_LIST: features.map((f) => `"${f}"`).join(", "),
    };

    const conditionals = {
      payments,
      chat,
      notifications: pushNotifications,
      multiTenant,
    };

    // ── Create project directory ──
    const projectDir = resolve(process.cwd(), appSlug);
    mkdirSync(projectDir, { recursive: true });

    // ── Copy and process templates ──
    copyTemplateDir(TEMPLATES_DIR, projectDir, vars, conditionals);

    // ── Print results ──
    console.log(`\u2713 Created ${appSlug}/`);
    console.log("");
    console.log("Next steps:");
    console.log(`  cd ${appSlug}`);
    console.log("  pnpm install");
    console.log("  pnpm setup:secrets      # pulls secrets from 1Password");
    console.log("  npx convex dev           # creates Convex deployment");
    console.log("  pnpm dev                 # start developing!");
    console.log("");
    console.log("Your app is configured with:");
    console.log(
      `  ${phoneOtp ? "\u2713" : "\u2717"} Phone OTP auth (Twilio)${phoneOtp ? "" : " (disabled)"}`
    );
    console.log(
      `  ${emailOtp ? "\u2713" : "\u2717"} Email OTP auth (Resend)${emailOtp ? "" : " (disabled)"}`
    );
    console.log(
      `  ${pushNotifications ? "\u2713" : "\u2717"} Push notifications${pushNotifications ? "" : " (disabled)"}`
    );
    console.log(
      `  ${chat ? "\u2713" : "\u2717"} Chat${chat ? "" : " (disabled)"}`
    );
    console.log(
      `  ${payments ? "\u2713" : "\u2717"} Payments (Stripe)${payments ? "" : " (disabled)"}`
    );
    if (multiTenant) {
      console.log(`  \u2713 Multi-tenant (${tenantName})`);
    }
    console.log(`  \u2713 ${strictness.charAt(0).toUpperCase() + strictness.slice(1)} deployment strictness`);
    console.log("");
  } catch (err) {
    if (err.code === "ERR_USE_AFTER_CLOSE") {
      // User pressed Ctrl+C during an interactive prompt
      console.log("\nAborted.");
      process.exit(0);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
