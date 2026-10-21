// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentTranscriptPage } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import type { Task } from "@luke/features/task-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { TranscriptFollower } from "../tasks/use-agent-transcript.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

/**
 * task-open.test.ts -- a task opens on its agent's tab through one placeholder
 * in the page's shape: no spinner, no empty column, and no "Loading agent"
 * between the open and the transcript, which is followed from the agent's id
 * before the task's list of agents answers. Synthetic throughout.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "", assumptions: [] },
};

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const BRIEF: CodingAgentMessage = {
  id: "brief",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "# Teammate invitations\n\nExpire invites after seven days." }],
  sentAt: Date.UTC(2026, 9, 14, 16, 5),
};

/** The transcript's one page, the brief alone, as the host pushes it. */
const PAGE: CodingAgentTranscriptPage = {
  messages: [BRIEF],
  cursor: "1:0",
  status: CODING_AGENT_STATUS.COMPLETED,
  title: null,
  caughtUp: true,
};

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** A follower that records each transcript followed and hands its pages over only when the test pushes them. */
function heldFollower() {
  const followed: string[] = [];
  const hearers: ((page: CodingAgentTranscriptPage) => void)[] = [];
  const follower: TranscriptFollower = (transcript, hear) => {
    followed.push(transcript.agentId);
    hearers.push(hear);
    return () => undefined;
  };
  return {
    follower,
    followed,
    push: (page: CodingAgentTranscriptPage) => {
      for (const hear of hearers) hear(page);
    },
  };
}

/** The task's row as the sidebar lists it, naming its one agent. */
const ROW = {
  id: TASK.id,
  workspaceId: TASK.workspaceId,
  name: TASK.name,
  createdAt: TASK.createdAt,
  updatedAt: TASK.updatedAt,
  repository: TASK.repository,
  agents: {
    total: 1,
    working: 0,
    agents: [
      {
        id: AGENT.id,
        title: AGENT.title,
        model: AGENT.model,
        effort: AGENT.effort,
        status: AGENT.status,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
};

/** The task's page opened on its agent's tab: the task `read` or still being read, the agents listed or not yet. */
function opened(input: {
  read: boolean;
  listed: boolean;
  follower: TranscriptFollower;
}): TasksControl {
  return tasksControl({
    tasks: [ROW],
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: TASK.id,
    region: input.read
      ? { kind: DOCUMENT_REGION.READY, task: TASK }
      : { kind: DOCUMENT_REGION.READING },
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: input.listed ? [{ agent: AGENT.id }] : [],
      // The tab the task's row chose before its agents were read (`use-main-tabs.ts`).
      tab: { agent: AGENT.id },
      openAgents: input.listed ? [AGENT.id] : undefined,
    },
    agents: codingAgentsControl({
      agents: input.listed ? [AGENT] : undefined,
      agentIds: input.listed ? [AGENT.id] : undefined,
      transcripts: input.follower,
    }),
  });
}

function mount(tasks: TasksControl) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const draw = (next: TasksControl) =>
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(DesktopTasks, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            notice: undefined,
            tasks: next,
          }),
        ),
      ),
    );
  draw(tasks);
  return { container, draw };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** What stands in the column's log as a reader sees it: a spinner, nothing, the placeholder's blocks by their shapes and widths, or the log's lines. */
function columnLog(container: HTMLElement): string {
  const pane = container.querySelector(".desktop-agent");
  if (pane === null || pane.textContent === null) return "empty";
  if (pane.querySelector(".luke-spinner") !== null) return "spinner";
  if (/Loading agent/u.test(pane.textContent)) return "loading agent";
  const region = pane.querySelector(".agent-tab > .luke-skeleton-region");
  if (region !== null) {
    const blocks = [...region.querySelectorAll(".luke-skeleton")].map(
      (block) => `${block.getAttribute("data-shape")}:${block.getAttribute("style")}`,
    );
    return `skeleton ${blocks.join(" ")}`;
  }
  return pane.querySelector(".agent-tab .conversation-log") === null ? "empty" : "transcript";
}

test("a task opened on an agent whose list is still read follows the agent's transcript at once, its tab standing in its own shape rather than empty or Loading agent", async () => {
  const held = heldFollower();
  const page = mount(opened({ read: true, listed: false, follower: held.follower }));
  await settle();

  assert.deepEqual(held.followed, [AGENT.id], "the transcript is followed before the list answers");
  const log = columnLog(page.container);
  assert.match(log, /^skeleton /u);
  assert.ok(
    page.container.querySelector(".desktop-agent .agent-tab-foot .prompt-input"),
    "the composer's card stands where the composer will",
  );
});

test("opening a task on its agent passes through one placeholder, from the task's read to the transcript, the toolbar's tab, the column, and its composer standing where they land", async () => {
  const held = heldFollower();
  const page = mount(opened({ read: false, listed: false, follower: held.follower }));
  await settle();
  const seen = [columnLog(page.container)];
  const tabBlock = () =>
    page.container.querySelector(".desktop-toolbar-heading .luke-skeleton")?.getAttribute("style");
  const tabWhileRead = tabBlock();

  page.draw(opened({ read: true, listed: false, follower: held.follower }));
  await settle();
  seen.push(columnLog(page.container));
  assert.equal(tabBlock(), tabWhileRead, "the toolbar's tab stands as it stood");

  page.draw(opened({ read: true, listed: true, follower: held.follower }));
  await settle();
  seen.push(columnLog(page.container));
  assert.ok(
    page.container.querySelector(".desktop-agent .agent-composer form"),
    "the composer takes its card's place",
  );

  act(() => held.push(PAGE));
  await settle();
  seen.push(columnLog(page.container));

  const placeholders = [...new Set(seen.filter((each) => each !== "transcript"))];
  assert.equal(placeholders.length, 1, `one placeholder, not a chain: ${placeholders.join(" | ")}`);
  assert.match(placeholders[0] ?? "", /^skeleton /u);
  assert.equal(seen.at(-1), "transcript", "and the transcript in its place once its page lands");
  assert.deepEqual(held.followed, [AGENT.id], "followed once, from the open on");
});

test("the summary's room stands from the open on where the task's row says it has agents, so their list landing moves nothing in the column", async () => {
  const held = heldFollower();
  const page = mount(opened({ read: false, listed: false, follower: held.follower }));
  await settle();
  const room = () => page.container.querySelector(".task-summary")?.getAttribute("data-mode");
  const whileRead = room();
  assert.equal(whileRead, "rail", "the rail's room is kept while the task is read");

  page.draw(opened({ read: true, listed: false, follower: held.follower }));
  await settle();
  assert.equal(room(), whileRead, "and while its agents are");

  page.draw(opened({ read: true, listed: true, follower: held.follower }));
  await settle();
  assert.equal(room(), whileRead, "and once they land");
});
