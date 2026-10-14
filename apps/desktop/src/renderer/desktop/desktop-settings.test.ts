// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { settingsView } from "@sidecar/settings/testing";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { UPDATE_STATUS } from "#shared/messages/update";
import { onRegistry } from "#testing/copy-feedback";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { DesktopSettings } from "./desktop-settings";

/**
 * Settings as the desktop draws it: the sidebar is the one list of pages,
 * Account first, and every option moved by the one-home layout is drawn on
 * its new page and on no other, as the search finds it there too.
 */

const ignore = () => undefined;
const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

/** The sidebar's pages, in the order the approved layout lists them. */
const PAGE_TITLES = [
  "Account",
  "Workspace",
  "Coding agents",
  "Integrations",
  "Plan template",
  "Voice",
  "Appearance",
  "Notifications",
  "This Mac",
  "About",
  "Keyboard shortcuts",
];

/** Each moved option's words, the one page that holds it, and the name the search finds its row by where that differs. */
const HOMES = [
  { words: "Sign out", page: "Account" },
  { words: "Delete account", page: "Account" },
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
    notifications: { refused: false, onOpenSettings: ignore },
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

/** Settings holding its own page, as the app holds it, opened on Account. */
function SettingsHarness(): React.JSX.Element {
  const [view, setView] = useState<SettingsView>(SETTINGS_VIEW.ACCOUNT);
  return createElement(DesktopSettings, {
    sidebar: { collapsed: false, width: 264, onToggle: ignore, onResize: ignore, staged: false },
    history: {
      canGoBack: false,
      canGoForward: false,
      onBack: ignore,
      onForward: ignore,
    },
    settings: settingsProps(view, setView),
    call: undefined,
    onExit: ignore,
  });
}

let root: Root | undefined;

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  Object.defineProperty(window, "sidecar", {
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
  act(() => root?.render(onRegistry(AtomRegistry.make(), element)));
  return container;
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

test("Settings opens on Account, and its sidebar lists every page once, in the approved order", () => {
  const page = mount(createElement(SettingsHarness));
  assert.deepEqual(
    pageButtons(page).map((each) => each.textContent),
    PAGE_TITLES,
  );
  const current = pageButtons(page).find((each) => each.getAttribute("aria-current") === "page");
  assert.equal(current?.textContent, "Account");
  assert.equal(page.querySelector(".settings-page-title")?.textContent, "Account");
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
