// @vitest-environment jsdom
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@luke/panel/testing/match-media";
import tokens from "@luke/ui/tokens.css?inline";
import { afterEach, beforeEach, test, vi } from "vitest";
import { followAppTheme } from "../src/admin/admin-appearance";

/**
 * The admin dashboard draws in the theme the app keeps, not a forced dark one:
 * once its page (`admin.html`) is up, `followAppTheme` wears a change of
 * `luke.theme`, or of the machine's appearance under System, as it lands, and
 * tints the browser's chrome in the worn theme's ground.
 */

const WEB = join(import.meta.dirname, "..");
const ADMIN_PAGE = new DOMParser().parseFromString(
  readFileSync(join(WEB, "admin.html"), "utf8"),
  "text/html",
);

let machineDark = false;
/** The media query lists handed out, which the machine's flip is announced to. */
const machine: MediaQueryListStub[] = [];

/** A media query list that is an event target, as the browser's is, answering the machine's appearance. */
class MediaQueryListStub extends EventTarget implements MediaQueryList {
  onchange: MediaQueryList["onchange"] = null;
  constructor(readonly media: string) {
    super();
  }
  get matches(): boolean {
    return this.media === "(prefers-color-scheme: dark)" && machineDark;
  }
  addListener(): void {}
  removeListener(): void {}
}

/** The machine's appearance flips: every list handed out hears it. */
function flipMachine(dark: boolean): void {
  machineDark = dark;
  for (const list of machine) list.dispatchEvent(new Event("change"));
}

beforeEach(() => {
  machineDark = false;
  machine.length = 0;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const list = new MediaQueryListStub(query);
    machine.push(list);
    return list;
  });
  // The page's head as admin.html writes it: its root's attributes and its tint.
  for (const { name, value } of Array.from(ADMIN_PAGE.documentElement.attributes)) {
    document.documentElement.setAttribute(name, value);
  }
  const tint = ADMIN_PAGE.querySelector('meta[name="theme-color"]');
  const meta = document.head.appendChild(document.createElement("meta"));
  meta.name = "theme-color";
  meta.content = tint?.getAttribute("content") ?? "";
  document.head.appendChild(document.createElement("style")).textContent = tokens;
});

afterEach(() => {
  document.head.replaceChildren();
  document.documentElement.removeAttribute("data-luke-theme");
  localStorage.clear();
  vi.restoreAllMocks();
});

function worn() {
  return {
    theme: document.documentElement.getAttribute("data-luke-theme"),
    chrome: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    ground: getComputedStyle(document.documentElement)
      .getPropertyValue("--luke-color-ground")
      .trim(),
  };
}

test("a change of the app's theme in another tab is worn as it lands, the chrome with it", () => {
  const stop = followAppTheme();
  assert.equal(worn().theme, "light");

  localStorage.setItem("luke.theme", "dark");
  window.dispatchEvent(new StorageEvent("storage", { key: "luke.theme", newValue: "dark" }));
  assert.equal(worn().theme, "dark");
  assert.equal(worn().chrome, worn().ground);

  localStorage.setItem("luke.theme", "light");
  window.dispatchEvent(new StorageEvent("storage", { key: "luke.theme", newValue: "light" }));
  assert.equal(worn().theme, "light");
  assert.equal(worn().chrome, worn().ground);
  stop();
});

test("under System the machine's flips are worn, and a chosen theme ignores them", () => {
  localStorage.setItem("luke.theme", "system");
  const stop = followAppTheme();
  assert.equal(worn().theme, "light");

  flipMachine(true);
  assert.equal(worn().theme, "dark");
  assert.equal(worn().chrome, worn().ground);

  localStorage.setItem("luke.theme", "light");
  window.dispatchEvent(new StorageEvent("storage", { key: "luke.theme" }));
  assert.equal(worn().theme, "light");
  flipMachine(false);
  flipMachine(true);
  assert.equal(worn().theme, "light", "a chosen theme stops following the machine");
  stop();
});
