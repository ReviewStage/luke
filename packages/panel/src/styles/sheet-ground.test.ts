// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PROFILE } from "@luke/ui";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * sheet-ground.test.ts -- the work stands on the sheet's ground in every
 * room, a narrow one's full-bleed column included, rather than on the
 * window's frame. The sheets are laid (`testing/container-width.ts`). jsdom
 * keeps a shorthand that names a custom property only as its rule's text,
 * so each is read as the last rule reaching the element declares it, in the
 * order the rules are laid, which is the order they win in for these
 * elements.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** What the last rule reaching `element` declares for `property`, as written; empty where none does. */
function declared(element: Element, property: string): string {
  let value = "";
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      try {
        if (!element.matches(rule.selectorText)) continue;
      } catch {
        // A pseudo-element's selector (`::highlight`), which no element is.
        continue;
      }
      value = rule.style.getPropertyValue(property).trim() || value;
    }
  }
  return value;
}

/** A shell in `room` on the web profile, and its work column. */
function shellIn(room: "wide" | "narrow") {
  document.documentElement.setAttribute("data-luke-profile", PROFILE.WEB);
  laid ??= layContainersAt({});
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  shell.dataset.sidebarCollapsed = String(room === "narrow");
  const main = shell.appendChild(document.createElement("main"));
  main.className = "desktop-main";
  return { shell, main };
}

test("a narrow room's full-bleed work column stands on the sheet's ground, as a wide room's sheet does, not on the frame", () => {
  const wide = shellIn("wide");
  // A wide room's work column draws its sheet beneath it, under its row on the frame; Settings' page is the sheet itself.
  wide.main.remove();
  const settings = wide.shell.appendChild(document.createElement("div"));
  settings.className = "desktop-settings";
  const page = settings.appendChild(document.createElement("section"));
  page.className = "settings-page";
  const sheet = declared(page, "background");
  const frame = declared(wide.shell, "background");
  document.body.replaceChildren();
  const narrow = shellIn("narrow");

  assert.notEqual(sheet, "");
  assert.notEqual(sheet, frame);
  assert.equal(declared(narrow.main, "background"), sheet);
});

test("a wide room's page without tabs stands its top row on the frame as a page with tabs does, one row high with no gap over it, its sheet beneath the row rather than its ground", () => {
  for (const collapsed of [false, true]) {
    const geometry = (tabbed: boolean) => {
      const { shell, main } = shellIn("wide");
      document.documentElement.setAttribute("data-luke-profile", PROFILE.DESKTOP);
      shell.dataset.sidebarCollapsed = String(collapsed);
      if (tabbed) main.appendChild(document.createElement("div")).className = "desktop-task";
      const drawn = ["--desktop-bar-height", "margin", "margin-left", "background"].map(
        (property) => declared(main, property),
      );
      document.body.replaceChildren();
      return drawn;
    };
    const tabless = geometry(false);

    assert.deepEqual(tabless, geometry(true), `sidebar collapsed: ${collapsed}`);
    assert.equal(tabless[3], "", "the page stands on the frame, its sheet drawn beneath it");
  }
});
