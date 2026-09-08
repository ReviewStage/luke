import assert from "node:assert/strict";
import test from "node:test";
import {
  type AgentRuntime,
  CONTEXT_INPUT_KIND,
  type ContextEngine,
  RUN_END_REASON,
  type RuntimeRunRequest,
} from "@sidecar/runtime-contracts";
import type { WireRecord } from "@sidecar/wire";
import type { BrainMemoryAccess } from "./agent.js";
import { RECALL_SUBRUN_TOOLS, runRecallSubrun } from "./recall-subrun.js";
import { BRAIN_TOOL } from "./tools.js";
import { REFUSAL_REASON } from "./turn.js";

/** A runtime that runs no model: it calls the tools the request offers and answers with what they said. */
function fakeRuntime(script: (request: RuntimeRunRequest) => Promise<string>) {
  const disposed: number[] = [];
  const requests: RuntimeRunRequest[] = [];
  // SAFETY: the subrun disposes the context and reads nothing else of it.
  const context = {
    dispose: () => {
      disposed.push(1);
    },
  } as unknown as ContextEngine;
  // SAFETY: the subrun calls openContext and start alone; the test supplies exactly those.
  const runtime = {
    openContext: async () => ({ context, bootstrap: { kind: "fresh" } }),
    start: (request: RuntimeRunRequest) => {
      requests.push(request);
      return {
        runId: request.runId,
        steer: () => false,
        cancel: () => undefined,
        done: script(request).then((text) => ({ reason: RUN_END_REASON.COMPLETED, text })),
      };
    },
  } as unknown as AgentRuntime;
  return { runtime, disposed, requests };
}

interface MemoryFake {
  readonly access: BrainMemoryAccess;
  readonly searches: string[];
  readonly reads: string[];
}

function memory(): MemoryFake {
  const searches: string[] = [];
  const reads: string[] = [];
  return {
    searches,
    reads,
    access: {
      search: async ({ query }) => {
        searches.push(query);
        const answer: WireRecord = {
          status: "accepted",
          mode: "hybrid",
          results: [
            { path: "USER.md", start_line: 5, end_line: 5, snippet: "- deploys on tuesdays" },
          ],
        };
        return answer;
      },
      get: async ({ path }) => {
        reads.push(path);
        return { status: "accepted", path, text: "- deploys on tuesdays" };
      },
    },
  };
}

test("the subrun is offered the two memory tools alone, runs them, and its context is disposed", async () => {
  const notebook = memory();
  const { runtime, disposed, requests } = fakeRuntime(async (request) => {
    const searched = await request.tools.execute(
      {
        callId: "c1",
        name: BRAIN_TOOL.MEMORY_SEARCH,
        argumentsJson: JSON.stringify({ query: "deploys" }),
      },
      { runId: "recall-1", isRevoked: () => false, signal: new AbortController().signal },
    );
    const read = await request.tools.execute(
      {
        callId: "c2",
        name: BRAIN_TOOL.MEMORY_GET,
        argumentsJson: JSON.stringify({ path: "USER.md", from: 5, lines: 1 }),
      },
      { runId: "recall-1", isRevoked: () => false, signal: new AbortController().signal },
    );
    const refused = await request.tools.execute(
      { callId: "c3", name: BRAIN_TOOL.ANNOUNCE, argumentsJson: "{}" },
      { runId: "recall-1", isRevoked: () => false, signal: new AbortController().signal },
    );
    assert.ok(searched.outputJson.includes("tuesdays"));
    assert.ok(read.outputJson.includes("USER.md"));
    assert.ok(refused.outputJson.includes(REFUSAL_REASON.NOT_OFFERED));
    return "Deploys go out on Tuesdays.";
  });
  const summary = await runRecallSubrun({
    runtime,
    memory: notebook.access,
    query: "when do we deploy?",
    recentTurns: [{ role: "user", text: "earlier ask" }],
    signal: new AbortController().signal,
    runId: "recall-1",
  });
  assert.equal(summary, "Deploys go out on Tuesdays.");
  assert.deepEqual(notebook.searches, ["deploys"]);
  assert.deepEqual(notebook.reads, ["USER.md"]);
  assert.deepEqual(
    requests[0]?.toolSchemas.map((schema) => schema.name).toSorted(),
    [...RECALL_SUBRUN_TOOLS].toSorted(),
  );
  assert.deepEqual(requests[0]?.ephemeral(), []);
  const opening = requests[0]?.input[0];
  assert.ok(opening && opening.kind === CONTEXT_INPUT_KIND.USER_TEXT);
  assert.ok(opening.text.includes("when do we deploy?"));
  assert.ok(opening.text.includes("earlier ask"));
  assert.equal(disposed.length, 1);
});

test("a subrun that does not complete answers nothing", async () => {
  const notebook = memory();
  // SAFETY: the subrun calls openContext and start alone; the test supplies exactly those.
  const runtime = {
    openContext: async () => ({ context: { dispose: () => undefined }, bootstrap: {} }),
    start: (request: RuntimeRunRequest) => ({
      runId: request.runId,
      steer: () => false,
      cancel: () => undefined,
      done: Promise.resolve({ reason: RUN_END_REASON.CANCELLED }),
    }),
  } as unknown as AgentRuntime;
  const summary = await runRecallSubrun({
    runtime,
    memory: notebook.access,
    query: "q",
    recentTurns: [],
    signal: new AbortController().signal,
    runId: "recall-2",
  });
  assert.equal(summary, undefined);
});
