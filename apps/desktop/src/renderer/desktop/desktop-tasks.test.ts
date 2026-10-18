// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_CURSOR_START,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, test, vi } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";
import { handState } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { relayout } from "#testing/resize-observer";
import { runAppCommand, useAppKeymap } from "../app-commands";
import { fixtureChat } from "../tasks/chat-fixture";
import { MAIN_TAB } from "../tasks/use-main-tabs";
import { PULL_REQUEST_VIEW, SIDE_PANEL_TAB } from "../tasks/use-side-panel";
import { NO_LOOKS } from "../tasks/use-task-looks";
import "../file-tree/index";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "#testing/tasks-control";
import { DesktopTasks } from "./desktop-tasks";

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "", assumptions: [] },
};

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

afterEach(() => {
  vi.restoreAllMocks();
});

test("a task the service will not hand the reader, as a link to another workspace's may name, is not found, its Close the one way on", () => {
  const left: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(DesktopTasks, {
        summary: UNPINNED_SUMMARY,
        looks: NO_LOOKS,
        tasks: tasksControl({
          page: TASKS_PAGE.DOCUMENT,
          activeTaskId: TASK.id,
          region: { kind: DOCUMENT_REGION.MISSING },
          onLeaveTask: () => left.push(TASK.id),
        }),
      }),
    ),
  );
  const close = [...container.querySelectorAll("button")].find(
    (each) => each.textContent === "Close task",
  );
  act(() => close?.click());

  assert.match(
    container.textContent ?? "",
    /Not foundThis task doesn't exist, or you don't have access to it\./u,
  );
  assert.deepEqual(left, [TASK.id]);
  act(() => root.unmount());
  container.remove();
});

test("the Call tab draws each call's spoken lines as the developer's bubbles and Luke's messages, left out of the screen recording", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopTasks, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      tasks: tasksControl({
        page: TASKS_PAGE.DOCUMENT,
        activeTaskId: TASK.id,
        region: { kind: DOCUMENT_REGION.READY, task: TASK },
        sidePanel: { ...tasksControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.CALL },
        transcript: {
          region: {
            kind: TRANSCRIPT_REGION.READY,
            earlierOmitted: false,
            calls: [
              {
                key: "call-1",
                startedAt: 1_000,
                live: true,
                lukeEnded: false,
                messages: [
                  {
                    id: "0",
                    role: "user",
                    parts: [{ type: "text", text: "Invites should expire." }],
                  },
                  {
                    id: "1",
                    role: "assistant",
                    parts: [{ type: "text", text: "After how many days?" }],
                  },
                ],
              },
            ],
          },
          onRetry: () => undefined,
        },
      }),
    }),
  );

  const page = document.createElement("div");
  page.innerHTML = markup;
  const call = page.querySelector('section.task-call.ph-no-capture[aria-label="Call"]');
  assert.ok(call, "the Call tab, left out of the recording");
  // The developer's line a bubble of their own, Luke's an assistant's message, as an agent's tab draws them.
  assert.deepEqual(
    [...call.querySelectorAll(".is-user, .is-assistant")].map((message) => [
      message.classList.contains("is-user") ? "user" : "assistant",
      message.querySelector("p")?.textContent,
    ]),
    [
      ["user", "Invites should expire."],
      ["assistant", "After how many days?"],
    ],
  );
  assert.match(call.textContent ?? "", /Live/u);
});

test("a plan's Inbox tab whose read holds nothing says nothing needs you under the Inbox's glyph, or under its list where the list stands alone, rather than standing blank", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const agentId = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          captions: undefined,
          tasks: tasksControl({
            page: TASKS_PAGE.DOCUMENT,
            activeTaskId: TASK.id,
            region: { kind: DOCUMENT_REGION.READY, task: TASK },
            mainTabs: {
              ...tasksControl().mainTabs,
              tabs: [MAIN_TAB.PLAN, MAIN_TAB.INBOX],
              tab: MAIN_TAB.INBOX,
            },
            agents: codingAgentsControl({
              agentIds: [agentId],
              readInbox: ({ after }) =>
                after === INBOX_CURSOR_START
                  ? Promise.resolve({ items: [], cursor: "1" })
                  : new Promise(() => undefined),
            }),
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const tab = container.querySelector<HTMLElement>('section.inbox-view[aria-label="Inbox"]');
  assert.ok(tab, "the plan's Inbox tab");
  assert.match(tab.textContent ?? "", /Nothing needs you/u);
  // Too narrow for the pane beside it, the list standing alone says so.
  vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 700, height: 800 }),
  );
  act(() => relayout());
  const shown = [...tab.querySelectorAll(".inbox-tasks, .inbox-view-items")].filter(
    (column) => !column.hasAttribute("hidden"),
  );
  assert.match(shown.map((column) => column.textContent).join(""), /Nothing needs you/u);
  assert.equal(
    shown
      .find((column) => column.classList.contains("inbox-tasks"))
      ?.querySelector(".luke-empty-state")?.textContent,
    "Nothing needs you",
    "the list standing alone stands the Inbox's empty state",
  );
  act(() => root.unmount());
  container.remove();
});

/** An item of the plan's agent, open and asking for an approval, as the service answers one. */
function approvalItem(id: string, title: string, at: number): InboxItem {
  return {
    id,
    agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    blocks: [],
    response: { type: INBOX_RESPONSE.APPROVAL },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: at,
    updatedAt: at,
  };
}

/** The plan's Inbox tab over the items given, laid out 700px wide, too narrow for its list and the item side by side, or as wide as given. */
async function narrowTaskInbox(
  items: readonly InboxItem[],
  fullScreen = false,
  width = 700,
  /** What the read held open past the first answers, where a test settles it; else it stays open. */
  later: Promise<CodingAgentInboxAnswerView> = new Promise(() => undefined),
  /** What the first read answers, where a test holds it open; else the items given. */
  first: Promise<CodingAgentInboxAnswerView> = Promise.resolve({ items, cursor: "1" }),
) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          captions: undefined,
          tasks: tasksControl({
            page: TASKS_PAGE.DOCUMENT,
            activeTaskId: TASK.id,
            region: { kind: DOCUMENT_REGION.READY, task: TASK },
            mainTabs: {
              ...tasksControl().mainTabs,
              tabs: [MAIN_TAB.PLAN, MAIN_TAB.INBOX],
              tab: MAIN_TAB.INBOX,
            },
            sidePanel: { ...tasksControl().sidePanel, open: fullScreen, fullScreen },
            agents: codingAgentsControl({
              agentIds: ["8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21"],
              readInbox: ({ after }) =>
                after === INBOX_CURSOR_START
                  ? first
                  : after === "1"
                    ? later
                    : new Promise(() => undefined),
            }),
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const tab = container.querySelector<HTMLElement>('section.inbox-view[aria-label="Inbox"]');
  assert.ok(tab, "the plan's Inbox tab");
  vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height: 800 }));
  act(() => relayout());
  return {
    /** What a reader finds standing: the list or the item, and the item's title. */
    standing: () => [
      tab.querySelector(".inbox-tasks")?.hasAttribute("hidden") === false ? "list" : "",
      tab.querySelector(".inbox-view-items")?.hasAttribute("hidden") === false
        ? (tab.querySelector("[data-inbox-title]")?.textContent ?? "item")
        : "",
    ],
    title: () => tab.querySelector("[data-inbox-title]")?.textContent,
    /** The list's head as a reader meets it: its name, and Needs you's pressed state. */
    head: () => {
      const head = tab.querySelector(".inbox-tasks header");
      const needsYou = head?.querySelector<HTMLButtonElement>('button[aria-label="Needs you"]');
      return [head?.querySelector("h1")?.textContent, needsYou?.getAttribute("aria-pressed")];
    },
    pressNeedsYou: () =>
      act(() =>
        tab
          .querySelector<HTMLButtonElement>('.inbox-tasks button[aria-label="Needs you"]')
          ?.click(),
      ),
    rows: () =>
      [...tab.querySelectorAll(".inbox-tasks .luke-list-row-title")].map((row) => row.textContent),
    /** Needs you's empty state in the list as a reader meets it: its heading, its line, and its one press; none where the list stands none. */
    filteredOut: () => {
      const empty = tab.querySelector(".inbox-tasks:not([hidden]) .luke-empty-state");
      if (empty === null) return null;
      return [
        empty.querySelector("h3")?.textContent,
        empty.querySelector("p")?.textContent,
        empty.querySelector("button")?.textContent,
      ];
    },
    showAll: () =>
      act(() =>
        tab.querySelector<HTMLButtonElement>(".inbox-tasks .luke-empty-state button")?.click(),
      ),
    pager: () => tab.querySelector(".inbox-pager-count")?.textContent ?? null,
    /** What the list says of a read that did not land, and whether it offers Retry. */
    failure: () => {
      const alert = tab.querySelector('.inbox-tasks [role="alert"]');
      const retry = [...tab.querySelectorAll(".inbox-tasks button")].some((button) =>
        button.textContent?.includes("Retry"),
      );
      return [alert?.textContent?.includes("The inbox could not be read.") ?? false, retry];
    },
    back: () =>
      [
        ...tab.querySelectorAll<HTMLButtonElement>(".inbox-view-items > .desktop-toolbar button"),
      ].find((button) => button.textContent === "Inbox") ?? null,
    row: (title: string) =>
      [...tab.querySelectorAll<HTMLButtonElement>(".inbox-tasks li > button")].find((each) =>
        each.textContent?.includes(title),
      ),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test("a task's Inbox tab too narrow for its list and the item side by side is the item it holds, with no way back to a list of one", async () => {
  const inbox = await narrowTaskInbox([
    approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000),
  ]);
  assert.deepEqual(inbox.standing(), ["", "Expire after 7 days?"]);
  assert.equal(inbox.back(), null, "no way back to a list of one");
  assert.equal(runAppCommand(APP_COMMAND.BACK), false, "nor does Back's chord go to one");
  inbox.unmount();
});

/** An item of the plan's agent the developer approved, settled. */
function approvedItem(id: string, title: string, at: number): InboxItem {
  return {
    ...approvalItem(id, title, at),
    status: INBOX_STATUS.ANSWERED,
    answer: { reply: INBOX_REPLY.APPROVED },
  };
}

test("a task's Inbox heads its list with the Inbox's name and Needs you, whose press lists only what needs you, kept across a relaunch", async () => {
  window.localStorage.clear();
  const items = [
    approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000),
    approvedItem("a1b2c3d4-0000-4000-8000-000000000002", "Resend on bounce?", 2_000),
  ];
  let inbox = await narrowTaskInbox(items, false, 1_200);
  assert.deepEqual(inbox.head(), ["Inbox", "false"]);
  assert.deepEqual(inbox.rows(), ["Resend on bounce?", "Expire after 7 days?"]);

  inbox.pressNeedsYou();
  assert.deepEqual(inbox.head(), ["Inbox", "true"]);
  assert.deepEqual(inbox.rows(), ["Expire after 7 days?"]);
  inbox.unmount();

  inbox = await narrowTaskInbox(items, false, 1_200);
  assert.deepEqual(inbox.rows(), ["Expire after 7 days?"], "Needs you outlives a relaunch");
  inbox.unmount();
  window.localStorage.clear();
});

test("one column wide, a task's Inbox filtered to what needs you pages through only those", async () => {
  window.localStorage.clear();
  const inbox = await narrowTaskInbox([
    approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000),
    approvedItem("a1b2c3d4-0000-4000-8000-000000000002", "Resend on bounce?", 2_000),
    approvalItem("a1b2c3d4-0000-4000-8000-000000000003", "Alert at 80%?", 3_000),
  ]);
  assert.deepEqual(inbox.standing(), ["", "Alert at 80%?"]);
  assert.equal(inbox.pager(), "1 of 3");

  act(() => inbox.back()?.click());
  inbox.pressNeedsYou();
  act(() => inbox.row("Alert at 80%?")?.click());
  assert.equal(inbox.pager(), "1 of 2", "the settled item is passed over");
  window.localStorage.clear();
  inbox.unmount();
});

test("one column wide, a task's Inbox filtered down to one item still offers its way back, to the list that holds Needs you", async () => {
  window.localStorage.clear();
  const inbox = await narrowTaskInbox([
    approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000),
    approvedItem("a1b2c3d4-0000-4000-8000-000000000002", "Resend on bounce?", 2_000),
  ]);
  act(() => inbox.back()?.click());
  inbox.pressNeedsYou();
  act(() => inbox.row("Expire after 7 days?")?.click());
  assert.deepEqual(inbox.standing(), ["", "Expire after 7 days?"]);
  act(() => inbox.back()?.click());
  assert.deepEqual(inbox.head(), ["Inbox", "true"]);
  window.localStorage.clear();
  inbox.unmount();
});

/** A read the test settles by hand: the promise the Inbox awaits, and what settles it. */
interface HeldAnswer {
  readonly promise: Promise<CodingAgentInboxAnswerView>;
  readonly settle: (answer: CodingAgentInboxAnswerView) => Promise<void>;
}

/** A read held open until the test settles it. */
function heldAnswer(): HeldAnswer {
  let settle: (answer: CodingAgentInboxAnswerView) => void = () => undefined;
  const promise = new Promise<CodingAgentInboxAnswerView>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    settle: async (answer) => {
      settle(answer);
      await act(async () => {
        for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
      });
    },
  };
}

test("while a task's Inbox is first read, its list stands placeholder rows under a status saying the inbox is being read, with no ring in its corner; once the read lands, the items stand", async () => {
  const read = heldAnswer();
  const asked = approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000);
  const inbox = await narrowTaskInbox([], false, 1_200, undefined, read.promise);
  const list = document.querySelector<HTMLElement>(".inbox-tasks");
  assert.ok(list, "the list is drawn");
  const wait = list.querySelector<HTMLElement>('[role="status"][aria-busy="true"]');
  assert.equal(wait?.textContent, "Reading your inbox…");
  assert.ok(
    (wait?.querySelectorAll(".luke-list-row .luke-skeleton").length ?? 0) > 0,
    "placeholder rows stand in the items' place",
  );
  assert.equal(list.querySelector(".luke-spinner"), null, "no ring stands in the list's corner");

  await read.settle({ items: [asked], cursor: "1" });
  assert.equal(list.querySelector('[aria-busy="true"]'), null);
  assert.deepEqual(inbox.rows(), ["Expire after 7 days?"]);
  inbox.unmount();
});

test("with Needs you on, the item a task's Inbox chose for itself stays shown once it is answered, though it leaves the list, which then says nothing needs you", async () => {
  window.localStorage.clear();
  const asked = approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000);
  const read = heldAnswer();
  const inbox = await narrowTaskInbox([asked], false, 1_200, read.promise);
  inbox.pressNeedsYou();
  assert.equal(inbox.title(), "Expire after 7 days?");
  await read.settle({ items: [approvedItem(asked.id, asked.title, 1_000)], cursor: "2" });
  assert.deepEqual(inbox.rows(), []);
  assert.equal(inbox.filteredOut()?.[0], "Nothing needs you");
  assert.equal(inbox.title(), "Expire after 7 days?", "the answer is seen landing");
  window.localStorage.clear();
  inbox.unmount();
});

test("a task's Inbox holding only settled items, Needs you pressed on, lists no row and says nothing needs you with Show all, wide or one column wide, and Show all turns the filter off", async () => {
  window.localStorage.clear();
  const items = [
    approvedItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000),
    approvedItem("a1b2c3d4-0000-4000-8000-000000000002", "Resend on bounce?", 2_000),
  ];
  const wide = await narrowTaskInbox(items, false, 1_200);
  assert.deepEqual(wide.rows(), ["Resend on bounce?", "Expire after 7 days?"]);
  wide.pressNeedsYou();
  assert.deepEqual(wide.head(), ["Inbox", "true"]);
  assert.deepEqual(wide.rows(), [], "the item read is not listed under a filter leaving it out");
  assert.deepEqual(wide.filteredOut(), [
    "Nothing needs you",
    "You've answered everything",
    "Show all",
  ]);
  assert.equal(wide.title(), "Resend on bounce?", "the item read stays shown beside the list");
  wide.showAll();
  assert.deepEqual(wide.head(), ["Inbox", "false"]);
  assert.deepEqual(wide.rows(), ["Resend on bounce?", "Expire after 7 days?"]);
  wide.pressNeedsYou();
  wide.unmount();

  // Opened again one column wide, Needs you kept, nothing stands chosen, so the list stands alone and says so.
  const narrow = await narrowTaskInbox(items);
  assert.deepEqual(narrow.standing(), ["list", ""]);
  assert.equal(narrow.filteredOut()?.[2], "Show all");
  narrow.showAll();
  assert.deepEqual(
    narrow.standing(),
    ["list", ""],
    "Show all leaves the rows it brings back standing",
  );
  assert.deepEqual(narrow.head(), ["Inbox", "false"]);
  assert.deepEqual(narrow.rows(), ["Resend on bounce?", "Expire after 7 days?"]);
  window.localStorage.clear();
  narrow.unmount();
});

test("a task's Inbox whose read failed offers Retry though Needs you lists nothing it still holds", async () => {
  window.localStorage.clear();
  const settled = [
    approvedItem("a1b2c3d4-0000-4000-8000-000000000002", "Resend on bounce?", 2_000),
  ];
  const first = await narrowTaskInbox(settled, false, 1_200);
  first.pressNeedsYou();
  first.unmount();

  const read = heldAnswer();
  const inbox = await narrowTaskInbox(settled, false, 1_200, read.promise);
  assert.deepEqual(inbox.rows(), [], "Needs you, kept from before, lists nothing");
  await read.settle({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(inbox.failure(), [true, true]);
  window.localStorage.clear();
  inbox.unmount();
});

test("a plan's Inbox the full-screen side panel covers leaves K and J to the panel, stepping nothing it hides", async () => {
  const keys = createRoot(document.body.appendChild(document.createElement("div")));
  function Keymap() {
    useAppKeymap(true);
    return null;
  }
  act(() => keys.render(createElement(Keymap)));
  const inbox = await narrowTaskInbox(
    [
      approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000),
      approvalItem("a1b2c3d4-0000-4000-8000-000000000002", "Resend on bounce?", 2_000),
    ],
    true,
  );
  assert.equal(inbox.title(), "Resend on bounce?");
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
  });
  assert.equal(inbox.title(), "Resend on bounce?");
  inbox.unmount();
  act(() => keys.unmount());
});

test("a plan's Inbox tab too narrow for its list and the item side by side shows the chosen item under a way back to the list, whose rows open their items again", async () => {
  const inbox = await narrowTaskInbox([
    approvalItem("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?", 1_000),
    approvalItem("a1b2c3d4-0000-4000-8000-000000000002", "Resend on bounce?", 2_000),
  ]);
  assert.deepEqual(inbox.standing(), ["", "Resend on bounce?"], "the newest that needs you");
  assert.equal(inbox.back()?.textContent, "Inbox");
  act(() => inbox.back()?.click());
  assert.deepEqual(inbox.standing(), ["list", ""]);
  act(() => inbox.row("Expire after 7 days?")?.click());
  assert.deepEqual(inbox.standing(), ["", "Expire after 7 days?"]);
  inbox.unmount();
});

test("a plan's document opens on its Edited by line, with no crumb over it", () => {
  const home = {
    id: TASK.workspaceId,
    name: "Personal",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const task: Task = {
    ...TASK,
    repository: "acme/web",
    lastEdit: {
      actor: PLAN_ACTOR.DEVELOPER,
      by: { userId: "user-lee", name: "Lee Park" },
      at: 2,
      duringCall: false,
    },
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          tasks: tasksControl({
            page: TASKS_PAGE.DOCUMENT,
            activeTaskId: task.id,
            region: { kind: DOCUMENT_REGION.READY, task },
            workspaces: [home],
            workspace: home,
          }),
        }),
      ),
    ),
  );
  const scroll = container.querySelector(".desktop-document .plan-document-scroll");
  const first = scroll?.firstElementChild;

  assert.equal(container.querySelector('nav[aria-label="Where this task is"]'), null);
  assert.ok(first?.classList.contains("plan-edit-note"), "the Edited by line leads the document");
  assert.match(first?.textContent ?? "", /^Edited by .*Lee Park/u);
  act(() => root.unmount());
  container.remove();
});

test("a chip in the plan naming a pull request one of the task's agents opened opens that agent's Pull request tab on its conversation, and another pull request's, or an archived agent's, opens on GitHub", () => {
  const agent: CodingAgentSummary = {
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    planId: TASK.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Batch the invitations",
    createdAt: 3,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  const url = "https://github.com/acme/relay/pull/42";
  const other = "https://github.com/acme/relay/pull/7";
  const archived: CodingAgentSummary = {
    ...agent,
    id: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
    title: "An earlier try",
    archivedAt: 4,
  };
  const archivedUrl = "https://github.com/acme/relay/pull/9";
  const opened: unknown[] = [];
  const onGitHub: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...DESKTOP_LINKS });
  fakeAppBridge({
    act: (request: Act) => {
      if (request.kind === ACT_KIND.GITHUB_OPEN) onGitHub.push(request.payload.url);
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
    },
  });
  const task: Task = {
    ...TASK,
    repository: "acme/relay",
    document: {
      body: `## Rollout\n\nShipped in [@relay#42](${url}/), after [@relay#7](${other}) and [@relay#9](${archivedUrl}).\n`,
      assumptions: [],
    },
  };
  const base = tasksControl();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          tasks: tasksControl({
            page: TASKS_PAGE.DOCUMENT,
            activeTaskId: task.id,
            region: { kind: DOCUMENT_REGION.READY, task },
            sidePanel: {
              ...base.sidePanel,
              onPullRequestView: (agentId, view) => opened.push({ agentId, view }),
              onChoose: (tab) => opened.push(tab),
            },
            agents: codingAgentsControl({
              agents: [agent],
              archived: [archived],
              agentIds: [agent.id],
              pullRequests: new Map([
                [
                  agent.id,
                  {
                    number: 42,
                    title: "Send invitations in batches",
                    url,
                    state: PULL_REQUEST_STATE.OPEN,
                    checks: CHECK_SUMMARY.PASSING,
                    additions: 12,
                    deletions: 3,
                    changedFiles: 2,
                  },
                ],
                [
                  archived.id,
                  {
                    number: 9,
                    title: "Send invitations at once",
                    url: archivedUrl,
                    state: PULL_REQUEST_STATE.CLOSED,
                    checks: CHECK_SUMMARY.NONE,
                    additions: 4,
                    deletions: 1,
                    changedFiles: 1,
                  },
                ],
              ]),
            }),
          }),
        }),
      ),
    ),
  );
  const chip = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(".desktop-document [data-mention-ref]")].find(
      (each) => each.querySelector(".luke-inline-ref-label")?.textContent?.includes(name),
    );

  const own = chip("relay#42");
  assert.ok(own, "the agent's pull request is its chip");
  act(() => own.click());
  assert.deepEqual(opened, [
    { agentId: agent.id, view: PULL_REQUEST_VIEW.CONVERSATION },
    { changes: agent.id },
  ]);
  assert.deepEqual(onGitHub, [], "nothing opened on GitHub");

  act(() => chip("relay#7")?.click());
  assert.deepEqual(onGitHub, [other]);

  // An archived agent's Pull request tab is not drawn on the task, so its pull request opens on GitHub.
  act(() => chip("relay#9")?.click());
  assert.deepEqual(onGitHub, [other, archivedUrl]);
  assert.equal(opened.length, 2, "no tab was asked for");
  act(() => root.unmount());
  container.remove();
});

/** The task's column on its Chat tab over the fixture's chat, its plan channel this task's where `ownChannel`. */
async function chatTabMounted(ownChannel: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const staged = fixtureChat({ fixtureMode: true }, 0);
  assert.ok(staged);
  const chat = {
    ...staged,
    answer: {
      ...staged.answer,
      channels: staged.answer.channels.map((channel) =>
        ownChannel && channel.name === "teammate-invitations"
          ? { ...channel, planId: TASK.id }
          : channel,
      ),
    },
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          captions: undefined,
          tasks: tasksControl({
            page: TASKS_PAGE.DOCUMENT,
            activeTaskId: TASK.id,
            region: { kind: DOCUMENT_REGION.READY, task: TASK },
            mainTabs: {
              ...tasksControl().mainTabs,
              tabs: [MAIN_TAB.PLAN, MAIN_TAB.CHAT],
              tab: MAIN_TAB.CHAT,
            },
            chatView: { ...tasksControl().chatView, available: true, chat },
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return { container, root };
}

test("a task's Chat tab shows its task channel at reading size, its composer posting there, and says so where the task has no channel yet", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const own = await chatTabMounted(true);
  const tab = own.container.querySelector('section.desktop-task-chat[aria-label="Chat"]');
  assert.ok(tab, "the task's Chat tab");
  assert.equal(tab.querySelector(".chat-head-title")?.textContent, "# teammate-invitations");
  assert.ok(tab.querySelector('textarea[aria-label="Message #teammate-invitations"]'));
  assert.equal(tab.querySelectorAll(".chat-messages > .chat-message").length, 6);
  act(() => own.root.unmount());
  own.container.remove();

  const none = await chatTabMounted(false);
  assert.match(
    none.container.querySelector("section.desktop-task-chat")?.textContent ?? "",
    /Nothing is posted in this task's channel yet\./u,
  );
  act(() => none.root.unmount());
  none.container.remove();
});

test("with Chat off for the account, a Chat tab kept on the task's strip draws nothing", async () => {
  handState({});
  const off = await chatTabMounted(true);
  assert.equal(off.container.querySelector("section.desktop-task-chat"), null);
  act(() => off.root.unmount());
  off.container.remove();
});
