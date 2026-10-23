// @vitest-environment jsdom

/**
 * sidebar-redraws.test.ts -- what the sidebar draws again as the window's tasks move while agents work: a patch to one task draws that task's row and no other, and the open task's agents moving draws none.
 *
 * The sidebar is drawn through `DesktopSidebar`, and drawn again over a
 * tasks control that changed as a delivery changes it, the rest standing as
 * the window's steady control keeps it. What is drawn again is read through
 * wrappers around what each row draws, a task's end mark and an agent's
 * glyph, which draw the real ones. Synthetic tasks and agents.
 */

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type TasklessAgent } from "@luke/features/coding-agent-wire";
import { TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/** How many times each row was drawn, by its task's id or its agent's name. */
const draws = vi.hoisted(() => new Map<string, number>());

// Note that each wrapper draws the real mark beneath it and only counts,
// because what is under test is whether the sidebar draws the row, not what it draws.
vi.mock("./task-card.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-card.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    TaskRowMark: (props: Parameters<typeof actual.TaskRowMark>[0]) => {
      draws.set(props.task.id, (draws.get(props.task.id) ?? 0) + 1);
      return draw(actual.TaskRowMark, props);
    },
  };
});
vi.mock("../tasks/tab-look.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tasks/tab-look.js")>();
  return {
    ...actual,
    tabLook: (subject: Parameters<typeof actual.tabLook>[0]) => {
      // Note that an agent's row is known by its name, the one thing of its agent the look is told.
      if (subject.kind === actual.TAB_KIND.AGENT && subject.name !== undefined) {
        draws.set(subject.name, (draws.get(subject.name) ?? 0) + 1);
      }
      return actual.tabLook(subject);
    },
  };
});

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

function task(id: string, name: string): TaskSummary {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: "acme/relay",
    status: TASK_STATUS.IN_PROGRESS,
  };
}

const INVITES = task("0a1b2c3d-0000-4000-8000-100000000001", "Invite expiry");
const RETRIES = task("0a1b2c3d-0000-4000-8000-100000000002", "Retry audit");

/** An automation's agent with no task, listed among the tasks. */
const SWEEP: TasklessAgent = {
  id: "0a1b2c3d-0000-4000-8000-200000000001",
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Sweep flaky tests",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  startedBy: { userId: "user-ada", name: "Ada Lovelace" },
  automationId: null,
  workspaceId: WORKSPACE.id,
  repository: "acme/relay",
  activityAt: 1,
};

/** The agent's row's name, its title. */
const SWEEP_NAME = "Sweep flaky tests";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  window.localStorage.clear();
  handState({});
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  draws.clear();
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The sidebar listing both tasks and the agent, and a way to draw it again over another control. */
async function drawSidebar(): Promise<{
  first: TasksControl;
  draw: (tasks: TasksControl) => Promise<void>;
}> {
  const first = tasksControl({
    tasks: [INVITES, RETRIES],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    listedAgents: { standing: [SWEEP], archived: [] },
  });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  const registry = AtomRegistry.make();
  const draw = async (tasks: TasksControl) => {
    act(() =>
      root?.render(onRegistry(registry, createElement(DesktopSidebar, sidebarProps(tasks)))),
    );
    await settle();
  };
  await draw(first);
  return { first, draw };
}

test("a patch to one task draws its row again and no other row", async () => {
  const { first, draw } = await drawSidebar();
  assert.ok(draws.get(INVITES.id), "every row is drawn at first");
  assert.ok(draws.get(SWEEP_NAME), "the agent's row among them");
  draws.clear();

  // An agent's save on the task, as a delivery carries it.
  const saved = { ...RETRIES, updatedAt: 3 };
  await draw({
    ...first,
    tasks: [INVITES, saved],
    listed: { ...first.listed, tasks: [INVITES, saved] },
  });

  assert.ok((draws.get(RETRIES.id) ?? 0) > 0, "the patched task's row is drawn again");
  assert.equal(draws.get(INVITES.id), undefined);
  assert.equal(draws.get(SWEEP_NAME), undefined);
});

test("the open task's agents moving draws no row again", async () => {
  const { first, draw } = await drawSidebar();
  draws.clear();

  await draw({ ...first, agents: { ...first.agents, agents: [], agentIds: [] } });

  assert.deepEqual([...draws], []);
});
