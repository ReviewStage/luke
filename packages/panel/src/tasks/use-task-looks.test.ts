// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import {
  PLAN_ACTOR,
  type PlanSectionEdit,
  type Task,
  type TaskAgentsSummary,
  type TaskSummary,
} from "@luke/features/task-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import {
  NO_LOOKS,
  useAgentLook,
  useReadMarks,
  useTaskLooks,
  useUnreadTasks,
} from "./use-task-looks.js";

/**
 * use-task-looks.test.ts -- the sections a reader is shown as changed since
 * they last looked: a teammate's saves, Luke's and an agent's, never the
 * reader's own; and a plan read the moment it opens, its changes still lit
 * for that visit.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const LOOKED_AT = 1_000;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  window.localStorage.clear();
});

/** The sections `readerId` is shown as changed on a task they last looked at before every save here. */
function changedFor(
  readerId: string | undefined,
  edits: readonly Omit<PlanSectionEdit, "at" | "duringCall">[],
  key = "luke.taskLooks",
): string[] {
  const task: Task = {
    ...DOCUMENT_TASK,
    sectionEdits: edits.map((edit) => ({ ...edit, at: LOOKED_AT + 1, duringCall: false })),
  };
  window.localStorage.setItem(key, JSON.stringify({ [task.id]: LOOKED_AT }));
  let changed: readonly string[] = [];
  function Reader() {
    changed = [...useTaskLooks(task, readerId).changed];
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Reader))));
  return [...changed].sort();
}

const EDITS = [
  { section: "Goal", actor: PLAN_ACTOR.DEVELOPER, by: DEAN },
  { section: "Approach", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES },
  { section: "Context", actor: PLAN_ACTOR.NOTETAKER },
];

test("a teammate's saves are shown as changed, and the reader's own are not", () => {
  assert.deepEqual(changedFor(DEAN.userId, EDITS), ["Approach", "Context"]);
  assert.deepEqual(changedFor(CHARLES.userId, EDITS), ["Context", "Goal"]);
});

test("the looks a window kept before tasks had their name are read under their earlier key, and the look opening takes is kept under the new one", () => {
  assert.deepEqual(changedFor(DEAN.userId, EDITS, "luke.planLooks"), ["Approach", "Context"]);
  assert.equal(
    window.localStorage.getItem("luke.planLooks"),
    JSON.stringify({ [DOCUMENT_TASK.id]: LOOKED_AT }),
    "the earlier key is left as it was",
  );
  assert.notEqual(
    window.localStorage.getItem("luke.taskLooks"),
    null,
    "the look is kept under the new key",
  );
});

test("a developer's save the window cannot place counts as the reader's, as before saves named a member", () => {
  const unnamed = [{ section: "Goal", actor: PLAN_ACTOR.DEVELOPER }];

  assert.deepEqual(changedFor(DEAN.userId, unnamed), []);
  assert.deepEqual(changedFor(undefined, EDITS), ["Context"]);
});

test("a reader's id arriving while the plan stays open lights a teammate's saves read without it", () => {
  const task: Task = {
    ...DOCUMENT_TASK,
    sectionEdits: EDITS.map((edit) => ({ ...edit, at: LOOKED_AT + 1, duringCall: false })),
  };
  window.localStorage.setItem("luke.taskLooks", JSON.stringify({ [task.id]: LOOKED_AT }));
  let changed: readonly string[] = [];
  function Reader({ readerId }: { readerId: string | undefined }) {
    changed = [...useTaskLooks(task, readerId).changed];
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const registry = AtomRegistry.make();
  act(() => root.render(onRegistry(registry, createElement(Reader, { readerId: undefined }))));
  assert.deepEqual([...changed].sort(), ["Context"]);

  act(() => root.render(onRegistry(registry, createElement(Reader, { readerId: DEAN.userId }))));
  assert.deepEqual([...changed].sort(), ["Approach", "Context"]);
});

/** The plan's sections lit and whether the sidebar reads it unread, as one window draws them with `plan` open or not. */
interface Drawn {
  changed: readonly string[];
  unread: boolean;
}

/** A window as a test drives it: what it drew last, a render with a plan open or none and its row as the list names it, and the row marked unread or read from a menu. */
interface TestWindow {
  readonly drawn: Drawn;
  readonly draw: (open: Task | undefined, row?: TaskSummary) => void;
  readonly mark: (unread: boolean) => void;
}

/** A window drawing `summary`'s row, or the row `draw` last named, and, while `open` is given, that plan open with the agents its row names. */
function windowOn(summary: TaskSummary): TestWindow {
  const drawn: Drawn = { changed: [], unread: false };
  let shown = summary;
  let marks: ReturnType<typeof useReadMarks> | undefined;
  function Window({ open, row }: { open: Task | undefined; row: TaskSummary }) {
    drawn.changed = [...useTaskLooks(open, DEAN.userId, row.agents).changed].sort();
    drawn.unread = useUnreadTasks([row], { listRead: true, staged: false })(row);
    marks = useReadMarks();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (open: Task | undefined, row = shown) => {
    shown = row;
    act(() => root.render(onRegistry(registry, createElement(Window, { open, row }))));
  };
  const mark = (unread: boolean) => act(() => marks?.mark(shown, unread));
  return { drawn, draw, mark };
}

/** A task's agents as its row names them, one agent's pull request standing `state`, its agents' newest settled activity at `activityAt`. */
function agentsAt(
  activityAt: number,
  state: TaskAgentsSummary["pullRequests"][number]["state"] = PULL_REQUEST_STATE.OPEN,
): TaskAgentsSummary {
  return {
    total: 1,
    working: 0,
    activityAt,
    agents: [],
    pullRequestTotal: 1,
    pullRequests: [
      {
        number: 7,
        title: "Fix it",
        state,
        checks: CHECK_SUMMARY.PASSING,
        additions: 1,
        deletions: 1,
      },
    ],
  };
}

test("a plan opened is read at once, and still lights what changed since the last look for that visit alone", () => {
  const task: Task = {
    ...DOCUMENT_TASK,
    updatedAt: LOOKED_AT + 1,
    sectionEdits: EDITS.map((edit) => ({ ...edit, at: LOOKED_AT + 1, duringCall: false })),
  };
  window.localStorage.setItem("luke.planLooks", JSON.stringify({ [task.id]: LOOKED_AT }));
  window.localStorage.setItem("luke.taskLooksSeededWithAgents", "1");
  const { drawn, draw } = windowOn(task);

  draw(undefined);
  assert.deepEqual(drawn, { changed: [], unread: true });

  draw(task);
  assert.deepEqual(drawn, { changed: ["Approach", "Context"], unread: false });

  draw(undefined);
  assert.deepEqual(drawn, { changed: [], unread: false });

  draw(task);
  assert.deepEqual(drawn, { changed: [], unread: false });
});

test("a plan marked unread lights, as it next opens, what changed since its last look and nothing before it", () => {
  const task: Task = {
    ...DOCUMENT_TASK,
    updatedAt: LOOKED_AT + 1,
    sectionEdits: [
      { section: "Approach", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at: LOOKED_AT - 1 },
      { section: "Context", actor: PLAN_ACTOR.NOTETAKER, at: LOOKED_AT + 1 },
    ].map((edit) => ({ ...edit, duringCall: false })),
  };
  window.localStorage.setItem("luke.planLooks", JSON.stringify({ [task.id]: LOOKED_AT }));
  window.localStorage.setItem("luke.taskLooksSeededWithAgents", "1");
  const { drawn, draw, mark } = windowOn(task);

  draw(undefined);
  mark(true);
  assert.deepEqual(drawn, { changed: [], unread: true });

  draw(task);
  assert.deepEqual(drawn, { changed: ["Context"], unread: false });
});

test("a save landing while the plan stays open is read as it lands, and stays read once the plan is left", () => {
  const task: Task = { ...DOCUMENT_TASK, updatedAt: LOOKED_AT };
  window.localStorage.setItem("luke.planLooks", JSON.stringify({ [task.id]: LOOKED_AT }));
  window.localStorage.setItem("luke.taskLooksSeededWithAgents", "1");
  const saved: Task = {
    ...task,
    updatedAt: LOOKED_AT + 1,
    sectionEdits: [
      { section: "Context", actor: PLAN_ACTOR.NOTETAKER, at: LOOKED_AT + 1, duringCall: false },
    ],
  };
  const { drawn, draw } = windowOn(saved);

  draw(task);
  draw(saved);
  assert.deepEqual(drawn, { changed: [], unread: false });

  draw(undefined);
  assert.deepEqual(drawn, { changed: [], unread: false });
});

test("an agent finishing after the look makes its task unread, opening it reads it, and what its agents do while it stays open is read as it lands", () => {
  const task: Task = { ...DOCUMENT_TASK, updatedAt: LOOKED_AT };
  window.localStorage.setItem("luke.taskLooks", JSON.stringify({ [task.id]: LOOKED_AT }));
  window.localStorage.setItem("luke.taskLooksSeededWithAgents", "1");
  const { drawn, draw } = windowOn({ ...task, agents: agentsAt(LOOKED_AT) });

  draw(undefined);
  assert.equal(drawn.unread, false);

  draw(undefined, { ...task, agents: agentsAt(LOOKED_AT + 1) });
  assert.equal(drawn.unread, true, "the agent's turn ending after the look is unread");

  draw(task);
  draw(task, { ...task, agents: agentsAt(LOOKED_AT + 2) });
  draw(undefined);
  assert.equal(drawn.unread, false, "opening reads it, and the turn ending while open is seen");
});

test("a pull request merging alone leaves a read task read", () => {
  const task: Task = { ...DOCUMENT_TASK, updatedAt: LOOKED_AT };
  window.localStorage.setItem("luke.taskLooks", JSON.stringify({ [task.id]: LOOKED_AT + 1 }));
  window.localStorage.setItem("luke.taskLooksSeededWithAgents", "1");
  const { drawn, draw } = windowOn({ ...task, agents: agentsAt(LOOKED_AT + 1) });

  draw(undefined);
  draw(undefined, { ...task, agents: agentsAt(LOOKED_AT + 1, PULL_REQUEST_STATE.MERGED) });
  assert.equal(drawn.unread, false);
});

test("the first list read since agents counted marks their old activity read, and leaves a task saved since its look unread", () => {
  const read: TaskSummary = {
    ...DOCUMENT_TASK,
    id: "task-read",
    updatedAt: LOOKED_AT,
    agents: agentsAt(LOOKED_AT + 5),
  };
  const saved: TaskSummary = {
    ...DOCUMENT_TASK,
    id: "task-saved",
    updatedAt: LOOKED_AT + 1,
    agents: agentsAt(LOOKED_AT + 5),
  };
  const unmarked: TaskSummary = {
    ...DOCUMENT_TASK,
    id: "task-unmarked",
    updatedAt: LOOKED_AT,
    agents: agentsAt(LOOKED_AT + 5),
  };
  const listed = [read, saved, unmarked];
  window.localStorage.setItem(
    "luke.taskLooks",
    JSON.stringify({ [read.id]: LOOKED_AT, [saved.id]: LOOKED_AT }),
  );
  window.localStorage.setItem("luke.taskLooksSeeded", "1");
  let unread: (task: TaskSummary) => boolean = () => false;
  function Sidebar() {
    unread = useUnreadTasks(listed, { listRead: true, staged: false });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Sidebar))));

  assert.deepEqual(
    listed.filter((task) => unread(task)).map((task) => task.id),
    [saved.id],
  );
});

test("a reader's id arriving mid-stay lights neither a save that landed during the stay nor a section dismissed", () => {
  const charles = { section: "Approach", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES };
  const task: Task = {
    ...DOCUMENT_TASK,
    updatedAt: LOOKED_AT + 1,
    sectionEdits: [{ ...charles, at: LOOKED_AT + 1, duringCall: false }],
  };
  const saved: Task = {
    ...task,
    updatedAt: LOOKED_AT + 2,
    sectionEdits: [
      { ...charles, at: LOOKED_AT + 1, duringCall: false },
      { section: "Context", actor: PLAN_ACTOR.NOTETAKER, at: LOOKED_AT + 2, duringCall: false },
    ],
  };
  const stay = (dismissing: boolean) => {
    window.localStorage.setItem("luke.planLooks", JSON.stringify({ [task.id]: LOOKED_AT }));
    let looks = NO_LOOKS;
    function Reader({ open, readerId }: { open: Task; readerId: string | undefined }) {
      looks = useTaskLooks(open, readerId);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    roots.push(root);
    const registry = AtomRegistry.make();
    const draw = (open: Task, readerId: string | undefined) =>
      act(() => root.render(onRegistry(registry, createElement(Reader, { open, readerId }))));
    draw(task, undefined);
    if (dismissing) act(() => looks.dismiss());
    draw(saved, undefined);
    draw(saved, DEAN.userId);
    return [...looks.changed];
  };

  assert.deepEqual(stay(false), ["Approach"]);
  assert.deepEqual(stay(true), []);
});

test("an agent with no task is looked at as its page opens, which takes back a mark unread by hand, and its row's time moving while open leaves a mark made then", () => {
  const agent = { id: "agent-looked", activityAt: LOOKED_AT };
  let marks: ReturnType<typeof useReadMarks> | undefined;
  function Window({ open }: { open: typeof agent | undefined }) {
    useAgentLook(open);
    marks = useReadMarks();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (open: typeof agent | undefined) =>
    act(() => root.render(onRegistry(registry, createElement(Window, { open }))));
  const kept = () => JSON.parse(window.localStorage.getItem("luke.taskLooks") ?? "{}");

  draw(undefined);
  act(() => marks?.mark({ id: agent.id, updatedAt: agent.activityAt }, true));
  assert.equal(marks?.markedUnread(agent.id), true);

  draw(agent);
  assert.equal(marks?.markedUnread(agent.id), false, "opening it takes the mark back");
  assert.deepEqual(kept(), { [agent.id]: LOOKED_AT });

  act(() => marks?.mark({ id: agent.id, updatedAt: agent.activityAt }, true));
  draw({ ...agent, activityAt: LOOKED_AT + 5 });
  assert.equal(marks?.markedUnread(agent.id), true, "a move while it stays open leaves the mark");
  assert.deepEqual(kept(), { [agent.id]: { at: LOOKED_AT + 5, unread: true } });
});
