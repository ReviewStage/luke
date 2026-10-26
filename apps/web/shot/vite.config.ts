import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { panelBuild } from "../scripts/panel-build";

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react(), tailwindcss(), ...panelBuild()],
  build: { outDir: process.env.SHOT_OUT, emptyOutDir: true },
});
