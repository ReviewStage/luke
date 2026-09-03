import assert from "node:assert/strict";
import test from "node:test";
import type { BrainAgent } from "@sidecar/brain";
import { maximumTypedAskLength } from "@sidecar/realtime";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { askBrain, BRAIN_ASK_REFUSAL } from "./brain";

function brainAnswering(answer: { text: string } | undefined, asked: string[]): BrainAgent {
  // SAFETY: the ask path reads only `ask` off the agent; the fixture stands in for the rest.
  return {
    ask: async (question: string) => {
      asked.push(question);
      return answer ? { text: answer.text } : undefined;
    },
  } as unknown as BrainAgent;
}

test("an ask with no brain, no words, or no answer in time is refused in fixed words", async () => {
  const asked: string[] = [];
  assert.deepEqual(await askBrain(undefined, "what needs me?"), {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: BRAIN_ASK_REFUSAL.ABSENT,
  });
  assert.deepEqual(await askBrain(brainAnswering({ text: "x" }, asked), "   "), {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: BRAIN_ASK_REFUSAL.EMPTY,
  });
  assert.deepEqual(await askBrain(brainAnswering(undefined, asked), "what needs me?"), {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: BRAIN_ASK_REFUSAL.TIMED_OUT,
  });
  assert.deepEqual(asked, ["what needs me?"]);
});

test("an answered ask is bounded like a typed one and carries the reply whole", async () => {
  const asked: string[] = [];
  const long = "a".repeat(maximumTypedAskLength + 50);
  const answer = await askBrain(brainAnswering({ text: "Two agents are waiting." }, asked), long);

  assert.equal(asked[0]?.length, maximumTypedAskLength);
  assert.deepEqual(answer, {
    status: ACT_RESULT_STATUS.ACCEPTED,
    briefing: "Two agents are waiting.",
  });
});
