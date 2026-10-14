// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
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
import type { IntegrationTool, IntegrationToolIndex } from "../integration-health";
import { SIGN_IN_GRACE, SIGN_IN_WAIT } from "../integration-sign-in";
import { OpenSettingsProvider } from "../open-settings";
import { rendererRuntime } from "../renderer-runtime";
import type { SettingsLink } from "../settings-views";
import { type IntegrationsSearch, IntegrationsSection } from "./integrations-page";

/**
 * Settings › Integrations over a bridge answering where every provider
 * stands as the service would: a provider the deployment offers the
 * account has a row, and one it does not, which the service answers as
 * unavailable, has none; an account offered none is told so, and a read
 * that fails still offers to read again. A row's button is for a problem
 * alone: a connection that works stands quiet, keeping Reconnect in its ⋯
 * beside Disconnect, and one expired or refused shows Reconnect on the row.
 * GitHub, which the account's own GitHub grants, says what it is for, is
 * connected in place through the account's GitHub connect, stands among the
 * rows by its name, and once connected keeps the same ⋯ as the rest, its
 * Disconnect the account's own GitHub disconnect. A Connect stands its
 * provider pending at the service until the bridge settles it, as the
 * browser would, or a Cancel ends it. A connected
 * provider's server lists the tools the bridge holds for it, which its row
 * opens onto in place, and which the page's search finds.
 */

/** The providers the deployment does not offer the account, which the service answers as unavailable; every other one is disconnected. */
let withheld: readonly IntegrationProvider[] = [];
/** Whether the next read of where they stand fails. */
let refuseRead = false;
/** Whether the account's own GitHub is connected, which is where GitHub stands. */
let githubConnected = false;
/** Whether the account's GitHub disconnect is refused, its refusal the window's toast rather than the page's. */
let refuseGitHubDisconnect = false;
/** Where a provider stands where it is not disconnected, GitHub's own aside. */
const standing = new Map<IntegrationProvider, IntegrationStatus>();
/** What a provider's server answered when asked for its tools, over the tools it lists. */
const toolReads = new Map<IntegrationProvider, IntegrationToolsView>();
/** Every act the page sent, in order. */
let sent: Act[] = [];
/** Every Settings link the page's presses followed. */
let links: SettingsLink[] = [];
/** How many times the account's GitHub connect was begun. */
let githubConnects = 0;
/** How many times the account's GitHub disconnect was asked. */
let githubDisconnects = 0;
/** Whether another window begins the sign-in again while the next Cancel is out, so the Cancel finds it pending. */
let reopenedDuringCancel = false;
/** Where the service stands a provider a Connect or a Cancel has touched, over where it would otherwise. */
const touched = new Map<IntegrationProvider, IntegrationStatus>();
/** The tools each provider's server lists; one absent here is never answered. */
const listed = new Map<IntegrationProvider, readonly IntegrationTool[]>();

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
            : (standing.get(provider) ?? INTEGRATION_STATUS.DISCONNECTED)),
    ]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
}

beforeEach(() => {
  withheld = [];
  refuseRead = false;
  githubConnected = false;
  refuseGitHubDisconnect = false;
  standing.clear();
  toolReads.clear();
  sent = [];
  links = [];
  githubConnects = 0;
  githubDisconnects = 0;
  touched.clear();
  listed.clear();
  reopenedDuringCancel = false;
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
    // A Cancel ends a sign-in still pending; one that finished first stays connected.
    case ACT_KIND.INTEGRATIONS_CANCEL: {
      const provider = request.payload.provider;
      if (touched.get(provider) === INTEGRATION_STATUS.PENDING && !reopenedDuringCancel) {
        touched.set(provider, INTEGRATION_STATUS.DISCONNECTED);
      }
      return { status: DONE, value: { status: serviceStatuses()[provider] } };
    }
    // A server whose tools the test holds none of is one the service never asked, as before tools were drawn.
    case ACT_KIND.INTEGRATIONS_TOOLS: {
      const read = toolReads.get(request.payload.provider);
      if (read !== undefined) return { status: DONE, value: read };
      const tools = listed.get(request.payload.provider);
      return tools === undefined
        ? { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }
        : { status: DONE, value: { tools } };
    }
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
async function mount(
  registry?: AtomRegistry.AtomRegistry,
  search?: IntegrationsSearch,
): Promise<HTMLElement> {
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
          disconnect: () => {
            githubDisconnects += 1;
            if (!refuseGitHubDisconnect) githubConnected = false;
            return Promise.resolve(!refuseGitHubDisconnect);
          },
        },
      },
      createElement(IntegrationsSection, { signedIn: true, search }),
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

/** The words of the buttons standing on a row, its ⋯ and its tools' toggle aside. */
function rowButtons(row: Element): (string | null)[] {
  return [...row.querySelectorAll("button")]
    .filter((button) => !button.hasAttribute("aria-expanded"))
    .map((button) => button.textContent);
}

/** What a row's ⋯ offers, and the line it stands under. */
interface MenuRead {
  readonly items: readonly (string | null)[];
  readonly heading: string | undefined;
}

/** A row's ⋯ opened and closed again; nothing where it draws no ⋯. */
function menuOf(row: Element): MenuRead {
  const ellipsis = row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  if (ellipsis === null) return { items: [], heading: undefined } satisfies MenuRead;
  act(() => ellipsis.click());
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
  const heading = document.querySelector(".plan-menu-heading")?.textContent ?? undefined;
  act(() => ellipsis.click());
  return { items, heading } satisfies MenuRead;
}

/** Chooses `words` in a row's ⋯, and lets what it asked settle. */
async function choose(row: Element, words: string): Promise<void> {
  const ellipsis =
    row.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ?? assert.fail("no ⋯");
  act(() => ellipsis.click());
  act(() =>
    (
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === words,
      ) ?? assert.fail(`no ${words} in the ⋯`)
    ).click(),
  );
  await settle();
}

/** Answers the confirm dialog standing with `verb`, and lets it settle; answers what the dialog then says. */
async function confirm(verb: string): Promise<string | null> {
  const dialog =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("no question");
  act(() =>
    (
      [...dialog.querySelectorAll("button")].find((button) => button.textContent === verb) ??
      assert.fail(`no ${verb} in the dialog`)
    ).click(),
  );
  await settle();
  return dialog.textContent;
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
    11,
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

test("GitHub, granted by the account's own GitHub, says it lets agents use GitHub tools as you and offers Connect, which connects it in place and waits on the browser, a disconnected read not failing it, and a Cancel ending it here alone", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  const page = await mount();
  const buttonNamed = (name: string) =>
    [...page.querySelectorAll("button")].find((button) => button.textContent === name);

  assert.equal(
    page.querySelector(".settings-copy small")?.textContent,
    "Lets agents use GitHub tools as you.",
  );
  const connect = buttonNamed("Connect") ?? assert.fail("Connect is offered");
  act(() => connect.click());
  await settle();

  assert.equal(githubConnects, 1);
  assert.deepEqual(links, [], "nothing leaves the page");
  assert.match(page.textContent ?? "", /Waiting for GitHub in your browser…/u);
  await focusWindow();
  assert.match(page.textContent ?? "", /Waiting for GitHub in your browser…/u, "still waiting");

  const cancel = buttonNamed("Cancel") ?? assert.fail("GitHub's wait offers Cancel");
  act(() => cancel.click());
  await settle();
  assert.equal(
    sent.some((request) => request.kind === ACT_KIND.INTEGRATIONS_CANCEL),
    false,
    "the service holds no GitHub sign-in to end",
  );
  assert.ok(buttonNamed("Connect"), "Connect is offered again");
});

test("GitHub connected stands quiet with the same ⋯ as every row, under a line saying it uses the GitHub sign-in", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  githubConnected = true;
  const page = await mount();
  const row = rowNamed(page, "GitHub");

  assert.deepEqual(rowButtons(row), []);
  assert.deepEqual(menuOf(row), {
    items: ["Reconnect", "Disconnect"],
    heading: "Uses your GitHub sign-in",
  });
});

test("GitHub's Disconnect is the account's GitHub disconnect, which asks first and leaves Connect, and a refusal closes the dialog with GitHub still connected", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  githubConnected = true;
  refuseGitHubDisconnect = true;
  const refusedPage = await mount();
  await choose(rowNamed(refusedPage, "GitHub"), "Disconnect");
  await confirm("Disconnect");
  const refusedDialog = document.querySelector('[role="alertdialog"]');
  const refusedButtons = rowButtons(rowNamed(refusedPage, "GitHub"));
  refuseGitHubDisconnect = false;
  const page = await mount();
  await choose(rowNamed(page, "GitHub"), "Disconnect");
  const askedBeforeConfirm = githubDisconnects;
  await confirm("Disconnect");

  assert.equal(refusedDialog, null, "the refusal is the window's toast, not the dialog's");
  assert.deepEqual(refusedButtons, [], "GitHub stands connected");
  assert.equal(askedBeforeConfirm, 1, "the second Disconnect asked before it disconnected");
  assert.equal(githubDisconnects, 2);
  assert.deepEqual(rowButtons(rowNamed(page, "GitHub")), ["Connect"]);
});

test("GitHub connected but refused by its server shows Reconnect on the row, and keeps the rest of its ⋯", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  githubConnected = true;
  toolReads.set(INTEGRATION_PROVIDER.GITHUB, {
    problem: { reason: INTEGRATION_TOOLS_PROBLEM.REFUSED },
  });
  const page = await mount();
  const row = rowNamed(page, "GitHub");

  assert.deepEqual(rowButtons(row), ["Reconnect"]);
  assert.deepEqual(menuOf(row).items, ["Disconnect"]);
});

test("a connection that works stands quiet, with Reconnect in its ⋯ beside Disconnect, and Reconnect signs in again", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.LINEAR,
  );
  standing.set(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_STATUS.CONNECTED);
  listed.set(INTEGRATION_PROVIDER.LINEAR, [{ name: "list_issues", description: "Lists issues." }]);
  const page = await mount();
  const row = rowNamed(page, "Linear");
  const line = row.querySelector(".settings-state")?.textContent;
  const buttons = rowButtons(row);
  const menu = menuOf(row);

  await choose(row, "Reconnect");

  assert.equal(line, "Connected · 1 tool");
  assert.deepEqual(buttons, []);
  assert.deepEqual(menu, { items: ["Reconnect", "Disconnect"], heading: undefined });
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.INTEGRATIONS_CONNECT)
      .map((request) => request.payload),
    [{ provider: INTEGRATION_PROVIDER.LINEAR }],
  );
});

test("a sign-in that expired, and a connection its server refused, each show Reconnect on the row", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) =>
      provider !== INTEGRATION_PROVIDER.NOTION && provider !== INTEGRATION_PROVIDER.SLACK,
  );
  standing.set(INTEGRATION_PROVIDER.NOTION, INTEGRATION_STATUS.EXPIRED);
  standing.set(INTEGRATION_PROVIDER.SLACK, INTEGRATION_STATUS.CONNECTED);
  toolReads.set(INTEGRATION_PROVIDER.SLACK, {
    problem: { reason: INTEGRATION_TOOLS_PROBLEM.REFUSED },
  });
  const page = await mount();
  const expired = rowNamed(page, "Notion");
  const refused = rowNamed(page, "Slack");

  assert.equal(expired.querySelector(".settings-state")?.textContent, "Sign-in expired.");
  assert.deepEqual(rowButtons(expired), ["Reconnect"]);
  assert.equal(refused.querySelector(".settings-state")?.textContent, "Slack refused the sign-in.");
  assert.deepEqual(rowButtons(refused), ["Reconnect"]);
  assert.deepEqual(menuOf(refused), { items: ["Disconnect"], heading: undefined });
});

test("a Connect waits on the browser with Reopen and Cancel, and a Cancel ends the sign-in at the service and leaves Connect", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");

  assert.deepEqual(granolaRow(page), WAITING);
  await pressOnGranola(page, "Cancel");
  assert.ok(
    sent.some(
      (request) =>
        request.kind === ACT_KIND.INTEGRATIONS_CANCEL && request.payload.provider === GRANOLA,
    ),
    "the sign-in is ended at the service",
  );
  assert.deepEqual(granolaRow(page), { line: undefined, buttons: ["Connect"] });
  await focusWindow();
  assert.deepEqual(granolaRow(page), { line: undefined, buttons: ["Connect"] });
});

test("a Cancel that lands after the sign-in finished leaves the provider connected", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");
  touched.set(GRANOLA, INTEGRATION_STATUS.CONNECTED);

  await pressOnGranola(page, "Cancel");
  assert.equal(granolaRow(page).line, "Connected");
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
  "a Cancel that a sign-in begun again elsewhere overtakes keeps waiting on that one, for its own whole wait",
  () =>
    Effect.gen(function* () {
      const registry = registryOn(yield* Clock.Clock);
      const page = yield* Effect.promise(() => mount(registry));
      yield* Effect.promise(() => pressOnGranola(page, "Connect"));
      yield* TestClock.adjust("2 minutes");

      reopenedDuringCancel = true;
      yield* Effect.promise(() => pressOnGranola(page, "Cancel"));
      yield* TestClock.adjust("2 minutes");
      yield* Effect.promise(settle);
      assert.deepEqual(
        granolaRow(page),
        WAITING,
        "past the first sign-in's deadline, still waiting",
      );

      yield* TestClock.adjust("1 minute");
      yield* Effect.promise(settle);
      assert.equal(granolaRow(page).line, "Sign-in didn't finish.");
    }),
);

it.effect("a sign-in begun later does not put off the deadline of one begun before it", () =>
  Effect.gen(function* () {
    const registry = registryOn(yield* Clock.Clock);
    const page = yield* Effect.promise(() => mount(registry));
    yield* Effect.promise(() => pressOnGranola(page, "Connect"));
    yield* TestClock.adjust("2 minutes");
    const linear =
      [...page.querySelectorAll(".settings-row")]
        .find((row) => row.querySelector("strong")?.textContent === "Linear")
        ?.querySelector("button") ?? assert.fail("Linear offers Connect");
    act(() => linear.click());
    yield* Effect.promise(settle);

    yield* TestClock.adjust("1 minute");
    yield* Effect.promise(settle);
    assert.deepEqual(granolaRow(page), {
      line: "Sign-in didn't finish.",
      buttons: ["Try again"],
    });
    assert.ok(
      page.textContent?.includes("Waiting for Linear in your browser…"),
      "Linear still waits its own three minutes",
    );
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

/** Vercel and Linear connected, their servers listing these tools, Vercel's annotated as a server may. */
function connectVercelAndLinear(): void {
  touched.set(INTEGRATION_PROVIDER.VERCEL, INTEGRATION_STATUS.CONNECTED);
  touched.set(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_STATUS.CONNECTED);
  listed.set(INTEGRATION_PROVIDER.VERCEL, [
    { name: "list_projects", description: "Lists projects.", annotations: { readOnlyHint: true } },
    {
      name: "delete_project",
      description: "Deletes a project.",
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    { name: "get_deployment", description: "Reads one deployment." },
  ]);
  listed.set(INTEGRATION_PROVIDER.LINEAR, [{ name: "list_issues", description: "Lists issues." }]);
}

/** The row named `name`, as the page draws it. */
function rowNamed(page: HTMLElement, name: string): Element {
  return (
    [...page.querySelectorAll(".settings-row")].find(
      (row) => row.querySelector(".settings-copy strong")?.textContent === name,
    ) ?? assert.fail(`${name} has a row`)
  );
}

/** Each tool the page shows opened: its name and its badge, where it wears one. */
function shownTools(page: HTMLElement) {
  return [...page.querySelectorAll(".integration-tools-panel .integration-tool")].map((tool) => [
    tool.querySelector(".integration-tool-id")?.textContent,
    tool.querySelector(".integration-tool-badge")?.textContent ?? undefined,
  ]);
}

test("while Settings' search holds a query, a row with tools it found opens onto just those, marked, and every row stays drawn", async () => {
  connectVercelAndLinear();
  const handed: IntegrationToolIndex[] = [];
  const page = await mount(undefined, { query: "deploy", onTools: (tools) => handed.push(tools) });

  assert.equal(rowNames(page).length, 12);
  assert.deepEqual(shownTools(page), [["get_deployment", undefined]]);
  assert.equal(page.querySelector(".integration-tools-found")?.textContent, "1 of 3 tools match");
  assert.equal(page.querySelector(".integration-tools-panel mark")?.textContent, "deploy");
  assert.deepEqual(
    [...(handed.at(-1) ?? new Map()).entries()].map(([provider, tools]) => [
      provider,
      tools.length,
    ]),
    [
      [INTEGRATION_PROVIDER.LINEAR, 1],
      [INTEGRATION_PROVIDER.VERCEL, 3],
    ],
  );
});

test("a query that finds an integration by its own name opens nothing by itself, and opened, keeps every tool", async () => {
  connectVercelAndLinear();
  const page = await mount(undefined, { query: "vercel", onTools: () => undefined });

  assert.deepEqual(shownTools(page), []);
  act(() =>
    (
      rowNamed(page, "Vercel").querySelector<HTMLButtonElement>(".integration-tools-toggle") ??
      assert.fail("Vercel's row opens onto its tools")
    ).click(),
  );
  assert.equal(shownTools(page).length, 3);
});

test("leaving the page takes its tools out of Settings' search, so a connection changed elsewhere leaves none behind", async () => {
  connectVercelAndLinear();
  const handed: IntegrationToolIndex[] = [];
  await mount(undefined, { query: "", onTools: (tools) => handed.push(tools) });
  assert.ok((handed.at(-1)?.size ?? 0) > 0);

  for (const root of roots.splice(0)) act(() => root.unmount());

  assert.equal(handed.at(-1)?.size, 0);
});

test("a row closed under one query opens again when that query comes back after another", async () => {
  connectVercelAndLinear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // Settings' query as the sidebar would change it, the page drawn under it each time.
  const searchFor = (query: string) =>
    act(() =>
      root.render(
        createElement(IntegrationsSection, {
          signedIn: true,
          search: { query, onTools: () => undefined },
        }),
      ),
    );
  searchFor("deploy");
  await settle();
  assert.deepEqual(shownTools(container), [["get_deployment", undefined]]);

  act(() =>
    (
      rowNamed(container, "Vercel").querySelector<HTMLButtonElement>(".integration-tools-toggle") ??
      assert.fail("Vercel's row closes")
    ).click(),
  );
  assert.deepEqual(shownTools(container), []);

  searchFor("logs");
  await settle();
  searchFor("deploy");
  await settle();

  assert.deepEqual(shownTools(container), [["get_deployment", undefined]]);
});

test("a tool pressed in an opened row shows the whole of what it does, one tool at a time", async () => {
  connectVercelAndLinear();
  listed.set(INTEGRATION_PROVIDER.VERCEL, [
    {
      name: "list_projects",
      description: "Lists projects.\n\nPages through every project on the team.",
    },
    { name: "get_deployment", description: "Reads one deployment." },
  ]);
  const page = await mount();
  act(() =>
    (
      rowNamed(page, "Vercel").querySelector<HTMLButtonElement>(".integration-tools-toggle") ??
      assert.fail("Vercel's row opens onto its tools")
    ).click(),
  );
  const press = (name: string) =>
    act(() =>
      (
        [...page.querySelectorAll<HTMLButtonElement>(".integration-tool-head")].find((button) =>
          button.textContent?.startsWith(name),
        ) ?? assert.fail(`${name} has its row`)
      ).click(),
    );

  // Note that in Settings a pressed tool takes the focus, as a button does, so Return and Space reach it next.
  const pressStart = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  page.querySelector(".integration-tool-head")?.dispatchEvent(pressStart);
  assert.equal(pressStart.defaultPrevented, false);

  press("list_projects");
  assert.deepEqual(
    [...page.querySelectorAll(".integration-tool-full")].map((full) => full.textContent),
    ["Lists projects.\n\nPages through every project on the team."],
  );

  press("get_deployment");
  assert.deepEqual(
    [...page.querySelectorAll(".integration-tool-full")].map((full) => full.textContent),
    ["Reads one deployment."],
  );
});

test("a query naming the integration and a tool opens the row onto that tool, as Settings' search found it", async () => {
  connectVercelAndLinear();
  const page = await mount(undefined, { query: "vercel deploy", onTools: () => undefined });

  assert.deepEqual(shownTools(page), [["get_deployment", undefined]]);
});

test("a tool with no description opens onto nothing", async () => {
  connectVercelAndLinear();
  listed.set(INTEGRATION_PROVIDER.VERCEL, [{ name: "whoami", description: "" }]);
  const page = await mount();
  act(() =>
    (
      rowNamed(page, "Vercel").querySelector<HTMLButtonElement>(".integration-tools-toggle") ??
      assert.fail("Vercel's row opens onto its tools")
    ).click(),
  );
  const head =
    page.querySelector<HTMLButtonElement>(".integration-tool-head") ?? assert.fail("whoami's row");

  act(() => head.click());

  assert.equal(page.querySelector('.integration-tool[data-open="true"]'), null);
  assert.equal(head.getAttribute("aria-expanded"), null);
});
