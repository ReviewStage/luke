import assert from "node:assert/strict";
import { TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  type AgentRuntimeEffect,
  CONTEXT_INPUT_KIND,
  type ContextOpening,
  RuntimeResumeRefused,
} from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import { test } from "vitest";
import { ResponsesContextEngine } from "./context-engine.js";
import { freshBrainState } from "./envelope.js";
import {
  CONTEXT_OPENING,
  type Generation,
  generationFrom,
  type OpenedContext,
} from "./generation.js";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";

const TOOL_LOOP_IDENTITY = { id: TOOL_LOOP_RUNTIME.ID, version: TOOL_LOOP_RUNTIME.VERSION };

const NOW = 1_800_000_000_000;

/** The open as a turn's fiber would take it, on a fiber of the test's own. */
const opened = (generation: Generation): Promise<OpenedContext> =>
  Effect.runPromise(generation.opened);

function heldRuntime() {
  const context = new ResponsesContextEngine(TOOL_LOOP_IDENTITY);
  let disposed = 0;
  Object.defineProperty(context, "dispose", {
    value: () => {
      disposed += 1;
    },
  });
  let release: (() => void) | undefined;
  let opens = 0;
  const opening = new Promise<ContextOpening>((resolve) => {
    release = () => resolve({ context, bootstrap: { loaded: true, repaired: 0 } });
  });
  const runtime: AgentRuntimeEffect = {
    descriptor: { id: "held", checkpoint: context.checkpointFormat },
    quietUntil: () => undefined,
    capabilities: () => Effect.succeed(undefined),
    compact: () => Effect.succeed({ compacted: false, reason: "not compacted here" }),
    openContext: () =>
      Effect.suspend(() => {
        opens += 1;
        return Effect.promise(() => opening);
      }),
    start: () => {
      throw new Error("not started here");
    },
    resume: () => Effect.fail(new RuntimeResumeRefused({ reason: "not resumed here" })),
  };
  return {
    runtime,
    context,
    release: () => release?.(),
    disposed: () => disposed,
    opens: () => opens,
  };
}

async function tick(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("an abort and the open's resolution in the same turn leave the context discarded exactly once and never installed, in either order", async () => {
  const abortFirst = heldRuntime();
  const first = generationFrom(
    freshBrainState("gen-1", NOW),
    abortFirst.runtime,
    UNKNOWN_ACTION_RESULT,
  );
  first.abort.abort();
  abortFirst.release();
  const firstOpened = await opened(first);
  await tick();
  assert.equal(firstOpened.kind, CONTEXT_OPENING.INCOMPATIBLE);
  assert.equal(abortFirst.disposed(), 1);

  const releaseFirst = heldRuntime();
  const second = generationFrom(
    freshBrainState("gen-2", NOW),
    releaseFirst.runtime,
    UNKNOWN_ACTION_RESULT,
  );
  releaseFirst.release();
  second.abort.abort();
  assert.equal((await opened(second)).kind, CONTEXT_OPENING.INCOMPATIBLE);
  await tick();
  assert.equal(releaseFirst.disposed(), 1);

  // Released later, across turns: still discarded, still once.
  const later = heldRuntime();
  const third = generationFrom(freshBrainState("gen-3", NOW), later.runtime, UNKNOWN_ACTION_RESULT);
  third.abort.abort();
  await opened(third);
  assert.equal(later.disposed(), 0);
  later.release();
  await tick();
  assert.equal(later.disposed(), 1);
  await tick();
  assert.equal(later.disposed(), 1);
});

test("an open that resolves while the generation stands installs the context and disposes nothing", async () => {
  const standing = heldRuntime();
  const generation = generationFrom(
    freshBrainState("gen-4", NOW),
    standing.runtime,
    UNKNOWN_ACTION_RESULT,
  );
  standing.release();
  const loaded = await opened(generation);
  assert.equal(loaded.kind, CONTEXT_OPENING.LOADED);
  // The generation holds the runtime's engine behind the transcript recorder:
  // what is ingested through the one lands in the other, and is on record.
  assert.ok(loaded.kind === CONTEXT_OPENING.LOADED);
  await loaded.context.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "hello" });
  assert.equal(standing.context.checkpoint().items.length, 1);
  assert.equal(loaded.context.pending().length, 1);
  await tick();
  assert.equal(standing.disposed(), 0);
});

test("the context is opened by the first fiber that asks for it, once, and shared with every fiber after", async () => {
  const shared = heldRuntime();
  const generation = generationFrom(
    freshBrainState("gen-5", NOW),
    shared.runtime,
    UNKNOWN_ACTION_RESULT,
  );
  await tick();
  assert.equal(shared.opens(), 0, "a generation nobody has asked has opened nothing");

  const first = opened(generation);
  const second = opened(generation);
  shared.release();
  const [asked, again] = await Promise.all([first, second]);
  assert.equal(shared.opens(), 1);
  assert.equal(asked.kind, CONTEXT_OPENING.LOADED);
  assert.equal(asked, again, "both fibers were handed the one open");
  assert.equal(await opened(generation), asked, "and so is a fiber that asks after it settled");
  assert.equal(shared.opens(), 1);
});
