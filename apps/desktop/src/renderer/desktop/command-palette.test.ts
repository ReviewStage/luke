// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { PLAN_TREE_ENTRY, type Plan } from "@luke/features/plan-wire";
import type { PlanCodeShowing, PlanningTreeAnswer } from "@luke/features/planning-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import { settingsView } from "@luke/settings/testing";
import { DOCUMENT_REGION, PLAN_MARK, PLANS_PAGE } from "@luke/ui/planning-model";
import { shownFiles } from "@luke/voice/code-pane-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { sidebarProps } from "#testing/desktop-sidebar";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { codingAgentsControl, plansControl } from "#testing/plans-control";
import { fadedEdges, layFades } from "#testing/scroll-fade";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { newestToastSays } from "#testing/toast";
import { appCommandOffered, runAppCommand, useAppCommand } from "../app-commands";
import { PageWorkspaceProvider, useCopyLink, usePageWorkspace } from "../links-at-hand";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { usePlanLooks } from "../planning/use-plan-looks";
import { AUTOMATIONS_PAGE, type PlansControl } from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB, type SidePanelControl } from "../planning/use-side-panel";
import { ToastHost } from "../toast";
import { CommandPalette } from "./command-palette";
import { DesktopSidebar } from "./desktop-sidebar";
import { ListedAutomations } from "./listed-automations";
import { panelEntries } from "./side-panel";

/** Where the palette sent the window: each tab and each Settings page it asked for, in order. */
interface Sent {
  tabs: PanelTab[];
  views: SettingsView[];
}

/** The window's own stylesheet, which says which part of a row gives way. */
const DESKTOP_CSS = readFileSync(path.join(import.meta.dirname, "../styles/desktop.css"), "utf8");

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** An agent's page, as far as it tells the window the workspace it read its agent into. */
function AgentPageTelling(props: { agentId: string; workspaceId: string }): null {
  usePageWorkspace(props.agentId, props.workspaceId);
  return null;
}

/** The palette as the window draws it, offering the links at hand through the window's own Copy link, beside an agent's page where one tells its workspace. */
function WindowPalette({
  page,
  ...props
}: Omit<Parameters<typeof CommandPalette>[0], "links"> & {
  page?: { agentId: string; workspaceId: string } | undefined;
}): React.JSX.Element {
  const links = useCopyLink(props.plans, undefined, true);
  return createElement(
    PageWorkspaceProvider,
    { value: links.onPageWorkspace },
    createElement(CommandPalette, { ...props, links }),
    page === undefined ? null : createElement(AgentPageTelling, page),
  );
}

/** The palette over a window on its Plans tab, opened by ⌘K's command, every page it opens recorded. */
function openPalette(
  plans: PlansControl = plansControl(),
  readFiles: (planId: string) => Promise<PlanningTreeAnswer> = () =>
    Promise.reject(new Error("no repository is open")),
  page?: { agentId: string; workspaceId: string },
): Sent {
  const sent: Sent = { tabs: [], views: [] };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(WindowPalette, {
        available: true,
        tab: PANEL_TAB.PLANS,
        onTabChange: (tab) => sent.tabs.push(tab),
        plans,
        settings: {
          rows: { settings: settingsView(), voiceControlsDrawn: true, accountDrawn: true },
          onViewChange: (view) => sent.views.push(view),
        },
        readFiles,
        page,
      }),
    ),
  );
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
  });
  return sent;
}

/** The window's look at `looked`, as its shell takes one while the plan is on screen, and none while it is covered. */
function Looker({ looked }: { looked: typeof DOCUMENT_PLAN | undefined }): null {
  usePlanLooks(looked, undefined);
  return null;
}

/** The palette over `DOCUMENT_PLAN` drawn, looked at or covered as `looked` says, redrawn by the answer. */
function paletteOverPlan(): (looked: typeof DOCUMENT_PLAN | undefined) => void {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const registry = AtomRegistry.make();
  const plans = plansControl({
    region: { kind: DOCUMENT_REGION.READY, plan: DOCUMENT_PLAN },
    activePlanId: DOCUMENT_PLAN.id,
  });
  return (looked) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(
            Fragment,
            null,
            createElement(Looker, { looked }),
            createElement(WindowPalette, {
              available: true,
              tab: PANEL_TAB.PLANS,
              onTabChange: () => undefined,
              plans,
              settings: {
                rows: { settings: settingsView(), voiceControlsDrawn: true, accountDrawn: true },
                onViewChange: () => undefined,
              },
              readFiles: () => Promise.reject(new Error("no repository is open")),
            }),
          ),
        ),
      ),
    );
}

/** The rows ⌘K lists for "mark", the palette opened afresh. */
function markRows(): string[] {
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
  });
  type("mark");
  return rows().filter((row) => row.startsWith("Mark as"));
}

test("⌘K marks the task on screen unread and then read, and offers no mark for a task Settings or the Inbox covers", () => {
  const draw = paletteOverPlan();
  draw(undefined);
  assert.deepEqual(markRows(), []);
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K closes");
  });

  draw(DOCUMENT_PLAN);
  assert.deepEqual(markRows(), ["Mark as unread"]);
  press("Mark as unread");
  assert.deepEqual(markRows(), ["Mark as read"]);
  press("Mark as read");
  assert.deepEqual(markRows(), ["Mark as unread"]);
});

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

/** The words a reader hears in a part of a row: its text but for a mark hidden from a screen reader, a workspace's tile's letter among them. */
function heard(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return [...node.childNodes].map(heard).join("");
}

/** Each row the palette lists, as its name and the muted words after it. */
function rows(): string[] {
  return [...document.querySelectorAll(".menu-item")].map((row) =>
    [row.querySelector(".command-palette-name"), row.querySelector(".command-palette-detail")]
      .filter((part) => part !== null)
      .map(heard)
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

/** The Settings pages by their names, in the order the palette lists them: Account's own page is Profile, and the Workspace page, whose head names the listed workspace, is Workspace here. */
const SETTINGS_PAGES = [
  "Profile",
  "Workspace",
  "Coding agents",
  "Integrations",
  "Plan template",
  "Voice",
  "Appearance",
  "Notifications",
  "This Mac",
  "Experimental",
  "About",
  "Keyboard shortcuts",
];

test("the results fade under the filters above them and over the keys' hints below them, rather than being sliced at either hairline", () => {
  openPalette();
  const sheets = layFades();
  try {
    const list = document.querySelector(".command-palette-list") ?? assert.fail("results stand");
    assert.deepEqual(fadedEdges(list), { top: true, bottom: true });
  } finally {
    sheets.remove();
  }
});

test("the Settings filter lists every Settings page by its name, ahead of the settings", () => {
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
  assert.equal(chosenFilter(), "Tasks");
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
  assert.equal(chosenFilter(), "Tasks");
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

test("an agent's card in ⌘K names the automation that started it, the listed workspace's automations read once around the window while the experiment is on, and none read while it is off", async () => {
  const automation = {
    id: "3f0e6f5c-7d1a-4f6e-9a55-000000000001",
    planId: null,
    planName: null,
    workspaceId: "workspace-acme",
    name: "Morning Sentry triage",
    enabled: true,
    pausedReason: null,
    trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage Sentry." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: null,
    createdAt: 1,
  } as const;
  const listed: (string | undefined)[] = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act): Promise<ActOutcome> => {
        if (request.kind !== ACT_KIND.AUTOMATIONS_LIST) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
        }
        listed.push(request.payload.workspaceId);
        const value = { automations: [automation] };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      },
    },
  });
  const plans = plansControl({
    activePlanId: "plan-1",
    workspace: {
      id: "workspace-acme",
      name: "Acme",
      slug: "acme",
      role: WORKSPACE_ROLE.MEMBER,
      github: null,
    },
    plans: [
      {
        id: "plan-1",
        workspaceId: "workspace-acme",
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
          status: CODING_AGENT_STATUS.COMPLETED,
          turnId: null,
          automationId: automation.id,
        },
      ],
      agentIds: ["agent-7"],
    }),
  });
  /** The words "Started by" says on the agent's row's card in ⌘K, the experiment `on` or off. */
  const startedBy = async (on: boolean): Promise<string | null | undefined> => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    roots.push(root);
    const palette = createElement(WindowPalette, {
      available: true,
      tab: PANEL_TAB.PLANS,
      onTabChange: () => undefined,
      plans,
      settings: {
        rows: { settings: settingsView(), voiceControlsDrawn: true, accountDrawn: true },
        onViewChange: () => undefined,
      },
      readFiles: () => Promise.reject(new Error("no repository is open")),
    });
    act(() => root.render(createElement(ListedAutomations, { plans, on, children: palette })));
    await act(async () => {
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });
    act(() => {
      assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
    });
    chooseFilter("Agents");
    const row = [...document.querySelectorAll<HTMLElement>(".menu-item")].find((each) =>
      each.textContent?.includes("Invoice export"),
    );
    assert.ok(row, "the agent is listed");
    act(() => {
      row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const words = document.querySelector(".tooltip-card .actor-words .actor-ref")?.textContent;
    act(() => root.unmount());
    document.body.innerHTML = "";
    return words;
  };

  assert.equal(await startedBy(true), "Morning Sentry triage");
  assert.deepEqual(listed, ["workspace-acme"]);
  listed.length = 0;
  assert.equal(await startedBy(false), undefined);
  assert.deepEqual(listed, []);
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

test("while an agent's page holds the side panel, ⌘K offers none of the open plan's panel tabs, workers, Changes, or files, which would open beside the agent", () => {
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
  const control = plansControl({});
  const read: string[] = [];
  openPalette(
    plansControl({
      activePlanId: DOCUMENT_PLAN.id,
      plans: [
        {
          id: DOCUMENT_PLAN.id,
          workspaceId: DOCUMENT_PLAN.workspaceId,
          name: DOCUMENT_PLAN.name,
          createdAt: 1,
          updatedAt: 2,
          repository: "acme/relay",
        },
      ],
      region: { kind: DOCUMENT_REGION.READY, plan: { ...DOCUMENT_PLAN, repository: "acme/relay" } },
      agentView: { ...control.agentView, agentId: "agent-page-1" },
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
    (planId) => {
      read.push(planId);
      return Promise.reject(new Error("not read here"));
    },
  );

  type("#42");
  const changes = rows().filter((row) => row.startsWith("Changes"));
  type("Show board");
  const board = rows().filter((row) => row.startsWith("Show board"));
  chooseFilter("Files");
  type("index");
  const notice = document.querySelector(".command-palette-empty")?.textContent;

  assert.deepEqual([changes, board], [[], []]);
  assert.deepEqual(read, [], "the hidden task's files are not read");
  assert.equal(notice, "Open a task with a repository to search its files.");
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

test("Search lists the listed workspace's plans first, then every other workspace's, each naming its workspace by its tile and name and found by it", () => {
  const personal = {
    id: "workspace-personal",
    name: "Personal",
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  };
  const northwind = {
    id: "workspace-northwind",
    name: "Northwind",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const plan = (id: string, workspaceId: string, repository: string | null) => ({
    id,
    workspaceId,
    name: id,
    createdAt: 1,
    updatedAt: 1,
    repository,
  });
  openPalette(
    plansControl({
      workspaces: [personal, northwind],
      workspace: personal,
      plans: [
        plan("Checkout retries", northwind.id, "northwind/shop"),
        plan("Dotfiles sync", personal.id, null),
      ],
    }),
  );
  chooseFilter("Tasks");
  const listed = rows();
  type("northwind");

  assert.deepEqual(listed, ["Dotfiles sync", "Checkout retries · Northwind · northwind/shop"]);
  assert.deepEqual(rows(), ["Checkout retries · Northwind · northwind/shop"]);
  assert.equal(
    document.querySelector(".command-palette-detail .workspace-ref .workspace-tile")?.textContent,
    "N",
    "the other workspace is named by its tile and its name",
  );
});

test("a teammate's task wears its creator's face at its row's end, and is found by their name, which the row then says", () => {
  const charles = { userId: "user-charles", name: "Charles Pan" };
  const dean = { userId: "user-dean", name: "Dean Stratakos" };
  const task = (id: string, by: typeof dean) => ({
    id,
    workspaceId: "workspace-personal",
    name: id,
    createdAt: 1,
    updatedAt: 1,
    repository: "acme/relay",
    ownerId: by.userId,
    createdBy: by,
  });
  openPalette(
    plansControl({
      me: dean.userId,
      plans: [task("Retry budget", charles), task("Rate limits", dean)],
    }),
  );
  chooseFilter("Tasks");
  const faces = () =>
    [...document.querySelectorAll(".menu-item")].map(
      (row) => row.querySelector(".menu-item-end .actor-mark")?.textContent ?? null,
    );

  assert.deepEqual(rows(), ["Retry budget · acme/relay", "Rate limits · acme/relay"]);
  assert.deepEqual(faces(), ["C", null]);
  assert.match(
    document.querySelector(".menu-item-end")?.textContent ?? "",
    /\(created by Charles Pan\)/u,
  );
  type("charles");
  assert.deepEqual(rows(), ["Retry budget · acme/relay · Charles Pan"]);
  // A query the creator's name answers only loosely still shows the name it was found by,
  // and one the task's other words answer, however loosely, leaves the name unsaid.
  type("chrls");
  assert.deepEqual(rows(), ["Retry budget · acme/relay · Charles Pan"]);
  type("rtry");
  assert.equal(rows()[0], "Retry budget · acme/relay");
  // A query running from the task's name into its creator's names them too.
  type("budgetch");
  assert.deepEqual(rows(), ["Retry budget · acme/relay · Charles Pan"]);
});

/** Offers ⌘K's own Show my tasks, as the sidebar does while it would change the list, and records each run. */
function OffersMyTasks({ ran }: { ran: string[] }): null {
  useAppCommand(APP_COMMAND.SHOW_MY_TASKS, () => ran.push("show my tasks"));
  return null;
}

test("a command ⌘K alone offers, the sidebar's Show my tasks, is listed by its name with no chord and runs from its row", () => {
  const ran: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(OffersMyTasks, { ran })));
  openPalette();
  type("my tasks");
  assert.ok(rows().includes("Show my tasks"), "Show my tasks is listed");
  const row = [...document.querySelectorAll(".menu-item")][rows().indexOf("Show my tasks")];
  assert.equal(row?.querySelector(".menu-item-hint"), null, "no chord is printed");
  press("Show my tasks");
  assert.deepEqual(ran, ["show my tasks"]);
});

/** Main's clipboard, keeping each copy the window asks of it. */
function installClipboard(): string[] {
  const copied: string[] = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        if (request.kind === ACT_KIND.WINDOW_COPY_TEXT) copied.push(request.payload.words);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      },
      recordSurfaceEvent: () => undefined,
    },
  });
  return copied;
}

/** The toasts the window raises, drawn as the window draws them. */
function drawToasts(): void {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(ToastHost)));
}

const LINKED_AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** A task drawn in Acme, its agent's tab chosen in the work column and the agent named. */
const ON_AGENT_TAB: PlansControl = plansControl({
  page: PLANS_PAGE.DOCUMENT,
  activePlanId: DOCUMENT_PLAN.id,
  region: {
    kind: DOCUMENT_REGION.READY,
    plan: { ...DOCUMENT_PLAN, workspaceId: "workspace-acme" },
  },
  workspaces: [
    { id: "workspace-acme", name: "Acme", slug: "acme", role: WORKSPACE_ROLE.MEMBER, github: null },
  ],
  mainTabs: { ...plansControl().mainTabs, tab: { agent: LINKED_AGENT } },
  agents: codingAgentsControl({
    agents: [
      {
        id: LINKED_AGENT,
        planId: DOCUMENT_PLAN.id,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: "Expire old invites",
        createdAt: 3,
        status: CODING_AGENT_STATUS.RUNNING,
        turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
      },
    ],
  }),
});

test("on a task's agent's tab, ⌘K offers Copy link to the agent, wearing ⌥⌘C, then to the task, and choosing one copies its link and says Link copied", async () => {
  const copied = installClipboard();
  drawToasts();
  openPalette(ON_AGENT_TAB);
  type("copy link");
  const listed = rows().filter((row) => row.startsWith("Copy link to "));
  const chord = document.querySelector(".menu-item .menu-item-hint")?.textContent;

  press("Copy link to agent · Expire old invites");
  await act(async () => undefined);

  assert.deepEqual(listed, [
    "Copy link to agent · Expire old invites",
    `Copy link to task · ${DOCUMENT_PLAN.name}`,
  ]);
  assert.equal(chord, "⌥⌘C");
  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${DOCUMENT_PLAN.id}/agent/${LINKED_AGENT}`,
  ]);
  assert.equal(newestToastSays(), "Link copied");
});

test("an action's name keeps its width beside the task it acts on, and the task's name is what gives way", () => {
  document.head.appendChild(document.createElement("style")).textContent = DESKTOP_CSS;
  openPalette(ON_AGENT_TAB);
  type("copy link");
  const at = rows().indexOf(`Copy link to task · ${DOCUMENT_PLAN.name}`);
  const row =
    document.querySelectorAll(".menu-item")[at] ?? assert.fail("Copy link to task is listed");
  const name = row.querySelector(".command-palette-name") ?? assert.fail("the row's name");
  const detail = row.querySelector(".command-palette-detail") ?? assert.fail("the task it acts on");

  assert.equal(getComputedStyle(name).flexShrink, "0", "the name keeps its width");
  assert.deepEqual(
    [getComputedStyle(detail).flexShrink, getComputedStyle(detail).minWidth],
    ["1", "0px"],
    "the task's name gives way",
  );
});

test("⌥⌘C copies the link of what is open, the most specific first: the Inbox's item over the Inbox, an automation over the list, the task under its tabs", async () => {
  const copied = installClipboard();
  const automationId = "6e2f3a4b-5c6d-4e7f-8a91-92a3b4c5d6e7";
  const itemId = "5d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
  const listed = { workspaces: ON_AGENT_TAB.workspaces, workspace: ON_AGENT_TAB.workspaces[0] };
  for (const plans of [
    ON_AGENT_TAB,
    plansControl({
      ...listed,
      inboxView: {
        ...plansControl().inboxView,
        open: true,
        chosen: { agentId: LINKED_AGENT, itemId },
      },
    }),
    plansControl({
      ...listed,
      automationsView: {
        ...plansControl().automationsView,
        open: true,
        place: { kind: AUTOMATIONS_PAGE.EDIT, automationId },
      },
    }),
    plansControl({ ...listed, factoryView: { ...plansControl().factoryView, open: true } }),
  ]) {
    openPalette(plans);
    act(() => {
      runAppCommand(APP_COMMAND.COMMAND_PALETTE);
      runAppCommand(APP_COMMAND.COPY_LINK);
    });
    await act(async () => undefined);
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
  }

  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${DOCUMENT_PLAN.id}/agent/${LINKED_AGENT}`,
    `https://tryluke.dev/acme/agent/${LINKED_AGENT}/inbox/${itemId}`,
    `https://tryluke.dev/acme/automation/${automationId}`,
    "https://tryluke.dev/acme/factory",
  ]);
});

test("on a person's page, over an open Inbox, ⌘K offers Copy link to profile and ⌥⌘C copies their page's link in the workspace it opened in", async () => {
  const copied = installClipboard();
  const [acme] = ON_AGENT_TAB.workspaces;
  openPalette(
    plansControl({
      workspaces: ON_AGENT_TAB.workspaces,
      workspace: acme,
      inboxView: { ...plansControl().inboxView, open: true },
      personView: {
        ...plansControl().personView,
        userId: "user-charles",
        workspaceId: acme?.id,
      },
    }),
  );
  type("copy link");
  const listed = rows().filter((row) => row.startsWith("Copy link to "));
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  await act(async () => undefined);

  assert.deepEqual(listed, ["Copy link to profile"]);
  assert.deepEqual(copied, ["https://tryluke.dev/acme/person/user-charles"]);
});

test("on the home page nothing has a link, so ⌥⌘C is not offered and ⌘K lists no Copy link", () => {
  openPalette(plansControl());
  type("copy link");

  assert.deepEqual(
    rows().filter((row) => row.startsWith("Copy link to ")),
    [],
  );
  assert.equal(appCommandOffered(APP_COMMAND.COPY_LINK), false);
});

test("with the side panel filling the window over an agent's tab, ⌥⌘C copies the panel's tab, which is what shows", async () => {
  const copied = installClipboard();
  openPalette(
    plansControl({
      ...ON_AGENT_TAB,
      sidePanel: {
        ...ON_AGENT_TAB.sidePanel,
        open: true,
        fullScreen: true,
        tab: SIDE_PANEL_TAB.CALL,
      },
    }),
  );
  act(() => {
    runAppCommand(APP_COMMAND.COMMAND_PALETTE);
    runAppCommand(APP_COMMAND.COPY_LINK);
  });
  await act(async () => undefined);

  assert.deepEqual(copied, [`https://tryluke.dev/acme/plan/${DOCUMENT_PLAN.id}/call`]);
});

test("⌘K pressed with the keyboard in the side panel offers its tab's link first, wearing ⌥⌘C, as ⌥⌘C there copies", () => {
  const panel = document.body.appendChild(document.createElement("div"));
  panel.className = "side-panel";
  const field = panel.appendChild(document.createElement("button"));
  field.focus();
  openPalette(
    plansControl({
      ...ON_AGENT_TAB,
      sidePanel: { ...ON_AGENT_TAB.sidePanel, open: true, tab: SIDE_PANEL_TAB.CALL },
    }),
  );
  type("copy link");
  const chord = document.querySelector(".menu-item .menu-item-hint")?.textContent;

  assert.deepEqual(
    rows().filter((row) => row.startsWith("Copy link to ")),
    [
      "Copy link to call",
      "Copy link to agent · Expire old invites",
      `Copy link to task · ${DOCUMENT_PLAN.name}`,
    ],
  );
  assert.equal(chord, "⌥⌘C");
});

test("on an agent's page in another workspace than the one listed, ⌥⌘C names the agent's workspace, which the page read", async () => {
  const copied = installClipboard();
  openPalette(
    plansControl({
      workspaces: [
        ...ON_AGENT_TAB.workspaces,
        {
          id: "workspace-beta",
          name: "Beta",
          slug: "beta",
          role: WORKSPACE_ROLE.MEMBER,
          github: null,
        },
      ],
      workspace: ON_AGENT_TAB.workspaces[0],
      agentView: { ...plansControl().agentView, agentId: LINKED_AGENT },
    }),
    undefined,
    { agentId: LINKED_AGENT, workspaceId: "workspace-beta" },
  );
  act(() => {
    runAppCommand(APP_COMMAND.COPY_LINK);
  });
  await act(async () => undefined);

  assert.deepEqual(copied, [`https://tryluke.dev/beta/agent/${LINKED_AGENT}`]);
});

test("People lists the listed workspace's members by name and role, the reader as You, found by email too, and a choice opens their page", async () => {
  const members = [
    {
      userId: "user-dean",
      name: "Dean Stratakos",
      email: "dean@example.com",
      role: WORKSPACE_ROLE.OWNER,
    },
    {
      userId: "user-charles",
      name: "Charles Pan",
      email: "charles@example.com",
      role: WORKSPACE_ROLE.MEMBER,
    },
  ];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: members }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
        ),
    },
  });
  const opened: string[] = [];
  const base = plansControl();
  const sent = openPalette(
    plansControl({
      me: "user-dean",
      workspace: { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.OWNER, github: null },
      personView: { ...base.personView, onOpen: (userId) => opened.push(userId) },
    }),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  chooseFilter("People");

  assert.deepEqual(rows(), ["Dean Stratakos · You · Owner", "Charles Pan · Member"]);
  type("charles@");
  assert.deepEqual(rows(), ["Charles Pan · Member"]);
  act(() => document.querySelector<HTMLElement>(".menu-item")?.click());
  assert.deepEqual(opened, ["user-charles"]);
  assert.deepEqual(sent.tabs, []);
});

test("on a one-off agent's page, ⌘K offers Pin agent, or Unpin agent once it is pinned, and nothing for an archived agent", () => {
  const asked: string[] = [];
  const agent = {
    id: "agent-9",
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Triage overnight issues",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    automationId: null,
    workspaceId: "workspace-1",
    repository: "acme/relay",
    activityAt: 2,
  };
  /** The rows ⌘K lists for "pin" over the agent's page, standing as given. */
  const pinRows = (standing: readonly (typeof agent & { pinnedAt?: number })[], archived = []) => {
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = "";
    openPalette(
      plansControl({
        agentView: { agentId: agent.id, onOpen: () => undefined, onClose: () => undefined },
        listedAgents: { standing, archived },
        onPinAgent: (agentId, pinned) => asked.push(`${agentId}:${String(pinned)}`),
      }),
    );
    type("pin");
    return rows().filter((row) => /^(Pin|Unpin) agent$/u.test(row));
  };

  assert.deepEqual(pinRows([agent]), ["Pin agent"]);
  press("Pin agent");
  assert.deepEqual(pinRows([{ ...agent, pinnedAt: 3 }]), ["Unpin agent"]);
  press("Unpin agent");
  assert.deepEqual(pinRows([]), []);
  assert.deepEqual(asked, ["agent-9:true", "agent-9:false"]);
});

/** The task on screen, listed in the sidebar beside the palette, its pin landing where the row menu's would. */
function PinnableTask(): React.JSX.Element {
  const [listed, setListed] = useState<Plan>(DOCUMENT_PLAN);
  const plans = plansControl({
    plans: [listed],
    region: { kind: DOCUMENT_REGION.READY, plan: listed },
    activePlanId: listed.id,
    onMarkPlan: (planId, mark) => {
      assert.equal(planId, listed.id);
      setListed(mark === PLAN_MARK.PIN ? { ...DOCUMENT_PLAN, pinnedAt: 5 } : DOCUMENT_PLAN);
    },
  });
  return createElement(
    Fragment,
    null,
    createElement(Looker, { looked: listed }),
    createElement(DesktopSidebar, sidebarProps(plans)),
    createElement(WindowPalette, {
      available: true,
      tab: PANEL_TAB.PLANS,
      onTabChange: () => undefined,
      plans,
      settings: {
        rows: { settings: settingsView(), voiceControlsDrawn: true, accountDrawn: true },
        onViewChange: () => undefined,
      },
      readFiles: () => Promise.reject(new Error("no repository is open")),
    }),
  );
}

/** The names the sidebar's Pinned section lists, none while it stands nowhere. */
function pinnedNames(): (string | null)[] {
  const section = document.querySelector('nav[aria-label="Pinned"]');
  return [...(section?.querySelectorAll(".sidebar-plan-name") ?? [])].map(
    (name) => name.textContent,
  );
}

/** The rows ⌘K lists for "pin", the palette opened afresh. */
function pinRows(): string[] {
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
  });
  type("pin");
  return rows().filter((row) => /^(Pin|Unpin) /u.test(row));
}

test("with a task open, ⌘K offers Pin task, which pins it under Pinned and turns to Unpin task", () => {
  // The sidebar asks whether motion is reduced, which jsdom cannot answer.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(PinnableTask))));

  assert.deepEqual(pinRows(), ["Pin task"]);
  press("Pin task");
  assert.deepEqual(pinnedNames(), [DOCUMENT_PLAN.name]);
  assert.deepEqual(pinRows(), ["Unpin task"]);
  press("Unpin task");
  assert.deepEqual(pinnedNames(), []);
  assert.deepEqual(pinRows(), ["Pin task"]);
});
