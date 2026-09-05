{{APPLE_TARGETS_REQUIRE}}/** @type {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => {{APPLE_TARGETS_OPEN}}{
  ...config,
  name: "{{APP_NAME}}",
  slug: "{{APP_SLUG}}",
  version: "1.0.0",
  scheme: "{{URL_SCHEME}}",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: process.env.APP_ENV === "staging"
      ? "{{STAGING_BUNDLE_ID}}"
      : "{{BUNDLE_ID}}",
    associatedDomains: [],
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    package: process.env.APP_ENV === "staging"
      ? "{{STAGING_BUNDLE_ID}}"
      : "{{BUNDLE_ID}}",
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "{{URL_SCHEME}}" }],
        category: ["DEFAULT", "BROWSABLE"],
      },
    ],
  },
  plugins: [
    "expo-router",
  ],
  extra: {
    eas: {
      projectId: "{{EAS_PROJECT_ID}}",
    },
    router: {
      origin: false,
    },
  },
  owner: "{{EXPO_OWNER}}",
  runtimeVersion: {
    policy: "appVersion",
  },
  updates: {
    url: `https://u.expo.dev/{{EAS_PROJECT_ID}}`,
  },
}{{APPLE_TARGETS_CLOSE}};
