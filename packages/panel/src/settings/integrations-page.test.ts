// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { IntegrationTool } from "@luke/features/integration-health";
import { SIGN_IN_GRACE, SIGN_IN_WAIT } from "@luke/features/integration-sign-in";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationStatusesView,
  type IntegrationToolsView,
} from "@luke/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_SIGN_IN_FAILURE,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppStateDelivery } from "@luke/host/app-state";
import type { PortActKind, PortActPayload } from "@luke/host/contract";
import type { SettingsLink } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { SettingsPage, timeRuntime } from "@luke/ui";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { GitHubConnectProvider } from "../github-connect.js";
import { OpenSettingsProvider } from "../open-settings.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { announcedPolitely, mountAnnouncer } from "../testing/announcer.js";
import { type AnyAct, fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { deliveryOf, signedInAs } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { playListMotions } from "../testing/pane-motion.js";
import { IntegrationsSection } from "./integrations-page.js";

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
 * opens onto in place. The page's own search keeps the rows it finds under
 * Connected and Not connected, opens a row onto the tools it found, says
 * when it finds nothing, takes Command-F, and gives way to Escape.
 */

/** The providers the deployment does not offer the account, which the service answers as unavailable; every other one is disconnected. */
let withheld: readonly IntegrationProvider[] = [];
/** Whether the next read of where they stand fails. */
let refuseRead = false;
/** Whether the account's own GitHub is connected, which is where GitHub stands. */
let githubConnected = false;
/** Whether the account's GitHub disconnect is refused, its refusal the window's toast rather than the page's. */
let refuseGitHubDisconnect = false;
/** Whether a rename is refused, its refusal the row's own line. */
let refuseRename = false;
/** Where a provider stands where it is not disconnected, GitHub's own aside. */
const standing = new Map<IntegrationProvider, IntegrationStatus>();
/** What a provider's server answered when asked for its tools, over the tools it lists. */
const toolReads = new Map<IntegrationProvider, IntegrationToolsView>();
/** One call the page made on the act port, by its kind, with what it carried. */
type PortCall = {
  [Kind in PortActKind]: { readonly kind: Kind; readonly payload: PortActPayload<Kind> };
}[PortActKind];
/** Every act the page sent on the act port, in order. */
let sent: (AnyAct | PortCall)[] = [];
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
/** The sign-in failures the service's next read names, as it names each once while it ends it. */
let signInFailures: IntegrationSignInFailure[] = [];
/** The accounts the service's reads name, past a provider's own word. */
let accounts: IntegrationAccount[] = [];
/** The providers the service's reads say another account may be added at. */
let addable: IntegrationProvider[] = [];
/** The name the service gives an account added. */
let addedConnection = "notion-3";
/** Whether a statuses read waits to be let go, answering what stood when it was sent. */
let holdReads = false;
/** The statuses reads held, each let go by its own call, in the order they were sent. */
const heldReads: (() => void)[] = [];
/** Where a Cancel leaves an account the service holds by connection name, past a provider's own word. */
const cancelled = new Map<string, IntegrationStatus>();

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
  refuseRename = false;
  standing.clear();
  toolReads.clear();
  sent = [];
  links = [];
  githubConnects = 0;
  githubDisconnects = 0;
  touched.clear();
  listed.clear();
  signInFailures = [];
  addedConnection = "notion-3";
  cancelled.clear();
  holdReads = false;
  heldReads.length = 0;
  accounts = [];
  addable = [];
  reopenedDuringCancel = false;
  fakeAppBridge({});
  // What the service answers an act the page sends on the act port.
  fakeActPort({
    [ACT_KIND.INTEGRATIONS_STATUS]: () => {
      sent.push({ kind: ACT_KIND.INTEGRATIONS_STATUS, payload: undefined });
      const answer: IntegrationStatusesView = refuseRead
        ? { failure: INTEGRATION_CALL_FAILURE.UNANSWERED }
        : {
            integrations: serviceStatuses(),
            ...(accounts.length > 0 ? { accounts } : undefined),
            ...(addable.length > 0 ? { addable } : undefined),
            ...(signInFailures.length > 0
              ? { signInFailures: signInFailures.splice(0) }
              : undefined),
          };
      if (!holdReads) return Promise.resolve(answer);
      const { promise, resolve } = Promise.withResolvers<IntegrationStatusesView>();
      heldReads.push(() => resolve(answer));
      return promise;
    },
    [ACT_KIND.INTEGRATIONS_CONNECT]: (payload) => {
      sent.push({ kind: ACT_KIND.INTEGRATIONS_CONNECT, payload });
      if (payload.add === true) {
        return Promise.resolve({ opened: true, connection: addedConnection });
      }
      touched.set(payload.provider, INTEGRATION_STATUS.PENDING);
      return Promise.resolve({ opened: true });
    },
    // A Cancel ends a sign-in still pending; one that finished first stays connected.
    [ACT_KIND.INTEGRATIONS_CANCEL]: (payload) => {
      sent.push({ kind: ACT_KIND.INTEGRATIONS_CANCEL, payload });
      const { provider } = payload;
      const account = cancelled.get(payload.connection ?? provider);
      if (account !== undefined) return Promise.resolve({ status: account });
      if (touched.get(provider) === INTEGRATION_STATUS.PENDING && !reopenedDuringCancel) {
        touched.set(provider, INTEGRATION_STATUS.DISCONNECTED);
      }
      return Promise.resolve({ status: serviceStatuses()[provider] });
    },
    // A server whose tools the test holds none of is one the service never asked, as before tools were drawn.
    [ACT_KIND.INTEGRATIONS_TOOLS]: (payload) => {
      sent.push({ kind: ACT_KIND.INTEGRATIONS_TOOLS, payload });
      const read = toolReads.get(payload.provider);
      if (read !== undefined) return Promise.resolve(read);
      const tools = listed.get(payload.provider);
      return tools === undefined
        ? Promise.reject(new Error("Not in this test."))
        : Promise.resolve({ tools });
    },
    // A rename names the account anew, which the next read of the integrations says.
    [ACT_KIND.INTEGRATIONS_RENAME]: (payload) => {
      sent.push({ kind: ACT_KIND.INTEGRATIONS_RENAME, payload });
      if (refuseRename) return Promise.resolve({ failure: INTEGRATION_CALL_FAILURE.UNANSWERED });
      const { connection, label } = payload;
      accounts = accounts.map((account) =>
        account.connection === connection ? { ...account, label } : account,
      );
      const renamed =
        accounts.find((account) => account.connection === connection) ?? assert.fail("no account");
      return Promise.resolve({ account: renamed });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Lets every answer the bridge gave, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * The signed-in page once where every provider stands has been read, its
 * atoms under `registry` where one is given, else under one of its own, as
 * the window's root provides its own, and under its title in a settings page's frame where `framed`.
 */
async function mount(registry?: AtomRegistry.AtomRegistry, framed = false): Promise<HTMLElement> {
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
      framed
        ? createElement(SettingsPage, {
            title: "Integrations",
            children: createElement(IntegrationsSection, { signedIn: true }),
          })
        : createElement(IntegrationsSection, { signedIn: true }),
    ),
  );
  act(() => root.render(onRegistry(registry ?? ownRegistry(), page)));
  await settle();
  return container;
}

/** A registry of the page's own, as the window's root provides, so nothing one test's page shared reaches the next. */
function ownRegistry(): AtomRegistry.AtomRegistry {
  const registry = AtomRegistry.make();
  registries.push(registry);
  return registry;
}

/** A registry whose atoms wait on this clock, as the window's would on its own. */
function registryOn(clock: Clock.Clock): AtomRegistry.AtomRegistry {
  const registry = AtomRegistry.make({
    initialValues: [
      [rendererRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))],
      [timeRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))],
    ],
  });
  registries.push(registry);
  return registry;
}

/** Granola's row as the page draws it. */
function granolaRowOf(page: HTMLElement): Element {
  return (
    [...page.querySelectorAll(".luke-settings-row")].find(
      (row) => row.querySelector('[id$="label"]')?.textContent === "Granola",
    ) ?? assert.fail("Granola has a row")
  );
}

/** A row as the developer reads it: its lines, one under another, and the labels of the buttons it offers. */
interface RowRead {
  readonly line: string | undefined;
  readonly buttons: readonly string[];
}

/** Granola's row: its line, and the labels of the buttons it offers. */
/** A row's state lines as a reader reads them, each on its own line; none where it draws none. */
function stateLines(row: Element): string | undefined {
  const lines = [...row.querySelectorAll(".luke-settings-row-state")].map(
    (line) => line.textContent ?? "",
  );
  return lines.length === 0 ? undefined : lines.join("\n");
}

function granolaRow(page: HTMLElement): RowRead {
  const row = granolaRowOf(page);
  return {
    line: stateLines(row),
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
  return [...page.querySelectorAll('[id$="label"]')].map((name) => name.textContent);
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
  const heading = document.querySelector(".luke-menu-heading")?.textContent ?? undefined;
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
    "Executor",
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
    12,
  );
});

test("an account offered no provider is told so, with no row", async () => {
  withheld = INTEGRATION_PROVIDER_LIST;
  const page = await mount();

  assert.deepEqual(rowNames(page), []);
  assert.match(page.textContent ?? "", /No integrations available/u);
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

test("GitHub, granted by the account's own GitHub, offers Connect, which connects it in place and waits on the browser, a disconnected read not failing it, and a Cancel ending it here alone", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.GITHUB,
  );
  const page = await mount();
  const buttonNamed = (name: string) =>
    [...page.querySelectorAll("button")].find((button) => button.textContent === name);

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
  listed.set(INTEGRATION_PROVIDER.GITHUB, [{ name: "get_me", description: "Reads the account." }]);
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
  listed.set(INTEGRATION_PROVIDER.GITHUB, [{ name: "get_me", description: "Reads the account." }]);
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
  const line = row.querySelector(".luke-settings-row-state")?.textContent;
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

  assert.equal(expired.querySelector(".luke-settings-row-state")?.textContent, "Sign-in expired");
  assert.deepEqual(rowButtons(expired), ["Reconnect"]);
  assert.equal(
    refused.querySelector(".luke-settings-row-state")?.textContent,
    "Slack refused the sign-in.",
  );
  assert.deepEqual(rowButtons(refused), ["Reconnect"]);
  assert.deepEqual(menuOf(refused), { items: ["Disconnect"], heading: undefined });
});

test("a server's own error stands quoted on a plain line under our sentence, never inside it", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.SLACK,
  );
  standing.set(INTEGRATION_PROVIDER.SLACK, INTEGRATION_STATUS.CONNECTED);
  toolReads.set(INTEGRATION_PROVIDER.SLACK, {
    problem: {
      reason: INTEGRATION_TOOLS_PROBLEM.REJECTED,
      message: "App is not enabled for Slack MCP server access",
    },
  });
  const page = await mount();
  const lines = [...rowNamed(page, "Slack").querySelectorAll(".luke-settings-row-state")].map(
    (line) => [line.textContent, line.getAttribute("data-state")],
  );

  assert.deepEqual(lines, [
    ["Slack could not be reached.", "attention"],
    ["Slack said: “App is not enabled for Slack MCP server access”", "plain"],
  ]);
});

test("a connection whose tools could not be read says so in the attention tint, never Connected, and Retry reads them again", async () => {
  withheld = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => provider !== INTEGRATION_PROVIDER.LINEAR,
  );
  standing.set(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_STATUS.CONNECTED);
  toolReads.set(INTEGRATION_PROVIDER.LINEAR, { failure: INTEGRATION_CALL_FAILURE.UNANSWERED });
  const page = await mount();
  const row = rowNamed(page, "Linear");
  const state = row.querySelector(".luke-settings-row-state");

  assert.equal(state?.textContent, "The tools could not be read.");
  assert.equal(state?.getAttribute("data-state"), "attention");
  assert.deepEqual(rowButtons(row), ["Retry"]);

  toolReads.delete(INTEGRATION_PROVIDER.LINEAR);
  listed.set(INTEGRATION_PROVIDER.LINEAR, [{ name: "list_issues", description: "Lists issues." }]);
  const retry = [...row.querySelectorAll("button")].find((each) => each.textContent === "Retry");
  act(() => retry?.click());
  await settle();

  const mended = rowNamed(page, "Linear");
  assert.equal(mended.querySelector(".luke-settings-row-state")?.textContent, "Connected · 1 tool");
  assert.deepEqual(rowButtons(mended), []);
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

test("a sign-in begun on one surface is what every other surface draws at once, and so is its Cancel, with no read between", async () => {
  const registry = AtomRegistry.make();
  registries.push(registry);
  const settings = await mount(registry);
  const other = await mount(registry);
  holdReads = true;

  await pressOnGranola(settings, "Connect");
  assert.deepEqual(granolaRow(other), WAITING);
  await pressOnGranola(other, "Cancel");
  assert.deepEqual(granolaRow(settings), { line: undefined, buttons: ["Connect"] });
});

test("the window's focus still reads for the surfaces left once the first one drawn has closed", async () => {
  const registry = AtomRegistry.make();
  registries.push(registry);
  await mount(registry);
  const first = roots.at(-1) ?? assert.fail("the first surface has a root");
  const other = await mount(registry);
  act(() => first.unmount());

  touched.set(GRANOLA, INTEGRATION_STATUS.EXPIRED);
  await focusWindow();
  assert.equal(granolaRow(other).line, "Sign-in expired");
});

test("a sign-out leaves nothing of one account's integrations to the next account signed in", async () => {
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  fakeAppBridge({
    requestAppState: () =>
      Promise.resolve(signedInAs({ id: "one", email: "one@example.com", name: "One" })),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const page = await mount();
  await pressOnGranola(page, "Connect");
  assert.deepEqual(granolaRow(page), WAITING);

  touched.clear();
  const next = signedInAs({ id: "two", email: "two@example.com", name: "Two" });
  act(() => {
    for (const listener of listeners) listener({ ...deliveryOf(next), version: 2 });
  });
  await settle();
  assert.deepEqual(granolaRow(page), { line: undefined, buttons: ["Connect"] });
});

test("a Cancel that lands after the sign-in finished leaves the provider connected", async () => {
  listed.set(GRANOLA, [{ name: "list_meetings", description: "Lists meetings." }]);
  const page = await mount();
  await pressOnGranola(page, "Connect");
  touched.set(GRANOLA, INTEGRATION_STATUS.CONNECTED);

  await pressOnGranola(page, "Cancel");
  assert.equal(granolaRow(page).line, "Connected · 1 tool");
});

test("a sign-in cancelled on Vercel Connect's own page says so plainly, with Retry", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");

  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  signInFailures = [{ provider: GRANOLA, reason: INTEGRATION_SIGN_IN_FAILURE.CANCELED }];
  await focusWindow();
  assert.deepEqual(granolaRow(page), {
    line: "You cancelled connecting Granola.",
    buttons: ["Retry"],
  });
  // The service names a failure once; the next read leaves the line as it stood.
  await focusWindow();
  assert.equal(granolaRow(page).line, "You cancelled connecting Granola.");
});

test("a sign-in Connect refused says so, then Connect's own line quoted under it, with Retry", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");

  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  signInFailures = [
    {
      provider: GRANOLA,
      reason: INTEGRATION_SIGN_IN_FAILURE.ERROR,
      message: "client_assertion aud must be the authorization server issuer",
    },
  ];
  await focusWindow();
  assert.deepEqual(granolaRow(page), {
    line: "Granola could not be connected.\nGranola's sign-in said: “client_assertion aud must be the authorization server issuer”",
    buttons: ["Retry"],
  });

  await pressOnGranola(page, "Retry");
  assert.deepEqual(granolaRow(page), WAITING);
});

test("a sign-in the browser came back from without a grant says it could not connect, and why, with Retry", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");
  await focusWindow();
  assert.deepEqual(granolaRow(page), WAITING, "still pending: still waiting");

  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  await focusWindow();
  assert.deepEqual(granolaRow(page), {
    line: "Granola could not be connected: the sign-in came back without access.",
    buttons: ["Retry"],
  });

  await pressOnGranola(page, "Retry");
  assert.deepEqual(granolaRow(page), WAITING);
});

it.effect(
  "a sign-in still pending once its wait runs out says it did not finish, with Retry, and connects after all if the browser finishes it later",
  () =>
    Effect.gen(function* () {
      listed.set(GRANOLA, [{ name: "list_meetings", description: "Lists meetings." }]);
      const registry = registryOn(yield* Clock.Clock);
      const page = yield* Effect.promise(() => mount(registry));
      yield* Effect.promise(() => pressOnGranola(page, "Connect"));

      yield* TestClock.adjust(SIGN_IN_WAIT);
      yield* Effect.promise(settle);
      assert.deepEqual(granolaRow(page), {
        line: "Sign-in didn't finish.",
        buttons: ["Retry"],
      });

      touched.set(GRANOLA, INTEGRATION_STATUS.CONNECTED);
      yield* Effect.promise(focusWindow);
      assert.equal(granolaRow(page).line, "Connected · 1 tool");
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
      [...page.querySelectorAll(".luke-settings-row")]
        .find((row) => row.querySelector('[id$="label"]')?.textContent === "Linear")
        ?.querySelector("button") ?? assert.fail("Linear offers Connect");
    act(() => linear.click());
    yield* Effect.promise(settle);

    yield* TestClock.adjust("1 minute");
    yield* Effect.promise(settle);
    assert.deepEqual(granolaRow(page), {
      line: "Sign-in didn't finish.",
      buttons: ["Retry"],
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
        buttons: ["Retry"],
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
    [...page.querySelectorAll(".luke-settings-row")].find(
      (row) => row.querySelector('[id$="label"]')?.textContent === name,
    ) ?? assert.fail(`${name} has a row`)
  );
}

/** Each tool the page shows opened: its name and its badge, where it wears one. */
function shownTools(page: HTMLElement) {
  return [...page.querySelectorAll('.integration-tools-panel ul[aria-label$=" tools"] > li')].map(
    (tool) => [toolName(tool), tool.querySelector(".luke-badge")?.textContent ?? undefined],
  );
}

/** A tool's name as its row draws it: beside its title, or in the title's place where it has none. */
function toolName(tool: Element | null | undefined): string | null | undefined {
  return (
    tool?.querySelector(".integration-tool-id") ?? tool?.querySelector(".integration-tool-title")
  )?.textContent;
}

/** Opens `name`'s row onto its tools. */
function openRow(page: HTMLElement, name: string): void {
  act(() =>
    (
      rowNamed(page, name).querySelector<HTMLButtonElement>(".luke-settings-row-state button") ??
      assert.fail(`${name}'s row opens onto its tools`)
    ).click(),
  );
}

/** The tool an opened row holds, by the row its list draws current and the title of the page beside it. */
function held(page: HTMLElement) {
  return [
    toolName(
      page.querySelector(
        '.integration-tools-panel ul[aria-label$=" tools"] > li:has([aria-current="true"])',
      ),
    ),
    page.querySelector(".integration-tools-panel .integration-tool-detail-title")?.textContent,
  ];
}

/** A key pressed wherever the focus stands, as a keyboard's lands, answering whether anything took it. */
function keyAtFocus(name: string): boolean {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** The page's search field. */
function searchField(page: HTMLElement): HTMLInputElement {
  return (
    page.querySelector<HTMLInputElement>('input[aria-label="Search integrations and tools"]') ??
    assert.fail("the page draws its search field")
  );
}

/** Types `query` over whatever the page's search field holds, as the developer would. */
async function searchFor(page: HTMLElement, query: string): Promise<void> {
  const field = searchField(page);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

/** The sections the page draws, each its heading and the names of its rows. */
function sections(page: HTMLElement) {
  return [...page.querySelectorAll(".luke-settings-section")].map((group) => [
    group.querySelector("h2")?.textContent,
    [...group.querySelectorAll('[id$="label"]')].map((name) => name.textContent),
  ]);
}

test("the rows stand under Connected and Not connected, each section in the order of their names", async () => {
  connectVercelAndLinear();
  const offered: readonly IntegrationProvider[] = [
    INTEGRATION_PROVIDER.VERCEL,
    INTEGRATION_PROVIDER.MERCURY,
    INTEGRATION_PROVIDER.LINEAR,
    GRANOLA,
  ];
  withheld = INTEGRATION_PROVIDER_LIST.filter((provider) => !offered.includes(provider));
  const page = await mount();

  assert.deepEqual(sections(page), [
    ["Connected", ["Linear", "Vercel"]],
    ["Not connected", ["Granola", "Mercury"]],
  ]);
});

test("a query keeps only the rows it found, opening one onto the tools it found, marked and counted", async () => {
  connectVercelAndLinear();
  const page = await mount();

  await searchFor(page, "deploy");

  assert.deepEqual(sections(page), [["Connected", ["Vercel"]]]);
  assert.deepEqual(shownTools(page), [["get_deployment", undefined]]);
  assert.equal(
    rowNamed(page, "Vercel").querySelector(".luke-settings-row-state button")?.textContent,
    "1 of 3 tools match",
  );
  assert.equal(page.querySelector(".integration-tools-panel mark")?.textContent, "deploy");
  assert.equal(
    rowNamed(page, "Vercel")
      .querySelector(".luke-settings-row-state button")
      ?.getAttribute("aria-label"),
    "1 of 3 tools match, hide Vercel tools",
  );
});

test("a query finds an integration by what it is for, keeping its section", async () => {
  connectVercelAndLinear();
  const page = await mount();

  await searchFor(page, "database");

  assert.deepEqual(sections(page), [["Not connected", ["Neon", "Notion", "Supabase"]]]);
});

test("a query that finds nothing says so, and clearing it brings every row back", async () => {
  connectVercelAndLinear();
  mountAnnouncer();
  const page = await mount();

  await searchFor(page, "frobnicate");

  assert.deepEqual(sections(page), []);
  assert.equal(page.textContent?.includes("No integrations or tools match “frobnicate”"), true);
  assert.equal(announcedPolitely(), "No integrations or tools match “frobnicate”");

  const clear =
    page.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]') ??
    assert.fail("a query offers to clear it");
  act(() => clear.click());
  await settle();

  assert.equal(rowNames(page).length, INTEGRATION_PROVIDER_LIST.length);
  assert.equal(document.activeElement, searchField(page));
  assert.equal(announcedPolitely(), "", "the words go once the rows are back");
});

test("while where the providers stand is read, the search stands usable above placeholder sections, and the rows land in their place", async () => {
  holdReads = true;
  const page = await mount();

  const status = page.querySelector('[role="status"]') ?? assert.fail("no placeholder");
  assert.equal(status.textContent, "Reading the integrations");
  assert.equal(status.querySelectorAll(".luke-settings-section-card").length, 2);
  // Note that the field is checked as a yes or no, because a failure's diff of an element would print the whole document.
  assert.equal(searchField(page).closest('[aria-busy="true"]') === null, true);
  await searchFor(page, "linear");
  assert.equal(searchField(page).value, "linear");

  for (const release of heldReads.splice(0)) act(() => release());
  await settle();

  assert.equal(page.querySelector('[role="status"]'), null);
  assert.deepEqual(rowNames(page), ["Linear"]);
});

test("Command-F lands in the page's search, and Escape clears it, then lets go of the caret, never reaching the window", async () => {
  connectVercelAndLinear();
  const page = await mount();
  const reachedWindow: string[] = [];
  const listen = (event: KeyboardEvent) => reachedWindow.push(event.key);
  window.addEventListener("keydown", listen);
  const pressEscape = () =>
    act(() => {
      searchField(page).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

  let offered = false;
  act(() => {
    offered = runAppCommand(APP_COMMAND.FIND);
  });
  assert.equal(offered, true);
  assert.equal(document.activeElement, searchField(page));

  await searchFor(page, "deploy");
  pressEscape();
  await settle();
  assert.equal(searchField(page).value, "");
  assert.equal(document.activeElement, searchField(page));
  assert.equal(rowNames(page).length, INTEGRATION_PROVIDER_LIST.length);

  pressEscape();
  assert.notEqual(document.activeElement, searchField(page));
  window.removeEventListener("keydown", listen);
  assert.deepEqual(reachedWindow, []);
});

test("a query that finds an integration by its own name opens nothing by itself, and opened, keeps every tool", async () => {
  connectVercelAndLinear();
  const page = await mount();
  await searchFor(page, "vercel");

  assert.deepEqual(shownTools(page), []);
  act(() =>
    (
      rowNamed(page, "Vercel").querySelector<HTMLButtonElement>(
        ".luke-settings-row-state button",
      ) ?? assert.fail("Vercel's row opens onto its tools")
    ).click(),
  );
  assert.equal(shownTools(page).length, 3);
});

test("a row closed under one query opens again when that query comes back after another", async () => {
  connectVercelAndLinear();
  const page = await mount();
  await searchFor(page, "deploy");
  assert.deepEqual(shownTools(page), [["get_deployment", undefined]]);

  act(() =>
    (
      rowNamed(page, "Vercel").querySelector<HTMLButtonElement>(
        ".luke-settings-row-state button",
      ) ?? assert.fail("Vercel's row closes")
    ).click(),
  );
  assert.deepEqual(shownTools(page), []);

  await searchFor(page, "projects");
  await searchFor(page, "deploy");

  assert.deepEqual(shownTools(page), [["get_deployment", undefined]]);
});

test("an opened row holds its first tool, whose page stands beside the list, and a press holds another", async () => {
  connectVercelAndLinear();
  listed.set(INTEGRATION_PROVIDER.VERCEL, [
    {
      name: "list_projects",
      title: "List projects",
      description: "Lists projects.\n\n- Pages through **every** project on the team.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      parameters: [{ name: "limit", type: "number", required: false, default: "20" }],
    },
    { name: "get_deployment", description: "Reads one deployment." },
  ]);
  const page = await mount();
  openRow(page, "Vercel");

  assert.deepEqual(held(page), ["get_deployment", "get_deployment"]);
  // Note that in Settings a pressed tool takes the focus, as a button does, so the arrows reach it next.
  const pressStart = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  page.querySelector('ul[aria-label$=" tools"] > li > button')?.dispatchEvent(pressStart);
  assert.equal(pressStart.defaultPrevented, false);

  act(() =>
    (
      [...page.querySelectorAll<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button')].find(
        (button) => toolName(button) === "list_projects",
      ) ?? assert.fail("list_projects has its row")
    ).click(),
  );
  assert.deepEqual(held(page), ["list_projects", "List projects"]);
  const detail = page.querySelector(".integration-tool-detail") ?? assert.fail("no tool page");
  assert.equal(detail.querySelector(".integration-tool-detail-name")?.textContent, "list_projects");
  assert.equal(
    detail.querySelector(".integration-tool-description-whole li strong")?.textContent,
    "every",
  );
  assert.deepEqual(
    [...detail.querySelectorAll(".integration-tool-hints li")].map((hint) => hint.textContent),
    ["Read-only", "Only Vercel's own data"],
  );
  assert.equal(detail.querySelector(".integration-tool-parameter-name")?.textContent, "limit");
});

test("the list is one Tab stop, and the arrows, Home, and End, wrapping, move the tool an opened row holds, its page following", async () => {
  connectVercelAndLinear();
  const page = await mount();
  openRow(page, "Vercel");
  act(() =>
    page.querySelector<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button')?.focus(),
  );

  assert.deepEqual(
    [...page.querySelectorAll<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button')].map(
      (button) => button.tabIndex,
    ),
    [0, -1, -1],
  );
  assert.equal(keyAtFocus("ArrowDown"), true);
  assert.deepEqual(held(page), ["get_deployment", "get_deployment"]);
  keyAtFocus("ArrowDown");
  assert.deepEqual(held(page), ["list_projects", "list_projects"]);
  assert.equal(toolName(document.activeElement), "list_projects");
  keyAtFocus("ArrowDown");
  assert.deepEqual(held(page), ["delete_project", "delete_project"], "↓ wraps at the end");
  keyAtFocus("Home");
  assert.deepEqual(held(page), ["delete_project", "delete_project"]);
  keyAtFocus("End");
  assert.deepEqual(held(page), ["list_projects", "list_projects"]);
  keyAtFocus("ArrowUp");
  assert.deepEqual(held(page), ["get_deployment", "get_deployment"]);
  assert.deepEqual(
    [...page.querySelectorAll<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button')].map(
      (button) => button.tabIndex,
    ),
    [-1, 0, -1],
  );
});

test("the arrows scroll an opened row's tool list, and only it, to keep the held tool in view", async () => {
  connectVercelAndLinear();
  const page = await mount();
  openRow(page, "Vercel");
  // Note that the list's scroller is the area its rows stand in.
  const list =
    page.querySelector<HTMLElement>(".integration-tools-list")?.parentElement ??
    assert.fail("the tool list");
  // Note that jsdom lays nothing out, so the list shows one 30px row and each row stands 30px under the last, less what the list has scrolled.
  const ROW = 30;
  const rows = () => [...list.querySelectorAll<HTMLElement>('ul[aria-label$=" tools"] > li')];
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this === list ? ROW : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(ROW);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const at = rows().indexOf(this);
    return new DOMRect(0, at < 0 ? 0 : at * ROW - list.scrollTop, 200, ROW);
  });
  act(() =>
    page.querySelector<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button')?.focus(),
  );

  keyAtFocus("ArrowDown");
  keyAtFocus("ArrowDown");
  assert.equal(list.scrollTop, 2 * ROW, "the third tool's row stands in the list's view");
  keyAtFocus("Home");
  assert.equal(list.scrollTop, 0, "the first tool's row stands in view again");
});

test("Return hands the focus to the held tool's page, and Escape or Left hands it back to its row, never leaving the page", async () => {
  connectVercelAndLinear();
  const page = await mount();
  openRow(page, "Vercel");
  const reached = { escapes: 0 };
  const heard = (event: KeyboardEvent) => {
    if (event.key === "Escape") reached.escapes += 1;
  };
  window.addEventListener("keydown", heard);
  try {
    act(() =>
      page.querySelector<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button')?.focus(),
    );
    keyAtFocus("ArrowDown");

    for (const back of ["Escape", "ArrowLeft"]) {
      keyAtFocus("Enter");
      assert.equal(
        document.activeElement,
        page.querySelector(".integration-tool-detail-body")?.parentElement,
      );
      assert.equal(keyAtFocus(back), true, back);
      assert.equal(toolName(document.activeElement), "get_deployment");
    }
    assert.equal(reached.escapes, 0);
    assert.deepEqual(held(page), ["get_deployment", "get_deployment"]);
  } finally {
    window.removeEventListener("keydown", heard);
  }
});

test("a search that no longer finds the held tool hands its place to the first it does", async () => {
  connectVercelAndLinear();
  const page = await mount();
  openRow(page, "Vercel");
  act(() =>
    (
      [...page.querySelectorAll<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button')].find(
        (button) => toolName(button) === "list_projects",
      ) ?? assert.fail("list_projects has its row")
    ).click(),
  );
  await searchFor(page, "deploy");

  assert.deepEqual(held(page), ["get_deployment", "get_deployment"]);
});

test("a query naming the integration and a tool opens the row onto that tool", async () => {
  connectVercelAndLinear();
  const page = await mount();
  await searchFor(page, "vercel deploy");

  assert.deepEqual(shownTools(page), [["get_deployment", undefined]]);
});

test("a tool held opens its page at the top, wherever the last one was scrolled", async () => {
  connectVercelAndLinear();
  const page = await mount();
  openRow(page, "Vercel");
  const body = () =>
    page.querySelector<HTMLElement>(".integration-tool-detail-body")?.parentElement ??
    assert.fail("no tool page");
  body().scrollTop = 120;

  act(() =>
    (
      [...page.querySelectorAll<HTMLButtonElement>('ul[aria-label$=" tools"] > li > button')].find(
        (button) => toolName(button) === "list_projects",
      ) ?? assert.fail("list_projects has its row")
    ).click(),
  );

  assert.deepEqual(held(page), ["list_projects", "list_projects"]);
  assert.equal(body().scrollTop, 0);
});

test("a search's words are marked on the held tool's page, where they landed past the row's one line", async () => {
  connectVercelAndLinear();
  listed.set(INTEGRATION_PROVIDER.VERCEL, [
    { name: "list_projects", description: "Lists projects.\n\nIncludes **archived** ones too." },
  ]);
  const page = await mount();
  await searchFor(page, "archived");

  assert.deepEqual(held(page), ["list_projects", "list_projects"]);
  assert.deepEqual(
    [...page.querySelectorAll(".integration-tool-description-whole mark.search-match")].map(
      (mark) => mark.textContent,
    ),
    ["archived"],
  );
});

test("a tool its server says nothing of has a page that says so", async () => {
  connectVercelAndLinear();
  listed.set(INTEGRATION_PROVIDER.VERCEL, [{ name: "whoami", description: "" }]);
  const page = await mount();
  openRow(page, "Vercel");

  assert.equal(page.querySelector(".luke-list-row-description"), null);
  assert.equal(page.querySelector(".integration-tool-detail-body")?.textContent, "No description.");
  assert.equal(page.querySelector(".integration-tool-hints"), null);
  assert.equal(page.querySelector(".integration-tool-parameters"), null);
});

test("two accounts at a provider stand as two rows named by their labels, each offering Rename and Add another account", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  addable = [notion];
  accounts = [
    {
      provider: notion,
      connection: "notion",
      label: "Acme",

      status: INTEGRATION_STATUS.CONNECTED,
    },
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",

      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const page = await mount();
  const rowOf = (label: string) =>
    [...page.querySelectorAll(".luke-settings-row")].find((row) =>
      row.querySelector('[id$="label"]')?.textContent?.startsWith(`Notion · ${label}`),
    ) ?? assert.fail(`Notion · ${label} has a row`);

  for (const label of ["Acme", "Personal"]) {
    assert.deepEqual(menuOf(rowOf(label)).items, [
      "Rename",
      "Add another account",
      "Reconnect",
      "Disconnect",
    ]);
  }

  await choose(rowOf("Acme"), "Add another account");
  const connects = sent.filter((request) => request.kind === ACT_KIND.INTEGRATIONS_CONNECT);
  assert.deepEqual(
    connects.map((request) => request.payload),
    [{ provider: notion, add: true }],
  );
  // The new account stands pending under the name the service gave it, as a row of its own.
  assert.ok(
    [...page.querySelectorAll('[id$="label"]')].some(
      (name) => name.textContent === "Notion · Account 3",
    ),
  );
});

test("an account renamed from its row's ⋯ is named in place: Escape keeps its name, and Return asks for the new one", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  accounts = [
    { provider: notion, connection: "notion", label: "Acme", status: INTEGRATION_STATUS.CONNECTED },
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const page = await mount();
  const rowOf = (label: string) =>
    [...page.querySelectorAll(".luke-settings-row")].find((row) =>
      row.querySelector('[id$="label"]')?.textContent?.startsWith(`Notion · ${label}`),
    ) ?? assert.fail(`Notion · ${label} has a row`);
  const field = () =>
    page.querySelector<HTMLInputElement>('input[aria-label="Notion · Acme account name"]');
  const press = (key: string) =>
    act(() => {
      (field() ?? assert.fail("the name's field is open")).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  const renames = () =>
    sent
      .filter((request) => request.kind === ACT_KIND.INTEGRATIONS_RENAME)
      .map((request) => request.payload);

  await choose(rowOf("Acme"), "Rename");
  const opened = field() ?? assert.fail("Rename opens the name's field");
  assert.equal(document.activeElement, opened);
  assert.equal(opened.value, "Acme");
  press("Escape");
  await settle();
  assert.equal(field(), null);
  assert.deepEqual(renames(), []);

  await choose(rowOf("Acme"), "Rename");
  const typing = field() ?? assert.fail("Rename opens the name's field again");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(typing, "Work");
    typing.dispatchEvent(new Event("input", { bubbles: true }));
  });
  press("Enter");
  await settle();
  assert.equal(field(), null);
  assert.deepEqual(renames(), [{ provider: notion, connection: "notion", label: "Work" }]);
  assert.ok(rowOf("Work"), "the row says the new name");
});

test("a refused rename says the account could not be renamed and what to do, in the one failure sentence", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  accounts = [
    { provider: notion, connection: "notion", label: "Acme", status: INTEGRATION_STATUS.CONNECTED },
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  refuseRename = true;
  const page = await mount();
  const row =
    [...page.querySelectorAll(".luke-settings-row")].find((each) =>
      each.querySelector('[id$="label"]')?.textContent?.startsWith("Notion · Acme"),
    ) ?? assert.fail("Notion has a row");

  await choose(row, "Rename");
  const field =
    page.querySelector<HTMLInputElement>('input[aria-label="Notion · Acme account name"]') ??
    assert.fail("no name field");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "Work");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  await settle();

  assert.match(page.textContent ?? "", /Notion · Acme could not be renamed\. Try again\./u);
});

test("an added account whose first sign-in Connect refused keeps its row with the reason and Retry, which signs in a new account", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  addable = [notion];
  accounts = [
    {
      provider: notion,
      connection: "notion",
      label: "Acme",

      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const page = await mount();
  const acme =
    [...page.querySelectorAll(".luke-settings-row")].find(
      (row) => row.querySelector('[id$="label"]')?.textContent === "Notion",
    ) ?? assert.fail("Notion has a row");
  await choose(acme, "Add another account");

  // The service ended the refused sign-in and deleted its row, naming the failure once.
  signInFailures = [
    {
      provider: notion,
      connection: "notion-3",
      reason: INTEGRATION_SIGN_IN_FAILURE.ERROR,
      message: "access_denied",
    },
  ];
  await focusWindow();
  const added =
    [...page.querySelectorAll(".luke-settings-row")].find(
      (row) => row.querySelector('[id$="label"]')?.textContent === "Notion · Account 3",
    ) ?? assert.fail("the refused account keeps its row");
  assert.match(stateLines(added) ?? "", /access_denied/u);

  sent = [];
  act(() =>
    (
      [...added.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
      assert.fail("no Retry")
    ).click(),
  );
  await settle();
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.INTEGRATIONS_CONNECT)
      .map((request) => request.payload),
    [{ provider: notion, add: true }],
  );
});

test("an account added under the provider's own name, beside one that stands, waits as a row of its own with Reopen and Cancel", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.DISCONNECTED);
  addable = [notion];
  addedConnection = notion;
  accounts = [
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const page = await mount();
  const personal =
    [...page.querySelectorAll(".luke-settings-row")].find(
      (row) => row.querySelector('[id$="label"]')?.textContent === "Notion",
    ) ?? assert.fail("Notion has a row");
  await choose(personal, "Add another account");

  const added =
    [...page.querySelectorAll(".luke-settings-row")].find(
      (row) => row.querySelector('[id$="label"]')?.textContent === "Notion · Account 1",
    ) ?? assert.fail("the account added has a row of its own");
  assert.deepEqual(
    [...added.querySelectorAll("button")]
      .map((button) => button.textContent)
      .filter((text) => text === "Reopen" || text === "Cancel"),
    ["Reopen", "Cancel"],
  );
});

test("an added account whose first sign-in is cancelled leaves its row, so the next one is added rather than reopened", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  addable = [notion];
  cancelled.set("notion-2", INTEGRATION_STATUS.DISCONNECTED);
  accounts = [
    {
      provider: notion,
      connection: "notion",
      label: "Acme",
      status: INTEGRATION_STATUS.CONNECTED,
    },
    {
      provider: notion,
      connection: "notion-2",
      status: INTEGRATION_STATUS.PENDING,
    },
  ];
  const page = await mount();
  const pending =
    [...page.querySelectorAll(".luke-settings-row")].find(
      (row) => row.querySelector('[id$="label"]')?.textContent === "Notion · Account 2",
    ) ?? assert.fail("the pending account has a row");
  // The service deletes the cancelled first sign-in's account, so its next read lists Acme alone.
  accounts = accounts.slice(0, 1);
  act(() =>
    (
      [...pending.querySelectorAll("button")].find((button) => button.textContent === "Cancel") ??
      assert.fail("no Cancel")
    ).click(),
  );
  await settle();

  assert.equal(
    [...page.querySelectorAll('[id$="label"]')].some(
      (name) => name.textContent === "Notion · Account 2",
    ),
    false,
  );
});

test("a cancelled sign-in that held a provider's last place frees it at once, offering Add another account again", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  cancelled.set("notion-5", INTEGRATION_STATUS.DISCONNECTED);
  accounts = [1, 2, 3, 4, 5].map((place) => ({
    provider: notion,
    connection: place === 1 ? notion : `notion-${place}`,
    label: `Workspace ${place}`,
    status: place === 5 ? INTEGRATION_STATUS.PENDING : INTEGRATION_STATUS.CONNECTED,
  }));
  const page = await mount();
  const rowOf = (label: string) =>
    [...page.querySelectorAll(".luke-settings-row")].find((row) =>
      row.querySelector('[id$="label"]')?.textContent?.startsWith(`Notion · ${label}`),
    ) ?? assert.fail(`Notion · ${label} has a row`);
  assert.ok(!menuOf(rowOf("Workspace 1")).items.includes("Add another account"));

  // The service's next read counts four accounts, so the provider is addable again.
  accounts = accounts.slice(0, 4);
  addable = [notion];
  act(() =>
    (
      [...rowOf("Workspace 5").querySelectorAll("button")].find(
        (button) => button.textContent === "Cancel",
      ) ?? assert.fail("no Cancel")
    ).click(),
  );
  await settle();

  assert.ok(menuOf(rowOf("Workspace 1")).items.includes("Add another account"));
});

test("a statuses read answered after a newer one changes nothing the newer one drew", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  const acme = {
    provider: notion,
    connection: "notion",
    label: "Acme",
    status: INTEGRATION_STATUS.CONNECTED,
  };
  accounts = [acme];
  const page = await mount();
  holdReads = true;
  await focusWindow();
  accounts = [
    acme,
    {
      provider: notion,
      connection: "notion-2",
      label: "Personal",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  await focusWindow();

  // The newer read lands first, then the older.
  const [older, newer] = heldReads;
  act(() => newer?.());
  await settle();
  act(() => older?.());
  await settle();

  assert.ok(
    [...page.querySelectorAll('[id$="label"]')].some(
      (name) => name.textContent === "Notion · Personal",
    ),
  );
});

test("a statuses read answered after a newer one still says why the sign-in it settled failed", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");

  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  signInFailures = [
    { provider: GRANOLA, reason: INTEGRATION_SIGN_IN_FAILURE.ERROR, message: "access_denied" },
  ];
  holdReads = true;
  // The first read settles the sign-in and is told why it failed; the second is told nothing of it.
  await focusWindow();
  await focusWindow();
  const [older, newer] = heldReads;
  act(() => newer?.());
  await settle();
  act(() => older?.());
  await settle();

  assert.deepEqual(granolaRow(page), {
    line: "Granola could not be connected.\nGranola's sign-in said: “access_denied”",
    buttons: ["Retry"],
  });
});

test("a failure an older read was told never comes back over a sign-in a newer read found connected, so a later disconnect offers Connect", async () => {
  const page = await mount();
  await pressOnGranola(page, "Connect");

  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  signInFailures = [
    { provider: GRANOLA, reason: INTEGRATION_SIGN_IN_FAILURE.ERROR, message: "access_denied" },
  ];
  holdReads = true;
  await focusWindow();
  // Another window connects Granola before the next read.
  touched.set(GRANOLA, INTEGRATION_STATUS.CONNECTED);
  await focusWindow();
  const [older, newer] = heldReads;
  act(() => newer?.());
  await settle();
  act(() => older?.());
  await settle();

  holdReads = false;
  touched.set(GRANOLA, INTEGRATION_STATUS.DISCONNECTED);
  await focusWindow();
  assert.deepEqual(granolaRow(page).buttons, ["Connect"]);
});

test("Reopen on an added account still waiting on its first sign-in reopens that account, never adds another", async () => {
  const notion = INTEGRATION_PROVIDER.NOTION;
  standing.set(notion, INTEGRATION_STATUS.CONNECTED);
  addable = [notion];
  accounts = [
    {
      provider: notion,
      connection: "notion",
      label: "Acme",
      status: INTEGRATION_STATUS.CONNECTED,
    },
  ];
  const page = await mount();
  const acme =
    [...page.querySelectorAll(".luke-settings-row")].find(
      (row) => row.querySelector('[id$="label"]')?.textContent === "Notion",
    ) ?? assert.fail("Notion has a row");
  await choose(acme, "Add another account");
  const added =
    [...page.querySelectorAll(".luke-settings-row")].find(
      (row) => row.querySelector('[id$="label"]')?.textContent === "Notion · Account 3",
    ) ?? assert.fail("the account added has a row");

  sent = [];
  act(() =>
    (
      [...added.querySelectorAll("button")].find((button) => button.textContent === "Reopen") ??
      assert.fail("no Reopen")
    ).click(),
  );
  await settle();
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.INTEGRATIONS_CONNECT)
      .map((request) => request.payload),
    [{ provider: notion, connection: "notion-3" }],
  );
});

/** How tall a row is drawn, in the layout given. */
const ROW = 40;

/** How much taller a row opened onto its tools stands, in the layout given. */
const TOOLS = 200;

/** How tall a moving row stands: a row's height, and its tools' under it where it opened onto them. */
function heightOf(row: Element): number {
  return row.querySelector(".integration-tools-panel") === null ? ROW : ROW + TOOLS;
}

/** Each row standing under the rows before it on the page, as a layout would; jsdom lays nothing out. */
function layRowsInOrder(page: HTMLElement): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const rows = [...page.querySelectorAll("[data-motion-key]")];
    const at = rows.indexOf(this);
    const top = rows.slice(0, Math.max(at, 0)).reduce((sum, row) => sum + heightOf(row), 0);
    return { top, bottom: top + ROW, left: 0, right: 0, width: 0, height: ROW } as DOMRect;
  });
}

/** What a row moves as, the box its motion follows, by the row's name. */
function movingRow(page: HTMLElement, name: string): HTMLElement {
  return (
    rowNamed(page, name).closest<HTMLElement>("[data-motion-key]") ??
    assert.fail(`${name}'s row moves`)
  );
}

/** Granola, Linear, and Mercury offered, none of them connected. */
function offerThree(): void {
  const offered: readonly IntegrationProvider[] = [
    GRANOLA,
    INTEGRATION_PROVIDER.LINEAR,
    INTEGRATION_PROVIDER.MERCURY,
  ];
  withheld = INTEGRATION_PROVIDER_LIST.filter((provider) => !offered.includes(provider));
}

test("an integration that connects glides from Not connected into Connected, followed by its connection", async () => {
  const motions = playListMotions();
  try {
    offerThree();
    const page = await mount();
    layRowsInOrder(page);
    const before = movingRow(page, "Mercury");

    touched.set(INTEGRATION_PROVIDER.MERCURY, INTEGRATION_STATUS.CONNECTED);
    await focusWindow();

    assert.deepEqual(sections(page), [
      ["Connected", ["Mercury"]],
      ["Not connected", ["Granola", "Linear"]],
    ]);
    const after = movingRow(page, "Mercury");
    assert.equal(before.dataset.motionKey, INTEGRATION_PROVIDER.MERCURY);
    assert.equal(after.dataset.motionKey, INTEGRATION_PROVIDER.MERCURY);
    const glide = motions.played.find((each) => each.element === after);
    assert.deepEqual(glide?.keyframes[0], { transform: `translate(0px, ${2 * ROW}px)` });
  } finally {
    motions.remove();
  }
});

test("with motion held still, an integration that connects takes its place and nothing plays", async () => {
  const motions = playListMotions();
  try {
    for (const name of ["--luke-duration-exit", "--luke-duration-shape"]) {
      document.documentElement.style.setProperty(name, "0ms");
    }
    offerThree();
    const page = await mount();
    layRowsInOrder(page);

    touched.set(INTEGRATION_PROVIDER.MERCURY, INTEGRATION_STATUS.CONNECTED);
    await focusWindow();

    assert.deepEqual(sections(page), [
      ["Connected", ["Mercury"]],
      ["Not connected", ["Granola", "Linear"]],
    ]);
    assert.deepEqual(
      motions.played.map((each) => each.keyframes),
      [],
    );
  } finally {
    motions.remove();
  }
});

/** Every element laid one row tall under the one before it in the document, so what a change inserts moves what follows it. */
function layInDocumentOrder(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = [...document.querySelectorAll("*")].indexOf(this) * ROW;
    return { top, bottom: top + ROW, left: 0, right: 0, width: 0, height: ROW } as DOMRect;
  });
}

/** The chevron on a row's tools press, and whether it stands turned. */
function toolsChevron(page: HTMLElement, name: string): HTMLElement {
  return (
    rowNamed(page, name).querySelector<HTMLElement>(
      ".luke-settings-row-state button .luke-disclosure-turn",
    ) ?? assert.fail(`${name}'s tools press wears a turning chevron`)
  );
}

/** The motions played on `element`, by their keyframes. */
function motionsOn(
  motions: ReturnType<typeof playListMotions>,
  element: Element | null | undefined,
): Keyframe[][] {
  return motions.played.filter((each) => each.element === element).map((each) => each.keyframes);
}

test("a row's tools unroll under one chevron that turns, and roll up as it turns back", async () => {
  const motions = playListMotions();
  // Note that the arrival's fade and stagger are tokens the list motion's helper leaves unset.
  for (const [name, value] of [
    ["--luke-duration-quick", "140ms"],
    ["--luke-row-stagger", "32ms"],
  ] as const) {
    document.documentElement.style.setProperty(name, value);
  }
  try {
    connectVercelAndLinear();
    const page = await mount();
    layInDocumentOrder();
    const under = movingRow(page, "Vercel");
    assert.equal(toolsChevron(page, "Linear").dataset.open, "false");

    openRow(page, "Linear");
    await settle();

    assert.equal(toolsChevron(page, "Linear").dataset.open, "true");
    const box = rowNamed(page, "Linear")
      .closest("[data-motion-key]")
      ?.querySelector(".luke-reveal");
    assert.notEqual(box?.querySelector(".integration-tools-panel"), null);
    assert.deepEqual(motionsOn(motions, box).at(-1), [
      { clipPath: "inset(0 0 100% 0)" },
      { clipPath: "inset(0)" },
    ]);
    // Note that the row under it glides down with the clip's foot, rather than jumping under the tools.
    assert.equal(motionsOn(motions, under).length > 0, true);

    openRow(page, "Linear");
    await settle();

    assert.equal(toolsChevron(page, "Linear").dataset.open, "false");
    assert.equal(box?.hasAttribute("inert"), true);
    assert.deepEqual(motionsOn(motions, box).at(-1), [
      { opacity: "1", clipPath: "inset(0)" },
      { opacity: 0, clipPath: "inset(0 0 100% 0)" },
    ]);
    act(() => motions.played.findLast((each) => each.element === box)?.finish());
    assert.equal(box?.isConnected, false);
  } finally {
    document.documentElement.style.removeProperty("--luke-duration-quick");
    document.documentElement.style.removeProperty("--luke-row-stagger");
    motions.remove();
  }
});

test("with motion held still, a row's tools show at once and fold at once", async () => {
  const motions = playListMotions();
  try {
    for (const name of ["--luke-duration-exit", "--luke-duration-shape"]) {
      document.documentElement.style.setProperty(name, "0ms");
    }
    connectVercelAndLinear();
    const page = await mount();
    layInDocumentOrder();

    openRow(page, "Linear");
    await settle();

    assert.notEqual(
      rowNamed(page, "Linear")
        .closest("[data-motion-key]")
        ?.querySelector(".integration-tools-panel"),
      null,
    );
    assert.deepEqual(
      motions.played.map((each) => each.keyframes),
      [],
    );

    openRow(page, "Linear");
    await settle();

    assert.equal(
      rowNamed(page, "Linear")
        .closest("[data-motion-key]")
        ?.querySelector(".integration-tools-panel"),
      null,
    );
  } finally {
    motions.remove();
  }
});
