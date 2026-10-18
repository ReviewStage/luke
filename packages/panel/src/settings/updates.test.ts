// @vitest-environment jsdom

import assert from "node:assert/strict";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { UpdatesSection } from "./updates.js";

/**
 * Settings › About's update row as a check runs: a press at rest starts one,
 * and the row says so and turns its press busy; while busy, the press stays
 * where the keyboard can reach it, named for the check in progress, and asks
 * the main process for no second check until the first answers.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** The About group as drawn, and the checks the main process was asked for so far. */
interface AboutGroup {
  page: HTMLElement;
  asked: () => number;
}

/**
 * The About group drawn over `initial`, beside a main process that, asked to
 * check, answers the snapshot a running check does, as the updater's does.
 */
function about(initial: UpdateSnapshot): AboutGroup {
  let asked = 0;
  function MainProcess(): React.JSX.Element {
    const [update, setUpdate] = useState<UpdateSnapshot>(initial);
    return createElement(UpdatesSection, {
      offered: true,
      control: {
        update,
        build: { packaged: true },
        onCheck: () => {
          asked += 1;
          setUpdate({
            status: UPDATE_STATUS.CHECKING,
            currentVersion: update.currentVersion,
            installSupported: update.installSupported,
          });
          return Promise.resolve();
        },
        onInstall: () => undefined,
        onOpenLatest: () => undefined,
      },
    });
  }
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  act(() => root.render(createElement(MainProcess)));
  return { page, asked: () => asked };
}

/** The button a reader is told is named `name`, or nothing while none is. */
function button(page: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
}

test("at rest, Check for updates starts a check the row then shows running", () => {
  const { page } = about({
    status: UPDATE_STATUS.IDLE,
    currentVersion: "0.17.0",
    installSupported: true,
    upToDate: true,
  });
  assert.match(page.textContent ?? "", /Up to date/);

  act(() => button(page, "Check for updates")?.click());

  assert.match(page.textContent ?? "", /Checking for updates…/);
  assert.equal(button(page, "Check for updates"), undefined);
  assert.equal(button(page, "Checking for updates")?.getAttribute("aria-busy"), "true");
});

test("while a check runs, its press stays focusable, says so, and asks for no second check", () => {
  const { page, asked } = about({
    status: UPDATE_STATUS.CHECKING,
    currentVersion: "0.17.0",
    installSupported: true,
  });
  const busy = button(page, "Checking for updates");
  assert.ok(busy, "no button named Checking for updates");

  busy.focus();
  assert.equal(document.activeElement, busy);
  assert.equal(busy.getAttribute("aria-busy"), "true");
  act(() => busy.click());
  assert.equal(asked(), 0);
});

test("a check that failed is said in the row's announced line, not among its details", () => {
  const { page } = about({
    status: UPDATE_STATUS.ERROR,
    currentVersion: "0.17.0",
    installSupported: true,
  });
  const announced = page.querySelector('[aria-live="polite"]');
  assert.equal(announced?.textContent, "Couldn't check for updates");
  assert.equal(page.textContent?.split("Couldn't check for updates").length, 2, "said once");
});
