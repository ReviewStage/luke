// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_REMOTE_TOOL,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { holdIntegrations } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ConnectionNames, useServerName } from "./connection-names.js";
import { toolCallView } from "./tool-call-model.js";

/**
 * connection-names.test.ts -- a call of an MCP server's tool says the server
 * by the name its card gives: "Notion · Work" where the provider holds two
 * labeled accounts or one alone that carries a label, the provider's name
 * where its one account carries none, and the name its
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

/**
 * Waits for the row of a call of a provider's tool on a connection to say it
 * ran on `said`, once the accounts are read. Note that one Query client holds
 * a test's document across its mounts, so a test asks first for a name only
 * the read gives, and every later mount draws on the account from its first frame.
 */
async function serverSays(
  connection: string,
  accounts: readonly { connection: string; label?: string }[],
  said: string,
  provider: IntegrationProvider = NOTION,
): Promise<void> {
  holdIntegrations(() => ({
    rows: {
      integrations: statuses(),
      accounts: accounts.map((account) => ({
        provider,
        status: INTEGRATION_STATUS.CONNECTED,
        ...account,
      })),
    },
  }));
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
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(ConnectionNames, { needed: true, children: createElement(Row) }),
      ),
    );
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await vi.waitFor(() => assert.equal(container.textContent, said));
}

test("a call on one of two labeled accounts says the account's name as its card does", async () => {
  const accounts = [
    { connection: "notion", label: "Personal" },
    { connection: "notion-2", label: "Work" },
  ];
  await serverSays("notion-2", accounts, "Notion · Work");
  await serverSays("notion", accounts, "Notion · Personal");
});

test("a call on a provider's only account says its label where it carries one and the provider where not, and one the accounts do not hold says what its id gives", async () => {
  await serverSays("notion", [{ connection: "notion", label: "Personal" }], "Notion · Personal");
  await serverSays("notion", [{ connection: "notion" }], "Notion");
  await serverSays("notion-2", [], "Notion 2");
});

test("a call on a bare linear connection says Linear, since a workspace's own Linear runs under it, while a later account says its name", async () => {
  const accounts = [
    { connection: "linear", label: "Home" },
    { connection: "linear-2", label: "Side" },
  ];
  const linear = INTEGRATION_PROVIDER.LINEAR;
  await serverSays("linear-2", accounts, "Linear · Side", linear);
  await serverSays("linear", accounts, "Linear", linear);
});
