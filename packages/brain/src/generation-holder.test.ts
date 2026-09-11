import assert from "node:assert/strict";
import { TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import type { AgentRuntime, ContextOpening } from "@sidecar/runtime/vocabulary";
import { test } from "vitest";
import { ResponsesContextEngine } from "./context-engine.js";
import { freshBrainState } from "./envelope.js";
import { type Generation, generationFrom, retireGeneration } from "./generation.js";
import { GENERATION_ADOPTION, GenerationHolder } from "./generation-holder.js";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";

const TOOL_LOOP_IDENTITY = { id: TOOL_LOOP_RUNTIME.ID, version: TOOL_LOOP_RUNTIME.VERSION };

const NOW = 1_800_000_000_000;

function openedRuntime(order: string[]) {
  const context = new ResponsesContextEngine(TOOL_LOOP_IDENTITY);
  Object.defineProperty(context, "dispose", {
    value: () => {
      order.push("disposed");
    },
  });
  const opening: Promise<ContextOpening> = Promise.resolve({
    context,
    bootstrap: { loaded: true, repaired: 0 },
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
  return runtime;
}

function generation(generationId: string, order: string[] = []): Generation {
  return generationFrom(
    freshBrainState(generationId, NOW),
    openedRuntime(order),
    UNKNOWN_ACTION_RESULT,
  );
}

async function tick(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("the announcement of the standing generation builds nothing and leaves it standing", () => {
  const holder = new GenerationHolder();
  assert.equal(holder.standing(), undefined);
  let built = 0;
  const first = holder.adopt("gen-1", () => {
    built += 1;
    return generation("gen-1");
  });
  assert.equal(first.kind, GENERATION_ADOPTION.ADOPTED);
  assert.equal(built, 1);
  assert.equal(holder.standing(), first.generation);

  const again = holder.adopt("gen-1", () => {
    built += 1;
    return generation("gen-1");
  });
  assert.equal(again.kind, GENERATION_ADOPTION.STANDING);
  assert.equal(built, 1);
  assert.equal(again.generation, first.generation);
  assert.equal(holder.standing(), first.generation);
});

test("the successor stands the moment the decision is taken, and a result of the generation it replaced installs nothing", () => {
  const holder = new GenerationHolder();
  const first = holder.adopt("gen-1", () => generation("gen-1"));
  const replaced = first.generation;

  const standingDuringBuild: (Generation | undefined)[] = [];
  const second = holder.adopt("gen-2", (previous) => {
    standingDuringBuild.push(previous);
    assert.equal(holder.standing(), replaced);
    return generation("gen-2");
  });

  assert.equal(second.kind, GENERATION_ADOPTION.ADOPTED);
  assert.ok(second.kind === GENERATION_ADOPTION.ADOPTED);
  assert.equal(second.previous, replaced);
  assert.deepEqual(standingDuringBuild, [replaced]);
  assert.equal(holder.standing(), second.generation);
  assert.notEqual(holder.standing(), replaced);
});

test("no turn passes between the decision and the fence", async () => {
  const holder = new GenerationHolder();
  const seenInsideBuild: (string | undefined)[] = [];
  const adopted = holder.adopt("gen-1", () => {
    queueMicrotask(() => seenInsideBuild.push(holder.standing()?.id));
    return generation("gen-1");
  });
  // The successor stands on the statement after the decision, with nothing
  // awaited: a microtask queued while the decision was being taken already
  // reads it, so no turn of the event loop passes with the fence down.
  assert.equal(holder.standing(), adopted.generation);
  await Promise.resolve();
  assert.deepEqual(seenInsideBuild, ["gen-1"]);
});

test("retiring a generation fires its signal and then lets go of its context, once however often it is retired", async () => {
  const order: string[] = [];
  const retiring = generation("gen-1", order);
  retiring.abort.signal.addEventListener("abort", () => order.push("aborted"));
  await retiring.opened;

  retireGeneration(retiring);
  assert.equal(retiring.abort.signal.aborted, true);
  await tick();
  assert.deepEqual(order, ["aborted", "disposed"]);

  retireGeneration(retiring);
  await tick();
  assert.deepEqual(order, ["aborted", "disposed"]);
});
