import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MAIN_SESSION_KEY, RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { ANNOUNCE_TOOL, type AnnounceToolContext } from "./announce-tool.js";
import { maximumBriefingLength } from "./names.js";
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

it.effect("announce takes the briefing alone, hands it on bounded, and answers accepted", () =>
  Effect.gen(function* () {
    const { ctx, announced } = context();
    const answer = yield* ANNOUNCE_TOOL.execute({ briefing: "Checkout wants a decision." }, ctx);
    assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED });
    yield* ANNOUNCE_TOOL.execute({ briefing: "x".repeat(maximumBriefingLength + 40) }, ctx);
    assert.deepEqual(
      announced.map((briefing) => briefing.length),
      ["Checkout wants a decision.".length, maximumBriefingLength],
    );
  }),
);

it.effect("a briefing with no words is refused and nothing is handed on", () =>
  Effect.gen(function* () {
    const { ctx, announced } = context();
    const wordless: readonly WireRecord[] = [{}, { briefing: "   " }, { briefing: 4 }];
    for (const input of wordless) {
      const refused = yield* ANNOUNCE_TOOL.execute(input, ctx);
      assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(refused.reason, REFUSAL_REASON.EMPTY_BRIEFING);
    }
    assert.deepEqual(announced, []);
  }),
);
