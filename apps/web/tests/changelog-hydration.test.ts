// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { test } from "vitest";
import { ChangelogPage, RELEASES } from "../src/ChangelogPage";
import { changelogRoutes, changelogViewForPath } from "../src/changelog-releases";

/* React reports a hydration mismatch as a recoverable error and quietly
   renders the client's tree instead, so a page that drew the wrong view would
   still look right; the errors are the only witness. */
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ROUTES = changelogRoutes(RELEASES);
const SAMPLES = [
  ROUTES.find((route) => route.path === "/changelog"),
  ROUTES.find((route) => route.path === "/changelog/page/2"),
  ROUTES.find((route) => route.path === `/changelog/${RELEASES[0]?.version}`),
  ROUTES.find((route) => route.path === `/changelog/${RELEASES.at(-1)?.version}`),
];

for (const route of SAMPLES) {
  test(`${route?.path} hydrates, from its own address, the page the prerender wrote`, async () => {
    assert.ok(route !== undefined);
    const root = document.createElement("div");
    root.innerHTML = renderToString(createElement(ChangelogPage, { view: route.view }));
    document.body.replaceChildren(root);
    window.history.replaceState(null, "", route.path);

    const view = changelogViewForPath(RELEASES, window.location.pathname);
    assert.ok(view !== undefined);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(root, createElement(ChangelogPage, { view }), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    assert.deepEqual(errors, []);
  });
}

test("the pager's arrows are named for where they go, not for which way they point", () => {
  const page = ROUTES.find((route) => route.path === "/changelog/page/2");
  const release = ROUTES.find((route) => route.path === `/changelog/${RELEASES[1]?.version}`);
  assert.ok(page !== undefined && release !== undefined);
  const named = (view: (typeof ROUTES)[number]["view"]) => {
    const root = document.createElement("div");
    root.innerHTML = renderToString(createElement(ChangelogPage, { view }));
    return Array.from(root.querySelectorAll("nav a[rel]")).map((link) =>
      link.getAttribute("aria-label"),
    );
  };
  assert.deepEqual(named(page.view), ["Newer page", "Older page"]);
  assert.deepEqual(named(release.view), [
    `Newer release, v${RELEASES[0]?.version}`,
    `Older release, v${RELEASES[2]?.version}`,
  ]);
});
