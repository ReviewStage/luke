// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { useExpiredServerToasts } from "./expired-server-toasts.js";
import { fakeActPort, fakeAppBridge } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { holdIntegrations, type IntegrationsHeld } from "./testing/app-state.js";
import { withQueryClient } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";

/**
 * expired-server-toasts.test.ts -- each MCP server whose sign-in expired is
 * said in a toast of its own with Reconnect, which begins its sign-in, says
 * the reconnect while it is under way, and leaves once the server is
 * connected again, the others standing; a reconnect that could not begin
 * says so with Retry. Synthetic throughout.
 */

/** Where each offered provider stands at the service; every other is not offered. */
let standing: Partial<Record<IntegrationProvider, IntegrationStatus>> = {};
/** Whether the next Connect is refused, as a service that does not answer refuses it. */
let refuseConnect = false;
/** Every provider a Connect was asked for, in order. */
let connects: IntegrationProvider[] = [];
let integrations: IntegrationsHeld;
let root: Root | undefined;

// SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
const UNAVAILABLE = Object.fromEntries(
  INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.UNAVAILABLE]),
) as Record<IntegrationProvider, IntegrationStatus>;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  connects = [];
  refuseConnect = false;
  // A Connect stands its provider pending at the service, answering once the host's read carries it.
  fakeActPort({
    [ACT_KIND.INTEGRATIONS_CONNECT]: (payload) => {
      connects.push(payload.provider);
      if (refuseConnect) return Promise.reject(new Error("Not now."));
      standing = { ...standing, [payload.provider]: INTEGRATION_STATUS.PENDING };
      integrations.lay();
      return Promise.resolve({ opened: true });
    },
  });
  fakeAppBridge({});
  integrations = holdIntegrations(() => ({
    rows: { integrations: { ...UNAVAILABLE, ...standing } },
  }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

function Toasts(): null {
  useExpiredServerToasts();
  return null;
}

/** The toasts, mounted as the window's root mounts them. */
async function mount(): Promise<void> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      withQueryClient(
        createElement(Fragment, null, createElement(Toasts), createElement(ToastHost)),
      ),
    ),
  );
  await settle();
}

/** What each toast standing says, oldest first, leaving out those on their way out. */
function said(): string[] {
  return [...document.querySelectorAll(".ui-toast:not([data-leaving]) .ui-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

/** Presses `label` on the standing toast that says `words`. */
async function press(words: string, label: string): Promise<void> {
  const offered = () => {
    const card = [...document.querySelectorAll(".ui-toast:not([data-leaving])")].find(
      (each) => each.querySelector(".ui-toast-words")?.textContent === words,
    );
    return [...(card?.querySelectorAll("button") ?? [])].find((each) => each.textContent === label);
  };
  await vi.waitFor(() => assert.equal(offered() !== undefined, true));
  const button = offered() ?? assert.fail(`"${words}" offers ${label}`);
  act(() => button.click());
  await settle();
}

test("each expired server stands in a toast of its own until its Reconnect has it connected again", async () => {
  standing = {
    [INTEGRATION_PROVIDER.SLACK]: INTEGRATION_STATUS.EXPIRED,
    [INTEGRATION_PROVIDER.LINEAR]: INTEGRATION_STATUS.EXPIRED,
    [INTEGRATION_PROVIDER.NOTION]: INTEGRATION_STATUS.CONNECTED,
  };
  await mount();
  await vi.waitFor(() =>
    assert.deepEqual(said().toSorted(), ["Linear's sign-in expired", "Slack's sign-in expired"]),
  );

  await press("Slack's sign-in expired", "Reconnect");
  assert.deepEqual(connects, [INTEGRATION_PROVIDER.SLACK]);
  assert.deepEqual(said().toSorted(), ["Linear's sign-in expired", "Reconnecting Slack…"]);

  standing = { ...standing, [INTEGRATION_PROVIDER.SLACK]: INTEGRATION_STATUS.CONNECTED };
  act(() => integrations.lay());
  await settle();
  await vi.waitFor(() => assert.deepEqual(said(), ["Linear's sign-in expired"]));
});

test("a reconnect that could not begin says so in the server's toast, with Retry", async () => {
  standing = { [INTEGRATION_PROVIDER.SLACK]: INTEGRATION_STATUS.EXPIRED };
  refuseConnect = true;
  await mount();

  await press("Slack's sign-in expired", "Reconnect");
  assert.deepEqual(said(), ["Slack could not be reconnected."]);

  refuseConnect = false;
  await press("Slack could not be reconnected.", "Retry");
  assert.deepEqual(connects, [INTEGRATION_PROVIDER.SLACK, INTEGRATION_PROVIDER.SLACK]);
  assert.deepEqual(said(), ["Reconnecting Slack…"]);
});
