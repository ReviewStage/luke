import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { emulateReducedMotion } from "./src/testing/browser-commands.js";

/**
 * vitest.browser.config.ts -- the package's second project: a shared
 * component's keyboard, pointer, focus, and accessibility, checked in a real
 * Chromium rather than jsdom, which has no layout, no focus order of its own,
 * and no trusted events.
 *
 * The browser is the one `playwright` (pinned in package.json) installs, so
 * every machine runs the same build of it: `scripts/bootstrap.sh` installs it
 * on a developer's, and CI's test job installs it with its system libraries.
 */
export default defineConfig({
  test: {
    name: "ui-browser",
    include: ["src/**/*.browser.test.ts"],
    setupFiles: ["src/testing/browser-setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      viewport: { width: 1280, height: 840 },
      commands: { emulateReducedMotion },
    },
  },
});
