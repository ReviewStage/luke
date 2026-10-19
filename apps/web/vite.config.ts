import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { bundleBudget } from "./scripts/bundle-budget";
import { panelBuild } from "./scripts/panel-build";

const resolveEntry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The panel's side bundles the app entry splits off, each by the module its
// chunk starts at (`@luke/panel`'s bundle loader), held to the budget beside
// the entry's first load.
const PANEL_SIDE_BUNDLES = {
  "plan-editor": "/packages/panel/src/plan-editor/index.ts",
  whiteboard: "/packages/panel/src/whiteboard/index.tsx",
  "file-tree": "/packages/panel/src/file-tree/index.ts",
  terminal: "/packages/panel/src/terminal/index.ts",
  diagram: "/packages/panel/src/diagram/index.ts",
  "diff-view": "/packages/panel/src/diff-view/index.ts",
  // What only a tab that records or reports loads: session replay's recorder
  // and its client, and Sentry's SDK.
  "session-recorder": "/apps/web/src/app/session-recorder.ts",
  "session-replay": "/posthog-js/dist/module.no-external.js",
  sentry: "/apps/web/src/app/web-sentry-sdk.ts",
};

// Where the web app's tab reports to Sentry (`src/app/web-sentry.ts`): the
// deployment's own DSN, environment, and commit, read from the build's
// environment as the desktop's build reads its DSN. A build without
// `SENTRY_DSN` writes an empty one, and the tab loads no SDK.
const WEB_SENTRY_DEFINES = {
  WEB_SENTRY_DSN: JSON.stringify(process.env.SENTRY_DSN ?? ""),
  WEB_SENTRY_ENVIRONMENT: JSON.stringify(process.env.VERCEL_ENV ?? ""),
  WEB_SENTRY_RELEASE: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ""),
};

export default defineConfig({
  define: WEB_SENTRY_DEFINES,
  plugins: [
    react(),
    tailwindcss(),
    ...panelBuild(),
    bundleBudget({
      budgetFile: resolveEntry("./bundle-budget.json"),
      entry: resolveEntry("./app.html"),
      sideBundles: PANEL_SIDE_BUNDLES,
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolveEntry("./index.html"),
        about: resolveEntry("./about.html"),
        privacy: resolveEntry("./privacy.html"),
        changelog: resolveEntry("./changelog.html"),
        "sign-in": resolveEntry("./sign-in.html"),
        consent: resolveEntry("./consent.html"),
        "github-installed": resolveEntry("./github-installed.html"),
        "integration-connected": resolveEntry("./integration-connected.html"),
        admin: resolveEntry("./admin.html"),
        "connect-github": resolveEntry("./connect-github.html"),
        "accept-invitation": resolveEntry("./accept-invitation.html"),
        "desktop-session": resolveEntry("./desktop-session.html"),
        app: resolveEntry("./app.html"),
      },
    },
  },
});
