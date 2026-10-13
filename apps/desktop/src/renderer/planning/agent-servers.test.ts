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
 * the popover lists each server, a connected server's row names how many
 * tools it offers and lists them, and switches it for this agent; one not
 * connected connects it there and then; a read that failed is read again.
 * The service's standing is the test's own variable, and the agent's list of
 * servers off is held as its tab holds it.
 */

/** Where the account's Linear connection stands at the service, or a read that fails. */
let standing: IntegrationStatus | "unreadable" = INTEGRATION_STATUS.CONNECTED;
/** Where every other provider's connection stands at the service. */
let others: IntegrationStatus = INTEGRATION_STATUS.UNAVAILABLE;
/** Every list of servers off the popover asked for, in order. */
let switched: (readonly IntegrationProvider[])[] = [];
/** How many times Settings was asked for. */
let settingsOpened = 0;
/** Every act the popover sent, in order. */
let sent: Act[] = [];

/** The tools Linear's server offers. */
const LINEAR_TOOLS = [
  { name: "list_issues", description: "List issues in the workspace." },
  { name: "create_issue", description: "" },
];

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the popover's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.INTEGRATIONS_STATUS: {
      if (standing === "unreadable") return Promise.reject(new Error("the host did not answer"));
      // SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
      const integrations = Object.fromEntries(
        INTEGRATION_PROVIDER_LIST.map((provider) => [provider, others]),
      ) as Record<IntegrationProvider, IntegrationStatus>;
      return Promise.resolve(
        done({ integrations: { ...integrations, [INTEGRATION_PROVIDER.LINEAR]: standing } }),
      );
    }
    case ACT_KIND.INTEGRATIONS_TOOLS:
      return Promise.resolve(done({ tools: LINEAR_TOOLS }));
    case ACT_KIND.INTEGRATIONS_CONNECT:
      return Promise.resolve(done({ opened: true }));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
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
  sent = [];
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

/** Each row as it reads: the server's name, its count of tools, its button, and its switch. */
const allRows = (container: HTMLElement) =>
  [...(popover(container)?.querySelectorAll(".agent-servers-row") ?? [])].map((row) => ({
    name: row.querySelector(".plan-compose-menu-name")?.textContent,
    count: row.querySelector(".agent-servers-tools-count")?.textContent ?? null,
    button: row.querySelector(".agent-servers-connect")?.textContent ?? null,
    on: row.querySelector('[role="switch"]')?.getAttribute("aria-checked") ?? null,
  }));

/** Linear's row as it reads, the one whose connection each test moves. */
const rows = (container: HTMLElement) => allRows(container).filter((row) => row.name === "Linear");

function rowNamed(container: HTMLElement, name: string): HTMLElement {
  const row = [
    ...(popover(container)?.querySelectorAll<HTMLElement>(".agent-servers-row") ?? []),
  ].find((each) => each.querySelector(".plan-compose-menu-name")?.textContent === name);
  return row ?? assert.fail(`no ${name} row`);
}

function pressIn(row: HTMLElement, selector: string): void {
  const control = row.querySelector<HTMLButtonElement>(selector) ?? assert.fail(`no ${selector}`);
  act(() => control.click());
}

test("a connected server names how many tools it offers, says nothing of where it stands, and its switch turns it off for this agent and on again", async () => {
  const container = await opened();
  assert.deepEqual(rows(container), [
    { name: "Linear", count: "2 tools", button: null, on: "true" },
  ]);
  assert.doesNotMatch(popover(container)?.textContent ?? "", /Connected|Not connected/);
  assert.match(popover(container)?.textContent ?? "", /Changes apply from the agent's next turn\./);

  pressIn(rowNamed(container, "Linear"), '[role="switch"]');
  assert.deepEqual(switched, [[INTEGRATION_PROVIDER.LINEAR]]);
  assert.equal(rows(container)[0]?.on, "false");

  pressIn(rowNamed(container, "Linear"), '[role="switch"]');
  assert.deepEqual(switched, [[INTEGRATION_PROVIDER.LINEAR], []]);
  assert.equal(rows(container)[0]?.on, "true");
});

test("the count's list names each tool the server offers, with the first line of what it does", async () => {
  const container = await opened();
  const list =
    rowNamed(container, "Linear").querySelector<HTMLElement>('ul[aria-label="Linear tools"]') ??
    assert.fail("no list of tools");
  assert.deepEqual(
    [...list.querySelectorAll("li")].map((item) => item.textContent),
    ["list_issuesList issues in the workspace.", "create_issue"],
  );
  assert.deepEqual(
    sent.filter((request) => request.kind === ACT_KIND.INTEGRATIONS_TOOLS).length,
    1,
  );
});

test("every server Luke offers has a row, in the provider list's order", async () => {
  others = INTEGRATION_STATUS.DISCONNECTED;
  const container = await opened();
  assert.deepEqual(
    allRows(container).map(({ name, button }) => ({ name, button })),
    INTEGRATION_PROVIDER_LIST.map((provider) => ({
      name: INTEGRATION_NAME[provider],
      button: provider === INTEGRATION_PROVIDER.LINEAR ? null : "Connect",
    })),
  );
});

test("a server the agent already switched off opens off", async () => {
  const container = await opened([INTEGRATION_PROVIDER.LINEAR]);
  assert.equal(rows(container)[0]?.on, "false");
});

test("a server not connected is connected from its row, and becomes its switch once the sign-in settles", async () => {
  standing = INTEGRATION_STATUS.DISCONNECTED;
  const container = await opened();
  assert.deepEqual(rows(container), [{ name: "Linear", count: null, button: "Connect", on: null }]);

  pressIn(rowNamed(container, "Linear"), ".agent-servers-connect");
  await settle();
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.INTEGRATIONS_CONNECT)
      .map((request) => request.payload),
    [{ provider: INTEGRATION_PROVIDER.LINEAR }],
  );
  assert.ok(popover(container), "the popover stays open");
  assert.equal(settingsOpened, 0);

  // The sign-in completed in the browser, and the window is focused again.
  standing = INTEGRATION_STATUS.CONNECTED;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  assert.deepEqual(rows(container), [
    { name: "Linear", count: "2 tools", button: null, on: "true" },
  ]);
});

test("an expired sign-in offers to reconnect, and one under way to connect again", async () => {
  for (const [status, button] of [
    [INTEGRATION_STATUS.EXPIRED, "Reconnect"],
    [INTEGRATION_STATUS.PENDING, "Connect"],
  ] as const) {
    standing = status;
    const container = await opened();
    assert.deepEqual(rows(container), [{ name: "Linear", count: null, button, on: null }]);
  }
});

test("a server this deployment does not offer is a dimmed row with nothing to press", async () => {
  standing = INTEGRATION_STATUS.UNAVAILABLE;
  const container = await opened();
  assert.deepEqual(rows(container), [{ name: "Linear", count: null, button: null, on: null }]);
  assert.equal(rowNamed(container, "Linear").getAttribute("aria-disabled"), "true");
  assert.equal(rowNamed(container, "Linear").querySelectorAll("button").length, 0);
});

test("a read that failed offers to read again, and Try again reads again", async () => {
  standing = "unreadable";
  const container = await opened();
  assert.deepEqual(rows(container), [
    { name: "Linear", count: null, button: "Try again", on: null },
  ]);

  standing = INTEGRATION_STATUS.CONNECTED;
  pressIn(rowNamed(container, "Linear"), ".agent-servers-connect");
  await settle();
  assert.equal(rows(container)[0]?.on, "true");
});

test("Settings is one press away at the foot, and closes the popover", async () => {
  const container = await opened();
  const settings =
    popover(container)?.querySelector<HTMLButtonElement>(".agent-servers-settings") ??
    assert.fail("no way to Settings");
  act(() => settings.click());
  assert.equal(settingsOpened, 1);
  assert.equal(popover(container), null);
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
