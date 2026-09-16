import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { TOOL_EFFECT } from "@sidecar/runtime";
import {
  MEMORY_CAPTURE_OUTCOME,
  MEMORY_SCOPE_KIND,
  type MemoryCaptureTurn,
  type MemoryScope,
  type MemoryToolContext,
  memoryToolNamed,
  RUN_ORIGIN,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { Effect } from "effect";
import { test } from "vitest";
import {
  maximumMemoryQueryLength,
  maximumMemorySearchResults,
  NOTEBOOK_MEMORY_REFUSAL,
  type NotebookMemoryAccess,
  type NotebookMemoryProviderSeams,
  notebookMemoryProvider,
  notebookMemoryToolShapes,
} from "./provider.js";
import { NOTEBOOK_MEMORY_TOOL } from "./tool-names.js";

const SCOPE: MemoryScope = { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: "main" };
const OTHER: MemoryScope = { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: "someone-else" };
const NEVER = new AbortController().signal;

function context(scope: MemoryScope = SCOPE): MemoryToolContext {
  return { runId: "run-1", origin: RUN_ORIGIN.USER, isRevoked: () => false, signal: NEVER, scope };
}

interface Seen {
  searches: { query: string; maxResults?: number }[];
  gets: { path: string; from?: number; lines?: number }[];
  captures: MemoryCaptureTurn[];
}

function harness(overrides: Partial<NotebookMemoryProviderSeams> = {}) {
  const seen: Seen = { searches: [], gets: [], captures: [] };
  const access: NotebookMemoryAccess = {
    search: (ask) =>
      Effect.sync(() => {
        seen.searches.push({
          query: ask.query,
          ...(ask.maxResults !== undefined ? { maxResults: ask.maxResults } : undefined),
        });
        return { status: ACTION_RESULT_STATUS.ACCEPTED, results: [] };
      }),
    get: (ask) =>
      Effect.sync(() => {
        seen.gets.push(ask);
        return { status: ACTION_RESULT_STATUS.ACCEPTED, path: ask.path };
      }),
  };
  const provider = notebookMemoryProvider({
    scope: SCOPE,
    access,
    recentNotes: () =>
      Effect.succeed([
        { name: "2026-09-10.md", path: "memory/2026-09-10.md", content: "- shipped" },
      ]),
    capture: (turn) =>
      Effect.sync(() => {
        seen.captures.push(turn);
        return { outcome: MEMORY_CAPTURE_OUTCOME.COMPLETED, writes: 1 };
      }),
    ...overrides,
  });
  return { provider, seen };
}

test("the two tools are the notebook's reads, in catalog order, each a module whose schema names its fields", () => {
  const shapes = notebookMemoryToolShapes();
  assert.deepEqual(
    shapes.map((shape) => [shape.name, shape.effect]),
    [
      [NOTEBOOK_MEMORY_TOOL.SEARCH, TOOL_EFFECT.READ],
      [NOTEBOOK_MEMORY_TOOL.GET, TOOL_EFFECT.READ],
    ],
  );
  const nodes = shapes.map((shape) => emitJsonSchema(shape.inputSchema));
  assert.deepEqual(
    nodes.map((node) => ("properties" in node ? Object.keys(node.properties) : [])),
    [
      ["query", "max_results"],
      ["path", "from", "lines"],
    ],
  );
  assert.deepEqual(
    nodes.map((node) => ("required" in node ? node.required : undefined)),
    [["query"], ["path"]],
  );
  const { provider } = harness();
  assert.deepEqual(
    provider.tools.map((tool) => [tool.name, tool.description, tool.inputSchema, tool.effect]),
    shapes.map((shape) => [shape.name, shape.description, shape.inputSchema, shape.effect]),
  );
});

it.effect(
  "recall renders the recent notes unkeyed into an empty history alone, and nothing into an ongoing one",
  () =>
    Effect.gen(function* () {
      const { provider } = harness();
      const fresh = yield* provider.recall(SCOPE, { items: [], signal: NEVER });
      assert.deepEqual(
        fresh.messages.map((message) => message.id),
        [undefined],
      );
      assert.ok(fresh.messages[0]?.content.includes("2026-09-10.md"));
      const ongoing = yield* provider.recall(SCOPE, {
        items: [{ type: "message" }],
        signal: NEVER,
      });
      assert.deepEqual(ongoing.messages, []);
      const empty = harness({ recentNotes: () => Effect.succeed([]) });
      const recalled = yield* empty.provider.recall(SCOPE, { items: [], signal: NEVER });
      assert.deepEqual(recalled.messages, []);
    }),
);

it.effect(
  "a search is bounded before the index sees it, a read passes its window whole, and a missing index refuses both",
  () =>
    Effect.gen(function* () {
      const { provider, seen } = harness();
      const search = memoryToolNamed(provider, NOTEBOOK_MEMORY_TOOL.SEARCH);
      const get = memoryToolNamed(provider, NOTEBOOK_MEMORY_TOOL.GET);
      assert.ok(search && get);
      const long = "x".repeat(maximumMemoryQueryLength + 50);
      yield* search.execute({ query: `  deploy   ${long}`, max_results: 99 }, context());
      assert.equal(seen.searches[0]?.query.length, maximumMemoryQueryLength);
      assert.equal(seen.searches[0]?.maxResults, maximumMemorySearchResults);
      yield* search.execute({ query: "deploy", max_results: 3.7 }, context());
      assert.deepEqual(seen.searches[1], { query: "deploy", maxResults: 3 });
      const emptyQuery = yield* search.execute({ query: "   " }, context());
      assert.equal(emptyQuery.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(emptyQuery.reason, NOTEBOOK_MEMORY_REFUSAL.EMPTY_QUERY);
      yield* get.execute({ path: " MEMORY.md ", from: 2, lines: 0 }, context());
      assert.deepEqual(seen.gets[0], { path: "MEMORY.md", from: 2 });
      const noPath = yield* get.execute({ path: "" }, context());
      assert.equal(noPath.reason, NOTEBOOK_MEMORY_REFUSAL.NOT_MEMORY_PATH);
      const indexless = harness({ access: undefined });
      for (const name of [NOTEBOOK_MEMORY_TOOL.SEARCH, NOTEBOOK_MEMORY_TOOL.GET]) {
        const tool = memoryToolNamed(indexless.provider, name);
        assert.ok(tool);
        const refused = yield* tool.execute({ query: "q", path: "MEMORY.md" }, context());
        assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
        assert.equal(refused.reason, NOTEBOOK_MEMORY_REFUSAL.NO_INDEX);
      }
    }),
);

it.effect("a provider answers only for the scope it was built over", () =>
  Effect.gen(function* () {
    const { provider, seen } = harness();
    const foreign = yield* provider.recall(OTHER, { items: [], signal: NEVER });
    assert.deepEqual(foreign.messages, []);
    const refusals: WireRecord[] = [];
    for (const tool of provider.tools) {
      refusals.push(yield* tool.execute({ query: "q" }, context(OTHER)));
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
      operation: { generationId: "gen-1", compactionCount: 0 },
      items: [],
      signal: NEVER,
    };
    const skipped = yield* provider.capture(turn);
    assert.equal(skipped.outcome, MEMORY_CAPTURE_OUTCOME.SKIPPED);
    const owned = yield* provider.capture({ ...turn, scope: SCOPE });
    assert.equal(owned.outcome, MEMORY_CAPTURE_OUTCOME.COMPLETED);
    assert.equal(seen.captures.length, 1);
  }),
);

test("a provider built without a capture offers none, so a conversation whose memory is never captured has nothing to call", () => {
  const uncaptured = notebookMemoryProvider({
    scope: SCOPE,
    access: undefined,
    recentNotes: () => Effect.succeed([]),
  });
  assert.equal(uncaptured.capture, undefined);
  assert.equal(Object.hasOwn(uncaptured, "capture"), false);
});
