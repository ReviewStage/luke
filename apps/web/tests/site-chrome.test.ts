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
 * keeps its own, and both mark the page the reader is on, and only that one;
 * a page beneath the changelog marks the changelog as the part of the site
 * the reader is in, never as the page they are on.
 */

const CHANGELOG_ROUTES = changelogRoutes(RELEASES);

/** The changelog as drawn at `path`. */
function changelogAt(path: string): FunctionComponent {
  const route = CHANGELOG_ROUTES.find((candidate) => candidate.path === path);
  assert.ok(route !== undefined);
  return () => createElement(ChangelogPage, { view: route.view });
}

const ChangelogIndex = changelogAt("/changelog");

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

for (const path of ["/changelog/page/2", `/changelog/${RELEASES[0]?.version}`]) {
  test(`${path} marks the changelog as where the reader is, not as the page they are on`, () => {
    const root = drawn(changelogAt(path));
    assert.equal(root.querySelectorAll('a[aria-current="page"]').length, 0);
    assert.deepEqual(
      Array.from(root.querySelectorAll('a[aria-current="true"]')).map((link) => [
        link.textContent,
        link.getAttribute("href"),
      ]),
      [
        ["Changelog", "/changelog"],
        ["Changelog", "/changelog"],
      ],
    );
  });
}
