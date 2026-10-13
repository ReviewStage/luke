// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import { APP_SETTING_ID } from "@sidecar/guide";
import { LIVE_VOICE } from "@sidecar/live";
import { TerminalIcon } from "@sidecar/panel";
import { APP_SETTING_DEFAULTS, SETTINGS_RESET_SCOPE, THEME } from "@sidecar/settings";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettings, AppSettingsView } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Effect } from "effect";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "#shared/messages/acts";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { navigationHistory } from "#testing/navigation-history";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { newestToastAction, newestToastSays } from "#testing/toast";
import { runAppCommand, useAppKeymap } from "../app-commands";
import type { CallCardInput } from "../call/call-card";
import { MICROPHONE_UNGRANTED_NOTE } from "../microphone-access";
import type { MicrophoneControl } from "../settings/controls";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE, SETTINGS_SEARCH_ROW } from "../settings-anchors";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { ToastHost } from "../toast";
import { DesktopSettings } from "./desktop-settings";
import { SIDEBAR_WIDTH } from "./sidebar-collapse";

const ignore = () => undefined;

/**
 * Turns the page from outside Settings, the way the app's Escape or a spoken
 * request does. Set by the mounted harness.
 */
let turnPage: (view: SettingsView) => void = ignore;

/** Settings with the page held the way the app holds it, so a press turns it. */
function Harness({
  settings,
  microphone,
  account,
}: {
  settings?: AppSettingsView;
  microphone?: MicrophoneControl;
  account?: AccountSnapshot;
}): React.JSX.Element {
  const [view, setView] = useState<SettingsView>(SETTINGS_VIEW.ROOT);
  turnPage = setView;
  return createElement(DesktopSettings, {
    sidebar: {
      collapsed: false,
      width: SIDEBAR_WIDTH.DEFAULT,
      onToggle: ignore,
      onResize: ignore,
      staged: false,
    },
    history: navigationHistory(),
    call: undefined,
    settings: settingsPanelProps({
      view,
      onViewChange: setView,
      ...(settings ? { settings } : undefined),
      ...(microphone ? { microphone } : undefined),
      ...(account ? { account } : undefined),
    }),
    onExit: ignore,
  });
}

/** Every root a test mounted, unmounted after it so nothing it started outlives it. */
const mounted: Root[] = [];

/** Settings under the window's toast, its atoms on `registry` where given. */
function mount(
  settings?: AppSettingsView,
  registry?: AtomRegistry,
  microphone?: MicrophoneControl,
  account?: AccountSnapshot,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  const surface = createElement(
    Fragment,
    null,
    createElement(Harness, {
      ...(settings ? { settings } : undefined),
      ...(microphone ? { microphone } : undefined),
      ...(account ? { account } : undefined),
    }),
    createElement(ToastHost),
  );
  act(() => {
    root.render(registry === undefined ? surface : onRegistry(registry, surface));
  });
  return container;
}

function sidebar(container: ParentNode): HTMLElement {
  const nav = container.querySelector<HTMLElement>("nav[aria-label='Settings pages']");
  assert.ok(nav, "the sidebar is drawn");
  return nav;
}

function field(container: ParentNode): HTMLInputElement {
  const input = sidebar(container).querySelector<HTMLInputElement>(
    "input[aria-label='Search settings']",
  );
  assert.ok(input, "the sidebar draws the search field");
  return input;
}

/** Types into the field the way a keystroke does, so React hears a change. */
function type(input: HTMLInputElement, text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  assert.ok(setValue);
  act(() => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(input: HTMLInputElement, key: string, isComposing = false): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing, bubbles: true }));
  });
}

/** The sidebar's list of pages by name, empty while results stand in its place. */
function pageList(container: ParentNode): readonly string[] {
  return [...sidebar(container).querySelectorAll(":scope ul > li > button")]
    .filter((button) => button.closest("section") === null)
    .map((button) => button.textContent ?? "");
}

/** The results drawn in the sidebar, as each group's heading and its rows. */
function results(container: ParentNode): readonly { page: string; rows: readonly string[] }[] {
  return [...sidebar(container).querySelectorAll("section")].map((group) => ({
    page: group.querySelector("h2")?.textContent ?? "",
    rows: [...group.querySelectorAll("button")].map((button) => button.textContent ?? ""),
  }));
}

function shownPage(container: ParentNode): string {
  return container.querySelector(".desktop-toolbar-title")?.textContent ?? "";
}

/** The plan template's page, by the name it is labelled with, which draws its title in its document rather than its toolbar. */
function templatePage(container: ParentNode): Element | null {
  return container.querySelector('.settings-page[aria-label="Plan template"]');
}

/** The toolbar's button with these words, if it draws one. */
function toolbarButton(container: ParentNode, words: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>(".desktop-toolbar button")].find(
    (button) => button.textContent === words,
  );
}

function result(container: ParentNode, label: string): HTMLButtonElement {
  const button = [...sidebar(container).querySelectorAll<HTMLButtonElement>("section button")].find(
    (candidate) => candidate.textContent === label,
  );
  assert.ok(button, `the results offer ${label}`);
  return button;
}

beforeEach(() => {
  // The page list and the field count their presses through the bridge,
  // which a test has none of.
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { recordSurfaceEvent: ignore, act: () => Promise.resolve({ ok: true }) },
  });
});

afterEach(() => {
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

test("the list of pages marks Voice while its microphone is ungranted, as the front page does", () => {
  const ungranted = mount(undefined, undefined, {
    status: MICROPHONE_STATUS.NOT_DETERMINED,
    voiceAvailable: true,
    onRequest: ignore,
    onOpenSettings: ignore,
  });
  const marked = pageList(ungranted).filter((page) => page.includes(MICROPHONE_UNGRANTED_NOTE));
  assert.equal(marked.length, 1);
  assert.ok(marked[0]?.startsWith("Voice"), `the mark stands on "${marked[0]}"`);

  // Granted, the row is its name and nothing more.
  assert.ok(pageList(mount()).includes("Voice"));
});

test("typing in the sidebar search turns the page list into results grouped under their pages", () => {
  const container = mount();
  const pages = pageList(container);
  assert.deepEqual(pages, [
    "General",
    "Voice",
    "Appearance",
    "Keyboard shortcuts",
    "Plan template",
    "Coding agents",
    "Integrations",
  ]);

  type(field(container), "hotkey");
  assert.deepEqual(pageList(container), []);
  assert.deepEqual(results(container), [
    { page: "Keyboard shortcuts", rows: ["Talk to Luke", "Stop Luke"] },
  ]);

  // A query landing on more than one page groups its rows under each, in the
  // list's own order.
  type(field(container), "microphone");
  assert.deepEqual(
    results(container).map((group) => group.page),
    ["Voice", "Keyboard shortcuts"],
  );

  type(field(container), "zzzz");
  assert.deepEqual(results(container), []);
  assert.match(sidebar(container).textContent ?? "", /No results/);

  // The main content draws no search of its own.
  const main = container.querySelector(".settings-page");
  assert.ok(main);
  assert.equal(main.querySelector("input"), null);
  assert.equal(shownPage(container), "General");
});

test("pressing a result opens its page beside the results, which stay standing", () => {
  const container = mount();
  type(field(container), "stop luke");
  act(() => result(container, "Stop Luke").click());

  assert.equal(shownPage(container), "Keyboard shortcuts");
  const row = container.querySelector(
    `.settings-page [${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${SETTINGS_SEARCH_ROW.STOP_KEY}"]`,
  );
  assert.ok(row, "the page holding the row is drawn");
  assert.equal(field(container).value, "stop luke");
  assert.equal(result(container, "Stop Luke").getAttribute("aria-current"), "location");

  // A page turned some other way leaves the result unmarked.
  act(() => turnPage(SETTINGS_VIEW.ROOT));
  assert.equal(result(container, "Stop Luke").getAttribute("aria-current"), null);

  // Return opens the first result, so a sure query needs no pointer.
  type(field(container), "login");
  const [first] = results(container);
  assert.ok(first);
  press(field(container), "Enter");
  assert.equal(shownPage(container), first.page);
});

test("searching for notifications finds the switch on Coding agents, and pressing it lands on the switch", () => {
  const container = mount();
  act(() => turnPage(SETTINGS_VIEW.APPEARANCE));
  type(field(container), "notifications");
  assert.deepEqual(results(container), [
    { page: "Coding agents", rows: ["Notify me when a coding agent finishes or needs me"] },
  ]);

  act(() => result(container, "Notify me when a coding agent finishes or needs me").click());
  assert.equal(shownPage(container), "Coding agents");
  const row = container.querySelector(
    `.settings-page [${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${APP_SETTING_ID.AGENT_NOTIFICATIONS}"]`,
  );
  assert.equal(row?.getAttribute("role"), "switch");
});

test("Coding agents holds the default model, the API keys, and notifications as three groups, and General holds none of them", () => {
  const container = mount();
  const headings = () =>
    [...container.querySelectorAll(".settings-page .settings-section > h2")].map(
      (heading) => heading.textContent,
    );
  assert.ok(!pageList(container).includes("API keys"), "API keys is no page of its own");
  const codingAgents = [...sidebar(container).querySelectorAll("li > button")].find(
    (button) => button.textContent === "Coding agents",
  );
  assert.equal(
    codingAgents?.querySelector("svg")?.outerHTML,
    renderToStaticMarkup(createElement(TerminalIcon)),
    "the page wears the terminal it always had",
  );
  assert.ok(!headings().includes("Notifications"));
  assert.ok(!headings().includes("Feedback"), "feedback is the account menu's and Help's");

  act(() => turnPage(SETTINGS_VIEW.CODING_AGENTS));
  assert.deepEqual(headings(), ["Default model", "API keys", "Notifications"]);
});

test("searching for an API key finds it on Coding agents, and pressing it lands on the key's row", async () => {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      recordSurfaceEvent: ignore,
      act: (request: Act) =>
        Promise.resolve(
          request.kind === ACT_KIND.PROVIDER_KEYS_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: { keys: [] } }
            : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
        ),
    },
  });
  const signedIn: AccountSnapshot = {
    status: ACCOUNT_STATUS.SIGNED_IN,
    name: "Ada Lovelace",
    email: "ada@example.com",
    provider: ACCOUNT_PROVIDER.GITHUB,
  };
  const container = mount(undefined, undefined, undefined, signedIn);
  type(field(container), "api key");
  assert.deepEqual(results(container), [
    { page: "Coding agents", rows: ["Anthropic API key", "OpenAI API key"] },
  ]);

  act(() => result(container, "OpenAI API key").click());
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
  assert.equal(shownPage(container), "Coding agents");
  const row = container.querySelector(
    `.settings-page [${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${SETTINGS_SEARCH_ROW.API_KEY_OPENAI}"]`,
  );
  assert.equal(row?.closest("section")?.querySelector("h2")?.textContent, "API keys");
});

test("clearing the query restores the page list, and Escape clears before it lets go", () => {
  const container = mount();
  const input = field(container);
  // Escape the field claims never reaches the window, whose own Escape turns
  // the page and the tab.
  const unwound: string[] = [];
  const onWindowKey = (event: KeyboardEvent) => unwound.push(event.key);
  window.addEventListener("keydown", onWindowKey);

  type(input, "voice");
  const clear = sidebar(container).querySelector<HTMLButtonElement>(
    "button[aria-label='Clear search']",
  );
  assert.ok(clear, "a standing query draws the clear button");
  act(() => clear.click());
  assert.equal(input.value, "");
  assert.equal(document.activeElement, input, "the cleared field keeps the caret");
  assert.equal(pageList(container).length, 7);

  type(input, "voice");
  // An Escape spent dismissing an input method's candidates leaves the query.
  press(input, "Escape", true);
  assert.equal(input.value, "voice");
  press(input, "Escape");
  assert.equal(input.value, "");
  assert.equal(pageList(container).length, 7);
  assert.equal(document.activeElement, input, "the first Escape only clears");

  press(input, "Escape");
  assert.notEqual(document.activeElement, input, "the second Escape lets go of the caret");
  assert.deepEqual(unwound, []);
  window.removeEventListener("keydown", onWindowKey);
});

test("the search's clear button hangs no pill, its glyph being the one every search field draws", () => {
  const container = mount();
  type(field(container), "voice");
  const clear = sidebar(container).querySelector<HTMLButtonElement>(
    "button[aria-label='Clear search']",
  );
  assert.ok(clear, "a standing query draws the clear button");
  act(() => {
    clear.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.equal(document.body.querySelector('[role="tooltip"]')?.textContent, undefined);
});

test("Command-F puts the caret in the search, whose empty field prints the chord until the caret arrives", () => {
  function Keyed() {
    useAppKeymap(true);
    return createElement(Harness);
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Keyed));
  });
  const input = field(container);
  const hint = () => sidebar(container).querySelector(".settings-search-shortcut");
  assert.equal(input.getAttribute("aria-keyshortcuts"), "Meta+F");
  assert.equal(hint()?.textContent, "⌘F");

  const event = new KeyboardEvent("keydown", { key: "f", metaKey: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  assert.equal(event.defaultPrevented, true);
  assert.equal(document.activeElement, input);

  type(input, "voice");
  assert.equal(hint(), null, "a query takes the chord's place");
  act(() => root.unmount());
});

test("a page off its defaults offers Reset to defaults in the toolbar, not in the page, and says a refusal beside it", async () => {
  const sent: Act[] = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      recordSurfaceEvent: ignore,
      act: (request: Act) => {
        sent.push(request);
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { status: ACTION_RESULT_STATUS.REJECTED, reason: "The settings are busy." },
        });
      },
    },
  });
  const container = mount(settingsView({ voiceAvailable: true, openAtLogin: false }));
  act(() => turnPage(SETTINGS_VIEW.APPEARANCE));
  const reset = toolbarButton(container, "Reset to defaults");
  assert.ok(reset, "the toolbar offers the page's reset");
  const resets = [...container.querySelectorAll("button")].filter((button) =>
    (button.getAttribute("aria-label") ?? button.textContent ?? "").startsWith("Reset"),
  );
  assert.deepEqual(resets, [reset], "the page itself carries no reset of its own");

  await act(async () => reset.click());
  assert.deepEqual(sent, [
    { kind: ACT_KIND.SETTINGS_RESET, payload: { scope: SETTINGS_RESET_SCOPE.APPEARANCE } },
  ]);
  assert.equal(
    container.querySelector(".desktop-toolbar [role='alert']")?.textContent,
    "The settings are busy.",
  );
});

/**
 * A store on the act channel that keeps every act asked of it, answers a
 * reset with the settings `left` says it leaves, and takes every write
 * unless `refusing` says otherwise.
 */
function installStore(left: AppSettings) {
  const sent: Act[] = [];
  const store = { sent, refusing: false };
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      recordSurfaceEvent: ignore,
      act: (request: Act) => {
        sent.push(request);
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value:
            store.refusing && request.kind === ACT_KIND.SETTING_UPDATE
              ? { status: ACTION_RESULT_STATUS.REJECTED, reason: "The settings are busy." }
              : { status: ACTION_RESULT_STATUS.ACCEPTED, settings: left },
        });
      },
    },
  });
  return store;
}

/** The settings a reset leaves of `before`: each it returned as `reset` says, the rest as they were. */
function leftOf(before: AppSettingsView, reset: Partial<AppSettings["stored"]>): AppSettings {
  return { stored: { ...before, ...reset }, status: { voiceAvailable: before.voiceAvailable } };
}

/** Lets the store's answers, and the redraws they cause, land. */
const settled = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  }),
);

function toastSays(): string | undefined {
  return newestToastSays();
}

function pressUndo(): void {
  const button = newestToastAction();
  assert.ok(button, "no Undo on the toast");
  act(() => button.click());
}

it.effect(
  "a reset that lands says so in a toast whose Undo writes back each setting the reset changed, and an Undo refused says so",
  () =>
    Effect.gen(function* () {
      const before = settingsView({ voiceAvailable: true, theme: THEME.DARK, openAtLogin: false });
      const store = installStore(
        leftOf(before, {
          theme: APP_SETTING_DEFAULTS.theme,
          openAtLogin: APP_SETTING_DEFAULTS.openAtLogin,
        }),
      );
      const container = mount(before, yield* registryOnTestClock);
      act(() => turnPage(SETTINGS_VIEW.APPEARANCE));
      const reset = toolbarButton(container, "Reset to defaults");
      assert.ok(reset);

      act(() => reset.click());
      yield* settled;
      assert.equal(toastSays(), "Appearance settings resetUndo");
      pressUndo();
      yield* settled;
      assert.deepEqual(store.sent, [
        { kind: ACT_KIND.SETTINGS_RESET, payload: { scope: SETTINGS_RESET_SCOPE.APPEARANCE } },
        { kind: ACT_KIND.SETTING_UPDATE, payload: { field: "theme", value: THEME.DARK } },
        { kind: ACT_KIND.SETTING_UPDATE, payload: { field: "openAtLogin", value: false } },
      ]);

      store.refusing = true;
      act(() => reset.click());
      yield* settled;
      pressUndo();
      yield* settled;
      assert.equal(toastSays(), "The settings could not be put back. Try again.");
      assert.equal(store.sent.length, 5, "the first refusal ends the Undo");
    }),
);

it.effect(
  "an Undo writes back no voice the file never held: one the launch resolved reads the same after the reset, and stays the launch's",
  () =>
    Effect.gen(function* () {
      // The environment chose cedar and the file holds no voice, so the reset leaves it cedar.
      const before = settingsView({
        voiceAvailable: true,
        voice: LIVE_VOICE.CEDAR,
        voiceCaptions: true,
      });
      const store = installStore(
        leftOf(before, { voiceCaptions: APP_SETTING_DEFAULTS.voiceCaptions }),
      );
      const container = mount(before, yield* registryOnTestClock);
      act(() => turnPage(SETTINGS_VIEW.VOICE));
      const reset = toolbarButton(container, "Reset to defaults");
      assert.ok(reset);

      act(() => reset.click());
      yield* settled;
      assert.equal(toastSays(), "Voice settings resetUndo");
      pressUndo();
      yield* settled;
      assert.deepEqual(store.sent.slice(1), [
        { kind: ACT_KIND.SETTING_UPDATE, payload: { field: "voiceCaptions", value: true } },
      ]);
    }),
);

test("a page at its defaults offers no reset", () => {
  const container = mount(settingsView({ voiceAvailable: true }));
  act(() => turnPage(SETTINGS_VIEW.APPEARANCE));
  assert.equal(toolbarButton(container, "Reset to defaults"), undefined);
});

test("the front page draws no Quit button, which the app menu's Quit already does", () => {
  const container = mount(settingsView({ voiceAvailable: true }));
  const words = [...container.querySelectorAll("button")].map((button) => button.textContent);
  assert.ok(!words.some((text) => text?.includes("Quit")));
});

test("the plan template stands as a plan's page beside the list, under its own toolbar, rather than as a page of the panel", () => {
  const container = mount();
  act(() => turnPage(SETTINGS_VIEW.PLAN_TEMPLATE));

  assert.ok(templatePage(container));
  assert.equal(shownPage(container), "", "the toolbar carries no title, the document does");
  assert.equal(container.querySelector(".settings-page-scroll"), null);
  assert.match(
    container.querySelector(".settings-page")?.textContent ?? "",
    /Sign in to edit the template/u,
  );
});

/** Answers the template page's reads: the account's own template, and no revisions. */
function answerTemplateReads(request: Act) {
  return Promise.resolve(
    request.kind === ACT_KIND.PLAN_TEMPLATE_READ
      ? { status: ACT_OUTCOME_STATUS.DONE, value: { template: "## Why\n", custom: true } }
      : request.kind === ACT_KIND.PLAN_TEMPLATE_REVISIONS
        ? { status: ACT_OUTCOME_STATUS.DONE, value: { revisions: [] } }
        : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
  );
}

/** A call standing while Settings is open. */
const CALL: CallCardInput = {
  card: {
    planName: "Parser cache migration",
    status: { voiceWord: "Listening", backend: { planner: undefined, notes: false } },
    microphoneMuted: false,
  },
  speakerMuted: false,
  controls: {
    onReturn: ignore,
    onToggleMicrophone: ignore,
    onToggleSpeaker: ignore,
    onEnd: ignore,
  },
};

/**
 * Settings, signed in, on the page `view` names, its reads answered with the
 * account's own template; `draw` draws it again on another page or with a
 * call, and `exits` counts how often Settings was left.
 */
async function mountSignedIn(view: SettingsView = SETTINGS_VIEW.PLAN_TEMPLATE) {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { recordSurfaceEvent: ignore, act: answerTemplateReads },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  const left = { exits: 0 };
  const settle = () =>
    act(async () => {
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    });
  const draw = async (page: SettingsView, call: CallCardInput | undefined = undefined) => {
    act(() =>
      root.render(
        createElement(DesktopSettings, {
          sidebar: {
            collapsed: false,
            width: SIDEBAR_WIDTH.DEFAULT,
            onToggle: ignore,
            onResize: ignore,
            staged: false,
          },
          history: navigationHistory(),
          call,
          settings: settingsPanelProps({
            view: page,
            onViewChange: ignore,
            account: {
              status: ACCOUNT_STATUS.SIGNED_IN,
              email: "dean@luke.test",
              name: "Dean",
              provider: ACCOUNT_PROVIDER.GITHUB,
            },
          }),
          onExit: () => {
            left.exits += 1;
          },
        }),
      ),
    );
    await settle();
  };
  await draw(view);
  const openHistory = async () => {
    act(() =>
      container
        .querySelector<HTMLButtonElement>('.plan-title-actions [aria-label="Version history"]')
        ?.click(),
    );
    await settle();
  };
  return { container, left, draw, settle, openHistory };
}

test("the template's version history takes the whole window from the page's title line, and Escape and Back leave it for the template rather than leaving Settings", async () => {
  const { container, left, settle, openHistory } = await mountSignedIn();
  assert.ok(
    container.querySelector('.plan-title-actions [aria-label="Version history"]'),
    "the template's title line offers its version history",
  );

  await openHistory();
  assert.equal(container.querySelector(".settings-pages"), null, "the page list gives way");
  assert.ok(container.querySelector(".desktop-version-history"));
  assert.equal(runAppCommand(APP_COMMAND.EXIT_SETTINGS), false);
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY);
  });
  await settle();
  assert.ok(container.querySelector(".settings-pages"), "Escape leaves for the template");
  assert.ok(templatePage(container));

  await openHistory();
  act(() => container.querySelector<HTMLButtonElement>(".version-log-back")?.click());
  await settle();
  assert.ok(templatePage(container), "Back leaves for the template too");
  assert.equal(left.exits, 0, "Settings was never left");
});

test("a page turned while the template's history stands leaves it, so coming back finds the template", async () => {
  const { container, draw, openHistory } = await mountSignedIn();
  await openHistory();

  await draw(SETTINGS_VIEW.SHORTCUTS);
  await draw(SETTINGS_VIEW.PLAN_TEMPLATE);

  assert.equal(container.querySelector(".desktop-version-history"), null);
  assert.ok(templatePage(container));
});

test("a call's card rides the page list, and floats over the template's history, which has none", async () => {
  const { draw, openHistory } = await mountSignedIn();
  await draw(SETTINGS_VIEW.PLAN_TEMPLATE, CALL);
  const cards = () =>
    [...document.body.querySelectorAll<HTMLElement>('.call-card[data-leaving="false"]')].map(
      (card) => card.dataset.surface ?? "",
    );
  assert.deepEqual(cards(), ["sidebar"]);

  await openHistory();
  assert.deepEqual(cards(), ["floating"]);
});
