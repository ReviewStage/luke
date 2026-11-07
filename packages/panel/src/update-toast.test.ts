// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import { UPDATE_STATUS } from "@repo/settings/update";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { rendererRegistry } from "./renderer-runtime.js";
import { fakeActPortAnswering, fakeAppBridge } from "./testing/app-bridge.js";
import { DESKTOP_CAPABILITIES, handState, stateWith } from "./testing/app-state.js";
import { onRegistry, settleQueries, startQueriesAfresh } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";
import { useReadyToast } from "./update-toast.js";

/**
 * update-toast.test.ts -- a release downloaded and waiting on its restart is
 * said in a toast that stands with Restart, which installs it, until it is
 * dismissed, after which that version is not said again. Synthetic throughout.
 */

const READY_WORDS = "Vespin 1.1.0 is ready to install";

/** Every act the toast sent, in order. */
let sent: string[] = [];
const roots: Root[] = [];

beforeEach(() => {
  sent = [];
  window.localStorage.clear();
  fakeAppBridge({});
  fakeActPortAnswering((request) => {
    sent.push(request.kind);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  rendererRegistry.reset();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function Toasts(): null {
  useReadyToast();
  return null;
}

/** The ready toast and the window's toasts, on a desktop whose updater holds 1.1.0 downloaded. */
async function mount(): Promise<void> {
  startQueriesAfresh();
  handState(
    {},
    {
      run: { ...stateWith({}, {}).run, capabilities: DESKTOP_CAPABILITIES },
      update: {
        status: UPDATE_STATUS.READY,
        currentVersion: "1.0.0",
        installSupported: true,
        latestVersion: "1.1.0",
      },
    },
  );
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(Fragment, null, createElement(Toasts), createElement(ToastHost)),
      ),
    ),
  );
  await settleQueries();
}

/** What each toast standing says, leaving out those on their way out. */
function said(): string[] {
  return [...document.querySelectorAll(".ui-toast:not([data-leaving]) .ui-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

/** The standing ready toast's button named `label`, by its words or its accessible name. */
function button(label: string): HTMLButtonElement {
  const card = document.querySelector(".ui-toast:not([data-leaving])");
  const found = [...(card?.querySelectorAll("button") ?? [])].find(
    (each) => each.textContent === label || each.getAttribute("aria-label") === label,
  );
  return found ?? assert.fail(`the ready toast offers ${label}`);
}

test("a downloaded release stands in a toast whose Restart installs it", async () => {
  await mount();
  await vi.waitFor(() => assert.deepEqual(said(), [READY_WORDS]));

  act(() => button("Restart").click());
  await vi.waitFor(() => assert.deepEqual(sent, [ACT_KIND.UPDATE_INSTALL]));
});

test("a dismissed release is not said again in a window drawn anew", async () => {
  await mount();
  await vi.waitFor(() => assert.deepEqual(said(), [READY_WORDS]));
  act(() => button("Dismiss").click());
  await vi.waitFor(() => assert.deepEqual(said(), []));

  for (const root of roots.splice(0)) act(() => root.unmount());
  await mount();
  assert.deepEqual(said(), []);
  assert.deepEqual(sent, []);
});
