import assert from "node:assert/strict";
import { MAIN_SESSION_KEY, RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { Effect } from "effect";
import { test } from "vitest";
import { ANNOUNCE_TOOL, type AnnounceToolContext } from "./announce-tool.js";
import { BRAIN_TOOL, maximumBriefingLength } from "./names.js";
import { REFUSAL_REASON } from "./refusals.js";

function context() {
  const announced: string[] = [];
  const ctx: AnnounceToolContext = {
    conversationId: MAIN_SESSION_KEY,
    turnId: "wake-1",
    runId: "wake-1",
    origin: RUN_ORIGIN.OBSERVATION,
    isRevoked: () => false,
    signal: new AbortController().signal,
    announce: (briefing) => {
      announced.push(briefing);
    },
  };
  return { ctx, announced };
}

test("announce takes the briefing alone, hands it on bounded, and answers accepted", async () => {
  assert.equal(ANNOUNCE_TOOL.name, BRAIN_TOOL.ANNOUNCE);
  const node = emitJsonSchema(ANNOUNCE_TOOL.inputSchema);
  assert.ok("required" in node && "properties" in node);
  assert.deepEqual(node.required, ["briefing"]);
  assert.deepEqual(Object.keys(node.properties), ["briefing"]);
  const { ctx, announced } = context();
  const answer = await Effect.runPromise(
    ANNOUNCE_TOOL.execute({ briefing: "Checkout wants a decision." }, ctx),
  );
  assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED });
  await Effect.runPromise(
    ANNOUNCE_TOOL.execute({ briefing: "x".repeat(maximumBriefingLength + 40) }, ctx),
  );
  assert.deepEqual(
    announced.map((briefing) => briefing.length),
    ["Checkout wants a decision.".length, maximumBriefingLength],
  );
});

test("a briefing with no words is refused and nothing is handed on", async () => {
  const { ctx, announced } = context();
  const wordless: readonly WireRecord[] = [{}, { briefing: "   " }, { briefing: 4 }];
  for (const input of wordless) {
    const refused = await Effect.runPromise(ANNOUNCE_TOOL.execute(input, ctx));
    assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(refused.reason, REFUSAL_REASON.EMPTY_BRIEFING);
  }
  assert.deepEqual(announced, []);
});

test("the briefing's context carries no carrier and no admission: the module's words can become speech and nothing else", () => {
  const { ctx } = context();
  assert.deepEqual(Object.keys(ctx).sort(), [
    "announce",
    "conversationId",
    "isRevoked",
    "origin",
    "runId",
    "signal",
    "turnId",
  ]);
});
