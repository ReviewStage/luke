import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceMapUploadToken } from "@luke/service/observability/source-maps";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";
import { bundleBudget } from "./scripts/bundle-budget";
import { panelBuild } from "./scripts/panel-build";

const resolveEntry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Where the client build leaves the site, which the Build Output copies under its `static/`. */
const SITE_DIRECTORY = resolveEntry("./dist");

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

// What the web app's tab reads of the deployment it was built for, from the
// build's environment as the desktop's build reads its own: Vercel's name for
// the deployment, which only `production` records session replay under
// (`src/app/web-session-replay.ts`) and Sentry files reports under, and the
// DSN and commit the tab reports to Sentry with (`src/app/web-sentry.ts`). A
// build without `SENTRY_DSN` writes an empty one, and the tab loads no SDK.
const WEB_DEPLOYMENT_DEFINES = {
  WEB_DEPLOYMENT: JSON.stringify(process.env.VERCEL_ENV ?? ""),
  WEB_SENTRY_DSN: JSON.stringify(process.env.SENTRY_DSN ?? ""),
  WEB_SENTRY_RELEASE: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ""),
};

/**
 * The client build's source maps, uploaded to Sentry's `luke-web` project
 * on the web functions' terms (`scripts/bundle-functions.ts`), so a stack
 * the tab reports reads as the source. Only a production client build that
 * holds `SENTRY_AUTH_TOKEN` writes maps at all, hidden (named by no comment
 * in a chunk); Sentry's plugin uploads them under the deployment's commit,
 * the release the tab reports under (`src/app/web-sentry.ts`), and deletes
 * them from `dist`, so none is served (and the Build Output copies none,
 * `server/build-output.ts`). An upload Sentry refuses is logged and the
 * build goes on, as the functions' does. The SSR build only prerenders, and
 * uploads nothing.
 */
function sentrySourceMaps(authToken: string | undefined): PluginOption[] {
  if (!authToken) return [];
  return [
    sentryVitePlugin({
      org: "stage-review",
      project: "luke-web",
      authToken,
      // The tab names its release itself, from the same commit, so nothing is written into the chunks for it.
      release: { name: process.env.VERCEL_GIT_COMMIT_SHA, inject: false },
      sourcemaps: { filesToDeleteAfterUpload: [join(SITE_DIRECTORY, "**", "*.map")] },
    }),
  ];
}

export default defineConfig(({ isSsrBuild }) => {
  const sourceMapToken = isSsrBuild ? undefined : sourceMapUploadToken(process.env);
  return {
    define: WEB_DEPLOYMENT_DEFINES,
    plugins: [
      react(),
      tailwindcss(),
      ...panelBuild(),
      bundleBudget({
        budgetFile: resolveEntry("./bundle-budget.json"),
        entry: resolveEntry("./app.html"),
        sideBundles: PANEL_SIDE_BUNDLES,
      }),
      // Sentry's plugin goes after all others.
      ...sentrySourceMaps(sourceMapToken),
    ],
    build: {
      // The bundle budget measures what it needs itself, so vite's own gzip
      // report is only a cost to every build.
      reportCompressedSize: false,
      sourcemap: sourceMapToken ? "hidden" : false,
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
  };
});
