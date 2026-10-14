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
import { GitHubConnectProvider } from "../github-connect";
import { OpenSettingsProvider } from "../open-settings";
import type { SettingsLink } from "../settings-views";
import { IntegrationsSection } from "./integrations-page";

/**
 * Settings › Integrations over a bridge answering where every provider
 * stands as the service would: a provider the deployment offers the
 * account has a row, and one it does not, which the service answers as
 * unavailable, has none; an account offered none is told so, and a read
 * that fails still offers to read again. GitHub, which the account's own
 * GitHub grants, is connected in place through the account's GitHub connect.
 */

/** The providers the deployment does not offer the account, which the service answers as unavailable; every other one is disconnected. */
let withheld: readonly IntegrationProvider[] = [];
/** Whether the next read of where they stand fails. */
let refuseRead = false;
/** Whether the account's own GitHub is connected, which is where GitHub stands. */
let githubConnected = false;
/** Every act the page sent, in order. */
let sent: Act[] = [];
/** Every Settings link the page's presses followed. */
let links: SettingsLink[] = [];
/** How many times the account's GitHub connect was begun. */
let githubConnects = 0;

const roots: Root[] = [];

/** Where every provider stands at the service. */
function serviceStatuses(): Record<IntegrationProvider, IntegrationStatus> {
  // SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
  return Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [
      provider,
      withheld.includes(provider)
        ? INTEGRATION_STATUS.UNAVAILABLE
        : provider === INTEGRATION_PROVIDER.GITHUB && githubConnected
          ? INTEGRATION_STATUS.CONNECTED
          : INTEGRATION_STATUS.DISCONNECTED,
    ]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
}

beforeEach(() => {
  withheld = [];
  refuseRead = false;
  githubConnected = false;
  sent = [];
  links = [];
  githubConnects = 0;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        sent.push(request);
        return Promise.resolve(
          request.kind !== ACT_KIND.INTEGRATIONS_STATUS
            ? { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }
            : refuseRead
              ? {
                  status: ACT_OUTCOME_STATUS.DONE,
                  value: { failure: INTEGRATION_CALL_FAILURE.UNANSWERED },
                }
              : { status: ACT_OUTCOME_STATUS.DONE, value: { integrations: serviceStatuses() } },
        );
      },
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
  act(() =>
    root.render(
      createElement(
        OpenSettingsProvider,
        { value: (link: SettingsLink) => links.push(link) },
        createElement(
          GitHubConnectProvider,
          {
            value: {
              connection: { connected: githubConnected, login: null },
              connect: () => {
                githubConnects += 1;
              },
            },
          },
          createElement(IntegrationsSection, { signedIn: true }),
        ),
      ),
    ),
  );
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
    "GitHub",
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

test("GitHub, granted by the account's own GitHub, offers Connect GitHub, which connects it in place and stands pending", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  const page = await mount();
  const buttonNamed = (name: string) =>
    [...page.querySelectorAll("button")].find((button) => button.textContent === name);

  const connect = buttonNamed("Connect GitHub") ?? assert.fail("Connect GitHub is offered");
  assert.equal(buttonNamed("Connect"), undefined);
  await act(async () => {
    connect.click();
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });

  assert.equal(githubConnects, 1);
  assert.deepEqual(links, [], "nothing leaves the page");
  assert.match(page.textContent ?? "", /Finish signing in to GitHub in your browser\./u);
});

test("GitHub connected stands connected with no Disconnect, whose way out is Settings › Connected accounts", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  githubConnected = true;
  const page = await mount();

  assert.equal(
    [...page.querySelectorAll("button")].some((button) => button.textContent === "Connect GitHub"),
    false,
  );
  assert.equal(page.querySelector('[aria-label="GitHub actions"]'), null);
});
