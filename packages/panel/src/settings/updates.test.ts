// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type AnyAct, FAKE_ANSWER, fakeActs } from "../testing/app-bridge.js";
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
  /** How many times the release page was asked for through the update control. */
  openedLatest: () => number;
}

/**
 * The About group drawn over `initial`, beside a main process that, asked to
 * check, answers the snapshot a running check does, as the updater's does.
 */
function about(initial: UpdateSnapshot): AboutGroup {
  let asked = 0;
  let openedLatest = 0;
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
        onOpenLatest: () => {
          openedLatest += 1;
        },
      },
    });
  }
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  act(() => root.render(createElement(MainProcess)));
  return { page, asked: () => asked, openedLatest: () => openedLatest };
}

/** The button a reader is told is named `name`, or nothing while none is. */
function button(page: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
}

/** The link a reader is told is named `name`, or nothing while none is. */
function link(page: HTMLElement, name: string): HTMLAnchorElement | undefined {
  return [...page.querySelectorAll("a")].find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
}

/** Presses a link as a click does, answering whether the browser was left free to follow it. */
function pressed(target: HTMLAnchorElement | undefined): boolean {
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    target?.dispatchEvent(click);
  });
  return !click.defaultPrevented;
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

test("a check that failed reads as an alert under the row, whose Retry checks again", () => {
  const { page, asked } = about({
    status: UPDATE_STATUS.ERROR,
    currentVersion: "0.17.0",
    installSupported: true,
  });
  const alerts = page.querySelectorAll('[role="alert"]');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.textContent, "Couldn't check for updatesRetry");
  assert.equal(page.textContent?.split("Couldn't check for updates").length, 2, "said once");
  assert.equal(button(page, "Try again"), undefined, "no second button of the row's own");

  act(() => button(page, "Retry")?.click());

  assert.equal(asked(), 1);
  assert.match(page.textContent ?? "", /Checking for updates…/);
  assert.equal(page.querySelector('[role="alert"]'), null, "the failure goes once a check runs");
});

test("an install that failed reads as an alert with no Retry, beside the Download that mends it", () => {
  const { page } = about({
    status: UPDATE_STATUS.ERROR,
    currentVersion: "0.17.0",
    latestVersion: "0.18.0",
    installSupported: true,
  });

  assert.equal(page.querySelector('[role="alert"]')?.textContent, "Couldn't install 0.18.0");
  assert.equal(button(page, "Retry"), undefined);
  assert.ok(link(page, "Download"), "the browser is the way to the release");
});

test("Download is a link to the release page whose press opens it through the update act, not the browser", () => {
  const { page, openedLatest } = about({
    status: UPDATE_STATUS.ERROR,
    currentVersion: "0.17.0",
    latestVersion: "0.18.0",
    installSupported: true,
  });
  const download = link(page, "Download");
  assert.equal(
    download?.getAttribute("href"),
    "https://github.com/ReviewStage/luke/releases/latest",
  );
  assert.equal(button(page, "Download"), undefined, "no button opens the page");

  const leftFree = pressed(download);

  assert.equal(leftFree, false, "the browser does not follow the address a second time");
  assert.equal(openedLatest(), 1);
});

test("Open changelog is a link to the changelog page whose press sends the changelog act", () => {
  const sent: AnyAct[] = [];
  fakeActs({
    act: (request) => {
      sent.push(request);
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
    },
  });
  const { page } = about({
    status: UPDATE_STATUS.IDLE,
    currentVersion: "0.17.0",
    installSupported: true,
    upToDate: true,
  });
  const open = link(page, "Open changelog");
  assert.equal(open?.getAttribute("href"), "https://tryluke.dev/changelog");
  assert.equal(link(page, "Open"), undefined, "the link names the page it opens");

  const leftFree = pressed(open);

  assert.equal(leftFree, false, "the browser does not follow the address a second time");
  assert.deepEqual(sent, [{ kind: ACT_KIND.UPDATE_OPEN_CHANGELOG }]);
});
