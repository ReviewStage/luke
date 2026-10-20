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
 * ground, as the palette names it, so a dark tab never opens light. And the
 * shell's frame app.html draws stands its sidebar as the shell last drew it
 * here: pinned, at the width kept, as the panel bounds it, where the tab
 * last read someone signed in, and none where the shell kept it folded or
 * never drew it, or the tab last read nobody signed in.
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
  document.documentElement.removeAttribute("data-luke-boot-sidebar");
  document.documentElement.style.removeProperty("--luke-boot-sidebar-width");
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

/** The sidebar the frame stands, as the boot script leaves it on the root: pinned or not, and at what width. */
function frameSidebar() {
  // biome-ignore lint/security/noGlobalEval: the script under test is the site's own file, run as the page runs it.
  window.eval(BOOT);
  const root = document.documentElement;
  return {
    pinned: root.getAttribute("data-luke-boot-sidebar") === "pinned",
    width: root.style.getPropertyValue("--luke-boot-sidebar-width") || undefined,
  };
}

test("the frame pins the sidebar as the shell last drew it here, at the width kept within the panel's bounds", () => {
  for (const [kept, width] of [
    ["300", "300px"],
    ["120", "200px"],
    ["999.6", "400px"],
    [undefined, undefined],
    ["wide", undefined],
  ] as const) {
    localStorage.setItem("luke.signed-in-here", "true");
    localStorage.setItem("luke.sidebar-collapsed", "false");
    if (kept === undefined) localStorage.removeItem("luke.sidebar-width");
    else localStorage.setItem("luke.sidebar-width", kept);
    document.documentElement.style.removeProperty("--luke-boot-sidebar-width");

    assert.deepEqual(frameSidebar(), { pinned: true, width }, `kept ${kept}`);
  }
});

test("a sidebar kept folded or never drawn, or a browser not signed in here, stands no sidebar in the frame", () => {
  for (const [signedIn, collapsed] of [
    ["true", "true"],
    ["true", undefined],
    [undefined, "false"],
  ] as const) {
    localStorage.clear();
    if (signedIn !== undefined) localStorage.setItem("luke.signed-in-here", signedIn);
    if (collapsed !== undefined) localStorage.setItem("luke.sidebar-collapsed", collapsed);
    localStorage.setItem("luke.sidebar-width", "300");

    assert.deepEqual(
      frameSidebar(),
      { pinned: false, width: undefined },
      `signed in ${signedIn}, folded ${collapsed}`,
    );
  }
});
