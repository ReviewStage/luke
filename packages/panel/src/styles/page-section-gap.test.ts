// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PROFILE } from "@luke/ui";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * page-section-gap.test.ts -- the sections of a page stand one role apart,
 * `--luke-page-section-gap`, 32px: Home's sections, an automations list's
 * groups and its suggestions under them, and a person's blocks under their
 * head, so no page spaces its sections by a step of its own. jsdom lays
 * nothing out, so the margin each page declares for the section that follows
 * another is read as the sheets declare it (`testing/container-width.ts`),
 * with the role spelled out.
 */

const PAGE_SECTION_GAP = 32;

beforeAll(() => {
  layContainersAt({});
});

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** `value` as `element` reads it, every custom property it names spelled out. */
function resolved(element: Element, value: string): string {
  const style = getComputedStyle(element);
  return value.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => {
    const own = style.getPropertyValue(name).trim();
    return own === "" ? whole : resolved(element, own);
  });
}

/** The `margin-top` the last rule reaching `element` declares, spelled out. */
function marginTop(element: Element): string {
  let declared = "";
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      try {
        if (!element.matches(rule.selectorText)) continue;
      } catch {
        continue;
      }
      const value = rule.style.getPropertyValue("margin-top").trim();
      if (value !== "") declared = value;
    }
  }
  return resolved(element, declared);
}

/** A section `second` standing after a `first`, each by its class, in a page of the desktop's profile. */
function after(first: string, second: string): HTMLElement {
  document.documentElement.setAttribute("data-luke-profile", PROFILE.DESKTOP);
  const page = document.body.appendChild(document.createElement("div"));
  page.appendChild(document.createElement("div")).className = first;
  const next = page.appendChild(document.createElement("div"));
  next.className = second;
  return next;
}

test("Home's sections stand a page section's gap apart", () => {
  assert.equal(marginTop(after("home-section", "home-section")), `${PAGE_SECTION_GAP}px`);
});

test("an automations list's groups and its suggestions stand a page section's gap apart", () => {
  assert.equal(marginTop(after("automation-group", "automation-group")), `${PAGE_SECTION_GAP}px`);
  assert.equal(
    marginTop(after("automation-group", "automation-suggestions")),
    `${PAGE_SECTION_GAP}px`,
  );
});

test("a person's sections stand a page section's gap under their head", () => {
  assert.equal(marginTop(after("person-top", "home-section")), `${PAGE_SECTION_GAP}px`);
});
