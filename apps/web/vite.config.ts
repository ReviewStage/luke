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
};

export default defineConfig({
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
