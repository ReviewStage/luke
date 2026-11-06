// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@repo/panel/testing/match-media";
import tokens from "@repo/ui/tokens.css?inline";
import { afterEach, beforeEach, test, vi } from "vitest";

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
  document.documentElement.setAttribute("data-ui-profile", "web");
  document.documentElement.setAttribute("data-ui-theme", "light");
  const meta = document.head.appendChild(document.createElement("meta"));
  meta.name = "theme-color";
  meta.content = "#ffffff";
  document.head.appendChild(document.createElement("style")).textContent = tokens;
});

afterEach(() => {
  document.head.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

function firstFrame() {
  // biome-ignore lint/security/noGlobalEval: the script under test is the site's own file, run as the page runs it.
  window.eval(BOOT);
  return {
    theme: document.documentElement.getAttribute("data-ui-theme"),
    chrome: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    ground: getComputedStyle(document.documentElement).getPropertyValue("--ui-color-ground").trim(),
  };
}

test("the first frame wears the theme chosen here, whatever the machine says", () => {
  for (const [chosen, machine, theme] of [
    ["dark", false, "dark"],
    ["light", true, "light"],
  ] as const) {
    machineDark = machine;
    localStorage.setItem("app.theme", chosen);

    const frame = firstFrame();

    assert.equal(frame.theme, theme);
    assert.equal(frame.chrome, frame.ground, "the chrome is tinted with the palette's ground");
  }
});

test("with System chosen, or nothing yet, the first frame follows the machine", () => {
  for (const chosen of ["system", undefined]) {
    for (const machine of [true, false]) {
      machineDark = machine;
      if (chosen !== undefined) localStorage.setItem("app.theme", chosen);

      const frame = firstFrame();

      assert.equal(frame.theme, machine ? "dark" : "light", `${chosen} on a ${machine} machine`);
      assert.equal(frame.chrome, frame.ground);
    }
  }
});
