// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_CALL_FAILURE } from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { onRegistry } from "#testing/copy-feedback";
import { GitHubConnectProvider } from "../github-connect";
import { SIGN_IN_GRACE, SIGN_IN_WAIT } from "../integration-sign-in";
import { OpenSettingsProvider } from "../open-settings";
import { rendererRuntime } from "../renderer-runtime";
import type { SettingsLink } from "../settings-views";
import { IntegrationsSection } from "./integrations-page";

/**
 * Settings › Integrations over a bridge answering where every provider
 * stands as the service would: a provider the deployment offers the
 * account has a row, and one it does not, which the service answers as
 * unavailable, has none; an account offered none is told so, and a read
 * that fails still offers to read again. GitHub, which the account's own
 * GitHub grants, is connected in place through the account's GitHub connect.
 * A Connect stands its provider pending at the service until the bridge
 * settles it, as the browser would, or a Cancel ends it.
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
/** Where the service stands a provider a Connect or a Cancel has touched, over where it would otherwise. */
const touched = new Map<IntegrationProvider, IntegrationStatus>();

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

const GRANOLA = INTEGRATION_PROVIDER.GRANOLA;

/** Where every provider stands at the service. */
function serviceStatuses(): Record<IntegrationProvider, IntegrationStatus> {
  // SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
  return Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [
      provider,
      touched.get(provider) ??
        (withheld.includes(provider)
          ? INTEGRATION_STATUS.UNAVAILABLE
          : provider === INTEGRATION_PROVIDER.GITHUB && githubConnected
            ? INTEGRATION_STATUS.CONNECTED
            : INTEGRATION_STATUS.DISCONNECTED),
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
  touched.clear();
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        sent.push(request);
        return Promise.resolve(answerOf(request));
      },
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
});

/** What the service answers an act the page sends, where the bridge answers it at all. */
function answerOf(request: Act): ActOutcome {
  const DONE = ACT_OUTCOME_STATUS.DONE;
  switch (request.kind) {
    case ACT_KIND.INTEGRATIONS_STATUS:
      return refuseRead
        ? { status: DONE, value: { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } }
        : { status: DONE, value: { integrations: serviceStatuses() } };
    case ACT_KIND.INTEGRATIONS_CONNECT:
      touched.set(request.payload.provider, INTEGRATION_STATUS.PENDING);
      return { status: DONE, value: { opened: true } };
    case ACT_KIND.INTEGRATIONS_DISCONNECT:
      touched.set(request.payload.provider, INTEGRATION_STATUS.DISCONNECTED);
      return { status: DONE, value: { status: INTEGRATION_STATUS.DISCONNECTED } };
    default:
      return { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT };
  }
}

/** Lets every answer the bridge gave, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * The signed-in page once where every provider stands has been read, its
 * atoms under `registry` where one is given, as the window's root provides
 * its own.
 */
async function mount(registry?: AtomRegistry.AtomRegistry): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const page = createElement(
    OpenSettingsProvider,
    { value: (link: SettingsLink) => links.push(link) },
    createElement(
      GitHubConnectProvider,
      {
        value: {
          connection: { connected: githubConnected, login: null },
          connect: () => {
            githubConnects += 1;
            return Promise.resolve(true);
          },
        },
      },
      createElement(IntegrationsSection, { signedIn: true }),
    ),
  );
  act(() => root.render(registry === undefined ? page : onRegistry(registry, page)));
  await settle();
  return container;
}

/** A registry whose atoms wait on this clock, as the window's would on its own. */
function registryOn(clock: Clock.Clock): AtomRegistry.AtomRegistry {
  const registry = AtomRegistry.make({
    initialValues: [[rendererRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))]],
  });
  registries.push(registry);
  return registry;
}

/** Granola's row as the page draws it. */
function granolaRowOf(page: HTMLElement): Element {
  return (
    [...page.querySelectorAll(".settings-row")].find(
      (row) => row.querySelector(".settings-copy strong")?.textContent === "Granola",
    ) ?? assert.fail("Granola has a row")
  );
}

/** A row as the developer reads it: its line, and the labels of the buttons it offers. */
interface RowRead {
  readonly line: string | undefined;
  readonly buttons: readonly string[];
}

/** Granola's row: its line, and the labels of the buttons it offers. */
function granolaRow(page: HTMLElement): RowRead {
  const row = granolaRowOf(page);
  return {
    line: row.querySelector(".settings-state")?.textContent ?? undefined,
    buttons: [...row.querySelectorAll("button")].flatMap((button) =>
      button.textContent === "" ? [] : [button.textContent ?? ""],
    ),
  };
}

/** Presses the button on Granola's row that says `label`. */
async function pressOnGranola(page: HTMLElement, label: string): Promise<void> {
  const button =
    [...granolaRowOf(page).querySelectorAll("button")].find((each) => each.textContent === label) ??
    assert.fail(`Granola's row offers ${label}`);
  act(() => button.click());
  await settle();
}

/** The developer back in the window, which reads where every provider stands again. */
async function focusWindow(): Promise<void> {
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
}

const WAITING = { line: "Waiting for Granola in your browser…", buttons: ["Reopen", "Cancel"] };

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

test("a Connect waits on the browser with Reopen and Cancel, and a Cancel ends the sign-in at the service and leaves Connect", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");

  assert.deepEqual(granolaRow(page), WAITING);
  await pressOnGranola(page, "Cancel");
  assert.ok(
    sent.some(
      (request) =>
        request.kind === ACT_KIND.INTEGRATIONS_DISCONNECT && request.payload.provider === GRANOLA,
    ),
    "the sign-in is ended at the service",
  );
  assert.deepEqual(granolaRow(page), { line: undefined, buttons: ["Connect"] });
  await focusWindow();
  assert.deepEqual(granolaRow(page), { line: undefined, buttons: ["Connect"] });
});

test("a sign-in the browser came back from without a grant says it could not connect, and why, with Try again", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");
  await focusWindow();
  assert.deepEqual(granolaRow(page), WAITING, "still pending: still waiting");

  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  await focusWindow();
  assert.deepEqual(granolaRow(page), {
    line: "Couldn't connect to Granola: the sign-in came back without access.",
    buttons: ["Try again"],
  });

  await pressOnGranola(page, "Try again");
  assert.deepEqual(granolaRow(page), WAITING);
});

it.effect(
  "a sign-in still pending once its wait runs out says it did not finish, with Try again, and connects after all if the browser finishes it later",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      const page = yield* Effect.promise(() => mount(registry));
      yield* Effect.promise(() => pressOnGranola(page, "Connect"));

      yield* TestClock.adjust(SIGN_IN_WAIT);
      yield* Effect.promise(settle);
      assert.deepEqual(granolaRow(page), {
        line: "Sign-in didn't finish.",
        buttons: ["Try again"],
      });

      touched.set(GRANOLA, INTEGRATION_STATUS.CONNECTED);
      yield* Effect.promise(focusWindow);
      assert.equal(granolaRow(page).line, "Connected");
    }),
);

it.effect(
  "back in the window, a sign-in still pending is given a grace to land, and then said not to have finished",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      const page = yield* Effect.promise(() => mount(registry));
      yield* Effect.promise(() => pressOnGranola(page, "Connect"));
      yield* Effect.promise(focusWindow);
      assert.deepEqual(granolaRow(page), WAITING);

      yield* TestClock.adjust(SIGN_IN_GRACE);
      yield* Effect.promise(settle);
      assert.deepEqual(granolaRow(page), {
        line: "Sign-in didn't finish.",
        buttons: ["Try again"],
      });
    }),
);
