// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type AgentInboxAnswerView, INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { TASK_STATUS } from "@luke/features/task-wire";
import type { AppInboxTask, AppInboxTaskHolding } from "@luke/host/app-state";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { Effect } from "effect";
import { act } from "react";
import { beforeAll, onTestFinished, test } from "vitest";
import { appCommandOffered, runAppCommand } from "../app-commands.js";
import { SHELL_ROOM } from "../shell-room.js";
import { FAKE_ANSWER } from "../testing/app-bridge.js";
import { editorBundleLanded } from "../testing/composer.js";
import {
  ACME,
  ASKING_ID,
  answeredBy,
  arrowNamed,
  asking,
  askingMessage,
  askPress,
  BILLING,
  backToList,
  chooseView,
  columnsShown,
  confirmClose,
  EXPIRY,
  EXPIRY_ASK,
  headTitle,
  heardOf,
  hoveredCard,
  INVITES,
  inOrder,
  item,
  itemPane,
  keyOn,
  layOut,
  listEdge,
  listed,
  menuItem,
  menuWords,
  mount,
  needsYouMark,
  noticeOf,
  ON_EXPIRY,
  ON_THRESHOLD,
  openViewOptions,
  pagerOf,
  pressKey,
  pushAgain,
  QUARANTINE,
  READER,
  RETRY,
  type ReadOutcome,
  ROW_TITLE,
  readTitle,
  rowLines,
  rowMenu,
  rowNamed,
  SCOPE_NAMES,
  SHARED_MEMBERS,
  SHARED_WORKSPACE,
  SHOW_KEY,
  SWEEP_AGENT,
  settle,
  showScope,
  standKeymap,
  TEAMMATE,
  THRESHOLD,
  takenCloses,
  threadItem,
  threadMessage,
  titleOf,
  viewItem,
  WHOSE_KEY,
  waitingTaskless,
  world,
} from "../testing/desktop-inbox.js";
import { restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { playMotions } from "../testing/pane-motion.js";
import { pointerCross } from "../testing/pointer-cross.js";
import { waitingOf } from "../testing/tasks-control.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

// The parser an answer's note is drawn through, landed as the panel lands it.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

/** Where the window's Inbox kept its Needs you button's press before the tabs that stood before its scopes. */
const EARLIER_SHOW_KEY = "luke.inboxWaitingOnly";

/** What the row of the item so titled says of its task's status; none where it wears no status. */
function rowStatus(page: HTMLElement, title: string): string | undefined {
  return (
    rowNamed(page, title).closest("li")?.querySelector(".inbox-row-task-status")?.textContent ??
    undefined
  );
}

/**
 * The list's head as a reader meets it: the Inbox's name, then each scope
 * its View options offers, the one shown in brackets; the menu is closed
 * again on the scope shown.
 */
function scopes(page: HTMLElement): string[] {
  openViewOptions(page);
  const offered = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].filter(
    (each) => SCOPE_NAMES.some((name) => each.textContent === name),
  );
  const shown = offered.find((each) => each.getAttribute("aria-checked") === "true");
  const words = offered.map((each) =>
    each === shown ? `[${each.textContent}]` : (each.textContent ?? ""),
  );
  act(() => shown?.click());
  return [headTitle(page) ?? "", ...words];
}

test("the list holds every task's items in one run, the latest changed first, each wearing the attention mark while it needs you, none chosen", async () => {
  const { page } = mount();
  await settle();
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "*Expire after 7 days?",
    "*Alert at 80%?",
  ]);
});

/** ⌘-clicks the row of the item so titled, as a Mac's list chooses a row in or out. */
function commandClick(page: HTMLElement, title: string): void {
  act(() => {
    rowNamed(page, title).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
    );
  });
}

/** The titles of the rows the list holds chosen, in the order drawn. */
function picked(page: HTMLElement): string[] {
  return [...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks li button.luke-list-row-main")]
    .filter((row) => heardOf(row.getAttribute("aria-describedby")).startsWith("Selected, "))
    .map(titleOf);
}

/** The selection's bar under the list, or none while nothing is chosen. */
function selectionBar(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>(".inbox-tasks .luke-selection-bar");
}

/** The selection bar's button named `name`. */
function barButton(page: HTMLElement, name: string): HTMLButtonElement {
  const button = [
    ...(selectionBar(page) ?? assert.fail("the bar stands")).querySelectorAll<HTMLButtonElement>(
      "button",
    ),
  ].find((each) => each.textContent?.trim() === name);
  assert.ok(button, `the bar offers ${name}`);
  return button;
}

/** Whether the row of the item so titled says to a reader that it is unread. */
function rowUnread(page: HTMLElement, title: string): boolean {
  return [...rowNamed(page, title).querySelectorAll(".luke-visually-hidden")].some(
    (each) => each.textContent === "Unread",
  );
}

test("⌘-clicking two open items chooses both across their tasks, opening neither, and the bar's Resolve asks once for both, red, then resolves each at the revision drawn and lets the selection go", async () => {
  const { page } = mount();
  await settle();
  const sent = takenCloses();
  const threshold = "Alert at 80%?";
  const expiry = "Expire after 7 days?";
  assert.deepEqual(picked(page), [], "nothing stands chosen before");

  commandClick(page, threshold);
  commandClick(page, expiry);
  assert.deepEqual(picked(page), [expiry, threshold]);
  assert.match(selectionBar(page)?.textContent ?? "", /2 selected/u);

  act(() => barButton(page, "Resolve").click());
  await settle();
  assert.deepEqual(sent, [], "Resolve asks first");
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("Resolve asks");
  assert.match(question.textContent ?? "", /Resolve 2 items without answering\?/u);
  assert.match(question.textContent ?? "", /Their agents are told/u);
  await confirmClose();

  assert.deepEqual(
    sent.map(({ itemId }) => itemId).sort(),
    [THRESHOLD.id, EXPIRY.id].sort(),
    "both items are resolved",
  );
  assert.equal(selectionBar(page), null, "the selection is let go");
  assert.deepEqual(picked(page), []);
});

test("an agent changing an item the bar's Resolve asks about withdraws the question whole, resolving nothing", async () => {
  const { page } = mount();
  await settle();
  const sent = takenCloses();
  commandClick(page, "Alert at 80%?");
  commandClick(page, "Expire after 7 days?");
  act(() => barButton(page, "Resolve").click());
  await settle();
  assert.ok(document.querySelector('[role="alertdialog"]'), "Resolve asks first");

  // The agent asks again under the same key, and main says the plan moved.
  world.inboxes.set(BILLING.id, [{ ...THRESHOLD, revision: 2, updatedAt: 7_000 }, RETRY]);
  act(() =>
    world.setHolding([
      { taskId: BILLING.id, items: 2, updatedAt: 7_000 },
      { taskId: INVITES.id, items: 1, updatedAt: 4_000 },
    ]),
  );
  await settle();

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "the question goes");
  assert.deepEqual(sent, []);
  assert.deepEqual(picked(page), ["Alert at 80%?", "Expire after 7 days?"], "the selection stands");
});

test("the bar's Mark as unread marks every item chosen at once under one toast, whose Undo marks each read again as it stood", async () => {
  const { page } = mount([], { toasts: true });
  await settle();
  const expiry = "Expire after 7 days?";
  const retry = "How is a failed email retried?";
  world.readMarks = [];

  commandClick(page, expiry);
  commandClick(page, retry);
  act(() => barButton(page, "Mark as unread").click());
  await settle();

  assert.deepEqual(world.readMarks.sort(), [`unread:${EXPIRY.id}`, `unread:${RETRY.id}`].sort());
  assert.ok(rowUnread(page, expiry) && rowUnread(page, retry), "both rows read as unread");
  assert.equal(selectionBar(page), null, "the selection is let go");
  assert.match(newestToastSays() ?? "", /2 items marked unread/u);

  world.readMarks = [];
  const undo = newestToastAction() ?? assert.fail("the toast offers Undo");
  assert.equal(undo.textContent, "Undo");
  await act(async () => undo.click());
  await settle();
  assert.deepEqual(world.readMarks.sort(), [`read:${EXPIRY.id}`, `read:${RETRY.id}`].sort());
  assert.ok(!rowUnread(page, expiry) && !rowUnread(page, retry), "both rows read as read again");
});

test("the bar's marks say in one toast how many the service refused", async () => {
  const { page } = mount([], { toasts: true });
  await settle();
  world.readMarkRefused = true;
  commandClick(page, "Expire after 7 days?");
  commandClick(page, "How is a failed email retried?");
  act(() => barButton(page, "Mark as unread").click());
  await settle();
  assert.equal(newestToastSays(), "Could not mark 2 items unread");
});

test("Esc lets the selection go, in the list as in its bar", async () => {
  const { page, asked } = mount();
  await settle();
  const expiry = "Expire after 7 days?";
  const retry = "How is a failed email retried?";

  commandClick(page, expiry);
  commandClick(page, retry);
  act(() => rowNamed(page, retry).focus());
  keyOn(rowNamed(page, retry), "Escape");
  assert.deepEqual(picked(page), [], "Esc in the list chooses none");
  assert.equal(selectionBar(page), null);
  assert.equal(asked.closed, 0, "the key goes no further than the list");

  commandClick(page, expiry);
  keyOn(barButton(page, "Clear"), "Escape");
  assert.deepEqual(picked(page), [], "Esc in the bar chooses none");
});

test("a plain click still opens its item, leaving what is chosen as it stands", async () => {
  const { page } = mount();
  await settle();
  const expiry = "Expire after 7 days?";
  const retry = "How is a failed email retried?";

  commandClick(page, expiry);
  act(() => rowNamed(page, retry).click());
  await settle();

  assert.equal(rowNamed(page, retry).getAttribute("aria-current"), "page", "the item opens");
  assert.notEqual(rowNamed(page, expiry).getAttribute("aria-current"), "page");
  assert.deepEqual(picked(page), [expiry], "the selection stands");
  assert.match(selectionBar(page)?.textContent ?? "", /1 selected/u);
});

test("a plan main says changed is read again, so an item answered on another Mac lists as settled, gray where it stood while the pointer is over the list and sorted anew once it leaves; Open then lists only what is still open, and the choice outlives a relaunch", async () => {
  let { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const list = page.querySelector('nav[aria-label^="Inbox items"]');
  assert.ok(list !== null);
  pointerCross(document.body, list);
  world.inboxes.set(INVITES.id, [
    { ...answeredBy(EXPIRY, READER, "Retry once", "", 6_000), updatedAt: 6_000 },
  ]);
  act(() =>
    world.setHolding([
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
    ]),
  );
  await settle();
  assert.deepEqual(
    listed(page),
    ["How is a failed email retried?", "Expire after 7 days?", "▸ *Alert at 80%?"],
    "the answer moves no row while the pointer is over the list",
  );
  const everything = ["Expire after 7 days?", "How is a failed email retried?", "▸ *Alert at 80%?"];

  pointerCross(list, document.body);
  assert.deepEqual(listed(page), everything, "the pointer gone, the list sorts anew");

  showScope(page, "Open");
  assert.deepEqual(scopes(page), ["Inbox", "[Open]", "All"]);
  assert.deepEqual(listed(page), ["▸ *Alert at 80%?"]);

  act(() => world.root?.unmount());
  world.root = undefined;
  ({ page } = mount([], { chosen: ON_THRESHOLD }));
  await settle();
  assert.deepEqual(scopes(page), ["Inbox", "[Open]", "All"]);
  assert.deepEqual(listed(page), ["▸ *Alert at 80%?"]);

  showScope(page, "All");
  assert.deepEqual(scopes(page), ["Inbox", "Open", "[All]"]);
  assert.deepEqual(listed(page), everything);
});

/** The number the window's sidebar draws on its Inbox row; none where it draws none. */
function sidebarInboxCount(page: HTMLElement): number | undefined {
  const row =
    [...page.querySelectorAll<HTMLElement>(".sidebar-places .luke-nav-item")].find(
      (each) => each.querySelector(".luke-nav-item-name")?.textContent === "Inbox",
    ) ?? assert.fail("the sidebar draws its Inbox row");
  const count = row.textContent?.match(/\d+/u)?.[0];
  return count === undefined ? undefined : Number(count);
}

/** How many rows the list draws. */
function toDoRows(page: HTMLElement): number {
  return listed(page).length;
}

test("the sidebar's Inbox counts what Needs you lists, the questions and the update waiting on you, never a settled thread however unread nor a teammate's question", async () => {
  window.localStorage.setItem(SHOW_KEY, JSON.stringify("to-do"));
  window.localStorage.removeItem(WHOSE_KEY);
  const NOTE: InboxItem = {
    ...noticeOf(item("a1b2c3d4-0000-4000-8000-000000000011", "Preview is up", 3_500)),
    needsReply: false,
    unread: true,
  };
  const SEEN: InboxItem = {
    ...RETRY,
    id: "a1b2c3d4-0000-4000-8000-000000000012",
    key: "seen",
    title: "Which region?",
    updatedAt: 4_500,
    unread: false,
  };
  const THEIRS: InboxItem = {
    ...item("a1b2c3d4-0000-4000-8000-000000000013", "Rotate the key?", 3_800),
    startedBy: TEAMMATE,
  };
  const followed: InboxItem = { ...RETRY, updatedAt: 2_500, unread: true };
  world.inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, followed, SEEN]);
  world.inboxes.set(INVITES.id, [{ ...EXPIRY, unread: true }, NOTE, THEIRS]);
  // Note that main counts each task's one open ask, never the notice, which the sidebar counts from main's open items.
  const holding: readonly AppInboxTaskHolding[] = [
    { taskId: BILLING.id, items: 3, toDo: 1, updatedAt: 4_500 },
    { taskId: INVITES.id, items: 3, toDo: 1, updatedAt: 4_000 },
  ];
  // Main lists the open items that wait on the reader, the notice among them, as the service's read does.
  const waiting: readonly AppInboxTask[] = [
    { taskId: BILLING.id, items: [waitingOf(THRESHOLD)] },
    { taskId: INVITES.id, items: [waitingOf(EXPIRY), { ...waitingOf(NOTE), asking: false }] },
  ];
  const { page } = mount([], { holding, waiting, withSidebar: true });
  await settle();
  assert.equal(toDoRows(page), 3, "the two questions and the update");
  assert.equal(sidebarInboxCount(page), 3, "the sidebar counts the rows Needs you lists");
});

test("the sidebar's Inbox counts the open items alone, as before, where main carries no To do count from an older service", async () => {
  world.inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, updatedAt: 6_000, unread: true }]);
  const { page } = mount([], { withSidebar: true });
  await settle();
  assert.equal(
    sidebarInboxCount(page),
    2,
    "the threshold and expiry questions, which main lists open",
  );
});

test("a fresh profile opens the Inbox on Open addressed to Me, which is Needs you, its head naming the Inbox alone, a settled item left out until All is chosen, the head naming the Inbox still", async () => {
  window.localStorage.clear();
  const { page } = mount([], { chosen: ON_EXPIRY });
  await settle();
  assert.deepEqual(scopes(page), ["Inbox", "[Open]", "All"]);
  assert.deepEqual(listed(page), ["▸ Expire after 7 days?", "Alert at 80%?"]);
  openViewOptions(page);
  act(() => viewItem("Addressed to").click());
  assert.equal(viewItem("Me").getAttribute("aria-checked"), "true");
  act(() => viewItem("Me").click());
  showScope(page, "All");
  assert.equal(headTitle(page), "Inbox");
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "▸ *Expire after 7 days?",
    "*Alert at 80%?",
  ]);
});

test("a task done or canceled keeps its items listed and counted as any other's, each row wearing its task's status, its card's task chip wearing it too, and a row of an agent with no task wearing none; no scope offers an archive", async () => {
  window.localStorage.clear();
  world.agentInboxes = new Map([[SWEEP_AGENT, [QUARANTINE]]]);
  const { page } = mount(
    [
      {
        id: QUARANTINE.id,
        agentId: SWEEP_AGENT,
        title: QUARANTINE.title,
        postedAt: QUARANTINE.postedAt,
        updatedAt: QUARANTINE.updatedAt,
        agentTitle: "Sweep the flaky tests",
        agentModel: "anthropic/claude-opus-5.5",
        automationId: null,
        automationName: null,
        repository: "acme/relay",
      },
    ],
    {
      standing: [
        { ...BILLING, status: TASK_STATUS.DONE },
        { ...INVITES, status: TASK_STATUS.CANCELED },
      ],
    },
  );
  await settle();
  assert.deepEqual(scopes(page), ["Inbox", "[Open]", "All"]);
  const rows = listed(page);
  for (const row of ["Alert at 80%?", "Expire after 7 days?", "Quarantine the flaky test?"]) {
    assert.ok(
      rows.some((each) => each.replace(/^▸ /u, "") === row),
      `Open lists ${row}: ${rows.join(" | ")}`,
    );
  }
  assert.equal(rowStatus(page, "Alert at 80%?"), "Done");
  assert.equal(rowStatus(page, "Expire after 7 days?"), "Canceled");
  assert.equal(rowStatus(page, "Quarantine the flaky test?"), undefined);

  restOn(rowNamed(page, "Alert at 80%?"));
  const card = document.querySelector(".luke-tooltip-card [data-inbox-item-card]");
  assert.ok(
    card?.querySelector('[data-holder-ref] .luke-task-status-mark[data-status="done"]'),
    "the card's task chip wears the task's status",
  );
});

// Note that this test mounts the Inbox eight times, about 1 s on an idle machine but near 5 s on a
// CI runner whose other workers run the shard's other files, so it is given 10 s.
test("a tab kept before the scopes opens the Inbox on the scope that lists what it did, Needs you and Unread on Open and All open and Everything on All, and the Needs you press kept before the tabs on Open where pressed and All where not; a scope chosen since is kept in its place", async () => {
  const kept = [
    [SHOW_KEY, "needs-you", "[Open]"],
    [SHOW_KEY, "unread", "[Open]"],
    [SHOW_KEY, "open", "[All]"],
    [SHOW_KEY, "all", "[All]"],
    [EARLIER_SHOW_KEY, true, "[Open]"],
    [EARLIER_SHOW_KEY, false, "[All]"],
  ] as const;
  const opened: (string | undefined)[] = [];
  for (const [key, value] of kept) {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify(value));
    const { page } = mount();
    await settle();
    opened.push(scopes(page).find((each) => each.startsWith("[")));
    act(() => world.root?.unmount());
    world.root = undefined;
  }
  assert.deepEqual(
    opened,
    kept.map(([, , scope]) => scope),
  );

  let { page } = mount();
  await settle();
  showScope(page, "Open");
  act(() => world.root?.unmount());
  world.root = undefined;
  ({ page } = mount());
  await settle();
  assert.deepEqual(scopes(page), ["Inbox", "[Open]", "All"]);
}, 10_000);

test("each row names its task on its first line with its time at that line's end, then its title on a line of its own, then its preview", async () => {
  world.inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: TEAMMATE }, RETRY]);
  const { page } = mount();
  await settle();
  const lines = () =>
    ["Alert at 80%?", "Expire after 7 days?"].map((title) => {
      const row = rowNamed(page, title);
      const head = row.querySelector(".luke-list-row-head");
      return {
        task: head?.querySelector('.luke-list-row-lead[data-at="above"]')?.textContent,
        time: head?.querySelector(".home-row-meta time") !== null,
        titleOnFirstLine: head?.textContent?.includes(title),
        preview: row.querySelector(".luke-list-row-description")?.textContent,
      };
    });
  const expected = [
    {
      task: "Billing usage alerts",
      time: true,
      titleOnFirstLine: false,
      preview: "Retry 3 times over an hour (recommended) / Retry once",
    },
    {
      task: "Invites",
      time: true,
      titleOnFirstLine: false,
      preview: "Retry 3 times over an hour (recommended) / Retry once",
    },
  ];
  assert.deepEqual(lines(), expected);
});

test("the list is resized from its edge between its bounds, and keeps its width across a relaunch", async () => {
  let { page } = mount();
  await settle();
  const edge = () => {
    const separator = listEdge(page);
    assert.ok(separator, "the list has an edge to resize it by");
    return separator;
  };
  const width = () => Number(edge().getAttribute("aria-valuenow"));
  const press = (key: string) => {
    act(() => {
      edge().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  };
  assert.equal(width(), 320, "a mail app's list, narrower than the item it reads");
  press("ArrowRight");
  assert.equal(width(), 336);
  press("End");
  assert.equal(width(), 440);
  press("ArrowRight");
  assert.equal(width(), 440, "no wider than its greatest width");

  act(() => world.root?.unmount());
  world.root = undefined;
  ({ page } = mount());
  await settle();
  assert.equal(width(), 440);
  press("Home");
  assert.equal(width(), 300);
  press("ArrowLeft");
  assert.equal(width(), 300, "no narrower than its least width");

  layOut(page, 900);
  press("End");
  assert.equal(width(), 340, "no wider than leaves the item its room");
});

/** The empty state a column stands, as it reads: its line, or none where the column stands none. */
function emptyStateIn(page: HTMLElement, column: string): string | null {
  const shown = page.querySelector(column);
  assert.ok(shown, "the column is drawn");
  const empty = shown.querySelector(".luke-empty-state-words");
  return empty === null || shown.hasAttribute("hidden") ? null : (empty.textContent ?? "");
}

/** The way on an empty state in `column` offers, by its words. */
function emptyStateAction(page: HTMLElement, column: string): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>(`${column} .luke-empty-state button`);
}

test("an Inbox with nothing in it stands its empty state in the pane beside the list, and in the list itself once the list stands alone", async () => {
  world.inboxes = new Map();
  world.listedAgents = [];
  const { page, asked } = mount();
  await settle();
  assert.deepEqual(columnsShown(page), ["list", "item"]);
  assert.deepEqual(
    [emptyStateIn(page, ".inbox-tasks"), emptyStateIn(page, ".inbox-view-items")],
    [null, "Nothing needs you"],
  );
  assert.doesNotMatch(
    page.querySelector(".inbox-tasks")?.textContent ?? "",
    /Nothing needs you/u,
    "the list beside the pane says nothing, the pane saying it once",
  );
  const offered = emptyStateAction(page, ".inbox-view-items");
  assert.equal(offered?.textContent, "New task", "the empty Inbox offers New task");
  act(() => offered?.click());
  assert.equal(asked.newTasks, 1, "New task asks for its dialog");

  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(emptyStateIn(page, ".inbox-tasks"), "Nothing needs you");
  assert.equal(emptyStateAction(page, ".inbox-tasks")?.textContent, "New task");
});

test("on a phone, an Inbox with nothing chosen shows its list and says nothing needs you, under no panel, though the panel stands open as a first launch leaves it", async () => {
  world.inboxes = new Map();
  world.listedAgents = [];
  const { page } = mount([], { room: SHELL_ROOM.NARROW });
  assert.equal(page.querySelector(".side-panel"), null, "no panel is drawn over the Inbox");
  assert.equal(page.querySelector(".page-find[hidden]"), null, "the Inbox page is not hidden");
  await settle();
  layOut(page, 390);
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(emptyStateIn(page, ".inbox-tasks"), "Nothing needs you");
});

test("while the account's feed is first read, the list stands placeholder rows in its items' place, saying to a reader that the inbox is being read, with no row to press and no ring; once it lands, the items stand where they stood", async () => {
  const reads = new Map([
    [BILLING.id, pending()],
    [INVITES.id, pending()],
  ]);
  world.startRead = (taskId) => reads.get(taskId)?.promise;
  world.feedUnread = true;
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const list = page.querySelector<HTMLElement>(".inbox-tasks");
  assert.ok(list, "the list is drawn");
  const wait = list.querySelector<HTMLElement>('[role="status"][aria-busy="true"]');
  assert.equal(wait?.textContent, "Reading your inbox…");
  assert.ok(
    (wait?.querySelectorAll(".luke-list-row .luke-skeleton").length ?? 0) > 0,
    "placeholder rows stand in the items' place",
  );
  assert.deepEqual(listed(page), []);
  assert.equal(list.querySelector(".luke-spinner"), null, "no ring stands in the list's corner");

  reads.get(BILLING.id)?.settle({ items: [THRESHOLD, RETRY], cursor: "1" });
  reads.get(INVITES.id)?.settle({ items: [EXPIRY], cursor: "1" });
  world.feedUnread = false;
  act(() => pushAgain());
  await settle();
  assert.equal(list.querySelector('[aria-busy="true"]'), null);
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "*Expire after 7 days?",
    "▸ *Alert at 80%?",
  ]);
});

test("an Inbox opened before the account's task list is read stands placeholder rows, and neither the list nor the pane says nothing needs you, whatever its width; once the list lands, its items stand", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD, listUnread: true });
  await settle();
  const list = page.querySelector<HTMLElement>(".inbox-tasks");
  assert.ok(list, "the list is drawn");
  assert.equal(
    list.querySelector('[role="status"][aria-busy="true"]')?.textContent,
    "Reading your inbox…",
  );
  assert.deepEqual(
    [emptyStateIn(page, ".inbox-tasks"), emptyStateIn(page, ".inbox-view-items")],
    [null, null],
  );
  assert.equal(page.querySelector(".luke-note-line"), null, "no line says nothing needs you");
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(emptyStateIn(page, ".inbox-tasks"), null);

  layOut(page, 1200);
  act(() => {
    world.setTasks([BILLING, INVITES]);
    world.setListRead(true);
  });
  await settle();
  assert.equal(list.querySelector('[aria-busy="true"]'), null);
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "*Expire after 7 days?",
    "▸ *Alert at 80%?",
  ]);
});

/** The list's empty state as a reader meets it: its heading, its line, and its one press; none where the list stands none. */
function listEmpty(page: HTMLElement): readonly (string | null | undefined)[] | null {
  const empty = page.querySelector(".inbox-tasks:not([hidden]) .luke-empty-state");
  if (empty === null) return null;
  return [
    empty.querySelector("h3")?.textContent,
    empty.querySelector("p")?.textContent,
    empty.querySelector("button")?.textContent,
  ];
}

test("with only settled items, read, Needs you lists no row, the item read still shown beside the list, which says there is nothing to do and offers Show all; its press shows All", async () => {
  window.localStorage.removeItem(WHOSE_KEY);
  world.inboxes.set(INVITES.id, [answeredBy(EXPIRY, READER, "Retry once", "", 4_000)]);
  world.inboxes.set(BILLING.id, [RETRY]);
  const { page } = mount([], { chosen: { taskId: BILLING.id, itemId: RETRY.id } });
  await settle();
  assert.deepEqual(listed(page), ["▸ How is a failed email retried?", "Expire after 7 days?"]);

  showScope(page, "Open");
  assert.equal(headTitle(page), "Inbox");
  assert.deepEqual(listed(page), [], "the item read is not listed under a filter leaving it out");
  assert.deepEqual(listEmpty(page), [undefined, "Nothing needs you", "Show all"]);
  assert.equal(emptyStateIn(page, ".inbox-view-items"), null, "the pane says nothing twice");
  assert.equal(readTitle(page), "How is a failed email retried?");

  // One column wide, the item read stands alone with nothing to page to, and its way back, choosing nothing, reaches the empty list.
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["item"]);
  assert.equal(pagerOf(page), null);
  act(() => backToList(page).click());
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(listEmpty(page)?.[1], "Nothing needs you");

  const showAll = page.querySelector<HTMLButtonElement>(".inbox-tasks .luke-empty-state button");
  assert.ok(showAll, "the empty state offers Show all");
  act(() => showAll.click());
  assert.equal(headTitle(page), "Inbox");
  assert.deepEqual(
    columnsShown(page),
    ["list"],
    "Show all leaves the rows it brings back standing",
  );
  assert.ok(
    document.activeElement === rowNamed(page, "How is a failed email retried?"),
    "the keyboard lands on the first row, not on the button Show all took away",
  );
  assert.deepEqual(listed(page), ["How is a failed email retried?", "Expire after 7 days?"]);
  assert.equal(listEmpty(page), null);
});

test("one column wide, an answered item that Needs you draws no row for shows no count in its pager, though its arrows still step to the rows either side, which count only the rows drawn", async () => {
  window.localStorage.removeItem(WHOSE_KEY);
  const { page } = mount();
  await settle();
  act(() => rowNamed(page, "How is a failed email retried?").click());
  showScope(page, "Open");
  assert.deepEqual(listed(page), ["Expire after 7 days?", "Alert at 80%?"]);
  layOut(page, 800);
  assert.equal(readTitle(page), "How is a failed email retried?");
  assert.equal(pagerOf(page), null, "no row, so no count");
  assert.equal(arrowNamed(page, "Previous item").getAttribute("aria-disabled"), "true");
  act(() => arrowNamed(page, "Next item").click());
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Expire after 7 days?", "1 of 2"]);
});

test("on Needs you, a focused row whose item is answered on another Mac leaves the keyboard on View options rather than nowhere", async () => {
  window.localStorage.removeItem(WHOSE_KEY);
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  showScope(page, "Open");
  rowNamed(page, "Expire after 7 days?").focus();
  world.inboxes.set(INVITES.id, [
    { ...answeredBy(EXPIRY, READER, "Retry once", "", 6_000), updatedAt: 6_000 },
  ]);
  act(() =>
    world.setHolding([
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
    ]),
  );
  await settle();
  assert.deepEqual(listed(page), ["▸ Alert at 80%?"]);
  assert.ok(
    document.activeElement === page.querySelector('button[aria-label="View options"]'),
    "the keyboard is on View options",
  );
});

test("on a phone, a focused row whose item is answered elsewhere leaves the keyboard on the head's ⋯, which holds View options there", async () => {
  window.localStorage.removeItem(WHOSE_KEY);
  const { page } = mount([], { chosen: ON_THRESHOLD, room: SHELL_ROOM.NARROW });
  await settle();
  // Open is chosen as a phone chooses it: the ⋯'s View options opens the list's own menu where the ⋯ stood.
  const more = () =>
    page.querySelector<HTMLButtonElement>('.inbox-head button[aria-label="Inbox actions"]') ??
    assert.fail("the ⋯ stands");
  act(() => more().click());
  const options = [
    ...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
  ].find((each) => each.querySelector(".luke-menu-item-label")?.textContent === "View options");
  act(() => options?.click());
  act(() => viewItem("Open").click());
  rowNamed(page, "Expire after 7 days?").focus();
  world.inboxes.set(INVITES.id, [
    { ...answeredBy(EXPIRY, READER, "Retry once", "", 6_000), updatedAt: 6_000 },
  ]);
  act(() =>
    world.setHolding([
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
    ]),
  );
  await settle();
  assert.deepEqual(listed(page), ["▸ Alert at 80%?"]);
  assert.ok(document.activeElement === more(), "the keyboard is on the head's ⋯");
});

/** Gives the window the list's motion tokens beside the pane's, and an engine that records what is played; answers what was played. */
function playListMotions() {
  const motions = playMotions();
  const root = document.documentElement.style;
  const tokens = {
    "--luke-duration-exit": "90ms",
    "--luke-motion-exit": "ease",
    "--luke-duration-shape": "460ms",
    "--luke-spring": "ease-out",
    "--luke-list-travel": "16px",
  };
  for (const [name, value] of Object.entries(tokens)) root.setProperty(name, value);
  onTestFinished(() => {
    motions.remove();
    for (const name of Object.keys(tokens)) root.removeProperty(name);
  });
  return motions.played;
}

/** Answers the Invites item on another Mac, as main hears of it. */
async function answerExpiryElsewhere(): Promise<void> {
  world.inboxes.set(INVITES.id, [
    { ...answeredBy(EXPIRY, READER, "Retry once", "", 6_000), updatedAt: 6_000 },
  ]);
  act(() =>
    world.setHolding([
      { taskId: INVITES.id, items: 1, updatedAt: 6_000 },
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
    ]),
  );
  await settle();
}

test("on Needs you, an item answered on another Mac slides out from where its row stood, out of reach while it goes, and leaves the list once its exit has played", async () => {
  window.localStorage.removeItem(WHOSE_KEY);
  const played = playListMotions();
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  showScope(page, "Open");
  await answerExpiryElsewhere();
  // The settled row Needs you held leaves with it.
  const leaving = [...page.querySelectorAll<HTMLElement>("[data-leaving]")];
  assert.deepEqual(
    leaving
      .map((each) =>
        each.matches(".sidebar-tasks > li") ? each.querySelector(ROW_TITLE)?.textContent : null,
      )
      .toSorted(),
    ["Expire after 7 days?", "How is a failed email retried?"],
  );
  assert.ok(
    leaving.every((each) => each.hasAttribute("inert")),
    "each is drawn on out of reach",
  );
  const fades = played.filter((each) => leaving.includes(each.element as HTMLElement));
  assert.deepEqual(
    fades.map((each) => each.keyframes.at(-1)),
    [
      { opacity: 0, transform: "translateX(-16px)" },
      { opacity: 0, transform: "translateX(-16px)" },
    ],
  );

  act(() => {
    for (const fade of fades) fade.finish();
  });
  assert.deepEqual(listed(page), ["▸ Alert at 80%?"]);
  assert.equal(page.querySelector("[data-leaving]"), null);
});

/** A read the test answers when it chooses. */
interface PendingRead {
  readonly promise: Promise<ReadOutcome>;
  readonly settle: (value: AgentInboxAnswerView) => void;
}

/** A read held until the test settles it. */
function pending(): PendingRead {
  let settle: PendingRead["settle"] = () => undefined;
  const promise = new Promise<ReadOutcome>((resolve) => {
    settle = (value) => resolve({ status: FAKE_ANSWER.DONE, value });
  });
  return { promise, settle };
}

test("an item's row reads as its task line and time, then its title, over the last word in its thread: what an open item asks, an answer by who gave it, You for the reader, a teammate's latest message by their name, and the agent's words alone where it took its ask back", async () => {
  const NIGHT = asking(
    item("a1b2c3d4-0000-4000-8000-000000000004", "Page on-call at night?", 2_000),
    { type: INBOX_ASK.DO, steps: ["Add the **rota** to PagerDuty."] },
  );
  const sevAsked = noticeOf(
    item("a1b2c3d4-0000-4000-8000-000000000005", "Which incidents page?", 1_500),
  );
  const SEV: InboxItem = {
    ...sevAsked,
    startedBy: TEAMMATE,
    thread: inOrder(sevAsked, [
      threadMessage("a1b2c3d4-0000-4000-8000-000000000051", "agent", "Asked on #oncall.", 1_200),
      threadMessage(
        "a1b2c3d4-0000-4000-8000-000000000052",
        { member: TEAMMATE },
        "Only **sev1**,\nnever sev2.",
        1_500,
      ),
    ]),
  };
  const [expiryAsking] = EXPIRY.thread ?? [];
  assert.ok(expiryAsking?.ask !== undefined, "the item opens with its ask");
  world.inboxes.set(BILLING.id, [THRESHOLD, RETRY, NIGHT, SEV]);
  world.inboxes.set(INVITES.id, [
    {
      ...EXPIRY,
      status: INBOX_STATUS.CLOSED,
      closedReason: "The plan now says 7 days.",
      thread: [
        {
          ...expiryAsking,
          ask: {
            ...expiryAsking.ask,
            status: INBOX_ASK_STATUS.WITHDRAWN,
            withdrawnReason: "The plan now says 7 days.",
          },
        },
      ],
    },
  ]);
  const { page } = mount();
  await settle();
  assert.deepEqual(rowLines(page, "Alert at 80%?"), [
    true,
    "Retry 3 times over an hour (recommended) / Retry once",
  ]);
  assert.deepEqual(rowLines(page, "How is a failed email retried?"), [
    true,
    "You: Chose Retry 3 times over an hour · And page on-call if all three fail.",
  ]);
  assert.deepEqual(rowLines(page, "Page on-call at night?"), [
    true,
    "1 step left · Add the rota to PagerDuty.",
  ]);
  assert.deepEqual(rowLines(page, "Which incidents page?"), [
    true,
    "Charles Pan: Only sev1, never sev2.",
  ]);
  assert.deepEqual(rowLines(page, "Expire after 7 days?"), [
    true,
    "A failed email is retried as the agent sets it up.",
  ]);
});

test("no row draws the attention mark, which an open item nearly always would: the reader's own open item says to a reader before its time that it needs them, its card showing it; a teammate's open item wears their face there with no ring, saying to a reader that it waits on them, a settled one wears neither, and none is drawn in the unread weight", async () => {
  world.inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: TEAMMATE }, RETRY]);
  const { page } = mount([], { chosen: ON_EXPIRY });
  await settle();
  const ends = (title: string) => {
    const row = rowNamed(page, title);
    const meta = row.querySelector(".luke-list-row-meta");
    return {
      mark: meta?.querySelector(".attention-mark") !== null,
      face: meta?.querySelector<HTMLElement>(".actor-mark")?.dataset.kind,
      said: meta?.querySelector(".luke-visually-hidden")?.textContent,
      dot: row.querySelector(".luke-unread-dot") !== null,
      unread: row.closest("li")?.dataset.unread === "true",
    };
  };
  assert.deepEqual(ends("Expire after 7 days?"), {
    mark: false,
    face: undefined,
    said: "Needs you",
    dot: false,
    unread: false,
  });
  assert.deepEqual(ends("Alert at 80%?"), {
    mark: false,
    face: "person",
    said: "Waiting on Charles Pan",
    dot: false,
    unread: false,
  });
  assert.deepEqual(ends("How is a failed email retried?"), {
    mark: false,
    face: undefined,
    said: undefined,
    dot: false,
    unread: false,
  });
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "▸ *Expire after 7 days?",
    "Alert at 80%?",
  ]);
});

/** Whether a row reads as unread: its blue dot, its title in the unread weight, and "Unread" said to a reader, each `?` where only some stand. */
function unreadOf(page: HTMLElement, title: string): boolean | "?" {
  const row = rowNamed(page, title);
  const marks = [
    row.querySelector(".luke-unread-gutter .luke-unread-dot") !== null,
    row.closest("li")?.dataset.unread === "true",
    [...row.querySelectorAll(`${ROW_TITLE} .luke-visually-hidden`)].some(
      (each) => each.textContent === "Unread",
    ),
  ];
  if (marks.every(Boolean)) return true;
  return marks.some(Boolean) ? "?" : false;
}

/** The mark a row's hover offers over its time. */
/** The row of the item so titled as a reader hears it: its name, then its description. */
function heardRow(page: HTMLElement, title: string): [string, string] {
  const row = rowNamed(page, title);
  return [
    heardOf(row.getAttribute("aria-labelledby")),
    heardOf(row.getAttribute("aria-describedby")),
  ];
}

/** Expire after 7 days? as an unread notice whose message shows its code under its first line. */
const CODED: InboxItem = {
  ...EXPIRY,
  unread: true,
  thread: [
    threadMessage(
      "a1b2c3d4-0000-4000-8000-0000000000c1",
      "agent",
      [
        "A link opened twice adds them twice:",
        "",
        "```ts",
        "await db.members.add(invite);",
        "```",
      ].join("\n"),
      4_000,
    ),
  ],
};

test("a row is heard as its task, Unread, its title, and its time, and described by its latest message's first line alone, never the code under it", async () => {
  window.localStorage.removeItem(WHOSE_KEY);
  world.inboxes.set(INVITES.id, [CODED]);
  const { page } = mount();
  await settle();
  showScope(page, "Open");
  const time = rowNamed(page, CODED.title).querySelector("time")?.textContent;
  assert.deepEqual(heardRow(page, CODED.title), [
    `Invites Unread Expire after 7 days? ${time}`,
    "A link opened twice adds them twice:",
  ]);
});

test("a row says Needs you to a reader only outside Needs you, whose name says it of every row, the list's name saying what it lists since the head names the Inbox alone", async () => {
  window.localStorage.removeItem(WHOSE_KEY);
  world.inboxes.set(INVITES.id, [CODED]);
  const { page } = mount();
  await settle();
  const time = rowNamed(page, CODED.title).querySelector("time")?.textContent;
  showScope(page, "All");
  assert.equal(
    page.querySelector("nav.inbox-tasks")?.getAttribute("aria-label"),
    "Inbox items · All · Me",
  );
  assert.equal(
    heardRow(page, CODED.title)[0],
    `Invites Unread Expire after 7 days? Needs you ${time}`,
  );
  showScope(page, "Open");
  assert.equal(heardRow(page, CODED.title)[0], `Invites Unread Expire after 7 days? ${time}`);
  assert.equal(
    page.querySelector("nav.inbox-tasks")?.getAttribute("aria-label"),
    "Inbox items · Needs you",
    "the list says it once",
  );
});

test("an unread item wears the blue dot in its row's gutter, its title in the unread weight, and says Unread to a reader; opening it marks it read at once, and the Inbox opening, choosing nothing, marks none", async () => {
  world.inboxes.set(BILLING.id, [
    { ...THRESHOLD, unread: true },
    { ...RETRY, unread: true },
  ]);
  world.inboxes.set(INVITES.id, [{ ...EXPIRY, unread: true }]);
  const { page } = mount();
  await settle();
  assert.deepEqual(world.readMarks, []);
  assert.equal(unreadOf(page, "How is a failed email retried?"), true);
  assert.equal(unreadOf(page, "Alert at 80%?"), true);
  assert.equal(unreadOf(page, "Expire after 7 days?"), true);

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.deepEqual(world.readMarks, [`read:${EXPIRY.id}`]);
  assert.equal(unreadOf(page, "Expire after 7 days?"), false);
  assert.equal(unreadOf(page, "Alert at 80%?"), true);
});

test("a row's menu and U each mark an item read or unread: Mark as unread on a read item, Mark as read on an unread one, U the chosen item, and only the chosen item's menu names U, after Copy link", async () => {
  world.listedWorkspace = ACME;
  const keys = standKeymap();
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const retry = "How is a failed email retried?";
  // Note that U acts only on the chosen item, so another row's menu does not name it.
  assert.deepEqual(rowMenu(page, retry), ["Copy link", "—", "Mark as unread"]);
  act(() => menuItem("Mark as unread").click());
  await settle();
  assert.equal(unreadOf(page, retry), true);
  assert.equal(
    page.querySelector('[aria-current="page"] .luke-list-row-title')?.textContent,
    "Alert at 80%?",
    "a press on the mark opens nothing",
  );

  assert.deepEqual(rowMenu(page, retry), ["Copy link", "—", "Mark as read"]);
  act(() => menuItem("Mark as read").click());
  await settle();
  assert.equal(unreadOf(page, retry), false);
  assert.deepEqual(rowMenu(page, "Alert at 80%?"), [
    "Copy link",
    "—",
    "Mark as unreadU",
    "—",
    "Resolve without answering",
  ]);

  pressKey("u");
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), true, "U marks the chosen item unread");
  pressKey("u");
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false, "and U again marks it read");
  assert.deepEqual(world.readMarks, [
    `unread:${RETRY.id}`,
    `read:${RETRY.id}`,
    `unread:${THRESHOLD.id}`,
    `read:${THRESHOLD.id}`,
  ]);
  act(() => keys.unmount());
});

test("an item marked unread while it is shown stays unread until it is opened again, as a mail app keeps it", async () => {
  const keys = standKeymap();
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  pressKey("u");
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), true);
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), true, "leaving it leaves it unread");
  act(() => rowNamed(page, "Alert at 80%?").click());
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false, "opening it again reads it");
  assert.deepEqual(world.readMarks, [`unread:${THRESHOLD.id}`, `read:${THRESHOLD.id}`]);
  act(() => keys.unmount());
});

test("a mark the service refuses is let go, and the dot stands as the reads hold it", async () => {
  world.readMarkRefused = true;
  const { page } = mount();
  await settle();
  rowMenu(page, "How is a failed email retried?");
  act(() => menuItem("Mark as unread").click());
  await settle();
  assert.deepEqual(world.readMarks, [`unread:${RETRY.id}`]);
  assert.equal(unreadOf(page, "How is a failed email retried?"), false);
});

test("the view's menu offers Show and Addressed to alone, and ⌘K's Mark all as read marks every unread item of the listed workspace read and clears the dots alone, the attention marks standing; with nothing unread ⌘K offers it no more", async () => {
  world.listedWorkspace = ACME;
  // Note that the unread answered item is a teammate's, so the item standing chosen is the one that needs you, and nothing is read before the mark.
  world.inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, unread: true, startedBy: TEAMMATE }]);
  world.inboxes.set(INVITES.id, [{ ...EXPIRY, unread: true }]);
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(options, "the head offers the view's menu");
  act(() => options.click());
  assert.deepEqual(menuWords(), ["Open", "All", "—", "Addressed to"]);
  act(() => options.click());
  act(() => {
    runAppCommand(APP_COMMAND.MARK_INBOX_READ);
  });
  await settle();
  assert.deepEqual(world.readMarks, ["all:workspace-acme"]);
  assert.equal(unreadOf(page, "Expire after 7 days?"), false);
  assert.equal(unreadOf(page, "How is a failed email retried?"), false);
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "*Expire after 7 days?",
    "▸ *Alert at 80%?",
  ]);
  assert.equal(appCommandOffered(APP_COMMAND.MARK_INBOX_READ), false);
});

test("Mark all as read sends one write and asks no task or agent again, since each followed inbox is pushed its items' read state as it moves", async () => {
  world.listedWorkspace = ACME;
  const taskReads: string[] = [];
  world.startRead = (taskId) => {
    taskReads.push(taskId);
    return undefined;
  };
  world.inboxes.set(BILLING.id, [THRESHOLD, { ...RETRY, unread: true }]);
  world.agentInboxes = new Map([[SWEEP_AGENT, [{ ...QUARANTINE, unread: true }]]]);
  mount([waitingTaskless(QUARANTINE)]);
  await settle();
  const tasksBefore = taskReads.length;
  const agentsBefore = world.agentReads.length;
  const followsBefore = world.main.asked.length;
  const marksBefore = world.readMarks.length;
  act(() => {
    runAppCommand(APP_COMMAND.MARK_INBOX_READ);
  });
  await settle();
  assert.deepEqual(world.readMarks.slice(marksBefore), ["all:workspace-acme"]);
  assert.deepEqual(world.main.asked.slice(followsBefore), [], "nothing is followed again");
  assert.deepEqual(taskReads.slice(tasksBefore), []);
  assert.deepEqual(world.agentReads.slice(agentsBefore), []);
});

/** The chip over the list saying whose items it holds, as a reader meets it: its words and its ×'s name; none where none stands. */
function whoseChip(page: HTMLElement): readonly (string | null | undefined)[] | null {
  const chip = page.querySelector(".inbox-tasks-chips .luke-chip");
  if (chip === null) return null;
  return [
    chip.querySelector(".luke-chip-name")?.textContent,
    chip.querySelector("button")?.getAttribute("aria-label"),
  ];
}

test("Addressed to in the view's menu offers Anyone, the reader as Me, then each teammate by face and name with their email, hanging their card; a chosen teammate's items list under a chip saying so, the choice outlives a relaunch, and the chip's × lists the reader's own again, under no chip", async () => {
  world.listedWorkspace = SHARED_WORKSPACE;
  world.members = SHARED_MEMBERS;
  world.inboxes.set(BILLING.id, [{ ...THRESHOLD, startedBy: TEAMMATE }, RETRY]);
  let { page } = mount();
  await settle();
  assert.equal(whoseChip(page), null, "anyone's items stand under no chip");
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  act(() => options?.click());
  act(() => viewItem("Addressed to").click());
  const whose = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].slice(-3);
  assert.deepEqual(
    whose.map((item) => [
      item.querySelector(".luke-menu-item-label")?.textContent,
      item.querySelector(".luke-menu-item-detail")?.textContent ?? null,
      item.getAttribute("aria-checked"),
    ]),
    [
      ["Anyone", null, "true"],
      ["Me", null, "false"],
      ["Charles Pan", "charles@example.com", "false"],
    ],
  );
  assert.ok(
    viewItem("Charles Pan").querySelector('.actor-mark[data-kind="person"]'),
    "a teammate is offered by their face",
  );
  restOn(viewItem("Charles Pan"));
  assert.equal(
    document.querySelector(".luke-tooltip-card [data-actor-card='person'] .luke-hover-card-name")
      ?.textContent,
    "Charles Pan",
    "a teammate's row hangs their card",
  );
  act(() => viewItem("Charles Pan").click());
  await settle();
  assert.deepEqual(listed(page), ["Alert at 80%?"]);
  assert.deepEqual(whoseChip(page), ["Charles Pan", "Show what's addressed to me"]);

  act(() => world.root?.unmount());
  world.root = undefined;
  ({ page } = mount());
  await settle();
  assert.deepEqual(whoseChip(page), ["Charles Pan", "Show what's addressed to me"]);

  const clear = page.querySelector<HTMLButtonElement>(".inbox-tasks-chips .luke-chip button");
  assert.ok(clear, "the chip offers its ×");
  act(() => clear.click());
  assert.equal(whoseChip(page), null, "the reader's own stand under no chip");
  assert.deepEqual(listed(page), ["How is a failed email retried?", "*Expire after 7 days?"]);
});

test("the Addressed to chip scales in as a teammate is chosen and out as its × lifts it, drawn on out of reach until its exit has played, the line standing hidden between", async () => {
  world.listedWorkspace = SHARED_WORKSPACE;
  world.members = SHARED_MEMBERS;
  const played = playListMotions();
  // Note that a chip arriving rides the quick beat, which the list's tokens leave out.
  document.documentElement.style.setProperty("--luke-duration-quick", "140ms");
  onTestFinished(() => {
    document.documentElement.style.removeProperty("--luke-duration-quick");
  });
  const { page } = mount();
  await settle();
  const line = () => page.querySelector<HTMLElement>(".inbox-tasks-chips")?.parentElement;
  const scaledIn = (element: Element | null | undefined) =>
    played.some(
      (each) =>
        each.element === element &&
        each.keyframes.some((frame) => String(frame.transform).includes("scale")),
    );
  assert.equal(line()?.hidden, true, "the line stands ready, hidden");

  chooseView(page, "Addressed to", "Charles Pan");
  const chip = page.querySelector("[data-motion-key='whose']");
  assert.equal(line()?.hidden, false);
  assert.ok(scaledIn(chip), "the chip scales in");

  act(() => (chip?.querySelector("button") ?? assert.fail("a way to lift it")).click());
  const leaving = page.querySelector("[data-motion-key='whose']");
  assert.equal(leaving?.hasAttribute("data-leaving"), true, "drawn on while it goes");
  assert.equal(leaving?.hasAttribute("inert"), true, "out of reach");
  assert.equal(leaving?.querySelector(".luke-chip-name")?.textContent, "Charles Pan");
  assert.ok(scaledIn(leaving), "it scales out");

  act(() => {
    for (const each of played.splice(0)) each.finish();
  });
  assert.equal(page.querySelector("[data-motion-key='whose']"), null);
  assert.equal(line()?.hidden, true);
});

test("Addressed to offers Me though the window does not know the reader's id, and a Me chosen stays checked", async () => {
  world.listedWorkspace = SHARED_WORKSPACE;
  world.members = SHARED_MEMBERS;
  const { page } = mount([], { readerKnown: false });
  await settle();
  chooseView(page, "Addressed to", "Me");
  const options = page.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  act(() => options?.click());
  act(() => viewItem("Addressed to").click());

  assert.deepEqual(
    ["Anyone", "Me"].map((each) => viewItem(each).getAttribute("aria-checked")),
    ["false", "true"],
  );
});

test("a teammate chosen in Addressed to with nothing in the scope shown says so, and offers the reader's own again where no scope holds any of theirs", async () => {
  world.listedWorkspace = SHARED_WORKSPACE;
  world.members = SHARED_MEMBERS;
  const { page } = mount();
  await settle();
  chooseView(page, "Addressed to", "Charles Pan");
  assert.deepEqual(listed(page), []);
  assert.deepEqual(listEmpty(page), [
    undefined,
    "Nothing addressed to them",
    "Show mine",
  ]);
  const mine = page.querySelector<HTMLButtonElement>(".inbox-tasks .luke-empty-state button");
  act(() => mine?.click());
  assert.equal(whoseChip(page), null);
  assert.equal(listed(page).length, 3);
});

test("Me chosen in Addressed to with nothing of the reader's in the scope shown says so in the reader's words, and offers anyone's", async () => {
  world.listedWorkspace = SHARED_WORKSPACE;
  world.members = SHARED_MEMBERS;
  for (const [holder, items] of world.inboxes) {
    world.inboxes.set(
      holder,
      items.map((item) => ({ ...item, startedBy: TEAMMATE })),
    );
  }
  const { page } = mount();
  await settle();
  chooseView(page, "Addressed to", "Me");
  assert.deepEqual(listed(page), []);
  assert.deepEqual(listEmpty(page), [undefined, "Nothing addressed to you", "Show anyone's"]);
});

test("an item its agent withdrew wears the slashed circle on its row's card where an answered item's card wears a check", async () => {
  const [asking] = EXPIRY.thread ?? [];
  assert.ok(asking?.ask !== undefined, "the item opens with its ask");
  const withdrawn: InboxItem = {
    ...EXPIRY,
    status: INBOX_STATUS.CLOSED,
    closedReason: "Product picked 14 days.",
    settledAt: 4_500,
    thread: [
      {
        ...asking,
        ask: {
          ...asking.ask,
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: "Product picked 14 days.",
        },
      },
    ],
  };
  world.inboxes.set(BILLING.id, [THRESHOLD, RETRY]);
  world.inboxes.set(INVITES.id, [withdrawn]);
  const { page } = mount();
  await settle();

  const settledGlyph = (title: string) => {
    hoveredCard(rowNamed(page, title), "[data-inbox-item-card]");
    const card =
      document.querySelector<HTMLElement>(".luke-tooltip-card [data-inbox-item-card]") ??
      assert.fail("the row's card is hung");
    return [
      card.querySelector("svg.lucide-circle-slash") !== null,
      card.querySelector("svg.lucide-check") !== null,
    ];
  };
  assert.deepEqual(settledGlyph("Expire after 7 days?"), [true, false], "withdrawn: slashed");
  assert.deepEqual(
    settledGlyph("How is a failed email retried?"),
    [false, true],
    "answered: check",
  );
});

test("an item marked read as it opened stays read once another plan's item is chosen, though the list's read of its plan, which a mark never moves, still holds it unread", async () => {
  world.inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, RETRY]);
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  assert.deepEqual(world.readMarks, [`read:${THRESHOLD.id}`]);
  assert.equal(unreadOf(page, "Alert at 80%?"), false);
  // The plan's inbox is pushed on the mark, as the host hears it, holding the item read.
  await act(async () =>
    world.main.push(
      { kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id },
      { items: [{ ...THRESHOLD, unread: false }, RETRY] },
    ),
  );
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false);

  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  assert.equal(readTitle(page), "Expire after 7 days?");
  assert.equal(unreadOf(page, "Alert at 80%?"), false, "the list's older read brings no dot back");
});

test("a mark another window makes later on the same item stands once the plan's push holds it, over the window's own earlier mark", async () => {
  world.inboxes.set(BILLING.id, [{ ...THRESHOLD, unread: true }, RETRY]);
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), false);
  // The plan's inbox is pushed as the test says: its own mark heard, then another window's.
  const billing = { kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id };
  await act(async () =>
    world.main.push(billing, { items: [{ ...THRESHOLD, unread: false }, RETRY] }),
  );
  await settle();
  await act(async () =>
    world.main.push(billing, { items: [{ ...THRESHOLD, unread: true }, RETRY] }),
  );
  await settle();
  assert.equal(unreadOf(page, "Alert at 80%?"), true);
});

test("a thread's row says the ask itself while one is open, led by its kind's glyph: the steps left and the next as the reader ticks them in its box, the fields, or an answer to write; a teammate's waits on them with no mark, and an answer reads as its stamp, led by a tick", async () => {
  const STEPS = threadItem([
    askingMessage({
      type: INBOX_ASK.DO,
      steps: ["Open the settings", "Add the secret", "Redeploy"],
    }),
  ]);
  const FIELDS: InboxItem = {
    ...threadItem([
      askingMessage(
        { type: INBOX_ASK.ANSWER, fields: [{ type: INBOX_FIELD.TEXT, label: "Host" }] },
        { id: "e1b2c3d4-0000-4000-8000-000000000021" },
      ),
    ]),
    id: "a1b2c3d4-0000-4000-8000-000000000021",
    title: "Which SMTP host?",
    startedBy: TEAMMATE,
  };
  const asked = askingMessage(EXPIRY_ASK, { status: INBOX_ASK_STATUS.ANSWERED });
  const CHOSEN: InboxItem = {
    ...threadItem([
      asked,
      {
        ...threadMessage(
          "e1b2c3d4-0000-4000-8000-000000000022",
          { member: READER },
          "and say so in the docs",
          2_000,
        ),
        answers: { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["7 days"] },
      },
    ]),
    id: "a1b2c3d4-0000-4000-8000-000000000022",
    title: "Invite window?",
    status: INBOX_STATUS.ANSWERED,
    answeredBy: READER,
  };
  world.inboxes = new Map([
    [BILLING.id, [STEPS, FIELDS, CHOSEN]],
    [INVITES.id, [{ ...EXPIRY, thread: [askingMessage({ type: INBOX_ASK.ANSWER })] }]],
  ]);
  const { page } = mount();
  await settle();
  assert.deepEqual(rowLines(page, STEPS.title), [true, "3 steps left · Open the settings"]);
  assert.deepEqual(rowLines(page, FIELDS.title), [true, "Fill in Host"]);
  assert.deepEqual(rowLines(page, EXPIRY.title), [true, "Write an answer"]);
  assert.deepEqual(rowLines(page, CHOSEN.title), [
    true,
    "You: Chose 7 days · and say so in the docs",
  ]);
  const glyphOf = (title: string) =>
    rowNamed(page, title).querySelector(".inbox-row-line")?.getAttribute("data-line");
  assert.deepEqual([STEPS.title, FIELDS.title, CHOSEN.title].map(glyphOf), [
    "do",
    "answer",
    "settled",
  ]);
  assert.equal(needsYouMark(rowNamed(page, STEPS.title)), "*");
  assert.equal(needsYouMark(rowNamed(page, FIELDS.title)), "", "a teammate's ask needs them");
  assert.equal(
    rowNamed(page, FIELDS.title)
      .querySelector(".luke-list-row-meta .actor-mark")
      ?.getAttribute("data-kind"),
    "person",
  );
  assert.equal(needsYouMark(rowNamed(page, CHOSEN.title)), "", "an answered ask waits on nobody");

  // A step ticked in the item's box is counted on its row once another item is chosen.
  act(() => rowNamed(page, STEPS.title).click());
  await settle();
  act(() => itemPane(page).querySelector<HTMLInputElement>("[data-inbox-step] input")?.click());
  act(() => rowNamed(page, CHOSEN.title).click());
  await settle();
  assert.deepEqual(rowLines(page, STEPS.title), [true, "2 steps left · Add the secret"]);

  // Mark done pressed in the box ticks every step on the row and its card, as the box shows them.
  act(() => rowNamed(page, STEPS.title).click());
  await settle();
  act(() => askPress(itemPane(page), "Mark done").click());
  act(() => rowNamed(page, CHOSEN.title).click());
  await settle();
  assert.deepEqual(rowLines(page, STEPS.title), [true, "Every step ticked · Mark done"]);
  hoveredCard(rowNamed(page, STEPS.title), "[data-inbox-item-card]");
  assert.deepEqual(
    [
      ...document.querySelectorAll(
        '.luke-tooltip-card [data-inbox-item-card] ul[aria-label="Steps"] > li',
      ),
    ].map((step) => step.getAttribute("data-done")),
    ["true", "true", "true"],
  );
});

/** Types `words` into the list's search, as a reader's keys put them in its field. */
function searchList(page: HTMLElement, words: string): void {
  const input = page.querySelector<HTMLInputElement>(
    '.inbox-tasks input[aria-label="Search inbox"]',
  );
  assert.ok(input, "the search stands open");
  // Note that the value goes in through the prototype's setter, because React tracks the field's own.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The title of the item the pane shows. */
function paneTitle(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-view-items .inbox-subject-title")?.textContent;
}

test("the list's search stands under the Inbox's head, its name and buttons never giving way, and narrows the list to the items saying every word typed, the item open leaving the list but not the pane; Escape empties it", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const title = headTitle(page);
  const buttons = () =>
    [...(page.querySelector(".inbox-tasks > .luke-toolbar")?.querySelectorAll("button") ?? [])].map(
      (each) => each.getAttribute("aria-label"),
    );
  assert.deepEqual(buttons(), ["View options"]);
  const input = page.querySelector<HTMLInputElement>(
    '.inbox-tasks input[aria-label="Search inbox"]',
  );
  assert.ok(input, "the search stands before anything is pressed");

  // Note that the retry question is found by its answer's note, which only its thread holds.
  searchList(page, "on-call");
  assert.deepEqual(listed(page), ["How is a failed email retried?"]);
  assert.equal(paneTitle(page), "Alert at 80%?", "the pane keeps the item open");
  assert.equal(headTitle(page), title, "the name stands while the search is used");
  assert.deepEqual(buttons(), ["View options"], "and so do the buttons");

  searchList(page, "zzz");
  assert.deepEqual(listed(page), []);
  assert.ok(page.querySelector(".inbox-tasks")?.textContent?.includes("No items match “zzz”."));

  act(() => input.focus());
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(input.value, "");
  assert.deepEqual(listed(page), [
    "How is a failed email retried?",
    "*Expire after 7 days?",
    "▸ *Alert at 80%?",
  ]);
  assert.equal(document.activeElement, input, "the caret stays in the field");
});
