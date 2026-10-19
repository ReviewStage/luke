// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { MemberDirectory } from "@luke/panel/member-directory";
import { AgentTab } from "@luke/panel/tasks/agent-tab";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { codingAgentsControl } from "#testing/tasks-control";

/**
 * agent-arrived-lines.test.ts -- in an agent's tab, a message that reached
 * the agent while its turn ran, GitHub's among them, is drawn where it
 * arrived, between the steps before it and the steps after it, rather than
 * ahead of the turn: in a finished turn it splits the fold, the work before
 * it folded above it and the work after it below, and in a turn still
 * running it stands between the work. The service keeps such a line ahead
 * of the turn's journal, which closes behind every line its turn took, so
 * the tab reads where the line arrived off the line itself; a line from a
 * service older than that stands where the order puts it.
 * Synthetic throughout.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };

const ACME: Pick<Workspace, "id" | "memberCount"> = { id: "workspace-acme", memberCount: 1 };

const JOURNAL = "journal";

/** The words GitHub's line says, as a review on the agent's pull request reaches it. */
const REVIEWED = "@devin-ai-integration[bot] reviewed your pull request #3016.";

function agentOf(status: CodingAgentStatus): CodingAgentSummary {
  return {
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Video tile aspect ratio fix",
    createdAt: 1_000,
    status,
    turnId: null,
    brief: CODING_AGENT_BRIEF.PROMPT,
    startedBy: DEAN,
  };
}

/** One answered command the agent ran, under its own call id. */
function ran(callId: string): WireRecord {
  return {
    type: "tool-run_command",
    toolCallId: callId,
    state: "output-available",
    input: { command: `pnpm ${callId}` },
    output: { exitCode: 0, stdout: "", stderr: "" },
  };
}

const STEP: WireRecord = { type: "step-start" };

/** The turn's journal: a command a step, A, B, then C, and its last words once it has finished. */
function journal(finished: boolean): CodingAgentMessage {
  return {
    id: JOURNAL,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      STEP,
      ran("a"),
      STEP,
      ran("b"),
      STEP,
      ran("c"),
      ...(finished ? [STEP, { type: "text", text: "Fixed the tile." }] : []),
    ],
    startedAt: 2_000,
    ...(finished ? { finishedAt: 9_000 } : undefined),
  };
}

/** GitHub's line, which the turn took in after its second step. */
const GITHUB_LINE: CodingAgentMessage = {
  id: "github",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: REVIEWED }],
  sentBy: { name: "devin-ai-integration[bot]", kind: CODING_AGENT_SENDER.GITHUB },
  arrivedIn: { journalId: JOURNAL, afterStep: 2 },
};

const TASK: CodingAgentMessage = {
  id: "task",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "Make the video tile look good at any width." }],
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  fakeAppBridge({});
});

/** The tab drawn over one page of `messages`, as the service answers it for an agent of `status`. */
async function drawnTab(
  messages: readonly CodingAgentMessage[],
  status: CodingAgentStatus,
): Promise<HTMLElement> {
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> =>
      Promise.resolve(
        request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
          ? {
              status: ACT_OUTCOME_STATUS.DONE,
              value: [{ ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER }],
            }
          : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
      ),
  });
  // Note that only the first read answers, because a read past the cursor waits on the service, and one answered at once would be read again without end.
  let reads = 0;
  const control = codingAgentsControl({
    agents: [agentOf(status)],
    me: DEAN.userId,
    readTranscript: (): Promise<CodingAgentMessagesAnswerView> => {
      reads += 1;
      if (reads > 1) return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      return Promise.resolve({ messages: [...messages], cursor: "9:0", status, title: null });
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MemberDirectory, {
          workspace: ACME,
          readerId: DEAN.userId,
          children: createElement(AgentTab, {
            agent: agentOf(status),
            control,
            shown: true,
            onOpenSubagent: () => undefined,
            onHeld: () => undefined,
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** What the tab draws, top to bottom: each of the developer's lines by its id, each fold's line, and each call by its id. */
function drawnOrder(container: HTMLElement): readonly string[] {
  return [
    ...container.querySelectorAll(".is-user, [data-turn-fold] > summary, [data-call-id]"),
  ].map((element) => {
    if (element.classList.contains("is-user"))
      return `line: ${element.getAttribute("data-message-id")}`;
    if (element.matches("summary")) return `fold: ${element.textContent}`;
    return `call: ${element.getAttribute("data-call-id")}`;
  });
}

/** Opens every closed fold of the turn, outermost first, as a reader pressing each line would. */
function openEveryFold(container: HTMLElement): void {
  for (const line of container.querySelectorAll<HTMLElement>("[data-turn-fold] > summary")) {
    if (line.getAttribute("aria-expanded") === "false") act(() => line.click());
  }
}

test("in a finished turn, a line GitHub sent while it ran splits its fold, the steps before it folded above it and the steps after it below", async () => {
  // The service keeps the line ahead of the journal, which closed behind it.
  const container = await drawnTab(
    [TASK, GITHUB_LINE, journal(true)],
    CODING_AGENT_STATUS.COMPLETED,
  );
  const task = "line: task";
  const github = "line: github";

  assert.deepEqual(drawnOrder(container), [
    task,
    "fold: 2 tool calls",
    github,
    "fold: 1 tool call",
  ]);

  openEveryFold(container);
  assert.deepEqual(drawnOrder(container), [
    task,
    "fold: 2 tool calls",
    "call: a",
    "call: b",
    github,
    "fold: 1 tool call",
    "call: c",
  ]);
});

test("in a turn still running, a line GitHub sent stands between the steps before it and the steps after it", async () => {
  const container = await drawnTab(
    [TASK, journal(false), GITHUB_LINE],
    CODING_AGENT_STATUS.RUNNING,
  );
  openEveryFold(container);

  assert.deepEqual(drawnOrder(container), [
    "line: task",
    "fold: 2 tools called",
    "call: a",
    "call: b",
    "line: github",
    "fold: 1 tool called",
    "call: c",
  ]);
});

test("a line from a service that kept no place for it stands where the order puts it, ahead of the turn", async () => {
  const { arrivedIn: _place, ...older } = GITHUB_LINE;
  const container = await drawnTab([TASK, older, journal(true)], CODING_AGENT_STATUS.COMPLETED);

  assert.deepEqual(drawnOrder(container), ["line: task", "line: github", "fold: 3 tool calls"]);
});
