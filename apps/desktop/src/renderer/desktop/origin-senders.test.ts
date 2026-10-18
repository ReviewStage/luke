// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import type { Task } from "@luke/features/task-wire";
import { MAIN_TAB, type MainTab } from "@luke/panel/tasks/use-main-tabs";
import { NO_LOOKS } from "@luke/panel/tasks/use-task-looks";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "#testing/tasks-control";
import type { SidePanelTab } from "../tasks/use-side-panel";
import { DesktopTasks } from "./desktop-tasks";

/**
 * origin-senders.test.ts -- in a task's column, an agent's tab opens on its
 * plan as a message the task sent: the task's name under the card, which
 * opens the plan, with the teammate who started the agent beside it and
 * never the reader; and a worker's tab in the side panel opens on its task
 * as a message the agent that delegated it sent, whose name opens that
 * agent's tab. Synthetic throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };

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
  startedBy: CHARLES,
};

/** When the plan was handed to the agent. */
const BRIEF_SENT_AT = Date.UTC(2026, 9, 14, 16, 5);

const BRIEF: CodingAgentMessage = {
  id: "brief",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "# Teammate invitations\n\nExpire invites after seven days." }],
  sentAt: BRIEF_SENT_AT,
};

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The plan's page as `reader` sees it, `main` chosen in its column and `side` in its panel, every tab the column is asked to show recorded. */
async function mount(input: {
  reader: string;
  main: MainTab;
  side?: SidePanelTab | undefined;
}): Promise<{ container: HTMLElement; chosen: MainTab[] }> {
  const chosen: MainTab[] = [];
  // Note that only the first read answers, because a read past the cursor waits on the service.
  const read = new Set<string>();
  const control = tasksControl({
    me: input.reader,
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: [MAIN_TAB.PLAN, { agent: AGENT.id }],
      tab: input.main,
      openAgents: [AGENT.id],
      onChoose: (tab) => chosen.push(tab),
    },
    sidePanel: {
      ...tasksControl().sidePanel,
      open: input.side !== undefined,
      subagents: [{ subagent: "call-1", delegation: { agent: AGENT.id, task: "Audit retries" } }],
      tab: input.side,
    },
    agents: codingAgentsControl({
      agents: [AGENT],
      agentIds: [AGENT.id],
      me: input.reader,
      readTranscript: ({ callId }): Promise<CodingAgentMessagesAnswerView> => {
        const key = callId ?? "agent";
        if (read.has(key)) {
          return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
        }
        read.add(key);
        return Promise.resolve({
          messages: callId === undefined ? [BRIEF] : [],
          cursor: "1:0",
          status: CODING_AGENT_STATUS.COMPLETED,
          title: null,
        });
      },
    }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          captions: undefined,
          tasks: control,
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return { container, chosen };
}

/** What a line says, its actors' faces left out, as a reader reads it. */
function words(line: Element | null | undefined): string {
  if (line == null) return "";
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let said = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.parentElement?.closest(".actor-mark") == null) said += node.textContent ?? "";
  }
  return said;
}

/** The line under the card a transcript opens on, in `place`. */
function senderLine(place: Element): HTMLElement {
  return (
    place.querySelector<HTMLElement>(".agent-origin .message-sender") ??
    assert.fail("the card is named by who sent it")
  );
}

test("a task's agent opens on its plan sent by the task, which opens the plan, with the teammate who started the agent", async () => {
  const { container, chosen } = await mount({ reader: DEAN.userId, main: { agent: AGENT.id } });

  const line = senderLine(container);
  assert.equal(words(line), "Teammate invitations · started by Charles Pan");
  const task = line.querySelector<HTMLButtonElement>("[data-task-ref]");
  assert.ok(task, "the task's name is a press");
  act(() => task.click());

  assert.deepEqual(chosen, [MAIN_TAB.PLAN]);
});

test("the reader's own agent opens on its plan sent by the task alone, never by them", async () => {
  const { container } = await mount({ reader: CHARLES.userId, main: { agent: AGENT.id } });

  assert.equal(words(senderLine(container)), "Teammate invitations");
});

test("the line naming who sent the plan stands under its card, then when it was sent, as a sent message's stands under its bubble", async () => {
  const { container } = await mount({ reader: DEAN.userId, main: { agent: AGENT.id } });

  const card =
    container.querySelector<HTMLElement>(".agent-origin [data-task-card]") ??
    assert.fail("the page opens on its card");
  const line = senderLine(container);
  assert.ok(
    card.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the sender's line follows the card",
  );
  const meta = line.closest(".message-meta") ?? assert.fail("the sender's line is the card's meta");
  const time = meta.querySelector("time") ?? assert.fail("the meta says when the plan was sent");
  assert.equal(time.getAttribute("datetime"), new Date(BRIEF_SENT_AT).toISOString());
  assert.ok(
    line.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the time follows who sent it",
  );
});

test("a worker's tab opens on its task sent by the agent that delegated it, whose name opens that agent's tab", async () => {
  const { container, chosen } = await mount({
    reader: DEAN.userId,
    main: MAIN_TAB.PLAN,
    side: { subagent: "call-1", delegation: { agent: AGENT.id, task: "Audit retries" } },
  });

  const panel = container.querySelector(".desktop-side-panel") ?? container;
  const parent = senderLine(panel).querySelector<HTMLButtonElement>("[data-actor-ref]");
  assert.equal(words(parent), "Invite expiry job");
  assert.equal(parent?.dataset.kind, "agent");
  act(() => parent?.click());

  assert.deepEqual(chosen, [{ agent: AGENT.id }]);
});
