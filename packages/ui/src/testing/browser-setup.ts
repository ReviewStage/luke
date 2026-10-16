import { afterEach } from "vitest";
import { unmountAll } from "./browser.js";

/**
 * browser-setup.ts -- every browser test starts on an empty page: what a
 * test mounted is unmounted after it.
 */

afterEach(unmountAll);
