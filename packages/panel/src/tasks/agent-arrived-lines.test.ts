// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_BRIEF,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentStatus,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handMembers } from "../testing/app-state.js";
import { onRegistry, settleQueries } from "../testing/copy-feedback.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentTab } from "./agent-tab.js";

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };

const ACME: Pick<Workspace, "id" | "memberCount"> = { id: "workspace-acme", memberCount: 1 };

const JOURNAL = "journal";

const REVIEWED = "@devin-ai-integration[bot] reviewed your pull request #3016.";

function agentOf(status: AgentStatus): AgentSummary {
  return {
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Video tile aspect ratio fix",
    createdAt: 1_000,
    status,
    turnId: null,
    brief: AGENT_BRIEF.PROMPT,
    startedBy: DEAN,
  };
}

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

function journal(finished: boolean): AgentTranscriptMessage {
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

const GITHUB_LINE: AgentTranscriptMessage = {
  id: "github",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: REVIEWED }],
  sentBy: { name: "devin-ai-integration[bot]", kind: AGENT_SENDER.GITHUB },
  arrivedIn: { journalId: JOURNAL, afterStep: 2 },
};

const TASK: AgentTranscriptMessage = {
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

async function drawnTab(
  messages: readonly AgentTranscriptMessage[],
  status: AgentStatus,
): Promise<HTMLElement> {
  fakeAppBridge({});
  fakeActPort({});
  handMembers(() => ({
    rows: { members: [{ ...DEAN, email: "dean@example.com", role: WORKSPACE_ROLE.OWNER }] },
  }));
  pushedTranscripts(() => [{ messages: [...messages], cursor: "9:0", status, title: null }]);
  const control = agentsControl({
    agents: [agentOf(status)],
    me: DEAN.userId,
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
  await settleQueries();
  return container;
}

function drawnOrder(container: HTMLElement): readonly string[] {
  return [
    ...container.querySelectorAll(
      ":is(.is-user, .is-received), [data-turn-fold] > summary, [data-call-id]",
    ),
  ].map((element) => {
    if (element.matches(".is-user, .is-received"))
      return `line: ${element.getAttribute("data-message-id")}`;
    if (element.matches("summary")) return `fold: ${element.textContent}`;
    return `call: ${element.getAttribute("data-call-id")}`;
  });
}

function openEveryFold(container: HTMLElement): void {
  for (const line of container.querySelectorAll<HTMLElement>("[data-turn-fold] > summary")) {
    if (line.getAttribute("aria-expanded") === "false") act(() => line.click());
  }
}

test("in a finished turn, a line GitHub sent while it ran splits its fold, the steps before it folded above it and the steps after it below", async () => {
  const container = await drawnTab([TASK, GITHUB_LINE, journal(true)], AGENT_STATUS.COMPLETED);
  const task = "line: task";
  const github = "line: github";

  assert.deepEqual(drawnOrder(container), [task, "fold: 2 tool calls", github, "call: c"]);

  openEveryFold(container);
  assert.deepEqual(drawnOrder(container), [
    task,
    "fold: 2 tool calls",
    "call: a",
    "call: b",
    github,
    "call: c",
  ]);
});

test("in a turn still running, a line GitHub sent stands between the steps before it and the steps after it", async () => {
  const container = await drawnTab([TASK, journal(false), GITHUB_LINE], AGENT_STATUS.RUNNING);
  openEveryFold(container);

  assert.deepEqual(drawnOrder(container), [
    "line: task",
    "fold: 2 tool calls",
    "call: a",
    "call: b",
    "line: github",
    "fold: 1 tool call",
    "call: c",
  ]);
});

test("a line from a service that kept no place for it stands where the order puts it, ahead of the turn", async () => {
  const { arrivedIn: _place, ...older } = GITHUB_LINE;
  const container = await drawnTab([TASK, older, journal(true)], AGENT_STATUS.COMPLETED);

  assert.deepEqual(drawnOrder(container), ["line: task", "line: github", "fold: 3 tool calls"]);
});

test("a line sent to steer a turn still running stands inside the turn, which stays under way, before the service says where it arrived", async () => {
  const steer: AgentTranscriptMessage = {
    id: "steer",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Keep the 16:9 ratio." }],
    sentAt: 5_000,
  };
  const writing = {
    ...journal(false),
    parts: [...journal(false).parts, { type: "text", text: "Checking the ratio." }],
  };
  const container = await drawnTab([TASK, writing, steer], AGENT_STATUS.RUNNING);

  assert.equal(drawnOrder(container).at(-1), "line: steer", "at the turn's end");
  assert.equal(
    container.querySelector('button[aria-label="Revert to here"]'),
    null,
    "the turn under way offers no end's actions",
  );
});
