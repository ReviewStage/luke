// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import { settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { layContainersAt } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import {
  focusByKeyboard,
  layWindowStyles,
  reachOf,
  ringOf,
  scrollRoomOf,
} from "#testing/focus-ring";
import { fadedEdges, layFades } from "#testing/scroll-fade";
import { useAct } from "../act";
import { runAppCommand } from "../app-commands";
import { type CallCardInput, callControls } from "../call/call-card";
import type { SettingsPanelProps } from "../settings/settings-panel";
import type { WorkspaceSettingsControl } from "../settings/workspace-page";
import { DesktopSettings } from "./desktop-settings";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse";

/**
 * Settings as the desktop draws it: the sidebar is the one list of pages,
 * grouped under the workspace the plans' sidebar lists, Account, and This
 * Mac, opening on Profile, and every option moved by the one-home layout is
 * drawn on its new page and on no other, as the search finds it there too.
 * The Workspace page is titled with the listed workspace and follows the
 * sidebar. The Integrations page's own search stands beside the sidebar's:
 * Command-F lands in the nearer one, and a sidebar result that opens an
 * integration hands its query down.
 */

const ignore = () => undefined;
const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

/** The sidebar's groups and their rows, in the order the approved layout lists them, where no workspace is listed to head the first. */
const PAGE_GROUPS = [
  { heading: "Workspace", rows: ["Workspace"] },
  {
    heading: "Account",
    rows: ["Profile", "Coding agents", "Integrations", "Plan template", "Experimental"],
  },
  {
    heading: "This Mac",
    rows: ["Voice", "Appearance", "Notifications", "This Mac", "About", "Keyboard shortcuts"],
  },
];

/** Every row the sidebar lists, which is also each page's title but the Workspace page's. */
const PAGE_TITLES = PAGE_GROUPS.flatMap((group) => group.rows);

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: null,
};
const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Dana Reyes",
  slug: "dana-reyes",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

/** The Workspace page's control with `listed` the workspace the plans' sidebar lists. */
function listing(listed: Workspace): WorkspaceSettingsControl {
  return {
    workspaces: [PERSONAL, ACME],
    workspaceId: listed.id,
    onLeft: ignore,
    listFailed: false,
    onRetryList: ignore,
  };
}

/** Each moved option's words, the one page that holds it, and the name the search finds its row by where that differs. */
const HOMES = [
  { words: "Sign out", page: "Profile" },
  { words: "Delete account", page: "Profile" },
  { words: "Talk to Luke", page: "Voice" },
  { words: "Stop Luke", page: "Voice" },
  { words: "Notify me when a coding agent finishes or needs me", page: "Notifications" },
  { words: "Let agents run commands on this Mac", page: "This Mac" },
  { words: "Check for updates", page: "About", found: "Updates" },
  { words: "Changelog", page: "About" },
];

const ACCOUNT: SettingsPanelProps["account"] = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dev@example.com",
  name: "Dev",
  provider: "github",
};

/** A signed-in account's Settings over voice that can run, every press but a page's ignored. */
function settingsProps(view: SettingsView, onViewChange: (view: SettingsView) => void) {
  return {
    account: ACCOUNT,
    onSignOut: () => Promise.resolve(),
    onDeleteAccount: accepted,
    view,
    onViewChange,
    microphone: {
      status: MICROPHONE_STATUS.GRANTED,
      voiceAvailable: true,
      onRequest: ignore,
      onOpenSettings: ignore,
    },
    notifications: {
      status: NOTIFICATIONS_STATUS.UNKNOWN,
      packaged: true,
      onOpenSettings: ignore,
      onTest: ignore,
    },
    updates: {
      update: {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "1.0.0",
        installSupported: true,
        upToDate: false,
      },
      build: { packaged: false },
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onOpenLatest: ignore,
    },
    settings: settingsView({ voiceAvailable: true }),
    shortcuts: {
      voiceHotkey: "Alt+Space",
      voiceHotkeyHeld: true,
      voiceChosen: false,
      voiceOff: false,
      onVoiceHotkeyChange: accepted,
      stopHotkey: "Alt+Escape",
      stopChosen: false,
      stopOff: false,
      onStopHotkeyChange: accepted,
      onCapture: ignore,
    },
  } satisfies SettingsPanelProps;
}

/** Settings holding its own page, as the app holds it, opened on Profile, over the workspaces the plans' sidebar lists where it is handed them. */
function SettingsHarness({
  workspace,
  opensOn = SETTINGS_VIEW.ACCOUNT,
  call,
}: {
  workspace?: WorkspaceSettingsControl;
  opensOn?: SettingsView;
  call?: CallCardInput;
}): React.JSX.Element {
  const [view, setView] = useState<SettingsView>(opensOn);
  return createElement(DesktopSettings, {
    sidebar: {
      collapsed: false,
      compact: false,
      overlay: SIDEBAR_OVERLAY.CLOSED,
      width: 264,
      onToggle: ignore,
      onOverlay: ignore,
      onResize: ignore,
      staged: false,
    },
    history: {
      canGoBack: false,
      canGoForward: false,
      onBack: ignore,
      onForward: ignore,
    },
    settings: { ...settingsProps(view, setView), ...(workspace ? { workspace } : undefined) },
    call,
    onExit: ignore,
  });
}

let root: Root | undefined;
let registry = AtomRegistry.make();

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry = AtomRegistry.make();
  act(() => root?.render(onRegistry(registry, element)));
  return container;
}

/** Draws the mounted root again over `element`, as a new render of the app hands Settings new props. */
function redraw(element: React.ReactElement): void {
  act(() => root?.render(onRegistry(registry, element)));
}

/** An element's words as a reader hears them, what is hidden from a screen reader left out. */
function spoken(element: Element): string {
  const copy = element.cloneNode(true);
  assert.ok(copy instanceof Element);
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent ?? "";
}

/** The sidebar's groups as they read: each heading and the rows under it. */
function pageGroups(page: HTMLElement): { heading: string; rows: string[] }[] {
  return [...page.querySelectorAll('nav[aria-label="Settings pages"] .settings-nav-group')].map(
    (group) => ({
      heading: spoken(group.querySelector("h2") ?? assert.fail("a group without a heading")),
      rows: [...group.querySelectorAll("li button")].map((each) => each.textContent ?? ""),
    }),
  );
}

/** The sidebar's pages, by name. */
function pageButtons(page: HTMLElement): HTMLButtonElement[] {
  return [
    ...page.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings pages"] li button'),
  ];
}

/** Opens the page the sidebar names, answering the page drawn beside it. */
function openPage(page: HTMLElement, title: string): HTMLElement {
  const button = pageButtons(page).find((each) => each.textContent === title);
  assert.ok(button, `the sidebar lists ${title}`);
  act(() => button.click());
  const drawn = page.querySelector<HTMLElement>(".settings-page, .plan-template-page");
  assert.ok(drawn, `${title} is drawn`);
  return drawn;
}

test("Settings opens on Profile, and its sidebar lists every page once under Workspace, Account, and This Mac where no workspace is listed", () => {
  const page = mount(createElement(SettingsHarness));
  assert.deepEqual(pageGroups(page), PAGE_GROUPS);
  const current = pageButtons(page).find((each) => each.getAttribute("aria-current") === "page");
  assert.equal(current?.textContent, "Profile");
  assert.equal(page.querySelector(".settings-page-title")?.textContent, "Profile");
});

test("Settings' page list fades over the sidebar's foot and a page fades into the drag strip above it, rather than being sliced at either", () => {
  const page = mount(createElement(SettingsHarness));
  const sheets = layFades();
  try {
    const list = page.querySelector(".sidebar-section") ?? assert.fail("the pages are listed");
    const column = page.querySelector(".settings-page-scroll") ?? assert.fail("a page stands");
    assert.deepEqual(fadedEdges(list), { top: true, bottom: true });
    assert.deepEqual(fadedEdges(column), { top: true, bottom: false });
  } finally {
    sheets.remove();
  }
});

test("the sidebar's first group is headed by the listed workspace's name, over its Workspace page", () => {
  const page = mount(createElement(SettingsHarness, { workspace: listing(ACME) }));
  assert.deepEqual(
    pageGroups(page).map((group) => group.heading),
    ["Acme", "Account", "This Mac"],
  );
  assert.deepEqual(pageGroups(page)[0]?.rows, ["Workspace"]);
});

test("the Workspace page is titled with the workspace the sidebar lists, and follows the sidebar when it lists another", () => {
  const page = mount(createElement(SettingsHarness, { workspace: listing(PERSONAL) }));
  openPage(page, "Workspace");
  const first = page.querySelector(".settings-page-title")?.textContent;

  redraw(createElement(SettingsHarness, { workspace: listing(ACME) }));

  assert.equal(first, "Dana Reyes");
  assert.equal(page.querySelector(".settings-page-title")?.textContent, "Acme");
  assert.equal(pageGroups(page)[0]?.heading, "Acme");
});

test("every moved option is drawn on its one page and on no other", () => {
  const page = mount(createElement(SettingsHarness));
  const words = new Map(PAGE_TITLES.map((title) => [title, openPage(page, title).textContent]));
  for (const { words: option, page: home } of HOMES) {
    const holding = PAGE_TITLES.filter((title) => words.get(title)?.includes(option));
    assert.deepEqual(holding, [home], `${option} lives on ${home} alone`);
  }
});

test("the Settings search finds each moved option under its new page", () => {
  const page = mount(createElement(SettingsHarness));
  const field = page.querySelector<HTMLInputElement>("input.settings-search-input");
  assert.ok(field, "the search field is drawn");
  for (const { words: option, page: home, ...named } of HOMES) {
    const words = "found" in named ? named.found : option;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const groups = [...page.querySelectorAll("nav section[aria-label]")].filter((group) =>
      group.textContent?.includes(words),
    );
    assert.deepEqual(
      groups.map((group) => group.getAttribute("aria-label")),
      [home],
      `${words} is found under ${home}`,
    );
  }
});

test("a page turned to opens at its top, not where the last page was scrolled", () => {
  const page = mount(createElement(SettingsHarness));
  openPage(page, "Voice");
  const scroller = page.querySelector<HTMLElement>(".settings-page-scroll");
  assert.ok(scroller, "the page scrolls");
  // Note that jsdom lays nothing out, so the scroll offset is held by hand.
  Object.defineProperty(scroller, "scrollTop", { configurable: true, writable: true, value: 400 });
  openPage(page, "Coding agents");
  assert.equal(page.querySelector<HTMLElement>(".settings-page-scroll")?.scrollTop, 0);
});

/** Types `words` over whatever the field holds, as the developer would. */
function typeInto(field: HTMLInputElement, words: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The field labelled `label`. */
function fieldNamed(page: HTMLElement, label: string): HTMLInputElement | null {
  return page.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
}

const SIDEBAR_SEARCH = "Search settings";
const PAGE_SEARCH = "Search integrations and tools";

/** Presses the sidebar's result named `name` under the Integrations page's heading. */
function openIntegrationResult(page: HTMLElement, name: string): void {
  const result = [
    ...page.querySelectorAll<HTMLButtonElement>('nav section[aria-label="Integrations"] button'),
  ].find((button) => button.textContent === name);
  assert.ok(result, `the search finds ${name} under Integrations`);
  act(() => result.click());
}

test("Command-F lands in the Integrations page's own search while it shows, and in the sidebar's elsewhere", () => {
  const page = mount(createElement(SettingsHarness));
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  assert.equal(document.activeElement, fieldNamed(page, SIDEBAR_SEARCH));

  openPage(page, "Integrations");
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  assert.equal(document.activeElement, fieldNamed(page, PAGE_SEARCH));
  assert.equal(fieldNamed(page, SIDEBAR_SEARCH)?.hasAttribute("aria-keyshortcuts"), false);
});

test("a sidebar result that opens an integration hands its query to the page's search where it finds that integration there, and clears it where not", () => {
  const page = mount(createElement(SettingsHarness));
  const sidebar = fieldNamed(page, SIDEBAR_SEARCH);
  assert.ok(sidebar, "the sidebar's search is drawn");

  typeInto(sidebar, "postgres");
  openIntegrationResult(page, "Neon");
  assert.equal(page.querySelector(".settings-page-title")?.textContent, "Integrations");
  assert.equal(fieldNamed(page, PAGE_SEARCH)?.value, "postgres");

  // Note that "mcp" finds every integration's row in the sidebar but none by
  // the page's own words, so it stays behind and the page's search is
  // cleared, so the row the landing seeks is drawn.
  typeInto(sidebar, "mcp");
  openIntegrationResult(page, "Linear");
  assert.equal(fieldNamed(page, PAGE_SEARCH)?.value, "");
});

test("the Integrations page's search is cleared when another page is turned to", () => {
  const page = mount(createElement(SettingsHarness));
  openPage(page, "Integrations");
  typeInto(fieldNamed(page, PAGE_SEARCH) ?? assert.fail("the page's search"), "deploy");

  openPage(page, "Voice");
  openPage(page, "Integrations");

  assert.equal(fieldNamed(page, PAGE_SEARCH)?.value, "");
});

test("the keyboard scrolls a page's row in with its ring to spare, and the plan template's words in clear of the fade at its top", async () => {
  const styles = await layWindowStyles();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...window.luke,
      act: (request: { kind: string }) =>
        Promise.resolve(
          request.kind === ACT_KIND.PLAN_TEMPLATE_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: { template: "# Context\n", custom: false } }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
        ),
    },
  });
  const page = mount(createElement(SettingsHarness, { opensOn: SETTINGS_VIEW.PLAN_TEMPLATE }));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  for (const row of pageButtons(page)) {
    focusByKeyboard(row);
    const ring = ringOf(row);
    assert.ok(ring, `${row.textContent} rings`);
    assert.ok(
      scrollRoomOf(row) >= reachOf(ring),
      `${row.textContent} scrolls in with its ring's reach to spare`,
    );
  }
  const scroller = page.querySelector(".template-document .plan-document-scroll");
  assert.ok(scroller, "the template's words scroll");
  const fade = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--scroll-fade"),
  );
  assert.ok(fade > 0, "the scroller's top fades");
  assert.ok(
    Number.parseFloat(getComputedStyle(scroller).getPropertyValue("scroll-padding-top")) >= fade,
    "what the keyboard reaches there is scrolled in past the fade",
  );
  styles.remove();
});

test("the plan template's version history keeps a call's card at the foot of its versions, as Settings' page list held it, and its way back asks for the call's plan", async () => {
  const sent: string[] = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...window.luke,
      act: (request: { kind: string }) => {
        sent.push(request.kind);
        return Promise.resolve(
          request.kind === ACT_KIND.PLAN_TEMPLATE_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: { template: "# Context\n", custom: false } }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
        );
      },
    },
  });
  // The card's presses sent as `App` sends them, over the bridge.
  function CallSettings(): React.JSX.Element {
    const { tell } = useAct();
    const call: CallCardInput = {
      card: { planName: "Checkout redesign", status: undefined, microphoneMuted: false },
      speakerMuted: false,
      controls: callControls(tell, false),
    };
    return createElement(SettingsHarness, { opensOn: SETTINGS_VIEW.PLAN_TEMPLATE, call });
  }
  const page = mount(createElement(CallSettings));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const history = page.querySelector<HTMLButtonElement>('button[aria-label="Version history"]');
  assert.ok(history, "the template page offers its version history");
  act(() => history.click());

  const versions = page.querySelector('nav[aria-label="Versions"]');
  assert.ok(versions, "the template's versions stand where the page list was");
  const cards = page.querySelectorAll<HTMLElement>('section.call-card[aria-label="Call"]');
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.ok(card);
  assert.deepEqual(
    {
      surface: card.dataset.surface,
      docked: card.closest(".sidebar-foot")?.parentElement === versions,
    },
    { surface: "sidebar", docked: true },
  );
  sent.length = 0;
  const back = card.querySelector<HTMLButtonElement>('button[aria-label="Open Checkout redesign"]');
  assert.ok(back);
  act(() => back.click());
  assert.deepEqual(sent, [ACT_KIND.CALL_SHOW_PLAN]);
});

test("a page's row in the sidebar offers Copy link on a right-click, copying the page's link under the listed workspace", async () => {
  const copied: string[] = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.WINDOW_COPY_TEXT) copied.push(request.payload.words);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
    },
  });
  const page = mount(createElement(SettingsHarness, { workspace: listing(ACME) }));
  const row = pageButtons(page).find((each) => each.textContent === "Workspace");
  assert.ok(row, "the Workspace page is listed");
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link",
  );
  assert.ok(item, "the row's menu offers Copy link");
  await act(async () => item.click());

  assert.deepEqual(copied, ["https://tryluke.dev/acme/settings/workspace"]);
});

/** The page's row whose name begins `name`. */
function rowNamed(page: HTMLElement, name: string): HTMLElement {
  return (
    [...page.querySelectorAll<HTMLElement>(".settings-row")].find((row) =>
      row.querySelector(".settings-copy strong")?.textContent?.startsWith(name),
    ) ?? assert.fail(`no ${name} row`)
  );
}

/** How a row lays out what it holds: whether it wraps, and the least room its words keep. */
function layout(row: HTMLElement) {
  const words = row.querySelector(".settings-copy") ?? assert.fail("a row without words");
  return { wraps: getComputedStyle(row).flexWrap, words: getComputedStyle(words).minWidth };
}

test("a page too narrow for a row's words beside its control drops the control under the words, which keep the row's first line, and a page wide enough keeps them side by side", () => {
  const page = mount(createElement(SettingsHarness, { opensOn: SETTINGS_VIEW.APPEARANCE }));
  const rows = () => ["Theme", "Zoom"].map((name) => layout(rowNamed(page, name)));

  // The page column beside the page list at its widest, in the smallest window.
  const narrow = layContainersAt({ settings: 270 });
  try {
    assert.deepEqual(rows(), [
      { wraps: "wrap", words: "60%" },
      { wraps: "wrap", words: "60%" },
    ]);
  } finally {
    narrow.remove();
  }
  // The same window with the page list at its own width.
  const wide = layContainersAt({ settings: 406 });
  try {
    assert.deepEqual(
      rows().map((row) => row.wraps),
      ["nowrap", "nowrap"],
    );
  } finally {
    wide.remove();
  }
});

test("the plan template's title line drops its history and Reset under the title where the column is too narrow for both, rather than breaking the title inside a word", async () => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...window.luke,
      act: (request: { kind: string }) =>
        Promise.resolve(
          request.kind === ACT_KIND.PLAN_TEMPLATE_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: { template: "# Context\n", custom: true } }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
        ),
    },
  });
  const page = mount(createElement(SettingsHarness, { opensOn: SETTINGS_VIEW.PLAN_TEMPLATE }));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const line =
    page.querySelector<HTMLElement>(".plan-page-head .plan-title-line") ??
    assert.fail("no title line");
  assert.ok(line.querySelector(".plan-title-actions"), "the actions stand on the title's line");

  const sheets = layContainersAt({});
  try {
    assert.equal(getComputedStyle(line).flexWrap, "wrap");
  } finally {
    sheets.remove();
  }
});
