import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { type StorePort, serveStore, storeClient } from "@sidecar/brain/store";
import {
  MEMORY_HOUSEKEEPING_OUTCOME,
  memoryFlushPrompt,
  resetCapturePrompt,
} from "@sidecar/memory";
import { recentDailyNotes } from "@sidecar/runtime";
import { temporaryDirectory } from "@sidecar/runtime/testing";
import {
  type AgentRuntime,
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  MEMORY_CAPTURE_PHASE,
  MEMORY_SCOPE_KIND,
  type MemoryCapturePhase,
  type MemoryCaptureTurn,
  RUN_END_REASON,
  type RuntimeRunRequest,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";
import { type MemoryMaintenanceDependencies, wireMemoryMaintenance } from "./memory-maintenance.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 03:00 local on a fixed day, so the notes' day stamps are stable in any zone the test runs in. */
const NOW = new Date(2026, 8, 8, 3, 0, 0).getTime();
const stamp = (atMs: number) => {
  const date = new Date(atMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const TODAY = stamp(NOW);
const YESTERDAY = stamp(NOW - DAY_MS);
const TWO_DAYS_AGO = stamp(NOW - 2 * DAY_MS);
const NEVER = new AbortController().signal;

function turnOf(phase: MemoryCapturePhase, items: readonly WireRecord[]): MemoryCaptureTurn {
  return {
    scope: { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: DEFAULT_AGENT_ID },
    phase,
    operation: { generationId: "gen-1", compactionCount: 0 },
    items,
    signal: NEVER,
  };
}

function client() {
  const channel = new MessageChannel();
  // SAFETY: a MessagePort posts and receives structured-clone values on the same events the port contract names.
  serveStore(channel.port2 as unknown as StorePort);
  // SAFETY: as above, for the client's end of the same channel.
  const store = storeClient(channel.port1 as unknown as StorePort);
  return {
    store,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/** A runtime whose one answer per system prompt the test decides; it executes no tool. */
function fakeRuntime(answer: (prompt: string, input: string) => string | undefined) {
  const prompts: string[] = [];
  // SAFETY: the sweep reaches only openContext and start, both present; the rest of the runtime is never called.
  const runtime = {
    openContext: async () => ({
      context: { dispose: () => undefined, adoptCompaction: () => undefined },
      bootstrap: {},
    }),
    start: (request: RuntimeRunRequest) => {
      prompts.push(request.prompt);
      const input = request.input[0];
      const text = answer(request.prompt, input && "text" in input ? input.text : "");
      return {
        runId: request.runId,
        steer: () => false,
        cancel: () => undefined,
        done: Promise.resolve(
          text === undefined
            ? { reason: RUN_END_REASON.PROVIDER_FAILURE, failure: "upstream", detail: "down" }
            : { reason: RUN_END_REASON.COMPLETED, text },
        ),
      };
    },
  } as unknown as AgentRuntime;
  return { runtime, prompts };
}

async function harness(
  t: TestContext,
  answer: (prompt: string, input: string) => string | undefined = () => "stored.",
  overrides: Partial<MemoryMaintenanceDependencies> = {},
) {
  const root = temporaryDirectory(t, "luke-memory-maintenance-");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "MEMORY.md"),
    "# MEMORY.md\n\n- Deploys go out on Tuesday afternoons\n",
  );
  const { store, close } = client();
  await store.open({
    agentRoot: root,
    workspaceDirectory: workspace,
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    conversationName: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
  const thread = threadSessionKey("11111111-1111-1111-1111-111111111111");
  const temporary = threadSessionKey("22222222-2222-2222-2222-222222222222");
  await store.ask("conversations.create", {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: thread,
    name: "Thread",
    now: NOW,
  });
  const fake = fakeRuntime(answer);
  const reports: string[] = [];
  let changed = 0;
  const maintenance = wireMemoryMaintenance({
    persistent: true,
    client: () => store,
    createRuntime: () => fake.runtime,
    workspaceDirectory: () => workspace,
    isTemporary: (sessionKey) => sessionKey === temporary,
    now: () => NOW,
    createId: () => "id",
    report: (message) => reports.push(message),
    onNotebookChanged: () => {
      changed += 1;
    },
    ...overrides,
  });
  return {
    root,
    workspace,
    store,
    close,
    thread,
    temporary,
    maintenance,
    prompts: fake.prompts,
    reports,
    changed: () => changed,
    memory: () => fs.readFileSync(path.join(workspace, "MEMORY.md"), "utf8"),
  };
}

test("the capture exists only for main and durable private threads, runs each phase under its own prompt, and the recent daily notes are today's and yesterday's, slugged variants included", async (t) => {
  const h = await harness(t);
  const main = h.maintenance.captureFor(MAIN_SESSION_KEY);
  assert.ok(main);
  assert.ok(h.maintenance.captureFor(h.thread));
  assert.equal(h.maintenance.captureFor(h.temporary), undefined);
  assert.equal(h.maintenance.flushMarkerFor(h.temporary), undefined);
  const empty = await main(turnOf(MEMORY_CAPTURE_PHASE.RESET_REQUESTED, []));
  assert.equal(empty.outcome, MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE);
  assert.equal(h.prompts.length, 0, "a reset over nothing runs no turn");
  const flushed = await main(
    turnOf(MEMORY_CAPTURE_PHASE.COMPACTION_REQUESTED, [{ type: "message" }]),
  );
  assert.equal(flushed.outcome, MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE);
  const reset = await main(turnOf(MEMORY_CAPTURE_PHASE.RESET_REQUESTED, [{ type: "message" }]));
  assert.equal(reset.outcome, MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE);
  assert.deepEqual(h.prompts, [memoryFlushPrompt(TODAY).system, resetCapturePrompt(TODAY).system]);
  // A capture whose model fails is reported as failed, never as done.
  const failing = await harness(t, () => undefined);
  const failingMain = failing.maintenance.captureFor(MAIN_SESSION_KEY);
  assert.ok(failingMain);
  const failed = await failingMain(
    turnOf(MEMORY_CAPTURE_PHASE.RESET_REQUESTED, [{ type: "message" }]),
  );
  assert.equal(failed.outcome, MEMORY_HOUSEKEEPING_OUTCOME.FAILED);
  failing.close();
  fs.writeFileSync(path.join(h.workspace, "memory", `${TODAY}.md`), "- today\n");
  fs.writeFileSync(path.join(h.workspace, "memory", `${YESTERDAY}-standup.md`), "- standup\n");
  fs.writeFileSync(path.join(h.workspace, "memory", `${TWO_DAYS_AGO}.md`), "- older\n");
  const primed = await recentDailyNotes(h.workspace, NOW);
  assert.deepEqual(
    primed.map((note) => note.name).sort(),
    [`${TODAY}.md`, `${YESTERDAY}-standup.md`].sort(),
  );
  h.close();
});

test("the flush marker is kept per conversation under the generation the brain names, and a new generation reads none", async (t) => {
  const h = await harness(t);
  const marker = h.maintenance.flushMarkerFor(MAIN_SESSION_KEY);
  assert.ok(marker);
  assert.equal(await marker.read("gen-1"), undefined);
  await marker.write("gen-1", 2);
  assert.equal(await marker.read("gen-1"), 2);
  assert.equal(
    await marker.read("gen-2"),
    undefined,
    "a marker from an earlier lifetime is never this cycle's",
  );
  const thread = h.maintenance.flushMarkerFor(h.thread);
  assert.ok(thread);
  assert.equal(
    await thread.read("gen-1"),
    undefined,
    "one conversation's marker says nothing about another's",
  );
  await thread.write("gen-1", 0);
  assert.equal(await marker.read("gen-1"), 2);
  h.close();
});
