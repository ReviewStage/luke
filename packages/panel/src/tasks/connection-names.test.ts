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

const roots: Root[] = [];

const NOTION = INTEGRATION_PROVIDER.NOTION;

beforeEach(() => fakeAppBridge({}));

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function statuses(): Record<IntegrationProvider, IntegrationStatus> {
  return Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [
      provider,
      provider === NOTION ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.UNAVAILABLE,
    ]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
}

async function serversSay(
  calls: readonly { connection: string; said: string }[],
  accounts: readonly { connection: string; label?: string }[],
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
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  function Row({ connection }: { connection: string }) {
    const view = toolCallView({
      tool: INTEGRATION_REMOTE_TOOL[provider],
      input: { remoteTool: "fetch", parentCallId: "wrapper", input: {}, connection },
      output: undefined,
    });
    return createElement("span", null, useServerName(view));
  }
  const rows = calls.map(({ connection }) => createElement(Row, { key: connection, connection }));
  await act(async () => {
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(ConnectionNames, { needed: true, children: rows }),
      ),
    );
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const said = () => [...container.querySelectorAll("span")].map((row) => row.textContent);
  await vi.waitFor(() =>
    assert.deepEqual(
      said(),
      calls.map((call) => call.said),
    ),
  );
}

test("a call on one of two labeled accounts says the account's name as its card does", async () => {
  const accounts = [
    { connection: "notion", label: "Personal" },
    { connection: "notion-2", label: "Work" },
  ];
  await serversSay([{ connection: "notion-2", said: "Notion · Work" }], accounts);
  await serversSay([{ connection: "notion", said: "Notion · Personal" }], accounts);
});

test("a call on a provider's only account says its label where it carries one and the provider where not, and one the accounts do not hold says what its id gives", async () => {
  await serversSay(
    [{ connection: "notion", said: "Notion · Personal" }],
    [{ connection: "notion", label: "Personal" }],
  );
  await serversSay([{ connection: "notion", said: "Notion" }], [{ connection: "notion" }]);
  await serversSay([{ connection: "notion-2", said: "Notion 2" }], []);
});

test("a call on a bare linear connection says Linear, since a workspace's own Linear runs under it, while a later account says its name", async () => {
  const accounts = [
    { connection: "linear", label: "Home" },
    { connection: "linear-2", label: "Side" },
  ];
  const linear = INTEGRATION_PROVIDER.LINEAR;
  await serversSay(
    [
      { connection: "linear-2", said: "Linear · Side" },
      { connection: "linear", said: "Linear" },
    ],
    accounts,
    linear,
  );
});
