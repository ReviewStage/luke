// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { Task } from "@luke/features/task-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { followedInboxes } from "../testing/followed-inboxes.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import {
  codingAgentsControl,
  pushedTranscripts,
  tasksControl,
  UNPINNED_SUMMARY,
} from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

/**
 * inbox-call-item.test.ts -- in a task's column, the row of an agent's
 * post to the inbox opens the task's Inbox on the item it posted, the
 * thread under its key of that agent's, rather than on whatever the Inbox
 * had chosen, though another agent posted under the same key. Synthetic
 * throughout.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/web",
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

const OTHER_AGENT = "4d2f1c7e-9a3b-4e8d-b1c6-2f7a8e9d0b13";

/** The agent's turn: one post to the inbox under the key `invite-ttl`, answered. */
const POSTED: CodingAgentMessage = {
  id: "turn",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    {
      type: "tool-post_to_inbox",
      toolCallId: "call-post",
      state: "output-available",
      input: { key: "invite-ttl", title: "Invite links expire after 7 days or 14?", body: "?" },
      output: { status: "accepted", inbox: [] },
    },
  ],
};

/** An open item asking a decision, posted by `agentId` under `key` at `at`. */
function item(id: string, agentId: string, key: string, title: string, at: number): InboxItem {
  return {
    id,
    agentId,
    key,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    thread: [
      {
        id: `m${id.slice(1)}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Which one?",
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Yes" }, { label: "No" }],
          status: INBOX_ASK_STATUS.OPEN,
        },
        createdAt: at,
      },
    ],
    postedAt: at,
    updatedAt: at,
  };
}

/** Newest first: another of the agent's items, the other agent's under the same key, then the one the row posted. */
const ITEMS: readonly InboxItem[] = [
  item("a1b2c3d4-0000-4000-8000-000000000001", AGENT.id, "smtp", "Which SMTP host?", 30),
  item("a1b2c3d4-0000-4000-8000-000000000002", OTHER_AGENT, "invite-ttl", "Someone else's", 20),
  item("a1b2c3d4-0000-4000-8000-000000000003", AGENT.id, "invite-ttl", "Invite TTL", 10),
];

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The task's page, the agent's tab in its column and the Inbox in its side panel, wide enough for the list and the item side by side. */
async function mount(): Promise<HTMLElement> {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 1200, height: 800 }),
  );
  const inboxes = followedInboxes(() => ({ items: ITEMS }));
  const control = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: [{ agent: AGENT.id }],
      tab: { agent: AGENT.id },
      openAgents: [AGENT.id],
    },
    sidePanel: {
      ...tasksControl().sidePanel,
      open: true,
      tabs: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX],
      strip: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX],
      tab: SIDE_PANEL_TAB.INBOX,
    },
    agents: codingAgentsControl({
      agents: [AGENT],
      agentIds: [AGENT.id, OTHER_AGENT],
      inboxFollower: inboxes.follower,
      transcripts: pushedTranscripts(() => [
        { messages: [POSTED], cursor: "1:0", status: CODING_AGENT_STATUS.COMPLETED, title: null },
      ]),
    }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks: control }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** The title of the item the task's Inbox shows. */
function shownTitle(container: HTMLElement): string | null | undefined {
  return container.querySelector("section.inbox-view [data-inbox-title]")?.textContent;
}

test("a post's row opens the task's Inbox on the item the agent posted under its key, not the item chosen before, nor another agent's under the same key", async () => {
  const container = await mount();
  assert.equal(shownTitle(container), "Which SMTP host?", "the Inbox stands on its newest item");

  const row =
    container.querySelector<HTMLButtonElement>('button[data-call-id="call-post"]') ??
    assert.fail("the post's row is a press");
  act(() => row.click());
  await act(async () => undefined);

  assert.equal(shownTitle(container), "Invite TTL");
});
