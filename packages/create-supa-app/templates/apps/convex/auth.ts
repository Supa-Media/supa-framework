import { createSupaAuth } from "@supa/convex/auth";

/**
 * Auth setup for {{APP_NAME}}.
 *
 * `createSupaAuth` wires up @convex-dev/auth with OTP providers. The enabled
 * methods and their transports (Resend for email, Twilio Verify for phone)
 * are configured here. See @supa/convex/auth for all options.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = createSupaAuth({
  appName: "{{APP_NAME}}",
  methods: [{{AUTH_METHODS_LIST}}],
{{AUTH_CONFIG}}
});
