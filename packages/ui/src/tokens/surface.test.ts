import { expect, test } from "vitest";
import { DENSITY, PROFILE, surfaceAttributes, THEME } from "./surface.js";

/**
 * surface.test.ts -- the desktop alone follows the machine's appearance: a
 * caller can draw a site's surface dark or light, and the compiler refuses
 * one asked to follow the system, whose palette the site does not have.
 * Only a site's surface may be drawn compact, and one that is says so on
 * its root.
 */

test("a web surface cannot be asked to follow the system", () => {
  surfaceAttributes(PROFILE.DESKTOP, THEME.SYSTEM);
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT);
  // @ts-expect-error The site keeps no palette that follows the machine.
  surfaceAttributes(PROFILE.WEB, THEME.SYSTEM);
});

test("a compact surface is the site's alone, and its root says it is compact", () => {
  expect(surfaceAttributes(PROFILE.WEB, THEME.DARK, DENSITY.COMPACT)).toEqual({
    "data-luke-profile": "web",
    "data-luke-theme": "dark",
    "data-luke-density": "compact",
  });
  expect(surfaceAttributes(PROFILE.WEB, THEME.DARK)).toEqual({
    "data-luke-profile": "web",
    "data-luke-theme": "dark",
  });
  // @ts-expect-error The desktop is drawn at its own density alone.
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK, DENSITY.COMPACT);
});
