// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "@repo/features/inbox-wire";
import { pageFrameUrl } from "@repo/features/page-frame";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { DRAFT_PLACE, type Draft, EMPTY_DRAFT, useDraftWriter } from "../composer-drafts.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import type { InboxBoardView } from "../tasks/inbox-model.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { longPress, underAFinger } from "../testing/finger.js";
import { restOn } from "../testing/hint-rest.js";
import { relayout } from "../testing/resize-observer.js";
import { agentsControl, tasksControl } from "../testing/tasks-control.js";
import type { HeldTranscripts } from "./strip-tabs.js";
import {
  type SummaryLayout,
  summaryHolds,
  TaskSummary,
  useSummaryLayout,
  useSummaryPin,
} from "./task-summary.js";

/**
 * task-summary.test.ts -- the summary's pull request row hangs the Changes
 * card, whose agent opens through the door the plan hands it, the one that
 * gives the plan's column the keys, and whose card previews the running
 * agent's latest step while the plan's column shows that agent. A page's
 * row hangs the page's tab's card, previewing it, and the plan's row the
 * task's card, as its tab does. A column too
 * narrow to spare the rail draws none, and the toolbar's button hangs the
 * card in its place. A plan with nothing to list draws neither the summary
 * nor its button. Synthetic agents and pull requests throughout.
 */

const RUN_STARTED = 5_000;

const AGENT: AgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c99",
  runStartedAt: RUN_STARTED,
};

const PULL_REQUEST: AgentPullRequest = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 210,
  deletions: 14,
  changedFiles: 6,
};

/** What the agent's tab last drew: its run's one step so far. */
const HELD: HeldTranscripts = {
  agents: new Map([
    [
      AGENT.id,
      {
        messages: [
          {
            id: "m1",
            role: "assistant",
            parts: [{ type: "text", text: "Writing the expiry tests." }],
          },
        ],
        status: AGENT_STATUS.RUNNING,
        runStartedAt: RUN_STARTED,
        title: undefined,
        subagentTitles: new Map(),
      },
    ],
  ]),
  workers: new Map(),
};

/** The summary pinned beside the document, its card hung by nothing. */
const PINNED: SummaryLayout = {
  mode: "column",
  holds: true,
  wide: true,
  card: undefined,
  onToggle: () => undefined,
  onExpand: () => undefined,
  onDismiss: () => undefined,
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/** The summary of a task whose running agent opened the pull request, the task's column showing `shown`, drawn beside `beside`; every agent it opens recorded. */
function mount(
  shown: "agent" | "plan",
  linkWorkspace?: string,
  inbox: InboxBoardView = { open: [], waiting: [], settled: [] },
  beside?: React.ReactNode,
) {
  const opened: string[] = [];
  const base = tasksControl();
  const tasks = tasksControl({
    activeTaskId: AGENT.planId ?? undefined,
    agents: agentsControl({
      agents: [AGENT],
      agentIds: [AGENT.id],
      models: [],
      pullRequests: new Map([[AGENT.id, PULL_REQUEST]]),
    }),
    mainTabs: {
      ...base.mainTabs,
      tabs: [{ agent: AGENT.id }],
      tab: shown === "agent" ? { agent: AGENT.id } : base.mainTabs.tab,
    },
  });
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          beside,
          createElement(
            LinkWorkspaceProvider,
            { value: linkWorkspace },
            createElement(TaskSummary, {
              tasks,
              layout: PINNED,
              cardId: "summary-card",
              inbox,
              held: HELD,
              onOpenAgent: (agentId) => opened.push(agentId),
            }),
          ),
        ),
      ),
    ),
  );
  return { page, opened };
}

/** Rests the pointer on a control, which hangs its card. */
function hover(control: Element): void {
  restOn(control);
}

/** The agent named in the Changes card the pull request's row hangs. */
function cardAgent(page: HTMLElement): HTMLButtonElement {
  const row = [...page.querySelectorAll("button")].find((each) =>
    each.textContent?.includes("#42 Expire invitations"),
  );
  assert.ok(row, "the pull request has a row");
  hover(row);
  const named = document.querySelector<HTMLButtonElement>(
    '.ui-tooltip-card .ui-hover-card-row button[data-actor-ref][data-kind="agent"]',
  );
  assert.ok(named, "the pull request's card names the agent");
  return named;
}

test("a page's row hangs the page's tab's card, previewing its newest version", () => {
  fakeAppPlatform({ pageFrameUrl });
  const funnel = {
    id: "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f",
    title: "Invite funnel",
    version: 1,
    at: 1,
  };
  const taskId = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  const tasks = tasksControl({ activeTaskId: taskId, pages: [funnel] });
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(TaskSummary, {
          tasks,
          layout: PINNED,
          cardId: "summary-card",
          inbox: { open: [], waiting: [], settled: [] },
          held: HELD,
          onOpenAgent: () => undefined,
        }),
      ),
    ),
  );
  const row = [...page.querySelectorAll("button")].find((each) =>
    each.textContent?.includes(funnel.title),
  );
  assert.ok(row, "the page has a row");
  hover(row);
  const card = document.querySelector(".ui-tooltip-card [data-page-card]");
  assert.ok(card, "the page's card is hung");
  assert.equal(card.querySelector(".ui-hover-card-name")?.textContent, funnel.title);
  assert.equal(
    card.querySelector(".ui-hover-card-sub"),
    null,
    "a page's one version is not counted",
  );
  assert.equal(
    card.querySelector("iframe")?.getAttribute("src"),
    pageFrameUrl({ taskId, pageId: funnel.id, version: 1 }),
  );
});

test("the agent a pull request row's card names opens through the plan's door, which hands its column the keys", () => {
  const { page, opened } = mount("plan");
  const named = cardAgent(page);
  act(() => named.click());
  assert.deepEqual(opened, [AGENT.id]);
});

test("the agent's card hung from a Changes card previews its running step while the plan's column shows the agent, and says none while it shows another tab", () => {
  const latestStep = (shown: "agent" | "plan") => {
    const { page } = mount(shown);
    hover(cardAgent(page));
    const words = [...document.querySelectorAll(".ui-tooltip-card [data-agent-card]")]
      .map((card) => card.textContent ?? "")
      .join(" | ");
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    return words;
  };
  assert.match(latestStep("agent"), /Writing the expiry tests\./u);
  assert.doesNotMatch(latestStep("plan"), /Writing the expiry tests\./u);
});

test("an agent's row in the summary draws the agent's one menu, Copy link copying the agent's own link", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const { page } = mount("plan", "acme");
  const row = [...page.querySelectorAll<HTMLElement>(".task-summary li > button")].find((each) =>
    each.textContent?.includes(AGENT.title ?? ""),
  );
  assert.ok(row, "the agent's row is listed");
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const labels = items.map((each) => each.textContent);
  const copy = items.find((each) => each.textContent === "Copy link");
  assert.ok(copy);
  await act(async () => copy.click());

  assert.deepEqual(labels, ["Copy link", "Rename", "Archive", "Permanently delete"]);
  assert.deepEqual(copied, [`https://vespin.dev/acme/agent/${AGENT.id}`]);
});

test("under a finger, an agent's row in the summary draws no ⋯, and held it offers the agent's menu", () => {
  underAFinger();
  const { page } = mount("plan");
  const row = [...page.querySelectorAll<HTMLElement>(".task-summary li > button")].find((each) =>
    each.textContent?.includes(AGENT.title ?? ""),
  );
  assert.ok(row, "the agent's row is listed");
  assert.ok(page.querySelector('[aria-label="Agent actions"]') === null, "the row draws no ⋯");

  longPress(row);
  const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
    (each) => each.textContent,
  );
  assert.ok(labels.includes("Rename"), "the long press offers the agent's menu");
});

test("a heading folds its rows away, counting them, and stands folded as the summary is drawn again", () => {
  fakeAppPlatform(QUIET_PANEL);
  const heading = (page: HTMLElement) =>
    [...page.querySelectorAll<HTMLButtonElement>(".task-summary button[aria-expanded]")].find(
      (button) => button.textContent?.startsWith("Agents"),
    ) ?? assert.fail("Agents is a fold");
  const agentRow = (page: HTMLElement) =>
    page
      .querySelector('.task-summary [aria-label="Agents"]')
      ?.textContent?.includes(AGENT.title ?? "") === true;
  const { page } = mount("plan");
  assert.equal(heading(page).getAttribute("aria-expanded"), "true");
  assert.ok(agentRow(page), "the agent is listed");

  act(() => heading(page).click());
  assert.equal(heading(page).getAttribute("aria-expanded"), "false");
  assert.equal(heading(page).textContent, "Agents1 agent");
  assert.ok(!agentRow(page), "the agent is folded away");

  act(() => root?.unmount());
  document.body.innerHTML = "";
  const again = mount("plan").page;
  assert.equal(heading(again).getAttribute("aria-expanded"), "false", "it stands as it was left");
});

/** An item of the plan's inbox that waits on the reader. */
const ASKING: InboxItem = {
  id: "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  agentId: AGENT.id,
  key: "3e4f",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Expire after 7 days?",
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_000,
  updatedAt: 1_000,
};

/** Writes `draft` into an inbox item's box, as typing an answer or picking on its card would. */
function DraftOnItem({ item, draft }: { item: InboxItem; draft: Draft }): null {
  const writer = useDraftWriter();
  useEffect(() => {
    const place = {
      kind: DRAFT_PLACE.INBOX,
      planId: AGENT.planId,
      agentId: item.agentId,
      itemId: item.id,
    };
    writer.update(place, () => draft);
  }, [writer, item, draft]);
  return null;
}

test("the Inbox's row counts what needs the reader in the attention tone its rows' marks wear", () => {
  const asking = ASKING;
  const { page } = mount("plan", undefined, { open: [asking], waiting: [asking], settled: [] });
  const count =
    page.querySelector<HTMLElement>(".task-summary .inbox-row-count") ??
    assert.fail("the Inbox's row counts what needs the reader");
  assert.equal(count.textContent, "1 needs you");
});

test("the Inbox's row wears the Draft pencil beside its count while one of its items' boxes holds a draft, and none for picks made on an ask since changed", () => {
  const board = { open: [ASKING], waiting: [ASKING], settled: [] };
  const marks = (draft?: Draft) => {
    const beside =
      draft === undefined ? undefined : createElement(DraftOnItem, { item: ASKING, draft });
    const { page } = mount("plan", undefined, board, beside);
    const drawn = {
      drafted: page.querySelector('.task-summary .draft-mark[aria-label="Draft"]') !== null,
      count: page.querySelector(".task-summary .inbox-row-count")?.textContent,
    };
    act(() => root?.unmount());
    page.remove();
    return drawn;
  };

  assert.deepEqual(marks(), { drafted: false, count: "1 needs you" });
  assert.deepEqual(marks({ ...EMPTY_DRAFT, text: "Seven days, yes" }), {
    drafted: true,
    count: "1 needs you",
  });
  const stale = { ...EMPTY_DRAFT, choices: ["Seven days"], revision: ASKING.revision - 1 };
  assert.equal(marks(stale).drafted, false);
});

/** What the plan's own inbox holds in these tests: nothing. */
const NO_INBOX = { open: [], waiting: [], settled: [] };

/** The plan's column as the shell lays it out: the summary, laid out by the column's own width. */
function TaskColumn({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const pin = useSummaryPin(true);
  const [column, setColumn] = useState<HTMLElement | null>(null);
  const layout = useSummaryLayout(pin, column, false, summaryHolds(tasks, NO_INBOX));
  return createElement(
    "div",
    { ref: setColumn },
    createElement(TaskSummary, {
      tasks,
      layout,
      cardId: "summary-card",
      inbox: NO_INBOX,
      held: HELD,
      onOpenAgent: () => undefined,
    }),
  );
}

/** A plan whose summary lists something: one page its agents wrote. */
function listedControl(): TasksControl {
  return tasksControl({ pages: [{ id: "page-1", title: "Invite funnel", version: 1, at: 1 }] });
}

/** The column of `plans` drawn `width` pixels wide, and ways to lay it out again at another width or over other plans. */
function columnAt(width: number, tasks: TasksControl = listedControl()) {
  const measured = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  measured.mockReturnValue(DOMRect.fromRect({ width }));
  const page = document.body.appendChild(document.createElement("div"));
  root = createRoot(page);
  const draw = (shown: TasksControl) =>
    act(() =>
      root?.render(onRegistry(AtomRegistry.make(), createElement(TaskColumn, { tasks: shown }))),
    );
  draw(tasks);
  return {
    page,
    rail: () => page.querySelector('aside[aria-label="Summary"]'),
    toggle: () => page.querySelector('button[aria-label$="summary"]'),
    redraw: draw,
    widen: (to: number) => {
      measured.mockReturnValue(DOMRect.fromRect({ width: to }));
      act(() => relayout());
    },
  };
}

test("where the summary cannot pin, the rail's chevron hangs the whole summary as a card over it", () => {
  const column = columnAt(600);
  const toggle =
    column.page.querySelector<HTMLButtonElement>('button[aria-label="Expand summary"]') ??
    assert.fail("the rail's chevron stands");
  act(() => toggle.click());
  const card = document.querySelector('[role="dialog"][aria-label="Summary"]');
  assert.ok(card, "the card hangs");
  assert.ok(card.querySelectorAll("li > button").length > 0, "the card lists the summary");
});

test("Escape takes the card the rail's chevron hung back down and hands the focus back to the chevron", () => {
  const column = columnAt(600);
  const toggle =
    column.page.querySelector<HTMLButtonElement>('button[aria-label="Expand summary"]') ??
    assert.fail("the rail's chevron stands");
  act(() => toggle.click());
  assert.ok(document.querySelector('[role="dialog"][aria-label="Summary"]'), "the card hangs");

  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "the card is taken down");
  assert.equal(document.activeElement, toggle, "the chevron has the focus back");
});

test("a press outside the card the rail's chevron hung takes it down, and a press inside it leaves it", () => {
  const column = columnAt(600);
  const toggle =
    column.page.querySelector<HTMLButtonElement>('button[aria-label="Expand summary"]') ??
    assert.fail("the rail's chevron stands");
  act(() => toggle.click());
  const card = document.querySelector('[role="dialog"][aria-label="Summary"]');
  assert.ok(card, "the card hangs");

  act(() => card.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "a press inside leaves it hung");

  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "a press outside takes it down");
});

test("a card the rail's chevron hung goes once the column narrows past the rail it hangs over", () => {
  const column = columnAt(600);
  const toggle =
    column.page.querySelector<HTMLButtonElement>('button[aria-label="Expand summary"]') ??
    assert.fail("the rail's chevron stands");
  act(() => toggle.click());
  assert.ok(document.querySelector('[role="dialog"][aria-label="Summary"]'), "the card hangs");

  column.widen(400);
  assert.equal(column.rail(), null, "no rail is left");
  assert.equal(
    document.querySelector('[role="dialog"][aria-label="Summary"]:not([data-leaving])'),
    null,
    "the card goes with it",
  );
});

test("a column with room for the rail draws it, and one widened to that room draws it again", () => {
  assert.equal(columnAt(600).rail()?.getAttribute("data-mode"), "rail");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const column = columnAt(423);
  assert.equal(column.rail(), null);
  column.widen(480);
  assert.equal(column.rail()?.getAttribute("data-mode"), "rail");
});

test("a plan with nothing yet to list draws no summary nor its chevron, and both stand once it holds a row", () => {
  const listed = listedControl();
  const bare = tasksControl();
  for (const width of [1200, 600, 280]) {
    const column = columnAt(width, bare);
    assert.equal(column.rail(), null, `no summary at ${width}px`);
    assert.equal(column.toggle(), null, `no chevron at ${width}px`);
    act(() => root?.unmount());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  }

  const column = columnAt(1200, bare);
  column.redraw(listed);
  assert.equal(column.rail()?.getAttribute("data-mode"), "column");
  assert.ok(column.toggle(), "the chevron stands");
});
