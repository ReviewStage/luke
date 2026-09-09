import assert from "node:assert/strict";
import test from "node:test";
import {
  type AgentRuntime,
  CONTEXT_INPUT_KIND,
  type ContextOpening,
} from "@sidecar/runtime/vocabulary";
import { ResponsesContextEngine } from "./context-engine.js";
import { CONTEXT_OPENING, generationFrom } from "./generation.js";
import { TOOL_LOOP_RUNTIME } from "./runtime.js";
import { freshBrainState } from "./state-store.js";

const TOOL_LOOP_IDENTITY = { id: TOOL_LOOP_RUNTIME.ID, version: TOOL_LOOP_RUNTIME.VERSION };

const NOW = 1_800_000_000_000;

function heldRuntime() {
  const context = new ResponsesContextEngine(TOOL_LOOP_IDENTITY);
  let disposed = 0;
  Object.defineProperty(context, "dispose", {
    value: () => {
      disposed += 1;
    },
  });
  let release: (() => void) | undefined;
  const opening = new Promise<ContextOpening>((resolve) => {
    release = () => resolve({ context, bootstrap: { loaded: true, repaired: 0 } });
  });
  const runtime: AgentRuntime = {
    descriptor: { id: "held", checkpoint: context.checkpointFormat },
    quietUntil: () => undefined,
    capabilities: () => Promise.resolve(undefined),
    compact: () => Promise.resolve({ compacted: false, reason: "not compacted here" }),
    openContext: () => opening,
    start: () => {
      throw new Error("not started here");
    },
    resume: () => Promise.resolve({ refused: "not resumed here" }),
  };
  return { runtime, context, release: () => release?.(), disposed: () => disposed };
}

async function tick(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("an abort and the open's resolution in the same turn leave the context discarded exactly once and never installed, in either order", async () => {
  const abortFirst = heldRuntime();
  const first = generationFrom(freshBrainState("gen-1", NOW), abortFirst.runtime, "{}");
  first.abort.abort();
  abortFirst.release();
  const firstOpened = await first.opened;
  await tick();
  assert.equal(firstOpened.kind, CONTEXT_OPENING.INCOMPATIBLE);
  assert.equal(abortFirst.disposed(), 1);
  assert.match(
    firstOpened.kind === CONTEXT_OPENING.INCOMPATIBLE ? firstOpened.reason : "",
    /replaced while its context was opening/u,
  );

  const releaseFirst = heldRuntime();
  const second = generationFrom(freshBrainState("gen-2", NOW), releaseFirst.runtime, "{}");
  releaseFirst.release();
  second.abort.abort();
  assert.equal((await second.opened).kind, CONTEXT_OPENING.INCOMPATIBLE);
  await tick();
  assert.equal(releaseFirst.disposed(), 1);

  // Released later, across turns: still discarded, still once.
  const later = heldRuntime();
  const third = generationFrom(freshBrainState("gen-3", NOW), later.runtime, "{}");
  third.abort.abort();
  await third.opened;
  assert.equal(later.disposed(), 0);
  later.release();
  await tick();
  assert.equal(later.disposed(), 1);
  await tick();
  assert.equal(later.disposed(), 1);
});

test("an open that resolves while the generation stands installs the context and disposes nothing", async () => {
  const standing = heldRuntime();
  const generation = generationFrom(freshBrainState("gen-4", NOW), standing.runtime, "{}");
  standing.release();
  const opened = await generation.opened;
  assert.equal(opened.kind, CONTEXT_OPENING.LOADED);
  // The generation holds the runtime's engine behind the transcript recorder:
  // what is ingested through the one lands in the other, and is on record.
  assert.ok(opened.kind === CONTEXT_OPENING.LOADED);
  await opened.context.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "hello" });
  assert.equal(standing.context.checkpoint().items.length, 1);
  assert.equal(opened.context.pending().length, 1);
  await tick();
  assert.equal(standing.disposed(), 0);
});
