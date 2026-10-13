// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "#shared/messages/acts";
import { AgentServersButton } from "./agent-servers";

/**
 * The MCP button at an agent's composer through the bridge the host answers:
 * the popover lists each server with where its connection stands, a
 * connected server's row switches it for this agent, one not connected
 * opens Settings, and a read that failed is read again. The service's
 * standing is the test's own variable, and the agent's list of servers off
 * is held as its tab holds it.
 */

/** Where the account's Linear connection stands at the service, or a read that fails. */
let standing: IntegrationStatus | "unreadable" = INTEGRATION_STATUS.CONNECTED;
/** Where every other provider's connection stands at the service. */
let others: IntegrationStatus = INTEGRATION_STATUS.UNAVAILABLE;
/** Every list of servers off the popover asked for, in order. */
let switched: (readonly IntegrationProvider[])[] = [];
/** How many times Settings was asked for. */
let settingsOpened = 0;

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the popover's read the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  if (request.kind !== ACT_KIND.INTEGRATIONS_STATUS) {
    return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
  if (standing === "unreadable") return Promise.reject(new Error("the host did not answer"));
  // SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
  const integrations = Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [provider, others]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
  return Promise.resolve(
    done({ integrations: { ...integrations, [INTEGRATION_PROVIDER.LINEAR]: standing } }),
  );
}

/** The button over a list of servers off held as the agent's tab holds it. */
function Composer({ initial }: { initial: readonly IntegrationProvider[] }): React.JSX.Element {
  const [disabled, setDisabled] = useState(initial);
  return createElement(AgentServersButton, {
    servers: {
      disabled,
      onSwitch: (next) => {
        switched.push(next);
        setDisabled(next);
      },
      onOpenSettings: () => {
        settingsOpened += 1;
      },
    },
  });
}

const roots: Root[] = [];

beforeEach(() => {
  standing = INTEGRATION_STATUS.CONNECTED;
  others = INTEGRATION_STATUS.UNAVAILABLE;
  switched = [];
  settingsOpened = 0;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { act: answer, recordSurfaceEvent: () => undefined },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

/** The composer's button mounted and pressed, its popover open once the read landed. */
async function opened(initial: readonly IntegrationProvider[] = []): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Composer, { initial })));
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="MCP servers"]');
  assert.ok(button, "the composer draws the MCP button");
  act(() => button.click());
  await settle();
  return container;
}

const popover = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[role="dialog"][aria-label="MCP servers"]');

/** Each row as it reads: the server's name, where it stands, and what its end offers. */
const allRows = (container: HTMLElement) =>
  [...(popover(container)?.querySelectorAll(".plan-compose-menu-row") ?? [])].map((row) => ({
    name: row.querySelector(".plan-compose-menu-name")?.textContent,
    state: row.querySelector(".plan-compose-menu-detail")?.textContent,
    end: row.querySelector(".plan-compose-menu-hint")?.textContent ?? null,
    on: row.getAttribute("role") === "switch" ? row.getAttribute("aria-checked") : null,
  }));

/** Linear's row as it reads, the one whose connection each test moves. */
const rows = (container: HTMLElement) => allRows(container).filter((row) => row.name === "Linear");

function rowNamed(container: HTMLElement, name: string): HTMLElement {
  const row = [
    ...(popover(container)?.querySelectorAll<HTMLElement>(".plan-compose-menu-row") ?? []),
  ].find((each) => each.querySelector(".plan-compose-menu-name")?.textContent === name);
  return row ?? assert.fail(`no ${name} row`);
}

test("a connected server is listed on, and its row switches it off for this agent and on again", async () => {
  const container = await opened();
  assert.deepEqual(rows(container), [
    { name: "Linear", state: "Connected", end: null, on: "true" },
  ]);
  assert.match(popover(container)?.textContent ?? "", /Changes apply from the agent's next turn\./);

  act(() => rowNamed(container, "Linear").click());
  assert.deepEqual(switched, [[INTEGRATION_PROVIDER.LINEAR]]);
  assert.equal(rows(container)[0]?.on, "false");

  act(() => rowNamed(container, "Linear").click());
  assert.deepEqual(switched, [[INTEGRATION_PROVIDER.LINEAR], []]);
  assert.equal(rows(container)[0]?.on, "true");
});

test("every server Luke offers has a row, in the provider list's order", async () => {
  others = INTEGRATION_STATUS.DISCONNECTED;
  const container = await opened();
  assert.deepEqual(
    allRows(container).map(({ name, state }) => ({ name, state })),
    INTEGRATION_PROVIDER_LIST.map((provider) => ({
      name: INTEGRATION_NAME[provider],
      state: provider === INTEGRATION_PROVIDER.LINEAR ? "Connected" : "Not connected",
    })),
  );
});

test("a server the agent already switched off opens off", async () => {
  const container = await opened([INTEGRATION_PROVIDER.LINEAR]);
  assert.deepEqual(rows(container), [
    { name: "Linear", state: "Connected", end: null, on: "false" },
  ]);
});

test("a server not connected, or whose sign-in expired, has no switch and opens Settings, closing the popover", async () => {
  for (const [status, state] of [
    [INTEGRATION_STATUS.DISCONNECTED, "Not connected"],
    [INTEGRATION_STATUS.PENDING, "Not connected"],
    [INTEGRATION_STATUS.EXPIRED, "Sign-in expired"],
  ] as const) {
    standing = status;
    settingsOpened = 0;
    const container = await opened();
    assert.deepEqual(rows(container), [
      { name: "Linear", state, end: "Connect in Settings", on: null },
    ]);
    act(() => rowNamed(container, "Linear").click());
    assert.equal(settingsOpened, 1);
    assert.equal(popover(container), null);
    assert.deepEqual(switched, []);
  }
});

test("a server this deployment does not offer is listed as not available, with nothing to press", async () => {
  standing = INTEGRATION_STATUS.UNAVAILABLE;
  const container = await opened();
  assert.deepEqual(rows(container), [
    { name: "Linear", state: "Not available", end: null, on: null },
  ]);
  assert.equal(rowNamed(container, "Linear").tagName, "DIV");
});

test("a read that failed is an error on the row, and Try again reads again", async () => {
  standing = "unreadable";
  const container = await opened();
  assert.deepEqual(rows(container), [
    { name: "Linear", state: "Error", end: "Try again", on: null },
  ]);

  standing = INTEGRATION_STATUS.CONNECTED;
  act(() => rowNamed(container, "Linear").click());
  await settle();
  assert.deepEqual(rows(container), [
    { name: "Linear", state: "Connected", end: null, on: "true" },
  ]);
});

test("Escape closes the popover and hands focus back to the button", async () => {
  const container = await opened();
  const box = popover(container);
  assert.ok(box);
  assert.equal(document.activeElement, box);
  act(() => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(popover(container), null);
  assert.equal(document.activeElement, container.querySelector('button[aria-label="MCP servers"]'));
});
