// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@repo/features/inbox-wire";
import type { LinkPlace, ReadLink } from "@repo/features/link-grammar";
import type { Task } from "@repo/features/task-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import { MESSAGE_ROLE } from "@repo/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { OpenLinkProvider } from "../tasks/use-open-link.js";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { handInboxItems } from "../testing/app-state.js";
import { onRegistry, settleQueries } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import {
  agentsControl,
  pushedTranscripts,
  tasksControl,
  UNPINNED_SUMMARY,
} from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/web",
  document: { body: "", assumptions: [] },
};

const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry job",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
};

const OTHER_AGENT = "4d2f1c7e-9a3b-4e8d-b1c6-2f7a8e9d0b13";

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

const ITEMS: readonly InboxItem[] = [
  item("a1b2c3d4-0000-4000-8000-000000000001", AGENT.id, "smtp", "Which SMTP host?", 30),
  item("a1b2c3d4-0000-4000-8000-000000000002", OTHER_AGENT, "invite-ttl", "Someone else's", 20),
  item("a1b2c3d4-0000-4000-8000-000000000003", AGENT.id, "invite-ttl", "Invite TTL", 10),
];

const POSTED: AgentTranscriptMessage = {
  id: "turn",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    {
      type: "tool-post_to_inbox",
      toolCallId: "call-post",
      state: "output-available",
      input: { key: "invite-ttl", title: "Invite links expire after 7 days or 14?", body: "?" },
      output: {
        status: "accepted",
        inbox: [ITEMS[0], ITEMS[2]].flatMap((posted) =>
          posted === undefined ? [] : [{ id: posted.id, key: posted.key }],
        ),
      },
    },
  ],
};

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mount(onOpen: (link: ReadLink) => void): Promise<HTMLElement> {
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
  handInboxItems({
    rows: { [INBOX_SCOPE_KIND.PLAN]: { [TASK.id]: ITEMS }, [INBOX_SCOPE_KIND.AGENT]: {} },
  });
  pushedTranscripts(() => [
    { messages: [POSTED], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
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
      tabs: [SIDE_PANEL_TAB.DESCRIPTION, SIDE_PANEL_TAB.INBOX],
      strip: [SIDE_PANEL_TAB.DESCRIPTION, SIDE_PANEL_TAB.INBOX],
      tab: SIDE_PANEL_TAB.INBOX,
    },
    agents: agentsControl({
      agents: [AGENT],
      agentIds: [AGENT.id, OTHER_AGENT],
    }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(OpenLinkProvider, {
          value: onOpen,
          children: createElement(DesktopTasks, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            tasks: control,
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();
  return container;
}

test("a post's chip opens the item the agent posted under its key, not another agent's under the same key", async () => {
  const opened: LinkPlace[] = [];
  const container = await mount((link) => opened.push(link.place));

  const chip =
    container.querySelector<HTMLElement>('[data-call-id="call-post"] summary [data-mention-ref]') ??
    assert.fail("the post's row names the thread by its chip");
  act(() => chip.click());

  assert.deepEqual(opened, [
    {
      kind: "inbox-item",
      agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
      itemId: "a1b2c3d4-0000-4000-8000-000000000003",
    },
  ]);
});
