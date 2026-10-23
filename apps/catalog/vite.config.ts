import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * vite.config.ts -- the catalog builds to a static folder that opens from
 * any path, so the relative base, and it fetches nothing at run time: every
 * font and glyph is bundled from the workspace. Tailwind compiles the
 * utilities `@luke/ui`'s vendored shadcn/ui components spell, as each app does.
 */
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
});
