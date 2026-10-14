// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { PLAN_TREE_ENTRY } from "@luke/features/plan-wire";
import type { PlanCodeShowing, PlanningTreeAnswer } from "@luke/features/planning-view";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import { settingsView } from "@luke/settings/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { codingAgentsControl, plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { runAppCommand } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { shownFiles } from "../planning/code-pane-model";
import type { PlansControl } from "../planning/use-plans-tab";
import type { SidePanelControl } from "../planning/use-side-panel";
import { CommandPalette } from "./command-palette";
import { panelEntries } from "./side-panel";

/** Where the palette sent the window: each tab and each Settings page it asked for, in order. */
interface Sent {
  tabs: PanelTab[];
  views: SettingsView[];
}

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The palette over a window on its Plans tab, opened by ⌘K's command, every page it opens recorded. */
function openPalette(
  plans: PlansControl = plansControl(),
  readFiles: (planId: string) => Promise<PlanningTreeAnswer> = () =>
    Promise.reject(new Error("no repository is open")),
): Sent {
  const sent: Sent = { tabs: [], views: [] };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(CommandPalette, {
        available: true,
        tab: PANEL_TAB.PLANS,
        onTabChange: (tab) => sent.tabs.push(tab),
        plans,
        settings: {
          rows: { settings: settingsView(), voiceControlsDrawn: true, accountDrawn: true },
          onViewChange: (view) => sent.views.push(view),
        },
        readFiles,
      }),
    ),
  );
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
  });
  return sent;
}

function field(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(".command-palette-search input");
  assert.ok(input, "the search field is drawn");
  return input;
}

function chooseFilter(name: string): void {
  const chip = [...document.querySelectorAll<HTMLButtonElement>(".command-palette-filter")].find(
    (each) => each.textContent === name,
  );
  assert.ok(chip, `the ${name} filter is drawn`);
  act(() => chip.click());
}

function type(words: string): void {
  const input = field();
  // Note that the value goes in through the prototype's setter, because React
  // tracks the field's own and would read a change made there as none.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Each row the palette lists, as its name and the muted words after it. */
function rows(): string[] {
  return [...document.querySelectorAll(".menu-item")].map((row) =>
    [row.querySelector(".command-palette-name"), row.querySelector(".command-palette-detail")]
      .map((part) => part?.textContent)
      .filter((words) => words !== undefined)
      .join(" · "),
  );
}

/** Presses the row listed as exactly these words. */
function press(listed: string): void {
  const at = rows().indexOf(listed);
  const row = document.querySelectorAll<HTMLElement>(".menu-item")[at];
  assert.ok(row, `${listed} is listed`);
  act(() => row.click());
}

/** The Settings pages in the sidebar's order, which the palette lists them in. */
const SETTINGS_PAGES = [
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

test("the Settings filter lists every Settings page by the sidebar's names, ahead of the settings", () => {
  openPalette();
  chooseFilter("Settings");

  assert.deepEqual(rows().slice(0, SETTINGS_PAGES.length), SETTINGS_PAGES);
});

test("a page is found by its name, above every setting the query finds", () => {
  openPalette();
  chooseFilter("Settings");

  type("settings");

  // Note that the Settings shortcut's own row scores higher on the word than
  // any page does, and the pages still come first.
  assert.deepEqual(rows().slice(0, SETTINGS_PAGES.length + 1), [
    ...SETTINGS_PAGES,
    "Settings · Keyboard shortcuts",
  ]);
  type("coding");
  assert.equal(rows()[0], "Coding agents");
});

test("choosing a page opens Settings on that page", () => {
  const sent = openPalette();
  chooseFilter("Settings");

  press("Integrations");

  assert.deepEqual(sent, { tabs: [PANEL_TAB.SETTINGS], views: [SETTINGS_VIEW.INTEGRATIONS] });
  assert.equal(document.querySelector(".menu-item"), null, "the palette closed");
});

/** The filter whose chip stands pressed. */
function chosenFilter(): string | null | undefined {
  return document.querySelector(".command-palette-filter[aria-pressed='true']")?.textContent;
}

/** Presses a key in the search field, answering whether the field kept it for itself. */
function key(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    field().dispatchEvent(event);
  });
  return !event.defaultPrevented;
}

const LEFT = { key: "ArrowLeft", code: "ArrowLeft" } as const;
const RIGHT = { key: "ArrowRight", code: "ArrowRight" } as const;
const BACK = { key: "[", code: "BracketLeft", metaKey: true } as const;
const FORWARD = { key: "]", code: "BracketRight", metaKey: true } as const;

/** The footer's hints, each its keys and then its words. */
function footer(): (string | null)[] {
  return [...document.querySelectorAll(".command-palette-footer-hint")].map(
    (hint) => hint.textContent,
  );
}

test("with the field empty, ← and → step through the filters, wrapping at the ends", () => {
  openPalette();

  assert.equal(key(RIGHT), false, "the step is the palette's, not the caret's");
  assert.equal(chosenFilter(), "Plans");
  key(RIGHT);
  assert.equal(chosenFilter(), "Agents");
  key(LEFT);
  key(LEFT);
  assert.equal(chosenFilter(), "All");
  key(LEFT);
  assert.equal(chosenFilter(), "Settings", "stepping back from All wraps to the last filter");
  key(RIGHT);
  assert.equal(chosenFilter(), "All", "stepping on from the last filter wraps to All");
});

test("once anything is typed, ← and → only move the caret, even at the text's ends", () => {
  openPalette();
  type("invite");
  const input = field();

  for (const at of [0, 3, 6]) {
    input.setSelectionRange(at, at);
    assert.equal(key(LEFT), true, `← at ${at} is the caret's`);
    assert.equal(key(RIGHT), true, `→ at ${at} is the caret's`);
  }
  assert.equal(chosenFilter(), "All");
  assert.equal(input.value, "invite");
});

test("⌘[ and ⌘] step through the filters, wrapping at the ends, whether or not anything is typed", () => {
  openPalette();

  assert.equal(key(FORWARD), false, "the window's Forward is held off");
  assert.equal(chosenFilter(), "Plans");
  type("invite");
  key(FORWARD);
  assert.equal(chosenFilter(), "Agents");
  assert.equal(key(BACK), false, "the window's Back is held off");
  key(BACK);
  key(BACK);
  assert.equal(chosenFilter(), "Settings", "stepping back from All wraps to the last filter");
  key(FORWARD);
  assert.equal(chosenFilter(), "All", "stepping on from the last filter wraps to All");
  assert.equal(field().value, "invite", "the words stay as typed");
});

test("the footer names the keys that step the filters now: ← → while the field is empty, ⌘[ ⌘] once typed", () => {
  openPalette();
  assert.deepEqual(footer(), ["↑↓Select", "⏎Open", "←→Filter"]);

  type("invite");
  assert.deepEqual(footer(), ["↑↓Select", "⏎Open", "⌘[⌘]Filter"]);

  type("");
  assert.deepEqual(footer(), ["↑↓Select", "⏎Open", "←→Filter"]);
});

test("an agent's row hangs its tab's card beside it while the pointer rests on it, and choosing it opens the agent's tab", () => {
  const shown: [string, string][] = [];
  openPalette(
    plansControl({
      activePlanId: "plan-1",
      plans: [
        {
          id: "plan-1",
          workspaceId: "workspace-personal",
          name: "Billing usage alerts",
          createdAt: 1,
          updatedAt: 2,
          repository: null,
        },
      ],
      agents: codingAgentsControl({
        agents: [
          {
            id: "agent-7",
            planId: "plan-1",
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            title: "Invoice export",
            createdAt: 1,
            status: CODING_AGENT_STATUS.RUNNING,
            turnId: null,
          },
        ],
        agentIds: ["agent-7"],
      }),
      onShowAgent: (planId, agentId) => shown.push([planId, agentId]),
    }),
  );
  chooseFilter("Agents");
  assert.deepEqual(rows(), [
    "Inbox · Billing usage alerts",
    "Invoice export · Billing usage alerts",
  ]);
  const row = document.querySelectorAll<HTMLElement>(".menu-item")[1];
  assert.ok(row, "the agent is listed");
  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".card-name")?.textContent, "Invoice export");
  assert.equal(card?.querySelector(".card-corner")?.textContent, "Working…");
  press("Invoice export · Billing usage alerts");
  assert.deepEqual(shown, [["plan-1", "agent-7"]]);
});

test("an agent's Changes row is named as its tab is, with its pull request's number beside it, and is found by that number and the pull request's title", () => {
  const agent = {
    id: "agent-7",
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Invoice export",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  openPalette(
    plansControl({
      activePlanId: "plan-1",
      plans: [
        {
          id: "plan-1",
          workspaceId: "workspace-personal",
          name: "Billing usage alerts",
          createdAt: 1,
          updatedAt: 2,
          repository: null,
        },
      ],
      agents: codingAgentsControl({
        agents: [agent],
        agentIds: [agent.id],
        pullRequests: new Map([
          [
            agent.id,
            {
              number: 42,
              title: "Export invoices as CSV",
              url: "https://github.com/acme/billing/pull/42",
              state: PULL_REQUEST_STATE.OPEN,
              checks: CHECK_SUMMARY.PASSING,
              additions: 120,
              deletions: 8,
              changedFiles: 4,
            },
          ],
        ]),
      }),
    }),
  );
  const changes = "Changes: Invoice export · #42 · Billing usage alerts";
  type("#42");
  assert.ok(rows().includes(changes), "found by its pull request's number");
  type("CSV");
  assert.ok(rows().includes(changes), "found by its pull request's title");
});

test('a file found wears the look the side panel\'s "+" gives it, hangs its card with Luke\'s note, and opens through the panel\'s one door for a file, as the "+" row of a file whose tab stands does', async () => {
  const path = "src/invites/accept.ts";
  const note = "A used invite is refused here.";
  const showing: PlanCodeShowing = {
    callId: "c",
    turnId: "t",
    shownAt: 1_000,
    code: {
      ref: { path, startLine: 3, endLine: 5 },
      repository: "acme/relay",
      firstLine: 1,
      lineCount: 9,
      lines: [],
      note,
    },
  };
  const opened: unknown[][] = [];
  const base = plansControl();
  const sidePanel: SidePanelControl = {
    ...base.sidePanel,
    files: [{ path, range: { startLine: 3, endLine: 5 }, opened: 1 }],
    onOpenFile: (...asked) => opened.push(asked),
  };
  const plans = plansControl({
    activePlanId: "plan-1",
    plans: [
      {
        id: "plan-1",
        workspaceId: "workspace-personal",
        name: "Teammate invitations",
        createdAt: 1,
        updatedAt: 2,
        repository: "acme/relay",
      },
    ],
    sidePanel,
    shownCode: [showing],
  });
  openPalette(plans, () =>
    Promise.resolve({
      folder: {
        path: "",
        repository: "acme/relay",
        branch: "main",
        entries: [{ name: path, kind: PLAN_TREE_ENTRY.FILE }],
        truncated: false,
      },
    }),
  );
  chooseFilter("Files");
  await act(async () => undefined);
  assert.deepEqual(rows(), ["accept.ts · src/invites"]);

  const [plus] = panelEntries({
    panel: sidePanel,
    kinds: [],
    workers: [],
    files: shownFiles([showing]),
  });
  assert.ok(plus, 'the "+" offers the file');
  const row = document.querySelector<HTMLElement>(".menu-item");
  assert.equal(
    row?.querySelector(".menu-item-glyph")?.innerHTML,
    renderToStaticMarkup(plus.row.icon),
    'the row wears the icon the "+" row does',
  );
  act(() => {
    row?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".tooltip-card [data-file-card]");
  assert.deepEqual(
    [
      card?.querySelector(".card-name")?.textContent,
      card?.querySelector(".card-note")?.textContent,
    ],
    [path, note],
  );

  press("accept.ts · src/invites");
  act(() => plus.onPick());
  // Both name the file alone, so the tab it has is shown as it stands.
  assert.deepEqual(opened, [[{ path }], [{ path }]]);
});
