// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { MESSAGE_ROLE } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { codingAgentsControl } from "#testing/tasks-control";
import { AGENT_LEAD, AgentMessage, AgentTab } from "./agent-tab";
import { agentForkDoors, ForkProvider } from "./fork-action";
import type { AgentFork } from "./fork-model";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";

/**
 * fork-action.test.ts -- Fork to new agent stands on an agent's own settled
 * messages, on a tab of a task that is not archived and that opens a
 * draft, and nowhere else; its press forks at that message; and under each
 * message a line names the agents forked at it, each opening its tab.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SOURCE = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const TURN = "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b";
const FORK_LABEL = "Fork to new agent";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  fakeAppBridge({});
});

function summary(id: string, extra: Partial<CodingAgentSummary> = {}): CodingAgentSummary {
  return {
    id,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    ...extra,
  };
}

const SETTLED: CodingAgentMessage = {
  id: TURN,
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [{ type: "text", text: "I moved the invite email to the queue and added a retry." }],
  startedAt: 1_000,
  finishedAt: 61_000,
};

/** The message drawn in an agent's tab handing it forking as `doors` builds it, or as a place handing none, every fork and opening recorded. */
function drawn(input: {
  message?: CodingAgentMessage;
  moving?: boolean;
  agent?: CodingAgentSummary;
  listed?: readonly CodingAgentSummary[];
  archivedAgents?: readonly CodingAgentSummary[];
  taskArchived?: boolean;
  opensDraft?: boolean;
  provided?: boolean;
}) {
  const forks: AgentFork[] = [];
  const opened: ToolTarget[] = [];
  const agent = input.agent ?? summary(SOURCE);
  const control = codingAgentsControl({
    agents: input.listed ?? [agent],
    archived: input.archivedAgents ?? [],
    onUnarchive: input.taskArchived === true ? () => undefined : undefined,
  });
  const message = createElement(AgentMessage, {
    message: input.message ?? SETTLED,
    plan: false,
    lead: AGENT_LEAD,
    moving: input.moving ?? false,
    delegation: { models: [] },
  });
  const doors = agentForkDoors({
    agent,
    control,
    onFork: input.opensDraft === false ? undefined : (fork) => forks.push(fork),
    cards: undefined,
    onOpenTarget: (target) => opened.push(target),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      input.provided === false ? message : createElement(ForkProvider, { value: doors }, message),
    ),
  );
  const fork = container.querySelector<HTMLButtonElement>(`button[aria-label="${FORK_LABEL}"]`);
  return { container, fork, forks, opened };
}

test("an agent's own settled message offers Fork to new agent after Copy, and its press forks at that message, quoting its opening words", () => {
  const view = drawn({});
  assert.ok(view.fork, "the action is drawn");
  const labels = [...view.container.querySelectorAll("button[aria-label]")].map((each) =>
    each.getAttribute("aria-label"),
  );
  assert.deepEqual(labels.slice(-2), ["Copy", FORK_LABEL], "it stands after Copy");
  act(() => view.fork?.click());
  assert.deepEqual(view.forks, [
    { agentId: SOURCE, messageId: TURN, opening: "I moved the invite email to the queue…" },
  ]);
});

test("no fork is offered on the developer's message, the message still being written, a task archived, an agent on no task, a place that opens no draft, or a tab that hands none, as a worker's", () => {
  const developers: CodingAgentMessage = {
    id: "line-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Use the queue." }],
  };
  const cases = {
    "the developer's message": drawn({ message: developers }),
    "the message still being written": drawn({ moving: true }),
    "a task archived": drawn({ taskArchived: true }),
    "an agent on no task": drawn({ agent: summary(SOURCE, { planId: null }) }),
    "a place that opens no draft": drawn({ opensDraft: false }),
    "a worker's tab": drawn({ provided: false }),
  };
  for (const [name, view] of Object.entries(cases)) {
    assert.equal(view.fork, null, `${name} offers no fork`);
  }
  assert.ok(
    cases["the developer's message"].container.querySelector('button[aria-label="Copy"]'),
    "the developer's message keeps its Copy",
  );
});

test("under a message, Forked to names the agents of the task forked at it in the order started, each opening its tab, an archived one named alone", () => {
  const from = { agentId: SOURCE, messageId: TURN, steps: 2, totalSteps: 3 };
  const listed = [
    summary(SOURCE),
    summary("fork-b", { title: "Try the cron", createdAt: 30, from }),
    summary("continued", {
      title: "Continue",
      createdAt: 40,
      from: { agentId: SOURCE, steps: 3, totalSteps: 3 },
    }),
  ];
  const archived = [
    summary("fork-a", { title: "Try the queue", createdAt: 20, from, archivedAt: 50 }),
  ];
  const view = drawn({ listed, archivedAgents: archived, taskArchived: true });

  const line = view.container.querySelector("[data-forked-to]");
  assert.equal(line?.textContent, "Forked toTry the queue,Try the cron");
  const chips = [...(line?.querySelectorAll<HTMLElement>(".actor-ref") ?? [])];
  assert.deepEqual(
    chips.map((chip) => chip.tagName),
    ["SPAN", "BUTTON"],
    "the archived fork is named alone; the standing one opens",
  );
  act(() => chips[1]?.click());
  assert.deepEqual(view.opened, [{ kind: TOOL_TARGET.AGENT, agent: "fork-b" }]);
});

test("a message no agent was forked at names none", () => {
  const view = drawn({ listed: [summary(SOURCE), summary("other", { createdAt: 2 })] });
  assert.equal(view.container.querySelector("[data-forked-to]"), null);
});

/** An agent's reply as its transcript carries it, its words whole or still being written. */
function reply(id: string, text: string): CodingAgentMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, { type: "text", text }],
    startedAt: 2_000,
    finishedAt: 9_000,
  };
}

function line(id: string, text: string): CodingAgentMessage {
  return { id, role: MESSAGE_ROLE.USER, parts: [{ type: "text", text }] };
}

/** The ids of the messages an agent's tab offers to fork at, over a page of `messages`, for an agent of `status`. */
async function forkedAtInTab(
  status: CodingAgentStatus,
  messages: readonly CodingAgentMessage[],
): Promise<readonly (string | null)[]> {
  fakeAppBridge({
    recordSurfaceEvent: () => undefined,
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
  const agent = summary(SOURCE, { status, brief: CODING_AGENT_BRIEF.PROMPT });
  // Note that only the first read answers, because a read past the cursor waits on the service.
  let reads = 0;
  const control = codingAgentsControl({
    agents: [agent],
    readTranscript: (): Promise<CodingAgentMessagesAnswerView> => {
      reads += 1;
      if (reads > 1) return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      return Promise.resolve({ messages: [...messages], cursor: "2:0", status, title: null });
    },
  });
  const forks: AgentFork[] = [];
  const doors = agentForkDoors({
    agent,
    control,
    onFork: (fork) => forks.push(fork),
    cards: undefined,
    onOpenTarget: undefined,
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        ForkProvider,
        { value: doors },
        createElement(AgentTab, {
          agent,
          control,
          shown: true,
          onOpenSubagent: () => undefined,
          onHeld: () => undefined,
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  for (const button of container.querySelectorAll<HTMLButtonElement>(
    `button[aria-label="${FORK_LABEL}"]`,
  )) {
    act(() => button.click());
  }
  return forks.map((fork) => fork.messageId);
}

test("while an agent works, the newest of its replies, which the running turn may still be writing, offers no fork, and every earlier one does; once it settles, every reply does", async () => {
  const LATEST = "6b3a4f5e-7d8c-4b9a-8c3d-4e5f6a7b8c9d";
  const settled = [
    line("task", "Queue the invite email."),
    reply(TURN, "Moved it onto the queue."),
    line("line-1", "Now add a retry."),
    reply(LATEST, "Adding the retry"),
  ];

  for (const working of [CODING_AGENT_STATUS.RUNNING, CODING_AGENT_STATUS.STARTING]) {
    assert.deepEqual(
      await forkedAtInTab(working, settled),
      [TURN],
      `${working}: the newest reply is open`,
    );
  }
  assert.deepEqual(await forkedAtInTab(CODING_AGENT_STATUS.COMPLETED, settled), [TURN, LATEST]);
  // A turn that has not written a reply of its own yet may still be writing to the newest one there is.
  assert.deepEqual(
    await forkedAtInTab(CODING_AGENT_STATUS.RUNNING, [
      line("task", "Queue the invite email."),
      reply(TURN, "Moved it onto the queue."),
      line("line-1", "Now add a retry."),
    ]),
    [],
  );
});
