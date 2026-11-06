// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import { type AppBridge, bridgeEntries } from "@repo/host/bridge";
import { PUSH_METHOD } from "@repo/host/contract";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { App } from "./app.js";
import { runAppCommand } from "./app-commands.js";
// Note that Settings is loaded as the window loads it, on first use
// (`pages-on-demand.ts`), so the module is read here first and its load settles
// within the test's own ticks rather than on a clock a busy machine outruns.
import "./desktop/desktop-settings.js";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { deliveryOf, signedInAs } from "./testing/app-state.js";
import { onRegistry, writeHandedAppState } from "./testing/copy-feedback.js";
import { windowRouter } from "./testing/window-router.js";

/**
 * app-account-home.test.ts -- an account leaving the window takes its place
 * with it: signed out from Settings, the next account to sign in finishes
 * setup on Home rather than on the Settings the last one left open.
 */

const REQUIRED = { accountRequired: true } as const;

/** Main's document for `account` signed in, where the window needs an account. */
function signedIn(account: { id: string; email: string; name: string }): AppStateSnapshot {
  const snapshot = signedInAs(account);
  return { ...snapshot, run: { ...snapshot.run, ...REQUIRED } };
}

const ADA = signedIn({ id: "account-ada", email: "ada@example.com", name: "Ada" });
const GRACE = signedIn({ id: "account-grace", email: "grace@example.com", name: "Grace" });

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;
let listeners = new Set<(snapshot: AppStateSnapshot) => void>();

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  listeners = new Set();
  window.localStorage.clear();
  fakeAppPlatform({ ...QUIET_PANEL, applySessionReplay: () => undefined });
  const quiet = Object.fromEntries([
    ...Object.keys(PUSH_METHOD).map((method) => [method, () => () => undefined]),
    ...bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "invoke" ? () => Promise.resolve(undefined) : () => undefined,
    ]),
  ]);
  fakeAppBridge({
    ...quiet,
    requestAppState: () => Promise.resolve(structuredClone(ADA)),
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      const listener = (snapshot: AppStateSnapshot) => heard(deliveryOf(snapshot));
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies Partial<AppBridge>);
  fakeActPortAnswering(() => Promise.reject(refusedOnPort("Not here.")));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 24; tick += 1) await Promise.resolve();
  });
}

/** Delivers `snapshot` as main would, and lets the window draw what it draws. */
async function deliver(snapshot: AppStateSnapshot, version: number): Promise<void> {
  act(() => {
    for (const listener of listeners) listener(structuredClone({ ...snapshot, version }));
  });
  await settle();
}

/** Whether setup's last step offers Finish. */
function finishStands(): boolean {
  return [...document.querySelectorAll("button")].some(
    (each) => each.textContent?.trim() === "Finish",
  );
}

/** The button drawn with `name` as its words. */
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (each) => each.textContent?.trim() === name,
  );
  assert.ok(found, `${name} stands`);
  return found;
}

test("signed out from Settings, a fresh account that finishes setup lands on Home", async () => {
  // Grace has walked setup on this machine to its last step, Connect your tools.
  window.localStorage.setItem(
    "app.setupPlace",
    JSON.stringify({ "account-grace": { audience: "me", at: 3 } }),
  );
  // Note that the document is in the client before the window draws, as the root's `ensureQueryData` leaves it.
  await writeHandedAppState();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(windowRouter().provide(onRegistry(AtomRegistry.make(), createElement(App)))),
  );
  await settle();
  act(() => runAppCommand(APP_COMMAND.SETTINGS));
  await settle();
  assert.ok(document.querySelector(".desktop-settings"), "Settings stands");

  await deliver({ ...ADA, account: { status: ACCOUNT_STATUS.SIGNED_OUT } }, 2);
  await vi.waitFor(() =>
    assert.equal(document.querySelector(".desktop-onboarding") !== null, true),
  );
  await deliver(GRACE, 3);
  await vi.waitFor(() => assert.equal(finishStands(), true));
  act(() => button("Finish").click());

  assert.equal(document.querySelector(".desktop-settings") === null, true, "Settings is gone");
  assert.ok(document.querySelector(".home-composer"), "Home stands");
});
