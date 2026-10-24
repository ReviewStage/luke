// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { test } from "vitest";
import { AboutPage } from "../src/AboutPage";
import { App } from "../src/App";
import { ChangelogPage, RELEASES } from "../src/ChangelogPage";
import { changelogRoutes } from "../src/changelog-releases";
import { PrivacyPage } from "../src/PrivacyPage";
import site from "../src/styles.css?inline";

/**
 * The site's sheet as Tailwind compiles it holds a rule for every utility a
 * public page's buttons are drawn with. `@luke/ui`'s button spells its box,
 * corner, and edge in utilities of the shared theme (`h-control`,
 * `rounded-control`, `border-button-edge`); a sheet that never took that
 * theme drops them, and the button keeps only a bare `border`, a square box
 * in the text's colour around every button on the page.
 */

const INDEX = changelogRoutes(RELEASES).find((route) => route.path === "/changelog");

const PAGES: readonly { path: string; page: FunctionComponent }[] = [
  { path: "/", page: App },
  { path: "/about", page: AboutPage },
  {
    path: "/changelog",
    page: () => {
      assert.ok(INDEX !== undefined);
      return createElement(ChangelogPage, { view: INDEX.view });
    },
  },
  { path: "/privacy", page: PrivacyPage },
];

/** The class names each button on the page wears, bar the group marker no rule selects by. */
function buttonClasses(page: FunctionComponent): Set<string> {
  const root = document.createElement("div");
  root.innerHTML = renderToString(createElement(page));
  const buttons = Array.from(root.querySelectorAll(".luke-button"));
  assert.ok(buttons.length > 0);
  return new Set(
    buttons.flatMap((button) =>
      Array.from(button.classList).filter((name) => !name.startsWith("group/")),
    ),
  );
}

/** Whether the sheet holds a selector naming `name` as a class, escaped as Tailwind escapes it. */
function hasRule(name: string): boolean {
  const selector = `.${name.replace(/[^\w-]/g, (character) => `\\${character}`)}`;
  let at = site.indexOf(selector);
  while (at !== -1 && /[\w-]/.test(site.charAt(at + selector.length))) {
    at = site.indexOf(selector, at + 1);
  }
  return at !== -1;
}

for (const { path, page } of PAGES) {
  test(`${path} draws every class its buttons wear`, () => {
    const missing = Array.from(buttonClasses(page)).filter((name) => !hasRule(name));
    assert.deepEqual(missing, []);
  });
}
