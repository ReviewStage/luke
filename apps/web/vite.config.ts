import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";
import { panelBuild } from "./scripts/panel-build";
import { siteMarkdown } from "./scripts/site-markdown";

const resolveEntry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Where the client build leaves the site, which the Build Output copies under its `static/`. */
const SITE_DIRECTORY = resolveEntry("./dist");

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
      // The release is the deployment's commit, which the plugin reads from
      // Vercel's `VERCEL_GIT_COMMIT_SHA` as the tab does; the tab names it
      // itself, so nothing is written into the chunks for it.
      release: { inject: false },
      sourcemaps: { filesToDeleteAfterUpload: [join(SITE_DIRECTORY, "**", "*.map")] },
    }),
  ];
}

export default defineConfig(({ isSsrBuild }) => {
  // The same gate as `sourceMapUploadToken` (`@luke/service/observability/source-maps`),
  // spelled here because knip loads this file without resolving a workspace
  // package's TypeScript source; `tests/web-source-maps.test.ts` holds it.
  const sourceMapToken =
    !isSsrBuild && process.env.VERCEL_ENV === "production"
      ? process.env.SENTRY_AUTH_TOKEN || undefined
      : undefined;
  return {
    define: WEB_DEPLOYMENT_DEFINES,
    plugins: [
      react(),
      tailwindcss(),
      ...panelBuild(),
      siteMarkdown(),
      // Sentry's plugin goes after all others.
      ...sentrySourceMaps(sourceMapToken),
    ],
    build: {
      // Vite's own gzip report is only a cost to every build.
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
