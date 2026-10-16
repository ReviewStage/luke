import { afterEach } from "vitest";
import { unmountAll } from "./browser.js";

/**
 * browser-setup.ts -- every browser test starts on an empty page: React is
 * told it runs under `act`, and what a test mounted is unmounted after it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(unmountAll);
