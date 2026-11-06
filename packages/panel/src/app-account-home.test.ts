// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@repo/features/models-wire";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
} from "@repo/features/provider-key-wire";
import { TASKS_READ } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import { type AppBridge, bridgeEntries } from "@repo/host/bridge";
import { PUSH_METHOD } from "@repo/host/contract";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "./app-commands.js";
import "./desktop/desktop-settings.js";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { deliveryOf, signedInAs } from "./testing/app-state.js";
import { onRegistry, writeHandedAppState } from "./testing/copy-feedback.js";
import { windowRouter } from "./testing/window-router.js";

const REQUIRED = { accountRequired: true } as const;

function signedIn(account: { id: string; email: string; name: string }): AppStateSnapshot {
  const snapshot = signedInAs(account);
  return { ...snapshot, run: { ...snapshot.run, ...REQUIRED } };
}

const ADA = signedIn({ id: "account-ada", email: "ada@example.com", name: "Ada" });
const GRACE = signedIn({ id: "account-grace", email: "grace@example.com", name: "Grace" });

const TEAM: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const OPUS: CatalogModel = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "high"],
};

const AT = Date.UTC(2026, 10, 6, 12);

const ANTHROPIC_KEY: ProviderKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  hint: "…wxyz",
  status: PROVIDER_KEY_STATUS.VERIFIED,
  addedAt: AT,
  statusAt: AT,
};

function graceInvited(connected: boolean): AppStateSnapshot {
  return {
    ...GRACE,
    tasks: {
      tasks: [],
      listStatus: TASKS_READ.READY,
      workspaces: [TEAM],
      workspacesStatus: TASKS_READ.READY,
    },
    [LIVE_READ.MODELS]: {
      "account-grace": {
        rows: { models: [connected ? OPUS : { ...OPUS, credentialMissing: true }] },
      },
    },
    [LIVE_READ.PROVIDER_KEYS]: {
      "account-grace": { rows: { keys: connected ? [ANTHROPIC_KEY] : [] } },
    },
  };
}

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

async function deliver(snapshot: AppStateSnapshot, version: number): Promise<void> {
  act(() => {
    for (const listener of listeners) listener(structuredClone({ ...snapshot, version }));
  });
  await settle();
}

function finishStands(): boolean {
  return [...document.querySelectorAll("button")].some(
    (each) => each.textContent?.trim() === "Finish",
  );
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (each) => each.textContent?.trim() === name,
  );
  assert.ok(found, `${name} stands`);
  return found;
}

test("signed out from Settings, a fresh account that finishes setup lands on Home", async () => {
  const graceMidway: AppStateSnapshot = {
    ...GRACE,
    settings: appSettingsWire(settingsView({ setupPlace: '{"audience":"me","at":3}' })),
  };
  await writeHandedAppState();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(onRegistry(AtomRegistry.make(), windowRouter().drawn())));
  await settle();
  act(() => runAppCommand(APP_COMMAND.SETTINGS));
  await settle();
  assert.ok(document.querySelector(".desktop-settings"), "Settings stands");

  await deliver({ ...ADA, account: { status: ACCOUNT_STATUS.SIGNED_OUT } }, 2);
  await vi.waitFor(() =>
    assert.equal(document.querySelector(".desktop-onboarding") !== null, true),
  );
  await deliver(graceMidway, 3);
  await vi.waitFor(() => assert.equal(finishStands(), true));
  act(() => button("Finish").click());

  assert.equal(document.querySelector(".desktop-settings") === null, true, "Settings is gone");
  assert.ok(document.querySelector(".home-composer"), "Home stands");
});

test("an account a team invited stays in setup once it connects an agent, until Finish lets it in", async () => {
  await writeHandedAppState();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(onRegistry(AtomRegistry.make(), windowRouter().drawn())));
  await settle();
  await deliver({ ...ADA, account: { status: ACCOUNT_STATUS.SIGNED_OUT } }, 2);
  await deliver(graceInvited(false), 3);
  await vi.waitFor(() => assert.equal(finishStands(), true));
  assert.equal(button("Finish").disabled, true, "Finish waits on an agent");

  await deliver(graceInvited(true), 4);
  await vi.waitFor(() => assert.equal(button("Finish").disabled, false));
  assert.ok(document.querySelector(".desktop-onboarding"), "setup stands");
  assert.equal(document.querySelector(".home-composer"), null, "Home waits on Finish");

  act(() => button("Finish").click());
  assert.ok(document.querySelector(".home-composer"), "Home stands");
});
