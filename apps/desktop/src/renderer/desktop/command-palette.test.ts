// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLANNING_READ,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { WORKSPACE_ROLE } from "@sidecar/hosted/workspace-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { ActKind, ActResultFor } from "#shared/messages/acts";
import { RUN_PROFILE } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import { APP_COMMAND } from "#shared/shortcuts";
import { plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { useAppCommand, useAppKeymap } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { NO_LOOKS } from "../planning/use-plan-looks";
import { type PlansControl, usePlansTab } from "../planning/use-plans-tab";
import { CommandPalette } from "./command-palette";
import { DesktopPlans } from "./desktop-plans";

const OPEN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
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
    workspaceId: "workspace-personal",
    name: "Billing export",
    createdAt: 4,
    updatedAt: 5,
    repository: "acme/web",
  },
  {
    id: "5d2e8a41-9c3b-4f6a-b7d0-1e2f3a4b5c6d",
    workspaceId: "workspace-personal",
    name: "Billing export",
    createdAt: 6,
    updatedAt: 7,
    repository: "acme/billing",
  },
];

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
}

/**
 * The window as the palette sees it: the keymap answering, the open plan's
 * toolbar standing (which offers Copy and Delete), Settings offered, and the
 * palette over it all, on the tab given.
 */
function mountWindow(initialTab: PanelTab, overrides: Partial<PlansControl> = {}): Asked {
  const asked: Asked = { selected: [], tabs: [], ran: [] };
  const plans = plansControl({
    page: PLANS_PAGE.DOCUMENT,
    plans: [OPEN, ...TWINS],
    activePlanId: OPEN.id,
    region: { kind: DOCUMENT_REGION.READY, plan: OPEN },
    onSelect: (planId) => asked.selected.push(planId),
    ...overrides,
  });
  function Window(): React.JSX.Element {
    const [tab, setTab] = useState(initialTab);
    useAppKeymap(true);
    useAppCommand(APP_COMMAND.SETTINGS, () => asked.ran.push(APP_COMMAND.SETTINGS));
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

/** Chooses the row whose words begin with those given. */
function choose(words: string): void {
  const row = listedRows().find((each) => rowWords(each).startsWith(words));
  assert.ok(row, `the palette lists ${words}`);
  act(() => row.click());
}

test("⌘K lists the commands the window can run now, and every plan beside its repository", () => {
  mountWindow(PANEL_TAB.PLANS);
  openPalette();
  const listed = rows();
  for (const offered of ["Copy plan", "Permanently delete plan", "Settings"]) {
    assert.ok(
      listed.some((row) => row.startsWith(offered)),
      `${offered} is offered now, so the palette lists it`,
    );
  }
  assert.ok(
    !listed.some((row) => row.startsWith("Toggle sidebar")),
    "nothing offers the sidebar's chord here, so the palette leaves it out",
  );
  assert.deepEqual(
    listed.filter((row) => row.startsWith("Billing export")),
    ["Billing export · acme/web", "Billing export · acme/billing"],
  );
});

test("a search finds a plan by its repository, so two plans of one name are told apart", () => {
  mountWindow(PANEL_TAB.PLANS);
  search(openPalette(), "acme/billing");
  assert.deepEqual(rows(), ["Billing export · acme/billing"]);
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
  choose("Settings");
  assert.deepEqual(asked.ran, [APP_COMMAND.SETTINGS]);
});

test("Permanently delete plan chosen from the palette asks the plan's own question first", () => {
  mountWindow(PANEL_TAB.PLANS);
  openPalette();
  choose("Permanently delete plan");
  const dialog = document.querySelector('[role="alertdialog"]');
  assert.ok(dialog, "Delete asks before anything goes");
  assert.match(dialog.textContent ?? "", /Teammate invitations/u);
});

/** The account's plans across two workspaces, the personal one listed: one of its own, one of acme's. */
const ACROSS_WORKSPACES: PlanningView = {
  ...IDLE_PLANNING_VIEW,
  listStatus: PLANNING_READ.READY,
  workspaces: [
    { id: "workspace-personal", name: "Personal", personal: true, role: WORKSPACE_ROLE.OWNER },
    { id: "workspace-acme", name: "acme", personal: false, role: WORKSPACE_ROLE.MEMBER },
  ],
  plans: [
    {
      id: OPEN.id,
      workspaceId: "workspace-personal",
      name: "Notes",
      createdAt: 1,
      updatedAt: 2,
      repository: null,
    },
    {
      id: "acme-alerts",
      workspaceId: "workspace-acme",
      name: "Usage alerts",
      createdAt: 3,
      updatedAt: 3,
      repository: "acme/web",
    },
  ],
};

test("the palette finds a plan of a workspace the sidebar does not list, and opening it lists that workspace", () => {
  const selected: string[] = [];
  let control: PlansControl | undefined;
  function Window(): React.JSX.Element {
    useAppKeymap(true);
    const plans = usePlansTab({
      acts: {
        act: <Kind extends ActKind>(kind: Kind, ..._args: unknown[]): Promise<ActResultFor<Kind>> =>
          Promise.reject(new Error(`Not answered: ${kind}`)),
        tell: () => undefined,
      },
      planning: ACROSS_WORKSPACES,
      run: { fixtureMode: false, profile: RUN_PROFILE.IDLE },
      signedIn: true,
      voiceAvailable: false,
      microphoneStatus: MICROPHONE_STATUS.GRANTED,
      shown: true,
      unseenAgents: [],
      voice: { view: IDLE_VOICE_VIEW, listening: false, requestMicrophoneAccess: () => undefined },
    });
    control = plans;
    return createElement(CommandPalette, {
      available: true,
      tab: PANEL_TAB.PLANS,
      onTabChange: () => undefined,
      plans: {
        ...plans,
        onSelect: (planId: string) => {
          selected.push(planId);
          plans.onSelect(planId);
        },
      },
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Window)));
  const listedBefore = control?.listed.plans.map((plan) => plan.name);

  search(openPalette(), "Usage");
  const found = rows();
  choose("Usage alerts");

  assert.deepEqual(listedBefore, ["Notes"]);
  assert.deepEqual(found, ["Usage alerts · acme/web"]);
  assert.deepEqual(selected, ["acme-alerts"]);
  assert.equal(control?.workspace?.id, "workspace-acme");
  window.localStorage.clear();
});
