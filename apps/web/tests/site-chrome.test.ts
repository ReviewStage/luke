// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { test } from "vitest";
import { AboutPage } from "../src/AboutPage";
import { App } from "../src/App";
import { PANEL_PATH } from "../src/app/web-address";
import { ChangelogPage, RELEASES } from "../src/ChangelogPage";
import { changelogRoutes } from "../src/changelog-releases";
import { PrivacyPage } from "../src/PrivacyPage";

const CHANGELOG_ROUTES = changelogRoutes(RELEASES);

function changelogAt(path: string): FunctionComponent {
  const route = CHANGELOG_ROUTES.find((candidate) => candidate.path === path);
  assert.ok(route !== undefined);
  return () => createElement(ChangelogPage, { view: route.view });
}

const ChangelogIndex = changelogAt("/changelog");

const PAGES: readonly { path: string; page: FunctionComponent; marked: readonly string[] }[] = [
  { path: "/", page: App, marked: ["Vespin"] },
  { path: "/about", page: AboutPage, marked: ["About", "About"] },
  { path: "/changelog", page: ChangelogIndex, marked: ["Changelog", "Changelog"] },
  { path: "/privacy", page: PrivacyPage, marked: ["Privacy"] },
];

function drawn(page: FunctionComponent): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToString(createElement(page));
  return root;
}

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
      "Vespin -> /",
      "About -> /about",
      "Docs -> /docs",
      "Changelog -> /changelog",
      "Vespin on GitHub -> https://github.com/ReviewStage/vespin",
      `Sign in -> ${PANEL_PATH}`,
    ]);
    assert.deepEqual(links(root.querySelector("footer")), [
      "About -> /about",
      "Docs -> /docs",
      "Changelog -> /changelog",
      "RSS -> /changelog/rss.xml",
      "Privacy -> /privacy",
      "Contact -> mailto:founders@vespin.dev",
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

test("the landing offers the web app beside the download, and nothing in its scenes to press", () => {
  const body = drawn(App).querySelector("main");
  const pressable = Array.from(body?.querySelectorAll("button, [tabindex]") ?? []).filter(
    (control) => control.closest("[inert]") === null,
  );
  assert.deepEqual(
    pressable.map((control) => control.textContent),
    [],
  );
  assert.deepEqual(links(body), [
    "Download for macOS -> https://github.com/ReviewStage/vespin/releases/latest/download/Vespin.dmg",
    `or sign in on the web -> ${PANEL_PATH}`,
    "Download for macOS -> https://github.com/ReviewStage/vespin/releases/latest/download/Vespin.dmg",
    "View on GitHub -> https://github.com/ReviewStage/vespin",
  ]);
});

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
