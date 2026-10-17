// @vitest-environment jsdom

import assert from "node:assert/strict";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { UpdatesSection } from "./updates";

/**
 * Settings › About's update row while a check runs: the press stays where
 * the keyboard can reach it, named for the check in progress, and refuses a
 * second check until the first answers; at rest it starts one.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** The About group as drawn, and how many checks its presses have asked for so far. */
interface AboutGroup {
  page: HTMLElement;
  checks: () => number;
}

/** The About group drawn over `update`. */
function about(update: UpdateSnapshot): AboutGroup {
  let checks = 0;
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  act(() =>
    root.render(
      createElement(UpdatesSection, {
        control: {
          update,
          build: { packaged: true },
          onCheck: () => {
            checks += 1;
            return Promise.resolve();
          },
          onInstall: () => undefined,
          onOpenLatest: () => undefined,
        },
      }),
    ),
  );
  return { page, checks: () => checks };
}

/** The button a reader is told is named `name`. */
function button(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
  assert.ok(found, `no button named ${name}`);
  return found;
}

test("while a check runs, its press stays focusable, says so, and asks for no second check", () => {
  const { page, checks } = about({
    status: UPDATE_STATUS.CHECKING,
    currentVersion: "0.17.0",
    installSupported: true,
  });
  const busy = button(page, "Checking for updates");

  busy.focus();
  assert.equal(document.activeElement, busy);
  assert.equal(busy.getAttribute("aria-busy"), "true");
  act(() => busy.click());
  assert.equal(checks(), 0);
});

test("at rest, Check for updates asks for a check", () => {
  const { page, checks } = about({
    status: UPDATE_STATUS.IDLE,
    currentVersion: "0.17.0",
    installSupported: true,
    upToDate: true,
  });

  act(() => button(page, "Check for updates").click());
  assert.equal(checks(), 1);
});
