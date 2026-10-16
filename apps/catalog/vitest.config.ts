import { emulateReducedMotion } from "@luke/ui/testing/browser-commands";
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
    // React under `act`, and the page emptied after each capture, as every
    // browser test of a shared component has it.
    setupFiles: ["src/test-setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      // Note that we draw text without hinting, subpixel positioning, or
      // LCD antialiasing, because Chromium otherwise takes each from the
      // machine's fontconfig, and two Linux images set them differently: a
      // golden must be the same pixels on any Linux that runs it.
      provider: playwright({
        launchOptions: {
          args: [
            "--font-render-hinting=none",
            "--disable-font-subpixel-positioning",
            "--disable-lcd-text",
            "--force-color-profile=srgb",
          ],
        },
      }),
      instances: [{ browser: "chromium" }],
      commands: { emulateReducedMotion },
      expect: {
        toMatchScreenshot: {
          comparatorName: "pixelmatch",
          comparatorOptions: { allowedMismatchedPixels: 0 },
        },
      },
    },
  },
});
