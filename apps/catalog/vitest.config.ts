import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * vitest.config.ts -- the catalog's visual comparison: each example captured
 * in the pinned Playwright Chromium and matched against its golden.
 *
 * A golden moves only when asked: `LUKE_UPDATE_FIXTURES=1` writes what was
 * drawn over what was recorded, as every other fixture in the repository is
 * re-recorded. Any pixel that differs otherwise fails the run, and the diff
 * lands under `.vitest/` beside the capture for whoever reads it.
 */
export default defineConfig({
  test: {
    name: "catalog",
    include: ["src/**/*.test.ts"],
    update: process.env.LUKE_UPDATE_FIXTURES === "1",
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      expect: {
        toMatchScreenshot: {
          comparatorName: "pixelmatch",
          comparatorOptions: { allowedMismatchedPixels: 0 },
        },
      },
    },
  },
});
