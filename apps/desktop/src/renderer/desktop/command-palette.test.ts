// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import {
  PLAN_TREE_ENTRY,
  type Plan,
  type PlanSummary,
  type PlanTreeEntry,
} from "@sidecar/hosted/plan-wire";
import {
  PLAN_CALL_FAILURE,
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanningTreeAnswer,
} from "@sidecar/hosted/planning-view";
import { BoardIcon, CodeIcon, TranscriptIcon, WorkIcon } from "@sidecar/panel";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import {
  codingAgentsControl,
  plansControl,
  UNPINNED_SUMMARY,
  versionHistoryControl,
} from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { useAppCommand, useAppKeymap } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { isSubagentTab, tabKey } from "../planning/tab-strip-model";
import { NO_LOOKS } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
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

/** Luke's planning model at work on the open plan: one worker, counting routes. */
const WORK: PlansControl["work"] = {
  callLive: true,
  earlier: undefined,
  onLoadEarlier: () => Promise.resolve(),
  turns: [
    {
      turnId: "turn-1",
      startedAt: 1_000,
      state: PLAN_WORK_STATE.RUNNING,
      earlierOmitted: false,
      parts: [
        {
          type: PLAN_WORK_PART.TOOL,
          id: "call-worker",
          tool: PLAN_WORK_TOOL.WORKER,
          name: "worker",
          state: PLAN_WORK_STATE.RUNNING,
          subject: "Count the routes.",
          input: "{}",
          session: { earlierOmitted: false, parts: [] },
        },
      ],
    },
  ],
};

/** The open plan's repository: two files under a folder, and one at the root. */
const ENTRIES: readonly PlanTreeEntry[] = [
  { name: "src", kind: PLAN_TREE_ENTRY.FOLDER },
  { name: "src/invites", kind: PLAN_TREE_ENTRY.FOLDER },
  { name: "src/invites/accept-invite.ts", kind: PLAN_TREE_ENTRY.FILE },
  { name: "src/invites/invite-email.tsx", kind: PLAN_TREE_ENTRY.FILE },
  { name: "README.md", kind: PLAN_TREE_ENTRY.FILE },
];

/** The repository listed whole, cut short at the wire's bound or not. */
function listing(
  truncated: boolean,
  entries: readonly PlanTreeEntry[] = ENTRIES,
): PlanningTreeAnswer {
  return {
    folder: { path: "", repository: "acme/docs", branch: "main", entries, truncated },
  };
}

const TREE = listing(false);

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
  /** Each agent shown, by its plan and its id. */
  agents: [string, string][];
  /** Each plan shown on its Inbox. */
  inboxes: string[];
  views: SettingsView[];
  /** Each read of the open plan's whole repository, by plan. */
  reads: string[];
  /** Each file opened in the side panel, and whether in a tab of its own. */
  browsed: [string, boolean][];
}

/**
 * The window as the palette sees it: the keymap answering, the open plan's
 * toolbar standing (which offers Copy and Delete), Settings offered, and the
 * palette over it all, on the tab given.
 */
function mountWindow(
  initialTab: PanelTab,
  overrides: Partial<PlansControl> = {},
  readTree: () => Promise<PlanningTreeAnswer> = () => Promise.resolve(TREE),
): Asked {
  const asked: Asked = {
    selected: [],
    tabs: [],
    ran: [],
    agents: [],
    inboxes: [],
    views: [],
    reads: [],
    browsed: [],
  };
  const base = plansControl();
  const plans = plansControl({
    page: PLANS_PAGE.DOCUMENT,
    plans: [OPEN, ...TWINS],
    archived: [ARCHIVED],
    activePlanId: OPEN.id,
    region: { kind: DOCUMENT_REGION.READY, plan: OPEN },
    onSelect: (planId) => asked.selected.push(planId),
    agents: codingAgentsControl({ agents: [AGENT], agentIds: [AGENT.id] }),
    onShowAgent: (planId, agentId) => asked.agents.push([planId, agentId]),
    onShowInbox: (planId) => asked.inboxes.push(planId),
    sidePanel: {
      ...base.sidePanel,
      onBrowseFile: (_from, path, newTab) => asked.browsed.push([path, newTab]),
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
        readFiles: (planId: string) => {
          asked.reads.push(planId);
          return readTree();
        },
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

/** Lets a read the palette asked for land. */
async function settle(): Promise<void> {
  await act(async () => undefined);
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

test("⌘K lists the commands the window can run now under Actions, each with its chord at the row's end", () => {
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
  assert.equal(settings?.querySelector(".shortcut")?.textContent, "⌘,");
  assert.equal(
    settings?.querySelector(".shortcut")?.getAttribute("aria-hidden"),
    null,
    "a row is an option with no aria-keyshortcuts of its own, so its chord is read",
  );
});

test("All lists each kind's best few under its heading, and a kind's filter lists more of it", () => {
  mountWindow(PANEL_TAB.PLANS);
  openPalette();
  assert.equal(chosenFilter(), "All", "the palette opens on All");
  assert.deepEqual(
    headings(),
    ["Plans", "Agents", "Actions", "Settings"],
    "no file is listed before a search",
  );
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

test("a search lists the rows its letters abbreviate, never those it is only scattered through", () => {
  mountWindow(PANEL_TAB.PLANS);
  const input = openPalette();
  search(input, "tgsb");
  pressFilter("Settings");
  assert.ok(
    rows().some((row) => row.startsWith("Toggle sidebar")),
    "tgsb abbreviates Toggle sidebar",
  );
  search(input, "palette");
  pressFilter("All");
  const listed = rows();
  assert.ok(listed.some((row) => row.startsWith("Command palette")));
  assert.ok(
    !listed.some((row) => row.startsWith("Permanently delete plan")),
    "palette's letters only stand scattered through Permanently delete plan",
  );
});

test("the open plan's Inbox and coding agent are listed beside the plan's name and open as an agent's notification would, over whatever covers their tab", () => {
  const asked = mountWindow(PANEL_TAB.SETTINGS);
  openPalette();
  pressFilter("Agents");
  assert.deepEqual(rows(), [
    "Inbox · Teammate invitations",
    "Invite email template · Teammate invitations",
  ]);
  choose("Invite email template");
  assert.deepEqual(asked.tabs, [PANEL_TAB.PLANS], "an agent opens on the Plans tab");
  assert.deepEqual(asked.agents, [[OPEN.id, AGENT.id]]);

  openPalette();
  pressFilter("Agents");
  choose("Inbox");
  assert.deepEqual(asked.inboxes, [OPEN.id]);
});

test("a subagent chosen over the version history opens its tab with the history put away", () => {
  const seen: string[] = [];
  const base = plansControl();
  mountWindow(PANEL_TAB.PLANS, {
    work: WORK,
    history: versionHistoryControl({ open: true, onClose: () => seen.push("history closed") }),
    sidePanel: {
      ...base.sidePanel,
      onChoose: (tab) => seen.push(isSubagentTab(tab) ? tab.subagent : "?"),
    },
  });
  openPalette();
  pressFilter("Agents");
  choose("Count the routes.");
  assert.deepEqual(seen, ["history closed", "call-worker"]);
});

test("Show board and the panel's other kinds are listed with the commands, with no chord, and show the panel on the tab over the version history", () => {
  const seen: string[] = [];
  const base = plansControl();
  const asked = mountWindow(PANEL_TAB.SETTINGS, {
    history: versionHistoryControl({ open: true, onClose: () => seen.push("history closed") }),
    sidePanel: {
      ...base.sidePanel,
      onChoose: (tab) => seen.push(tabKey(tab)),
    },
  });
  const input = openPalette();
  pressFilter("Actions");
  search(input, "show");
  for (const [kind, glyph] of [
    ["Show board", BoardIcon],
    ["Show code", CodeIcon],
    ["Show transcript", TranscriptIcon],
    ["Show work", WorkIcon],
  ] as const) {
    assert.ok(rows().includes(kind), `${kind} is listed alone, with no chord`);
    const row = listedRows().find((each) => rowWords(each) === kind);
    assert.equal(
      row?.querySelector("svg")?.outerHTML,
      renderToStaticMarkup(createElement(glyph)),
      `${kind} wears its tab's glyph`,
    );
  }
  choose("Show transcript");
  assert.deepEqual(asked.tabs, [PANEL_TAB.PLANS], "the panel opens on the Plans tab");
  assert.deepEqual(seen, ["history closed", SIDE_PANEL_TAB.TRANSCRIPT]);
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

test("Files lists the repository's files matching the query, each beside its folder, and opens one in a tab of its own", async () => {
  const asked = mountWindow(PANEL_TAB.SETTINGS);
  const input = openPalette();
  pressFilter("Files");
  await settle();
  search(input, "invite");
  assert.deepEqual(
    rows().sort(),
    ["accept-invite.ts · src/invites", "invite-email.tsx · src/invites"],
    "the two files whose paths hold the word, the README and the folders left out",
  );
  choose("accept-invite.ts");
  assert.deepEqual(asked.tabs, [PANEL_TAB.PLANS], "a file opens on the Plans tab");
  assert.deepEqual(asked.browsed, [["src/invites/accept-invite.ts", true]]);
});

test("a file chosen over the version history opens with the history put away", async () => {
  let closed = 0;
  const asked = mountWindow(PANEL_TAB.PLANS, {
    history: versionHistoryControl({ open: true, onClose: () => (closed += 1) }),
  });
  const input = openPalette();
  pressFilter("Files");
  await settle();
  search(input, "readme");
  choose("README.md");
  assert.equal(closed, 1);
  assert.deepEqual(asked.browsed, [["README.md", true]]);
});

test("the repository is read the first time a file is searched in an opening, once however many searches follow, and All lists its best files", async () => {
  const asked = mountWindow(PANEL_TAB.PLANS);
  let input = openPalette();
  await settle();
  assert.deepEqual(asked.reads, [], "opening the palette reads nothing");
  search(input, "readme");
  await settle();
  assert.deepEqual(asked.reads, [OPEN.id]);
  assert.ok(headings().includes("Files"));
  assert.ok(rows().includes("README.md"), "a file at the root stands without a folder");
  search(input, "accept");
  await settle();
  assert.deepEqual(asked.reads, [OPEN.id], "the listing is kept for the opening's next search");
  assert.ok(rows().includes("accept-invite.ts · src/invites"));
  press(input, { key: "Escape" });
  input = openPalette();
  search(input, "accept");
  await settle();
  assert.deepEqual(
    asked.reads,
    [OPEN.id, OPEN.id],
    "the next opening reads the branch as it stands",
  );
});

test("a read answering after a later one was asked is not kept, since it may list an older branch", async () => {
  const answers: ((answer: PlanningTreeAnswer) => void)[] = [];
  mountWindow(
    PANEL_TAB.PLANS,
    {},
    () => new Promise<PlanningTreeAnswer>((answer) => answers.push(answer)),
  );
  let input = openPalette();
  pressFilter("Files");
  press(input, { key: "Escape" });
  input = openPalette();
  pressFilter("Files");
  const [older, later] = answers;
  assert.ok(older && later, "each opening asked for the files");
  later(listing(false, [{ name: "src/new.ts", kind: PLAN_TREE_ENTRY.FILE }]));
  older(TREE);
  await settle();
  assert.deepEqual(rows(), ["new.ts · src"]);
});

test("with no plan open the Files filter says so quietly and reads nothing", async () => {
  const asked = mountWindow(PANEL_TAB.PLANS, {
    page: PLANS_PAGE.NEW,
    activePlanId: undefined,
    region: { kind: DOCUMENT_REGION.NONE },
  });
  openPalette();
  pressFilter("Files");
  await settle();
  assert.equal(
    document.querySelector(".command-palette-empty")?.textContent,
    "Open a plan with a repository to search its files.",
  );
  assert.deepEqual(asked.reads, []);
});

test("a listing cut short at the wire's bound says the search covers only its first entries", async () => {
  mountWindow(PANEL_TAB.PLANS, {}, () => Promise.resolve(listing(true)));
  openPalette();
  pressFilter("Files");
  await settle();
  assert.equal(
    document.querySelector(".command-palette-notice")?.textContent,
    "Only the repository's first 50,000 entries are searched.",
  );
});

test("a read that did not land says so, and the next opening asks again", async () => {
  const asked = mountWindow(PANEL_TAB.PLANS, {}, () =>
    Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED }),
  );
  let input = openPalette();
  pressFilter("Files");
  await settle();
  assert.equal(
    document.querySelector(".command-palette-empty")?.textContent,
    "The files could not be read.",
  );
  press(input, { key: "Escape" });
  input = openPalette();
  pressFilter("Files");
  await settle();
  assert.deepEqual(asked.reads, [OPEN.id, OPEN.id]);
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
