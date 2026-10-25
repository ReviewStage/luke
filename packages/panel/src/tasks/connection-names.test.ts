// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_REMOTE_TOOL,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { ConnectionNames, useServerName } from "./connection-names.js";
import { toolCallView } from "./tool-call-model.js";

/**
 * connection-names.test.ts -- a call of an MCP server's tool says the server
 * by the name its card gives: "Notion · Work" where the provider holds two
 * labelled accounts, the provider's name where it holds one, and the name its
 * connection's id gives where the accounts were not read. Synthetic accounts.
 */

const roots: Root[] = [];

const NOTION = INTEGRATION_PROVIDER.NOTION;

beforeEach(() => fakeAppBridge({}));

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Where the integrations stand: Notion connected, the rest unavailable. */
function statuses(): Record<IntegrationProvider, IntegrationStatus> {
  // SAFETY: the entries are made from INTEGRATION_PROVIDER_LIST, one for every provider, which is the record's every key.
  return Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [
      provider,
      provider === NOTION ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.UNAVAILABLE,
    ]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
}

/** What the row of a call of a provider's tool on a connection says it ran on, once the accounts are read. */
async function serverSaid(
  connection: string,
  accounts: readonly { connection: string; label?: string }[],
  provider: IntegrationProvider = NOTION,
): Promise<string | undefined> {
  fakeActPort({
    [ACT_KIND.INTEGRATIONS_STATUS]: () =>
      Promise.resolve({
        integrations: statuses(),
        accounts: accounts.map((account) => ({
          provider,
          status: INTEGRATION_STATUS.CONNECTED,
          ...account,
        })),
      }),
  });
  const view = toolCallView({
    tool: INTEGRATION_REMOTE_TOOL[provider],
    input: { remoteTool: "fetch", parentCallId: "wrapper", input: {}, connection },
    output: undefined,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  function Row() {
    return createElement("span", null, useServerName(view));
  }
  await act(async () => {
    root.render(createElement(ConnectionNames, { needed: true, children: createElement(Row) }));
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container.textContent ?? undefined;
}

test("a call on one of two labelled accounts says the account's name as its card does", async () => {
  const accounts = [
    { connection: "notion", label: "Personal" },
    { connection: "notion-2", label: "Work" },
  ];
  assert.equal(await serverSaid("notion-2", accounts), "Notion · Work");
  assert.equal(await serverSaid("notion", accounts), "Notion · Personal");
});

test("a call on a provider's only account says the provider, and one the accounts do not hold says what its id gives", async () => {
  assert.equal(await serverSaid("notion", [{ connection: "notion", label: "Personal" }]), "Notion");
  assert.equal(await serverSaid("notion-2", []), "Notion 2");
});

test("a call on a bare linear connection says Linear, since a workspace's own Linear runs under it, while a later account says its name", async () => {
  const accounts = [
    { connection: "linear", label: "Home" },
    { connection: "linear-2", label: "Side" },
  ];
  const linear = INTEGRATION_PROVIDER.LINEAR;
  assert.equal(await serverSaid("linear", accounts, linear), "Linear");
  assert.equal(await serverSaid("linear-2", accounts, linear), "Linear · Side");
});
