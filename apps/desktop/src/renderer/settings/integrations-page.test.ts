// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INTEGRATION_CALL_FAILURE } from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { IntegrationsSection } from "./integrations-page";

/**
 * Settings › Integrations over a bridge answering where every provider
 * stands as the service would: a provider the deployment offers the
 * account has a row, and one it does not, which the service answers as
 * unavailable, has none; an account offered none is told so, and a read
 * that fails still offers to read again.
 */

/** The providers the deployment does not offer the account, which the service answers as unavailable; every other one is disconnected. */
let withheld: readonly IntegrationProvider[] = [];
/** Whether the next read of where they stand fails. */
let refuseRead = false;

const roots: Root[] = [];

/** Where every provider stands at the service. */
function serviceStatuses(): Record<IntegrationProvider, IntegrationStatus> {
  // SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
  return Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [
      provider,
      withheld.includes(provider)
        ? INTEGRATION_STATUS.UNAVAILABLE
        : INTEGRATION_STATUS.DISCONNECTED,
    ]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
}

beforeEach(() => {
  withheld = [];
  refuseRead = false;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind !== ACT_KIND.INTEGRATIONS_STATUS
            ? { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }
            : refuseRead
              ? {
                  status: ACT_OUTCOME_STATUS.DONE,
                  value: { failure: INTEGRATION_CALL_FAILURE.UNANSWERED },
                }
              : { status: ACT_OUTCOME_STATUS.DONE, value: { integrations: serviceStatuses() } },
        ),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The signed-in page once where every provider stands has been read. */
async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(IntegrationsSection, { signedIn: true })));
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

/** The providers the page draws a row for, by name. */
function rowNames(page: HTMLElement): (string | undefined)[] {
  return [...page.querySelectorAll(".settings-copy strong")].map((name) => name.textContent);
}

test("a provider the deployment does not offer the account has no row, and every one it offers has its Connect", async () => {
  withheld = [INTEGRATION_PROVIDER.SLACK];
  const page = await mount();

  assert.deepEqual(rowNames(page), [
    "Granola",
    "Linear",
    "Mercury",
    "Neon",
    "Notion",
    "PostHog",
    "Sentry",
    "Supabase",
    "Vercel",
    "Y Combinator",
  ]);
  assert.equal(
    [...page.querySelectorAll("button")].filter((button) => button.textContent === "Connect")
      .length,
    10,
  );
});

test("an account offered no provider is told so, with no row", async () => {
  withheld = INTEGRATION_PROVIDER_LIST;
  const page = await mount();

  assert.deepEqual(rowNames(page), []);
  assert.match(page.textContent ?? "", /No integrations are available for this account\./u);
});

test("a read that fails after one that offered nothing still says so and offers to read again", async () => {
  withheld = INTEGRATION_PROVIDER_LIST;
  const page = await mount();
  refuseRead = true;
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });

  assert.match(page.textContent ?? "", /Your integrations could not be read\./u);
  assert.ok(
    [...page.querySelectorAll("button")].some((button) => button.textContent === "Retry"),
    "Retry is offered",
  );
});
