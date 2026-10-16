import { PROFILE, surfaceAttributes, THEME } from "@luke/ui";
import { mount } from "@luke/ui/testing/browser";
import { createElement } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { ExampleFrame } from "./catalog";
import { EXAMPLES } from "./examples";
import "./styles";
import "./capture.css";

/**
 * catalog.test.ts -- every example, drawn at every surface it ships on,
 * matches the golden recorded for it: the desktop at its window's 1280×840
 * in both themes, and the site at a phone's 320, a tablet's 768, and a
 * desktop browser's 1440 wide, each in both themes.
 *
 * The goldens are recorded in the pinned Playwright Chromium on Linux, CI's
 * machine, and compared only there (`scripts/check.mjs` leaves this suite to
 * CI on any other system). One is re-recorded, deliberately, with
 * `LUKE_UPDATE_FIXTURES=1 pnpm --filter @luke/catalog test:vitest`, and the
 * pull request that does so says why its pixels moved.
 */

/** One surface an example ships on: where it is drawn and how wide the window is. */
interface Surface {
  readonly name: string;
  readonly attributes: ReturnType<typeof surfaceAttributes>;
  readonly width: number;
  readonly height: number;
}

const DESKTOP_WINDOW = { width: 1280, height: 840 } as const;
const WEB_WIDTHS = [320, 768, 1440] as const;
const WEB_HEIGHT = 900;

const SURFACES: readonly Surface[] = [
  ...[THEME.DARK, THEME.LIGHT].map((theme) => ({
    name: `desktop-${theme}`,
    attributes: surfaceAttributes(PROFILE.DESKTOP, theme),
    ...DESKTOP_WINDOW,
  })),
  ...WEB_WIDTHS.flatMap((width) =>
    [THEME.DARK, THEME.LIGHT].map((theme) => ({
      name: `web-${width}-${theme}`,
      attributes: surfaceAttributes(PROFILE.WEB, theme),
      width,
      height: WEB_HEIGHT,
    })),
  ),
];

for (const example of EXAMPLES) {
  for (const surface of SURFACES) {
    test(`${example.title} at ${surface.name} matches its golden`, async () => {
      await page.viewport(surface.width, surface.height);
      const { container } = await mount(
        createElement(ExampleFrame, { example }),
        surface.attributes,
      );
      // Note that we wait on the faces, because a capture taken while one
      // is still loading draws its words in the fallback.
      await document.fonts.ready;
      // The window grows to the example's full height, because Chromium
      // paints only what stands inside the viewport, and a tall example on a
      // phone's width would be captured with its foot blank.
      const height = Math.ceil(container.getBoundingClientRect().height);
      await page.viewport(surface.width, Math.max(surface.height, height));
      await expect(container).toMatchScreenshot(`${example.id}-${surface.name}`);
    });
  }
}
