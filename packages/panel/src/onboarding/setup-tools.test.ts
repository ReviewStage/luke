// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { IntegrationStatusesAnswer } from "@repo/features/integration-live";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import type { AppHostRead } from "@repo/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads, holdIntegrations, holdIntegrationTools } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToolRows } from "./setup-tools.js";

/**
 * Setup's tools step over a bridge answering where every provider stands as
 * the service would: a connected account is named beside its provider, as
 * Settings › Integrations names it, so the developer sees which account
 * each tool connected, and one not connected says what it gives agents.
 */

const NOTION = INTEGRATION_PROVIDER.NOTION;

let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;

/** Where every provider stands at the service: Notion connected, every other one not. */
function heldRead(): AppHostRead<IntegrationStatusesAnswer> {
  // SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
  const integrations = Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [
      provider,
      provider === NOTION ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED,
    ]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
  return {
    rows: {
      integrations,
      accounts: [
        {
          provider: NOTION,
          connection: "notion",
          label: "Acme",
          status: INTEGRATION_STATUS.CONNECTED,
        },
      ],
    },
  };
}

beforeEach(() => {
  fakeAppBridge({});
  fakeActPort({});
  holdIntegrationTools(handHostReads({}).deliverTools, () => ({ tools: [] }));
  holdIntegrations(heldRead);
});

afterEach(() => {
  if (root !== undefined) act(() => root?.unmount());
  registry?.dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

test("a connected account is named beside its provider, and a tool not connected by its provider alone, saying what it gives agents", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const own = AtomRegistry.make();
  registry = own;
  act(() => root?.render(onRegistry(own, createElement(ToolRows))));
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });

  const names = [...container.querySelectorAll('[id$="label"]')].map((label) => {
    const beside = label.nextElementSibling;
    const account = beside?.classList.contains("ui-account-words") ? beside.textContent : "";
    return account ? `${label.textContent} · ${account}` : label.textContent;
  });
  assert.deepEqual(names, ["Linear", "Slack", "Sentry", "Notion · Acme"]);
  assert.equal(
    container
      .querySelector('[id$="label"]')
      ?.closest(".ui-settings-row")
      ?.textContent?.includes("Issues, projects, and cycles"),
    true,
  );
});
