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

/**
 * The site's chrome as a reader meets it on every public page, drawn as the
 * prerender writes it: the banner's navigation names its links, the footer
 * keeps its own, and both mark the page the reader is on, and only that one.
 */

const CHANGELOG = changelogRoutes(RELEASES).find((route) => route.path === "/changelog");

function ChangelogIndex(): React.JSX.Element {
  assert.ok(CHANGELOG !== undefined);
  return createElement(ChangelogPage, { view: CHANGELOG.view });
}

const PAGES: readonly { path: string; page: FunctionComponent; marked: readonly string[] }[] = [
  { path: "/", page: App, marked: ["Luke"] },
  { path: "/about", page: AboutPage, marked: ["About", "About"] },
  { path: "/changelog", page: ChangelogIndex, marked: ["Changelog", "Changelog"] },
  { path: "/privacy", page: PrivacyPage, marked: ["Privacy"] },
];

/** The page as the prerender writes it. */
function drawn(page: FunctionComponent): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToString(createElement(page));
  return root;
}

/** What each link is named, its words or else its label, with where it goes. */
function links(region: Element | null): string[] {
  assert.ok(region !== null);
  return Array.from(region.querySelectorAll("a")).map(
    (link) =>
      `${link.getAttribute("aria-label") ?? link.textContent} -> ${link.getAttribute("href")}`,
  );
}

for (const { path, page, marked } of PAGES) {
  test(`${path} names the site's links in its banner and footer`, () => {
    const root = drawn(page);
    assert.deepEqual(links(root.querySelector('header nav[aria-label="Site"]')), [
      "Luke -> /",
      "About -> /about",
      "Changelog -> /changelog",
      "Luke on GitHub -> https://github.com/ReviewStage/luke",
    ]);
    assert.deepEqual(links(root.querySelector("footer")), [
      "About -> /about",
      "Changelog -> /changelog",
      "RSS -> /changelog/rss.xml",
      "Privacy -> /privacy",
      "Contact -> mailto:founders@stagereview.app",
    ]);
  });

  test(`${path} marks the links to itself as the current page`, () => {
    const current = Array.from(drawn(page).querySelectorAll('a[aria-current="page"]'));
    assert.deepEqual(
      current.map((link) => link.textContent),
      marked,
    );
    for (const link of current) assert.equal(link.getAttribute("href"), path);
  });
}
