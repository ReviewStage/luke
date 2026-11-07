// @vitest-environment jsdom
import { MARK_PROVIDER } from "@repo/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { type AdminDoors, AdminDoorsProvider } from "./admin-doors.js";
import { ExternalLink } from "./chrome/external-links.js";

/**
 * admin-external-links.test.ts -- a link to a page outside the dashboard
 * opens through the mount's own opener where it hands one, as the app does,
 * whose window opens no browser tab, and is the browser's to follow on the
 * web page, which hands none.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const GITHUB_ACCOUNT = "https://github.com/acme";

/** A mount's doors, opening a page outside the dashboard through `openLink` where given; the link reads nothing else of them. */
function doors(openLink: ((href: string) => void) | undefined): AdminDoors {
  return {
    // SAFETY: the link reads no read, no gate, and no address, only the opener.
    reads: {} as AdminDoors["reads"],
    // SAFETY: as above.
    gate: {} as AdminDoors["gate"],
    // SAFETY: as above.
    address: {} as AdminDoors["address"],
    ...(openLink === undefined ? {} : { openLink }),
  };
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** Presses the link to GitHub drawn under `mounted`, answering whether the browser was left to follow it. */
function press(mounted: AdminDoors): boolean {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        AdminDoorsProvider,
        { value: mounted },
        createElement(ExternalLink, {
          place: { provider: MARK_PROVIDER.GITHUB, label: "acme", href: GITHUB_ACCOUNT },
        }),
      ),
    ),
  );
  let followed = true;
  // Note that jsdom cannot follow a link, so the page stops it once the press has bubbled past the link.
  document.addEventListener(
    "click",
    (event) => {
      followed = !event.defaultPrevented;
      event.preventDefault();
    },
    { once: true },
  );
  act(() => container.querySelector("a")?.click());
  return followed;
}

test("a link outside the dashboard opens through the mount's opener where it hands one, and is the browser's where it hands none", () => {
  const opened: string[] = [];

  expect(press(doors((href) => opened.push(href)))).toBe(false);
  expect(opened).toEqual([GITHUB_ACCOUNT]);

  act(() => root?.unmount());
  expect(press(doors(undefined))).toBe(true);
});
