// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PRODUCT_SURFACE_EVENT } from "@luke/features/analytics";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { runAppCommand } from "@luke/panel/app-commands";
import { type CallCardInput, callControls } from "@luke/panel/call/call-card";
import { SIDEBAR_OVERLAY } from "@luke/panel/desktop/sidebar-collapse";
import type { SettingsPanelProps } from "@luke/panel/settings/settings-panel";
import type { WorkspaceSettingsControl } from "@luke/panel/settings/workspace-page";
import { fakeAppBridge, fakeAppBridgeCalls } from "@luke/panel/testing/app-bridge";
import { DESKTOP_CAPABILITIES } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";
import { DesktopSettings } from "./desktop-settings";

/**
 * Settings as the desktop draws it: the sidebar is the one list of pages,
 * grouped under the workspace the tasks' sidebar lists, Account, and This
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

/** The Workspace page's control with `listed` the workspace the tasks' sidebar lists. */
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
  { words: "Minimize inline comments", page: "Appearance" },
  { words: "Dark theme", page: "Appearance" },
];

const ACCOUNT: SettingsPanelProps["account"] = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dev@example.com",
  name: "Dev",
  provider: "github",
};

/** A signed-in account's Settings over voice that can run, on the desktop unless the platform is named, every press but a page's ignored. */
function settingsProps(
  view: SettingsView,
  onViewChange: (view: SettingsView) => void,
  capabilities: readonly HostCapability[] = DESKTOP_CAPABILITIES,
) {
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
    capabilities,
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

/** Settings holding its own page, as the app holds it, opened on Profile, over the workspaces the tasks' sidebar lists where it is handed them. */
function SettingsHarness({
  workspace,
  opensOn = SETTINGS_VIEW.ACCOUNT,
  call,
  onExit = ignore,
  capabilities,
}: {
  workspace?: WorkspaceSettingsControl;
  opensOn?: SettingsView;
  call?: CallCardInput;
  onExit?: () => void;
  capabilities?: readonly HostCapability[];
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
    settings: {
      ...settingsProps(view, setView, capabilities),
      ...(workspace ? { workspace } : undefined),
    },
    call,
    onExit,
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
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
  fakeAppPlatform(QUIET_PANEL);
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

/** The title of the page drawn beside the sidebar: its own `h1`, the sidebar's being Settings'. */
function shownTitle(page: HTMLElement): string | null | undefined {
  return [...page.querySelectorAll("h1")].find((title) => title.closest("nav") === null)
    ?.textContent;
}

/** What scrolls the page drawn beside the sidebar: the shared settings page around its title. */
function shownScroller(page: HTMLElement): HTMLElement {
  const title = [...page.querySelectorAll("h1")].find((each) => each.closest("nav") === null);
  return title?.closest<HTMLElement>(".luke-settings-page") ?? assert.fail("the page scrolls");
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
  assert.equal(shownTitle(page), "Profile");
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
  const first = shownTitle(page);

  redraw(createElement(SettingsHarness, { workspace: listing(ACME) }));

  assert.equal(first, "Dana Reyes");
  assert.equal(shownTitle(page), "Acme");
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

/** Types `words` into the sidebar's search, answering the pages whose result groups hold them. */
function foundUnder(page: HTMLElement, words: string): (string | null)[] {
  const field = page.querySelector<HTMLInputElement>('input[aria-label="Search settings"]');
  assert.ok(field, "the search field is drawn");
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return [...page.querySelectorAll("nav section[aria-label]")]
    .filter((group) => group.textContent?.includes(words))
    .map((group) => group.getAttribute("aria-label"));
}

test("the Settings search finds each moved option under its new page", () => {
  const page = mount(createElement(SettingsHarness));
  for (const { words: option, page: home, ...named } of HOMES) {
    const words = "found" in named ? named.found : option;
    assert.deepEqual(foundUnder(page, words), [home], `${words} is found under ${home}`);
  }
});

test("a platform without voice, notifications, Mac commands, or updates lists none of their pages, draws About without its Updates row, and its search finds none of them", () => {
  const missing: readonly HostCapability[] = [
    HOST_CAPABILITY.VOICE,
    HOST_CAPABILITY.NOTIFICATIONS,
    HOST_CAPABILITY.MAC_COMMANDS,
    HOST_CAPABILITY.UPDATES,
  ];
  const capabilities = DESKTOP_CAPABILITIES.filter((each) => !missing.includes(each));
  const page = mount(createElement(SettingsHarness, { capabilities }));

  assert.deepEqual(pageGroups(page)[2], {
    heading: "This Mac",
    rows: ["Appearance", "About", "Keyboard shortcuts"],
  });
  const about = openPage(page, "About").textContent ?? "";
  assert.equal(about.includes("Changelog"), true);
  assert.equal(about.includes("Check for updates"), false);
  for (const words of [
    "Talk to Luke",
    "Notify me when a coding agent finishes or needs me",
    "Let agents run commands on this Mac",
    "Updates",
  ]) {
    assert.deepEqual(foundUnder(page, words), [], `${words} is found nowhere`);
  }
});

test("a platform with voice but without its own microphone route draws Voice without the Microphone permission row or Prefer the Mac's microphone, and its search finds neither", () => {
  const voicePage = (capabilities: readonly HostCapability[]) => {
    const page = mount(createElement(SettingsHarness, { capabilities }));
    const words = openPage(page, "Voice").textContent ?? "";
    const found = foundUnder(page, "Microphone");
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    return { words, found };
  };

  const desktop = voicePage(DESKTOP_CAPABILITIES);
  const without = voicePage(
    DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.MICROPHONE),
  );

  assert.ok(desktop.words.includes("Prefer the Mac's microphone"));
  assert.ok(desktop.words.includes("Microphone"));
  assert.ok(desktop.found.includes("Voice"));
  assert.equal(without.words.includes("Prefer the Mac's microphone"), false);
  assert.equal(without.words.includes("Microphone"), false);
  assert.equal(without.found.includes("Voice"), false);
});

test("Keyboard shortcuts lists Show terminal and the Call group's chords only on a platform offering terminals and voice, and its search finds them only there", () => {
  const listed = (capabilities: readonly HostCapability[]) => {
    const page = mount(createElement(SettingsHarness, { capabilities }));
    const words = openPage(page, "Keyboard shortcuts").textContent ?? "";
    const found = foundUnder(page, "Show terminal");
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    return {
      terminal: words.includes("Show terminal"),
      call: words.includes("Toggle microphone"),
      found,
    };
  };
  const without = DESKTOP_CAPABILITIES.filter(
    (each) => each !== HOST_CAPABILITY.TERMINALS && each !== HOST_CAPABILITY.VOICE,
  );

  assert.deepEqual(listed(DESKTOP_CAPABILITIES), {
    terminal: true,
    call: true,
    found: ["Keyboard shortcuts"],
  });
  assert.deepEqual(listed(without), { terminal: false, call: false, found: [] });
});

test("Appearance draws every diff setting in a Diffs group of its own, under the page's own rows", () => {
  const page = mount(createElement(SettingsHarness, { opensOn: SETTINGS_VIEW.APPEARANCE }));
  const group =
    [...page.querySelectorAll("section[aria-labelledby]")].find(
      (each) =>
        document.getElementById(each.getAttribute("aria-labelledby") ?? "")?.textContent ===
        "Diffs",
    ) ?? assert.fail("a Diffs group stands");
  assert.deepEqual(
    [...group.querySelectorAll('[role="switch"], [aria-haspopup]')].map(
      // A pop-up's name ends with the value it names, which is not the row's.
      (control) => control.getAttribute("aria-label")?.split(": ")[0],
    ),
    [
      "Line numbers",
      "Word wrap",
      "Layout",
      "Indicators",
      "Inline diffs",
      "Backgrounds",
      "Dark theme",
      "Light theme",
      "Font",
      "Font size",
      "Line height",
      "Ligatures",
      "Minimize inline comments",
    ],
  );
});

test("a page turned to opens at its top, not where the last page was scrolled", () => {
  const page = mount(createElement(SettingsHarness));
  openPage(page, "Voice");
  const scroller = shownScroller(page);
  // Note that jsdom lays nothing out, so the scroll offset is held by hand.
  Object.defineProperty(scroller, "scrollTop", { configurable: true, writable: true, value: 400 });
  openPage(page, "Coding agents");
  assert.equal(shownScroller(page).scrollTop, 0);
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

/** Presses Escape where the caret stands, mid-composition where `composing`, the window answering what nothing nearer kept as its own Escape does. */
function pressEscape(composing = false): void {
  const leave = (event: KeyboardEvent) => {
    if (event.key === "Escape") runAppCommand(APP_COMMAND.EXIT_SETTINGS);
  };
  window.addEventListener("keydown", leave);
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: composing }),
    );
  });
  window.removeEventListener("keydown", leave);
}

/** Counts the searches the window reports opened. */
function countSearchOpens() {
  let opens = 0;
  fakeAppPlatform({
    ...QUIET_PANEL,
    recordSurfaceEvent: (event: string) => {
      if (event === PRODUCT_SURFACE_EVENT.SEARCH_OPEN) opens += 1;
    },
  });
  return () => opens;
}

test("Settings opens with the caret in its search, uncounted as a search opened, and Escape there leaves Settings in one press", () => {
  const searchesOpened = countSearchOpens();
  let exits = 0;
  const page = mount(createElement(SettingsHarness, { onExit: () => (exits += 1) }));
  const field = fieldNamed(page, SIDEBAR_SEARCH);
  assert.ok(document.activeElement === field, "the caret stands in the search");
  assert.equal(searchesOpened(), 0);

  // An input method's Escape dismisses its candidates and leaves nothing.
  pressEscape(true);
  assert.equal(exits, 0);
  pressEscape();
  assert.equal(exits, 1);

  // A caret put back by hand is a search opened, and holds Escape as its own.
  act(() => field?.blur());
  act(() => field?.focus());
  assert.equal(searchesOpened(), 1);
  pressEscape();
  assert.equal(exits, 1);
  assert.ok(document.activeElement !== field, "the search let go of the caret");
});

test("once the opening caret's search is typed in, Escape clears it, then lets go of the caret, and only then leaves Settings", () => {
  let exits = 0;
  const page = mount(createElement(SettingsHarness, { onExit: () => (exits += 1) }));
  const field = fieldNamed(page, SIDEBAR_SEARCH) ?? assert.fail("the sidebar's search");
  typeInto(field, "voice");

  pressEscape();
  assert.equal(field.value, "");
  assert.ok(document.activeElement === field, "the caret stands in the search");
  pressEscape();
  assert.ok(document.activeElement !== field, "the search let go of the caret");
  assert.equal(exits, 0);
  pressEscape();
  assert.equal(exits, 1);
});

test("a caret already in the window as Settings opens keeps it", () => {
  const landed = document.createElement("button");
  document.body.append(landed);
  landed.focus();
  mount(createElement(SettingsHarness));
  assert.ok(document.activeElement === landed, "the caret stays where it was");
});

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
  assert.equal(shownTitle(page), "Integrations");
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

test("the plan template's version history keeps a call's card at the foot of its versions, as Settings' page list held it, and its way back asks for the call's plan", async () => {
  const sent: string[] = [];
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    act: (request: { kind: string }) => {
      sent.push(request.kind);
      return Promise.resolve(
        request.kind === ACT_KIND.PLAN_TEMPLATE_READ
          ? { status: ACT_OUTCOME_STATUS.DONE, value: { template: "# Context\n", custom: false } }
          : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
      );
    },
  });
  // The card's presses sent as `App` sends them, over the bridge.
  function CallSettings(): React.JSX.Element {
    const { tell } = useAct();
    const call: CallCardInput = {
      card: { taskName: "Checkout redesign", status: undefined, microphoneMuted: false },
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
  assert.deepEqual(sent, [ACT_KIND.CALL_SHOW_TASK]);
});

test("while the plan template is read its page stands its name over placeholder blocks, and the template lands in their place", async () => {
  const { promise: read, resolve: land } = Promise.withResolvers<void>();
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    act: (request: { kind: string }) =>
      request.kind === ACT_KIND.PLAN_TEMPLATE_READ
        ? read.then(() => ({
            status: ACT_OUTCOME_STATUS.DONE,
            value: { template: "# Context\n", custom: false },
          }))
        : Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
  const page = mount(createElement(SettingsHarness, { opensOn: SETTINGS_VIEW.PLAN_TEMPLATE }));
  const placeholder = () => page.querySelector('[role="status"][aria-busy="true"]')?.textContent;

  assert.deepEqual(
    [shownTitle(page), placeholder()],
    ["Plan template", "Loading your plan template"],
  );
  land();
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  assert.equal(placeholder(), undefined);
  assert.ok(page.querySelector('button[aria-label="Version history"]'), "the template is drawn");
});

test("a page's row in the sidebar offers Copy link on a right-click, copying the page's link under the listed workspace", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
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
