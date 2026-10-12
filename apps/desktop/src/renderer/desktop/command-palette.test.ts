// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { codingAgentsControl, plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { useAppCommand, useAppKeymap } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { isAgentTab } from "../planning/tab-strip-model";
import { NO_LOOKS } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { settingsRowsInput } from "../settings/settings-panel";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { CommandPalette } from "./command-palette";
import { DesktopPlans } from "./desktop-plans";

const OPEN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/docs",
  document: { body: "# Teammate invitations", assumptions: [] },
};

/** Two plans of one name, told apart only by their repositories. */
const TWINS: readonly PlanSummary[] = [
  {
    id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
    name: "Billing export",
    createdAt: 4,
    updatedAt: 5,
    repository: "acme/web",
  },
  {
    id: "5d2e8a41-9c3b-4f6a-b7d0-1e2f3a4b5c6d",
    name: "Billing export",
    createdAt: 6,
    updatedAt: 7,
    repository: "acme/billing",
  },
];

/** A plan the developer archived, which the palette still finds. */
const ARCHIVED: PlanSummary = {
  id: "2f6c1b8d-7a4e-4c3b-9d1f-8e7a6b5c4d3e",
  name: "Legacy importer",
  createdAt: 8,
  updatedAt: 9,
  repository: "acme/tools",
};

/** The open plan's one coding agent. */
const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: OPEN.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite email template",
  createdAt: 3,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const PALETTE = '[cmdk-root=""]';

let root: Root | undefined;

/** Every Escape that reached the window, as the window's own Escape hears one. */
let windowEscapes = 0;
const countEscape = (event: KeyboardEvent) => {
  if (event.key === "Escape") windowEscapes += 1;
};

beforeEach(() => {
  installScrollIntoView();
  windowEscapes = 0;
  window.addEventListener("keydown", countEscape);
});

afterEach(() => {
  window.removeEventListener("keydown", countEscape);
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** What the window was asked to do while the palette stood over it. */
interface Asked {
  selected: string[];
  tabs: PanelTab[];
  ran: string[];
  agents: string[];
  views: SettingsView[];
}

/**
 * The window as the palette sees it: the keymap answering, the open plan's
 * toolbar standing (which offers Copy and Delete), Settings offered, and the
 * palette over it all, on the tab given.
 */
function mountWindow(initialTab: PanelTab, overrides: Partial<PlansControl> = {}): Asked {
  const asked: Asked = { selected: [], tabs: [], ran: [], agents: [], views: [] };
  const base = plansControl();
  const plans = plansControl({
    page: PLANS_PAGE.DOCUMENT,
    plans: [OPEN, ...TWINS],
    archived: [ARCHIVED],
    activePlanId: OPEN.id,
    region: { kind: DOCUMENT_REGION.READY, plan: OPEN },
    onSelect: (planId) => asked.selected.push(planId),
    agents: codingAgentsControl({ agents: [AGENT], agentIds: [AGENT.id] }),
    mainTabs: {
      ...base.mainTabs,
      onChoose: (tab) => {
        if (isAgentTab(tab)) asked.agents.push(tab.agent);
      },
    },
    ...overrides,
  });
  const rows = settingsRowsInput(settingsPanelProps());
  function Window(): React.JSX.Element {
    const [tab, setTab] = useState(initialTab);
    useAppKeymap(true);
    useAppCommand(APP_COMMAND.SETTINGS, () => asked.ran.push(APP_COMMAND.SETTINGS));
    useAppCommand(APP_COMMAND.BACK, () => asked.ran.push(APP_COMMAND.BACK));
    useAppCommand(APP_COMMAND.FORWARD, () => asked.ran.push(APP_COMMAND.FORWARD));
    return createElement(
      "div",
      null,
      createElement(DesktopPlans, {
        summary: UNPINNED_SUMMARY,
        looks: NO_LOOKS,
        plans,
      }),
      createElement(CommandPalette, {
        available: true,
        tab,
        onTabChange: (next: PanelTab) => {
          asked.tabs.push(next);
          setTab(next);
        },
        plans,
        settings: { rows, onViewChange: (view: SettingsView) => asked.views.push(view) },
      }),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Window)));
  return asked;
}

function press(target: EventTarget, init: KeyboardEventInit): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

function openPalette(): HTMLInputElement {
  press(document.body, { key: "k", code: "KeyK", metaKey: true });
  const input = document.querySelector<HTMLInputElement>(`${PALETTE} input`);
  assert.ok(input, "⌘K opens the palette with its search field");
  return input;
}

function search(input: HTMLInputElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A row as its words read: its name, then its repository or its chord. */
function rowWords(row: HTMLElement): string {
  return [...row.children]
    .map((part) => part.textContent)
    .filter((words) => words !== "")
    .join(" · ");
}

function listedRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[cmdk-item=""]')];
}

/** Each row the palette lists, as its words read. */
function rows(): string[] {
  return listedRows().map(rowWords);
}

/** The headings the palette lists its rows under, in order. */
function headings(): string[] {
  return [...document.querySelectorAll("[cmdk-group-heading]")].map((each) => each.textContent);
}

/** The filter chosen, as its chip reads. */
function chosenFilter(): string | null | undefined {
  return document.querySelector('.command-palette-filter[aria-pressed="true"]')?.textContent;
}

/** Presses a filter's chip. */
function pressFilter(label: string): void {
  const chip = [...document.querySelectorAll<HTMLElement>(".command-palette-filter")].find(
    (each) => each.textContent === label,
  );
  assert.ok(chip, `the palette offers the ${label} filter`);
  act(() => chip.click());
}

/** Chooses the row whose words begin with those given. */
function choose(words: string): void {
  const row = listedRows().find((each) => rowWords(each).startsWith(words));
  assert.ok(row, `the palette lists ${words}`);
  act(() => row.click());
}

test("⌘K lists the commands the window can run now under Actions, each with its chord drawn as keys", () => {
  mountWindow(PANEL_TAB.PLANS);
  openPalette();
  pressFilter("Actions");
  const listed = rows();
  for (const offered of ["Copy plan · ⇧⌘C", "Permanently delete plan · ⌘⌫", "Settings · ⌘,"]) {
    assert.ok(listed.includes(offered), `${offered} is offered now, so the palette lists it`);
  }
  assert.ok(
    !listed.some((row) => row.startsWith("Toggle sidebar")),
    "nothing offers the sidebar's chord here, so the palette leaves it out",
  );
  const settings = listedRows().find((row) => rowWords(row).startsWith("Settings"));
  assert.deepEqual(
    [...(settings?.querySelectorAll("kbd.keycap") ?? [])].map((cap) => cap.textContent),
    ["⌘", ","],
  );
});

test("All lists each kind's best few under its heading, and a kind's filter lists more of it", () => {
  mountWindow(PANEL_TAB.PLANS);
  openPalette();
  assert.equal(chosenFilter(), "All", "the palette opens on All");
  assert.deepEqual(headings(), ["Plans", "Agents", "Actions", "Settings"]);
  const actionsUnderAll = listedRows().filter(
    (row) =>
      row.closest("[cmdk-group]")?.querySelector("[cmdk-group-heading]")?.textContent === "Actions",
  ).length;
  assert.equal(actionsUnderAll, 5, "All lists the best five actions");
  pressFilter("Actions");
  assert.deepEqual(headings(), ["Actions"]);
  assert.ok(rows().length > 5, "the Actions filter lists every action offered");
});

test("⌘] and ⌘[ step through the filters, wrapping at the ends, and never reach the window's Back and Forward", () => {
  const asked = mountWindow(PANEL_TAB.PLANS);
  const input = openPalette();
  press(input, { key: "]", code: "BracketRight", metaKey: true });
  assert.equal(chosenFilter(), "Plans");
  assert.deepEqual(headings(), ["Plans"]);
  press(input, { key: "]", code: "BracketRight", metaKey: true });
  assert.equal(chosenFilter(), "Agents");
  press(input, { key: "[", code: "BracketLeft", metaKey: true });
  press(input, { key: "[", code: "BracketLeft", metaKey: true });
  assert.equal(chosenFilter(), "All");
  press(input, { key: "[", code: "BracketLeft", metaKey: true });
  assert.equal(chosenFilter(), "Settings", "stepping back from All wraps to the last filter");
  assert.deepEqual(asked.ran, [], "the window went neither back nor forward");
  assert.ok(document.querySelector(PALETTE), "the palette still stands");
});

test("every plan is listed beside its repository, an archived one marked so and opened like the rest", () => {
  const asked = mountWindow(PANEL_TAB.PLANS);
  openPalette();
  pressFilter("Plans");
  assert.deepEqual(rows(), [
    "Teammate invitations · acme/docs",
    "Billing export · acme/web",
    "Billing export · acme/billing",
    "Legacy importer · acme/tools · Archived",
  ]);
  choose("Legacy importer");
  assert.deepEqual(asked.selected, [ARCHIVED.id]);
});

test("a search finds a plan by its repository, so two plans of one name are told apart, the words found marked", () => {
  mountWindow(PANEL_TAB.PLANS);
  search(openPalette(), "acme/billing");
  assert.deepEqual(rows(), ["Billing export · acme/billing"]);
  assert.deepEqual(
    [...document.querySelectorAll("[cmdk-item] mark")].map((mark) => mark.textContent),
    ["acme/billing"],
  );
});

test("the open plan's coding agent is listed beside the plan's name and opens its tab", () => {
  const asked = mountWindow(PANEL_TAB.SETTINGS);
  openPalette();
  pressFilter("Agents");
  assert.deepEqual(rows(), ["Invite email template · Teammate invitations"]);
  choose("Invite email template");
  assert.deepEqual(asked.tabs, [PANEL_TAB.PLANS], "an agent opens on the Plans tab");
  assert.deepEqual(asked.agents, [AGENT.id]);
});

test("no plan open lists no agents", () => {
  mountWindow(PANEL_TAB.PLANS, {
    page: PLANS_PAGE.NEW,
    activePlanId: undefined,
    region: { kind: DOCUMENT_REGION.NONE },
  });
  openPalette();
  pressFilter("Agents");
  assert.deepEqual(rows(), []);
});

test("a setting chosen opens its page in Settings", () => {
  const asked = mountWindow(PANEL_TAB.PLANS);
  search(openPalette(), "theme");
  pressFilter("Settings");
  const [first] = rows();
  assert.ok(first?.startsWith("Theme · Appearance"), `the Theme row leads, not ${first}`);
  choose("Theme");
  assert.deepEqual(asked.tabs, [PANEL_TAB.SETTINGS]);
  assert.deepEqual(asked.views, [SETTINGS_VIEW.APPEARANCE]);
});

test("a setting is found by a word its description holds, never by letters scattered through it", () => {
  mountWindow(PANEL_TAB.PLANS);
  const input = openPalette();
  pressFilter("Settings");
  const notify = "Notify me when a coding agent finishes";
  search(input, "notification");
  assert.ok(
    rows().some((row) => row.startsWith(notify)),
    "its description speaks of a notification",
  );
  search(input, "sear");
  assert.ok(
    !rows().some((row) => row.startsWith(notify)),
    "no word of it holds the letters typed, though they stand in its description in order",
  );
});

test("the palette's foot says its keys", () => {
  mountWindow(PANEL_TAB.PLANS);
  openPalette();
  const foot = document.querySelector(".command-palette-footer");
  assert.ok(foot, "the palette has a foot");
  assert.deepEqual(
    [...foot.querySelectorAll(".command-palette-footer-hint")].map((hint) => hint.textContent),
    ["↑↓Select", "↩Open", "⌘[⌘]Change filter", "EscClose"],
  );
});

test("Escape closes the palette alone: it never reaches the window, whose Escape would stop Luke speaking", () => {
  mountWindow(PANEL_TAB.PLANS);
  const input = openPalette();
  press(input, { key: "Escape" });
  assert.equal(document.querySelector(PALETTE), null, "Escape closes the palette");
  assert.equal(windowEscapes, 0, "the window never heard the press");
});

test("a plan chosen opens through the tab's own select, bringing Plans forward from Settings", () => {
  const asked = mountWindow(PANEL_TAB.SETTINGS);
  openPalette();
  const [web] = TWINS;
  assert.ok(web);
  choose("Billing export · acme/web");
  assert.equal(document.querySelector(PALETTE), null, "choosing closes the palette");
  assert.deepEqual(asked.tabs, [PANEL_TAB.PLANS]);
  assert.deepEqual(asked.selected, [web.id]);
});

test("a command chosen runs as its shortcut would", () => {
  const asked = mountWindow(PANEL_TAB.PLANS);
  openPalette();
  pressFilter("Actions");
  choose("Settings");
  assert.deepEqual(asked.ran, [APP_COMMAND.SETTINGS]);
});

test("Permanently delete plan chosen from the palette asks the plan's own question first", () => {
  mountWindow(PANEL_TAB.PLANS);
  openPalette();
  pressFilter("Actions");
  choose("Permanently delete plan");
  const dialog = document.querySelector('[role="alertdialog"]');
  assert.ok(dialog, "Delete asks before anything goes");
  assert.match(dialog.textContent ?? "", /Teammate invitations/u);
});
