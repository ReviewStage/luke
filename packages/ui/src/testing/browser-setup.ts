import { afterEach } from "vitest";
import { commands } from "vitest/browser";
import { unmountAll } from "./browser.js";

/**
 * browser-setup.ts -- every browser test starts on an empty page with no
 * media emulated: what a test mounted is unmounted after it, and a system
 * preference it emulated is set back.
 */

afterEach(async () => {
  await unmountAll();
  await commands.emulateReducedMotion(false);
});
