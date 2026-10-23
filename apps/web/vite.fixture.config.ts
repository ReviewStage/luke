import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { panelBuild } from "./scripts/panel-build";
export default defineConfig({
  define: { WEB_DEPLOYMENT: '""', WEB_SENTRY_DSN: '""', WEB_SENTRY_RELEASE: '""' },
  plugins: [react(), tailwindcss(), ...panelBuild()],
  build: { target: "esnext", outDir: process.env.FIXTURE_OUT, emptyOutDir: true, rollupOptions: { input: { fixture: "fixture.html" } } },
  server: { host: true, allowedHosts: true },
});
