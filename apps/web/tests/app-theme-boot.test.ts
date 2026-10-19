// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@luke/panel/testing/match-media";
import tokens from "@luke/ui/tokens.css?inline";
import { afterEach, beforeEach, test, vi } from "vitest";

/**
 * The web app's first frame (`public/app-theme.js`, which app.html runs in
 * its head before any stylesheet paints): the theme the account last chose
 * in this browser is worn, and with nothing chosen, or System, the
 * machine's; and the browser's chrome is tinted with that theme's own
 * ground, as the palette names it, so a dark tab never opens light.
 */

const BOOT = readFileSync(join(import.meta.dirname, "..", "public", "app-theme.js"), "utf8");

let machineDark = false;

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query === "(prefers-color-scheme: dark)" && machineDark,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  );
  // The page's head as app.html writes it: the profile, the light theme, and the light tint.
  document.documentElement.setAttribute("data-luke-profile", "web");
  document.documentElement.setAttribute("data-luke-theme", "light");
  const meta = document.head.appendChild(document.createElement("meta"));
  meta.name = "theme-color";
  meta.content = "#fbfbfa";
  document.head.appendChild(document.createElement("style")).textContent = tokens;
});

afterEach(() => {
  document.head.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

/** The page loading: the boot script run, and what the first frame wears. */
function firstFrame() {
  // biome-ignore lint/security/noGlobalEval: the script under test is the site's own file, run as the page runs it.
  window.eval(BOOT);
  return {
    theme: document.documentElement.getAttribute("data-luke-theme"),
    chrome: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    ground: getComputedStyle(document.documentElement)
      .getPropertyValue("--luke-color-ground")
      .trim(),
  };
}

test("the first frame wears the theme chosen here, whatever the machine says", () => {
  for (const [chosen, machine, theme] of [
    ["dark", false, "dark"],
    ["light", true, "light"],
  ] as const) {
    machineDark = machine;
    localStorage.setItem("luke.theme", chosen);

    const frame = firstFrame();

    assert.equal(frame.theme, theme);
    assert.equal(frame.chrome, frame.ground, "the chrome is tinted with the palette's ground");
  }
});

test("with System chosen, or nothing yet, the first frame follows the machine", () => {
  for (const chosen of ["system", undefined]) {
    for (const machine of [true, false]) {
      machineDark = machine;
      if (chosen !== undefined) localStorage.setItem("luke.theme", chosen);

      const frame = firstFrame();

      assert.equal(frame.theme, machine ? "dark" : "light", `${chosen} on a ${machine} machine`);
      assert.equal(frame.chrome, frame.ground);
    }
  }
});
