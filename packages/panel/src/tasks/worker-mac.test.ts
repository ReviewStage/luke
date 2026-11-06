// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry, settleQueries } from "../testing/copy-feedback.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentSubagentTab } from "./agent-tab.js";

const DEAN = "user-dean";
const CHARLES = { userId: "user-charles", name: "Charles Pan" };

const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite flow",
  createdAt: 1_000,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  startedBy: CHARLES,
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function workerTabFor(reader: string): Promise<string> {
  pushedTranscripts(() => [
    {
      messages: [
        {
          id: "worker-step",
          role: "assistant",
          parts: [
            {
              type: "tool-run_on_mac",
              toolCallId: "mac-call",
              state: "output-available",
              input: { command: "pnpm test" },
              output: { status: "ran", exitCode: 0, stdout: "ok", stderr: "" },
            },
          ],
        },
      ],
      cursor: "1:0",
      status: AGENT_STATUS.COMPLETED,
      title: null,
    },
  ]);
  const control = agentsControl({
    agents: [AGENT],
    me: reader,
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
          task: "Run the tests",
          status: AGENT_STATUS.COMPLETED,
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
  await settleQueries();
  const place = container.querySelector(".actor-words") ?? assert.fail("the row says whose Mac");
  const disc = place.querySelector(".actor-mark") ?? assert.fail("by the owner's disc");
  return (place.textContent ?? "").replace(disc.textContent ?? "", "");
}

test("a command a teammate's agent's worker ran on a Mac says it ran on theirs, and the reader's own agent's worker's on the reader's", async () => {
  const deanReads = await workerTabFor(DEAN);
  act(() => root?.unmount());
  const charlesReads = await workerTabFor(CHARLES.userId);

  assert.equal(deanReads, "On Charles Pan’s Mac");
  assert.equal(charlesReads, "On your Mac");
});
