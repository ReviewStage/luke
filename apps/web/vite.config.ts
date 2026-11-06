import { fileURLToPath } from "node:url";
import { PAGE_IN_MAC_APP_PATH } from "@repo/features/page-frame";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { panelBuild } from "./scripts/panel-build";
import { siteMarkdown } from "./scripts/site-markdown";

const resolveEntry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const WEB_DEPLOYMENT_DEFINES = {
  WEB_DEPLOYMENT: JSON.stringify(process.env.VERCEL_ENV ?? ""),
  WEB_SENTRY_DSN: JSON.stringify(process.env.SENTRY_DSN ?? ""),
  WEB_SENTRY_RELEASE: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ""),
};

function pageInMacAppAtCleanPath(): Plugin {
  return {
    name: "page-in-mac-app-at-clean-path",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname === PAGE_IN_MAC_APP_PATH)
          request.url = `${url.pathname}.html${url.search}`;
        next();
      });
    },
  };
}

export default defineConfig({
  define: WEB_DEPLOYMENT_DEFINES,
  plugins: [react(), tailwindcss(), ...panelBuild(), siteMarkdown(), pageInMacAppAtCleanPath()],
  build: {
    reportCompressedSize: false,
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
        "404": resolveEntry("./404.html"),
      },
    },
  },
});
