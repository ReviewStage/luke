import { test } from "vitest";
import { PROFILE, surfaceAttributes, THEME } from "./surface.js";

/**
 * surface.test.ts -- the desktop alone follows the machine's appearance: a
 * caller can draw a site's surface dark or light, and the compiler refuses
 * one asked to follow the system, whose palette the site does not have.
 */

test("a web surface cannot be asked to follow the system", () => {
  surfaceAttributes(PROFILE.DESKTOP, THEME.SYSTEM);
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT);
  // @ts-expect-error The site keeps no palette that follows the machine.
  surfaceAttributes(PROFILE.WEB, THEME.SYSTEM);
});
