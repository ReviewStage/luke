import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL, realtimeToolDefinitions } from "@sidecar/actions";
import { TOOL_EFFECT } from "@sidecar/runtime";
import {
  MEMORY_CAPTURE_OUTCOME,
  MEMORY_CAPTURE_PHASE,
  MEMORY_SCOPE_KIND,
  type MemoryCaptureTurn,
  type MemoryScope,
  type MemoryToolContext,
  memoryToolNamed,
  RUN_ORIGIN,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import type { NotebookMemoryAccess } from "./notebook-memory.js";
import {
  maximumMemoryQueryLength,
  maximumMemorySearchResults,
  NOTEBOOK_MEMORY_REFUSAL,
  NOTEBOOK_MEMORY_TOOL,
  NOTEBOOK_RECALL_ID,
  type NotebookMemoryProviderSeams,
  notebookMemoryProvider,
  notebookMemoryToolShapes,
} from "./provider.js";

const SCOPE: MemoryScope = { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: "main" };
const OTHER: MemoryScope = { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: "someone-else" };
const NEVER = new AbortController().signal;

function context(scope: MemoryScope = SCOPE): MemoryToolContext {
  return { runId: "run-1", origin: RUN_ORIGIN.USER, isRevoked: () => false, signal: NEVER, scope };
}

function call(name: string, args: WireRecord) {
  return { callId: `call-${name}`, name, argumentsJson: JSON.stringify(args) };
}

interface Seen {
  searches: { query: string; maxResults?: number }[];
  gets: { path: string; from?: number; lines?: number }[];
  performed: { name: string; argumentsJson: string; origin: string }[];
  captures: MemoryCaptureTurn[];
}

function harness(overrides: Partial<NotebookMemoryProviderSeams> = {}) {
  const seen: Seen = { searches: [], gets: [], performed: [], captures: [] };
  const access: NotebookMemoryAccess = {
    search: async (ask) => {
      seen.searches.push({
        query: ask.query,
        ...(ask.maxResults !== undefined ? { maxResults: ask.maxResults } : undefined),
      });
      return { status: ACTION_RESULT_STATUS.ACCEPTED, results: [] };
    },
    get: async (ask) => {
      seen.gets.push(ask);
      return { status: ACTION_RESULT_STATUS.ACCEPTED, path: ask.path };
    },
  };
  const provider = notebookMemoryProvider({
    scope: SCOPE,
    access,
    facts: () => [{ id: "f1", words: "prefers espresso" }],
    recentNotes: async () => [
      { name: "2026-09-10.md", path: "memory/2026-09-10.md", content: "- shipped" },
    ],
    perform: async (invocation, ctx) => {
      seen.performed.push({
        name: invocation.name,
        argumentsJson: invocation.argumentsJson,
        origin: ctx.origin,
      });
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    },
    capture: async (turn) => {
      seen.captures.push(turn);
      return { outcome: MEMORY_CAPTURE_OUTCOME.COMPLETED, writes: 1 };
    },
    ...overrides,
  });
  return { provider, seen };
}

test("the four tools are the notebook's, in catalog order, the reads as reads and the two actions as writes with the actions table's own schemas", () => {
  const shapes = notebookMemoryToolShapes();
  assert.deepEqual(
    shapes.map((shape) => [shape.schema.name, shape.effect]),
    [
      [NOTEBOOK_MEMORY_TOOL.SEARCH, TOOL_EFFECT.READ],
      [NOTEBOOK_MEMORY_TOOL.GET, TOOL_EFFECT.READ],
      [REALTIME_TOOL.REMEMBER_FACT, TOOL_EFFECT.WRITE],
      [REALTIME_TOOL.FORGET_FACT, TOOL_EFFECT.WRITE],
    ],
  );
  const remember = realtimeToolDefinitions().find(
    (tool) => tool.name === REALTIME_TOOL.REMEMBER_FACT,
  );
  assert.ok(remember);
  assert.deepEqual(
    shapes.find((shape) => shape.schema.name === REALTIME_TOOL.REMEMBER_FACT)?.schema.parameters,
    JSON.parse(JSON.stringify(remember.parameters)),
  );
  const { provider } = harness();
  assert.deepEqual(
    provider.tools.map((tool) => tool.schema.name),
    shapes.map((shape) => shape.schema.name),
  );
});

test("recall renders the facts under a stable id every turn and the recent notes unkeyed into an empty history alone", async () => {
  const { provider } = harness();
  const fresh = await provider.recall(SCOPE, { items: [], signal: NEVER });
  assert.deepEqual(
    fresh.messages.map((message) => message.id),
    [NOTEBOOK_RECALL_ID.FACTS, undefined],
  );
  const ongoing = await provider.recall(SCOPE, { items: [{ type: "message" }], signal: NEVER });
  assert.deepEqual(
    ongoing.messages.map((message) => message.id),
    [NOTEBOOK_RECALL_ID.FACTS],
  );
  assert.equal(ongoing.messages[0]?.content, fresh.messages[0]?.content);
  const empty = harness({ facts: () => [], recentNotes: async () => [] });
  assert.deepEqual((await empty.provider.recall(SCOPE, { items: [], signal: NEVER })).messages, []);
});

test("a search is bounded before the index sees it, a read passes its window whole, and a missing index refuses both", async () => {
  const { provider, seen } = harness();
  const search = memoryToolNamed(provider, NOTEBOOK_MEMORY_TOOL.SEARCH);
  const get = memoryToolNamed(provider, NOTEBOOK_MEMORY_TOOL.GET);
  assert.ok(search && get);
  const long = "x".repeat(maximumMemoryQueryLength + 50);
  await search.execute(
    call(NOTEBOOK_MEMORY_TOOL.SEARCH, { query: `  deploy   ${long}`, max_results: 99 }),
    context(),
  );
  assert.equal(seen.searches[0]?.query.length, maximumMemoryQueryLength);
  assert.equal(seen.searches[0]?.maxResults, maximumMemorySearchResults);
  await search.execute(
    call(NOTEBOOK_MEMORY_TOOL.SEARCH, { query: "deploy", max_results: 3.7 }),
    context(),
  );
  assert.deepEqual(seen.searches[1], { query: "deploy", maxResults: 3 });
  const emptyQuery = await search.execute(
    call(NOTEBOOK_MEMORY_TOOL.SEARCH, { query: "   " }),
    context(),
  );
  assert.equal(emptyQuery.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(emptyQuery.reason, NOTEBOOK_MEMORY_REFUSAL.EMPTY_QUERY);
  await get.execute(
    call(NOTEBOOK_MEMORY_TOOL.GET, { path: " MEMORY.md ", from: 2, lines: 0 }),
    context(),
  );
  assert.deepEqual(seen.gets[0], { path: "MEMORY.md", from: 2 });
  const noPath = await get.execute(call(NOTEBOOK_MEMORY_TOOL.GET, { path: "" }), context());
  assert.equal(noPath.reason, NOTEBOOK_MEMORY_REFUSAL.NOT_MEMORY_PATH);
  const indexless = harness({ access: undefined });
  for (const name of [NOTEBOOK_MEMORY_TOOL.SEARCH, NOTEBOOK_MEMORY_TOOL.GET]) {
    const tool = memoryToolNamed(indexless.provider, name);
    assert.ok(tool);
    const refused = await tool.execute(call(name, { query: "q", path: "MEMORY.md" }), context());
    assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(refused.reason, NOTEBOOK_MEMORY_REFUSAL.NO_INDEX);
  }
});

test("the two writes are carried whole to the action gauntlet with the turn's origin, never reshaped here", async () => {
  const { provider, seen } = harness();
  const remember = memoryToolNamed(provider, NOTEBOOK_MEMORY_TOOL.REMEMBER);
  const forget = memoryToolNamed(provider, NOTEBOOK_MEMORY_TOOL.FORGET);
  assert.ok(remember && forget);
  const rememberCall = call(NOTEBOOK_MEMORY_TOOL.REMEMBER, { words: "likes tea", replaces: "f1" });
  const forgetCall = call(NOTEBOOK_MEMORY_TOOL.FORGET, { id: "f1" });
  const answered = await remember.execute(rememberCall, context());
  await forget.execute(forgetCall, { ...context(), origin: RUN_ORIGIN.OBSERVATION });
  assert.equal(answered.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(seen.performed, [
    { name: rememberCall.name, argumentsJson: rememberCall.argumentsJson, origin: RUN_ORIGIN.USER },
    {
      name: forgetCall.name,
      argumentsJson: forgetCall.argumentsJson,
      origin: RUN_ORIGIN.OBSERVATION,
    },
  ]);
});

test("a provider answers only for the scope it was built over", async () => {
  const { provider, seen } = harness();
  assert.deepEqual((await provider.recall(OTHER, { items: [], signal: NEVER })).messages, []);
  const refusals: WireRecord[] = [];
  for (const tool of provider.tools) {
    refusals.push(await tool.execute(call(tool.schema.name, { query: "q" }), context(OTHER)));
  }
  assert.deepEqual(
    refusals.map((refusal) => [refusal.status, refusal.reason]),
    provider.tools.map(() => [
      ACTION_RESULT_STATUS.REJECTED,
      NOTEBOOK_MEMORY_REFUSAL.FOREIGN_SCOPE,
    ]),
  );
  assert.ok(provider.capture);
  const turn: MemoryCaptureTurn = {
    scope: OTHER,
    phase: MEMORY_CAPTURE_PHASE.COMPACTION_REQUESTED,
    operation: { generationId: "gen-1", compactionCount: 0 },
    items: [],
    signal: NEVER,
  };
  assert.equal((await provider.capture(turn)).outcome, MEMORY_CAPTURE_OUTCOME.SKIPPED);
  const owned = await provider.capture({ ...turn, scope: SCOPE });
  assert.equal(owned.outcome, MEMORY_CAPTURE_OUTCOME.COMPLETED);
  assert.equal(seen.captures.length, 1);
  assert.equal(seen.performed.length, 0);
});

test("a provider built without a capture offers none, so a conversation whose memory is never captured has nothing to call", () => {
  const uncaptured = notebookMemoryProvider({
    scope: SCOPE,
    access: undefined,
    facts: () => [],
    recentNotes: async () => [],
    perform: async () => ({ status: ACTION_RESULT_STATUS.REJECTED }),
  });
  assert.equal(uncaptured.capture, undefined);
  assert.equal(Object.hasOwn(uncaptured, "capture"), false);
});
