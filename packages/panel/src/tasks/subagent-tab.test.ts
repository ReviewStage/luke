// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { WireRecord } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { taskCards } from "../desktop/side-panel.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { codingAgentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { NOTHING_HELD } from "./agent-ref.js";
import { AgentSubagentTab } from "./agent-tab.js";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model.js";

/**
 * subagent-tab.test.ts -- a worker's tab folds its calls as its agent's
 * tab does: a run of calls under one line while the worker works, and a
 * finished run's lead under one line ahead of its last words. Its rows open
 * and hang what an agent's rows do, and a worker of its own, which has no
 * tab, folds open on its task. Synthetic throughout.
 */

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "CSV export",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: null,
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** One stored tool part, answered where `output` is given and still running where not. */
function toolPart(tool: string, callId: string, input: WireRecord, output?: WireRecord) {
  return {
    type: `tool-${tool}`,
    toolCallId: callId,
    state: output === undefined ? "input-available" : "output-available",
    input,
    ...(output === undefined ? undefined : { output }),
  };
}

/** Another agent on the task, which a worker's call may be about. */
const TEAMMATE: CodingAgentSummary = {
  ...AGENT,
  id: "3f9d2b7e-6a41-4c58-9e0d-2b8c5a1f7d64",
  title: "Invoice export",
};

/** The worker's tab once its one page is read, the worker standing at `status`, opening what its rows name through `opens` where handed. */
async function workerTab(
  status: CodingAgentStatus,
  parts: readonly WireRecord[],
  opened: { task: string; first?: string; later?: string } = { task: "Audit the CSV writers" },
  opens?: (target: ToolTarget) => void,
): Promise<HTMLElement> {
  const agents = [AGENT, TEAMMATE];
  const cards = taskCards({
    agents: codingAgentsControl({ agents }),
    held: NOTHING_HELD,
    chosen: () => false,
    shownCode: [],
    pages: undefined,
  });
  const control = codingAgentsControl({
    agents,
    transcripts: pushedTranscripts(() => [
      {
        messages: [
          ...(opened.first === undefined
            ? []
            : [
                {
                  id: "worker-task",
                  role: "user" as const,
                  parts: [{ type: "text", text: opened.first }],
                },
              ]),
          { id: "worker-turn", role: "assistant", parts: [...parts] },
          ...(opened.later === undefined
            ? []
            : [
                {
                  id: "worker-later",
                  role: "user" as const,
                  parts: [{ type: "text", text: opened.later }],
                },
              ]),
        ],
        cursor: "1:0",
        status,
        title: null,
      },
    ]),
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentSubagentTab, {
          agentId: AGENT.id,
          callId: "delegation-call",
          task: opened.task,
          status,
          control,
          shown: true,
          onStatus: () => undefined,
          onHeld: () => undefined,
          ...(opens === undefined
            ? undefined
            : { onOpenTarget: opens, cards: cards.agent(AGENT.id) }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** The words of every call's row drawn in the tab, open folds and all. */
function callRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-turn-fold] summary")]
    .slice(1)
    .map((row) => row.textContent ?? "");
}

test("a worker still working draws its run of calls under one line, open on its calls", async () => {
  const container = await workerTab(CODING_AGENT_STATUS.RUNNING, [
    toolPart("grep", "grep-call", { pattern: "toCsv" }, { content: "2 matches" }),
    toolPart("bash", "test-call", { command: "pnpm test" }),
  ]);

  const group = container.querySelector("[data-turn-fold] > summary");
  assert.equal(group?.textContent, "2 tools called");
  assert.equal(group?.getAttribute("aria-expanded"), "true");
  assert.deepEqual(callRows(container), ["Searched toCsv", "Ran pnpm test"]);
});

test("a worker that finished folds its lead under one line, its last words standing after it", async () => {
  const container = await workerTab(CODING_AGENT_STATUS.COMPLETED, [
    toolPart("grep", "grep-call", { pattern: "toCsv" }, { content: "2 matches" }),
    toolPart("read_file", "read-call", { filePath: "src/csv.ts" }, { content: "export {}" }),
    { type: "text", text: "Both writers quote fields the same way." },
  ]);

  const fold = container.querySelector<HTMLElement>("[data-turn-fold] > summary");
  assert.equal(fold?.textContent, "2 tool calls");
  assert.equal(fold?.getAttribute("aria-expanded"), "false");
  assert.ok(container.textContent?.includes("Both writers quote fields the same way."));
  act(() => fold?.click());
  assert.deepEqual(callRows(container), ["Searched toCsv", "Read src/csv.ts"]);
});

test("in a worker's transcript, a call about an agent opens its tab, and an agent's chip hangs its card", async () => {
  const opened: ToolTarget[] = [];
  const container = await workerTab(
    CODING_AGENT_STATUS.RUNNING,
    [
      toolPart("read_coding_agent", "read-call", { agentId: TEAMMATE.id }, { status: "running" }),
      toolPart(
        "message_agent",
        "message-call",
        { agentId: TEAMMATE.id, text: "Rebase on main" },
        { status: "accepted" },
      ),
    ],
    undefined,
    (target) => opened.push(target),
  );

  const row = container.querySelector<HTMLElement>('button[data-call-id="read-call"]');
  assert.ok(row, "the call's row opens the agent's tab");
  act(() => row.click());
  assert.deepEqual(opened, [{ kind: TOOL_TARGET.AGENT, agent: TEAMMATE.id }]);
  const chip = container.querySelector('[data-call-id="message-call"] [data-tool-agent-ref]');
  restOn(chip ?? assert.fail("the message's agent chip"));
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Invoice export");
});

test("in a worker's transcript, a worker of its own, which opens no tab, folds open on its job's task and answer", async () => {
  const container = await workerTab(
    CODING_AGENT_STATUS.RUNNING,
    [
      toolPart(
        "delegate",
        "nested-call",
        { task: "Check the retry timeouts" },
        { result: "Every timeout is 30s." },
      ),
    ],
    undefined,
    () => undefined,
  );

  const line = container.querySelector<HTMLElement>(
    '[data-subagent-row][data-call-id="nested-call"]',
  );
  assert.ok(line, "the worker's line is drawn");
  assert.notEqual(line.tagName, "BUTTON", "no tab reads a worker's own worker");
  assert.match(line.textContent ?? "", /Check the retry timeouts/u);
  act(() => line.click());
  assert.match(container.textContent ?? "", /Every timeout is 30s\./u);
});

test("a worker opened by its link, which carries no task's words, draws the task its own first row says, and no later task as the developer's", async () => {
  const container = await workerTab(CODING_AGENT_STATUS.COMPLETED, [], {
    task: "",
    first: "Audit retries.",
    later: "Also check the timeouts.",
  });

  assert.match(container.textContent ?? "", /Audit retries\./u);
  assert.equal(container.querySelectorAll(".is-user:not(.agent-origin)").length, 0);
});

test("a worker opened by its link whose own first row has no words still draws its work", async () => {
  const container = await workerTab(
    CODING_AGENT_STATUS.COMPLETED,
    [{ type: "text", text: "Both writers quote fields the same way." }],
    { task: "", first: "" },
  );

  assert.match(container.textContent ?? "", /Both writers quote fields the same way\./u);
});

test("a worker's tab whose earlier messages could not be read says so over its log, and Retry reads them again", async () => {
  const asked: unknown[] = [];
  fakeActPort({
    [ACT_KIND.CODING_AGENTS_TRANSCRIPT_OLDER]: (payload: unknown) => {
      asked.push(payload);
      return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    },
  } as unknown as Parameters<typeof fakeActPort>[0]);
  const control = codingAgentsControl({
    agents: [AGENT],
    transcripts: pushedTranscripts(() => [
      {
        messages: [
          { id: "worker-turn", role: "assistant", parts: [{ type: "text", text: "Done." }] },
        ],
        cursor: "1:0",
        status: CODING_AGENT_STATUS.COMPLETED,
        title: null,
        newest: true,
        before: "40",
        caughtUp: true,
      },
    ]),
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const settle = () =>
    act(async () => {
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentSubagentTab, {
          agentId: AGENT.id,
          callId: "delegation-call",
          task: "Audit the CSV writers",
          status: CODING_AGENT_STATUS.COMPLETED,
          control,
          shown: true,
          onStatus: () => undefined,
          onHeld: () => undefined,
        }),
      ),
    ),
  );
  await settle();
  // A log its lines do not fill asks for the earlier ones at once.
  assert.equal(asked.length, 1);
  assert.ok(container.textContent?.includes("Earlier messages could not be read."));
  const retry = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Retry"),
  );
  assert.ok(retry, "the line offers Retry");
  act(() => retry.click());
  await settle();
  assert.equal(asked.length, 2);
});
