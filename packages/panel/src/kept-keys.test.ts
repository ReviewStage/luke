// @vitest-environment jsdom

import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { useCallVideoHeight } from "./call/use-call-video-size.js";
import { useChosenWorkspace } from "./desktop/chosen-workspace.js";
import {
  FILE_TREE_WIDTH,
  INBOX_LIST_WIDTH,
  useChatListWidth,
  useFileTreeWidth,
  useFoldedGroups,
  useInboxListWidth,
  useInboxTaskFolds,
  useInboxViewChoices,
  useRunsPanel,
  useTaskInboxShow,
} from "./desktop/folded-groups.js";
import { SIDEBAR_WIDTH, useSidebarCollapse } from "./desktop/sidebar-collapse.js";
import { useTaskListView } from "./desktop/task-list-view.js";
import { useSummaryPin } from "./desktop/task-summary.js";
import { useConversationFilters } from "./tasks/conversation-filters.js";

/**
 * kept-keys.test.ts -- a view choice kept before it moved onto `useKept` is
 * still kept: each is read from the name and in the shape an earlier build
 * wrote it, and written back under the same name in the same shape, so
 * nobody loses a fold, a width or a filter to the move. The stored texts
 * are spelled out here, never computed from the code under test.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** What the hook answered on its last draw. */
interface Drawn<T> {
  readonly now: () => T;
}

/** Draws a surface that calls `hook`, and answers what it last returned. */
function draw<T>(hook: () => T): Drawn<T> {
  let latest: T | undefined;
  function Surface(): null {
    latest = hook();
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Surface)));
  return {
    now: () => {
      if (latest === undefined) throw new Error("the surface has not drawn");
      return latest;
    },
  };
}

function kept(name: string): string | null {
  return window.localStorage.getItem(name);
}

function keep(name: string, text: string): void {
  window.localStorage.setItem(name, text);
}

test("the sidebar's folds are read from, and written back to, the names they were kept under", () => {
  keep("luke.sidebarFoldedGroups", '["acme/app",null]');
  keep("luke.sidebarFoldedCreators", '["u1"]');
  keep("luke.sidebarFoldedAssignees", "[null]");
  keep("luke.sidebarPinnedFolded", "true");
  keep("luke.sidebarFoldedSections", '["s1"]');
  const folds = draw(() => useFoldedGroups(false));
  expect(folds.now().folded("acme/app")).toBe(true);
  expect(folds.now().folded(null)).toBe(true);
  expect(folds.now().folded("acme/other")).toBe(false);
  expect(folds.now().creatorFolded("u1")).toBe(true);
  expect(folds.now().assigneeFolded(undefined)).toBe(true);
  expect(folds.now().pinnedFolded).toBe(true);
  expect(folds.now().sectionFolded("s1")).toBe(true);
  act(() => folds.now().toggle("acme/other"));
  act(() => folds.now().togglePinned());
  act(() => folds.now().toggleSection("s2"));
  expect(kept("luke.sidebarFoldedGroups")).toBe('["acme/app",null,"acme/other"]');
  expect(kept("luke.sidebarPinnedFolded")).toBe("false");
  expect(kept("luke.sidebarFoldedSections")).toBe('["s1","s2"]');
  // The folds that were not pressed are left as they were kept.
  expect(kept("luke.sidebarFoldedCreators")).toBe('["u1"]');
});

test("a fixture run's folds keep nothing", () => {
  const folds = draw(() => useFoldedGroups(true));
  act(() => folds.now().toggle("acme/app"));
  expect(folds.now().folded("acme/app")).toBe(true);
  expect(kept("luke.sidebarFoldedGroups")).toBeNull();
});

test("the Inbox's task folds are read from the name tasks had before they were named", () => {
  keep("luke.inboxFoldedPlans", '["t1"]');
  const folds = draw(() => useInboxTaskFolds());
  expect(folds.now().folded("t1")).toBe(true);
  act(() => folds.now().toggle("t2"));
  expect(kept("luke.inboxFoldedTasks")).toBe('["t1","t2"]');
});

test("the Inbox's scope is read from a tab, or a button's press, kept before the scopes", () => {
  keep("luke.inboxShow", '"needs-you"');
  expect(draw(() => useInboxViewChoices()).now().show).toBe("to-do");
  act(() => root?.unmount());
  keep("luke.inboxShow", '"open"');
  expect(draw(() => useInboxViewChoices()).now().show).toBe("all");
  act(() => root?.unmount());
  window.localStorage.removeItem("luke.inboxShow");
  keep("luke.inboxWaitingOnly", "false");
  expect(draw(() => useInboxViewChoices()).now().show).toBe("all");
  act(() => root?.unmount());
  keep("luke.inboxWaitingOnly", "true");
  expect(draw(() => useInboxViewChoices()).now().show).toBe("to-do");
  act(() => root?.unmount());
  window.localStorage.clear();
  expect(draw(() => useInboxViewChoices()).now().show).toBe("to-do");
});

test("an Inbox scope kept as null reads the Needs you press kept beside it, as it did before", () => {
  keep("luke.inboxShow", "null");
  keep("luke.inboxWaitingOnly", "false");
  keep("luke.taskInboxShow", "null");
  keep("luke.taskInboxWaitingOnly", "false");
  const shown = draw(() => ({ window: useInboxViewChoices(), task: useTaskInboxShow() }));
  expect(shown.now().window.show).toBe("all");
  expect(shown.now().task.show).toBe("all");
});

test("the Inbox's choices are read as they were kept, and an earlier sort as the one that replaced it", () => {
  keep("luke.inboxShow", '"all"');
  keep("luke.inboxGrouping", '"plan"');
  keep("luke.inboxSort", '"waiting"');
  keep("luke.inboxWhose", '{"kind":"person","userId":"u1","name":"Ana"}');
  keep("luke.inboxMediaPreviews", "true");
  keep("luke.inboxSecondLine", "false");
  const choices = draw(() => useInboxViewChoices());
  expect(choices.now().show).toBe("all");
  expect(choices.now().grouping).toBe("plan");
  expect(choices.now().sort).toBe("oldest");
  expect(choices.now().whose).toEqual({ kind: "person", userId: "u1", name: "Ana" });
  expect(choices.now().mediaPreviews).toBe(true);
  expect(choices.now().secondLine).toBe(false);
  act(() => choices.now().onShow("to-do"));
  act(() => choices.now().onSort("latest"));
  expect(kept("luke.inboxShow")).toBe('"to-do"');
  expect(kept("luke.inboxSort")).toBe('"latest"');
});

test("a task's own Inbox keeps its scope apart from the window's", () => {
  keep("luke.taskInboxShow", '"all"');
  keep("luke.inboxShow", '"to-do"');
  expect(draw(() => useTaskInboxShow()).now().show).toBe("all");
});

test("the list, the file tree and the Runs panel stand at the widths they were kept at, held to their bounds", () => {
  keep("luke.inboxListWidth", "400");
  keep("luke.chatListWidth", "9999");
  keep("luke.fileTreeWidth", "1");
  keep("luke.automationRunsPanel", '{"width":300,"open":false}');
  const drawn = draw(() => ({
    inbox: useInboxListWidth(),
    chat: useChatListWidth(),
    tree: useFileTreeWidth(),
    runs: useRunsPanel(),
  }));
  expect(drawn.now().inbox.width).toBe(400);
  expect(drawn.now().chat.width).toBe(INBOX_LIST_WIDTH.MAX);
  expect(drawn.now().tree.width).toBe(FILE_TREE_WIDTH.MIN);
  expect(drawn.now().runs).toMatchObject({ width: 300, open: false });
  act(() => drawn.now().inbox.onResize(350.4));
  act(() => drawn.now().runs.onShow());
  expect(kept("luke.inboxListWidth")).toBe("350");
  expect(kept("luke.automationRunsPanel")).toBe('{"width":300,"open":true}');
});

test("the sidebar is folded and as wide as it was kept, and keeps a change under the same names", () => {
  keep("luke.sidebar-collapsed", "true");
  keep("luke.sidebar-width", "300");
  const sidebar = draw(() => useSidebarCollapse(false, false));
  expect(sidebar.now().collapsed).toBe(true);
  expect(sidebar.now().width).toBe(300);
  act(() => sidebar.now().onToggle());
  act(() => sidebar.now().onResize(9999));
  expect(kept("luke.sidebar-collapsed")).toBe("false");
  expect(kept("luke.sidebar-width")).toBe(String(SIDEBAR_WIDTH.MAX));
});

test("a sidebar never folded opens", () => {
  expect(draw(() => useSidebarCollapse(false, false)).now().collapsed).toBe(false);
});

test("each workspace's task list view is read from the record it was kept in", () => {
  keep("luke.sidebarTaskViews", '{"w1":{"grouping":"creator","order":"created","createdBy":"u1"}}');
  const list = draw(() => useTaskListView("w1", false));
  expect(list.now().view).toMatchObject({ grouping: "creator", createdBy: "u1" });
  act(() => list.now().onEveryone());
  expect(JSON.parse(kept("luke.sidebarTaskViews") ?? "{}")).toEqual({
    w1: { grouping: "creator", order: "created" },
  });
});

test("the sidebar and a person's page draw one task list view at once", () => {
  const drawn = draw(() => ({
    sidebar: useTaskListView("w1", false),
    person: useTaskListView("w1", false),
  }));
  act(() => drawn.now().person.onCreatedByAlone("u2"));
  expect(drawn.now().sidebar.view.createdBy).toBe("u2");
});

test("the chosen workspace is read from the id it was kept as", () => {
  const workspace = (id: string): Workspace => ({
    id,
    name: id,
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  });
  keep("luke.chosenWorkspace", '"w2"');
  const chosen = draw(() => useChosenWorkspace([workspace("w1"), workspace("w2")], false));
  expect(chosen.now().chosen?.id).toBe("w2");
  act(() => chosen.now().choose("w1"));
  expect(kept("luke.chosenWorkspace")).toBe('"w1"');
});

test("the call's video stands as tall as it was kept, held to its bounds", () => {
  keep("luke.callVideoHeight", "200");
  const video = draw(() => useCallVideoHeight());
  expect(video.now().height).toBe(200);
  act(() => video.now().onResize(1000));
  expect(kept("luke.callVideoHeight")).toBe("360");
});

test("the summary is pinned unless it was kept unpinned", () => {
  expect(draw(() => useSummaryPin(false)).now().pinned).toBe(true);
  act(() => root?.unmount());
  keep("luke.summary-pinned", "false");
  const pin = draw(() => useSummaryPin(false));
  expect(pin.now().pinned).toBe(false);
  act(() => pin.now().onToggle());
  expect(kept("luke.summary-pinned")).toBe("true");
});

test("the conversation's filters and folds are read from the one record, and every other conversation draws a change at once", () => {
  keep(
    "luke.conversation-filters",
    '{"hideBots":true,"hideResolved":false,"descriptionOpen":false,"conversationOpen":true}',
  );
  const drawn = draw(() => ({ first: useConversationFilters(), second: useConversationFilters() }));
  expect(drawn.now().first.filters).toEqual({
    hideBots: true,
    hideResolved: false,
    descriptionOpen: false,
    conversationOpen: true,
  });
  act(() => drawn.now().first.change({ hideResolved: true }));
  expect(drawn.now().second.filters.hideResolved).toBe(true);
  expect(JSON.parse(kept("luke.conversation-filters") ?? "{}")).toEqual({
    hideBots: true,
    hideResolved: true,
    descriptionOpen: false,
    conversationOpen: true,
  });
});
