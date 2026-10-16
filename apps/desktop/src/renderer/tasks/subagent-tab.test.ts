// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import type { WireRecord } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/tasks-control";
import { AgentSubagentTab } from "./agent-tab";

/**
 * subagent-tab.test.ts -- a worker's tab folds its calls as its agent's
 * tab does: a run of calls under one line while the worker works, and a
 * finished run's lead under one line ahead of its last words. Synthetic
 * throughout.
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

/** The worker's tab once its one page is read, the worker standing at `status`. */
async function workerTab(
  status: CodingAgentStatus,
  parts: readonly WireRecord[],
  opened: { task: string; first?: string; later?: string } = { task: "Audit the CSV writers" },
): Promise<HTMLElement> {
  // Note that only the first read answers, because a read past the cursor waits on the service, and one answered at once would be read again without end.
  let reads = 0;
  const control = codingAgentsControl({
    agents: [AGENT],
    readTranscript: (): Promise<CodingAgentMessagesAnswerView> => {
      reads += 1;
      if (reads > 1) return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      return Promise.resolve({
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
      });
    },
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
