import assert from "node:assert/strict";
import test from "node:test";
import { ATTENTION_TRIGGER, type AttentionUpdate } from "@sidecar/attention";
import { ATTENTION_DISPOSITION, type AttentionDecision, SESSION_STATUS } from "@sidecar/session";
import { tracedAttentionEvaluator } from "./attention-trace.js";
import type { AttentionTraceRecord } from "./trace-writer.js";

const UPDATE: AttentionUpdate = {
  providerId: "claude-code",
  providerSessionId: "abc",
  trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
  providerName: "Claude Code",
  title: "checkout-service",
  status: SESSION_STATUS.WAITING,
  observedAt: 1_800_000_000_000,
};

const DECISION: AttentionDecision = {
  disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
  decidedAt: 1_800_000_000_500,
};

test("a traced pass returns the decision unchanged and records both halves", async () => {
  const records: AttentionTraceRecord[] = [];
  let clock = 1_000;
  const evaluator = tracedAttentionEvaluator(
    { evaluate: async () => DECISION },
    (record) => records.push(record),
    () => {
      clock += 40;
      return clock;
    },
  );
  const decision = await evaluator.evaluate(UPDATE);
  assert.equal(decision, DECISION);
  assert.deepEqual(records, [{ update: UPDATE, decision: DECISION, elapsedMs: 40 }]);
});

test("a failed pass still throws, and the trace keeps the failure", async () => {
  const records: AttentionTraceRecord[] = [];
  const evaluator = tracedAttentionEvaluator(
    {
      evaluate: async () => {
        throw new Error("rate limited");
      },
    },
    (record) => records.push(record),
    () => 7,
  );
  await assert.rejects(() => evaluator.evaluate(UPDATE), /rate limited/u);
  assert.deepEqual(records, [
    { update: UPDATE, decision: undefined, elapsedMs: 0, error: "rate limited" },
  ]);
});

test("a recorder that throws costs the trace line, never the pass", async () => {
  const evaluator = tracedAttentionEvaluator({ evaluate: async () => DECISION }, () => {
    throw new Error("disk full");
  });
  assert.equal(await evaluator.evaluate(UPDATE), DECISION);
});

test("the reviewing model is recorded and forwarded only when the evaluator names one", async () => {
  const records: AttentionTraceRecord[] = [];
  const keyed = tracedAttentionEvaluator(
    { evaluate: async () => DECISION, model: "gpt-5.6-luna" },
    (record) => records.push(record),
    () => 0,
  );
  assert.equal(keyed.model, "gpt-5.6-luna");
  await keyed.evaluate(UPDATE);
  assert.equal(records[0]?.model, "gpt-5.6-luna");

  const hosted = tracedAttentionEvaluator(
    { evaluate: async () => DECISION },
    (record) => records.push(record),
    () => 0,
  );
  assert.equal(hosted.model, undefined);
  await hosted.evaluate(UPDATE);
  assert.ok(records[1] && !("model" in records[1]));
});

test("quietUntil is forwarded only when the wrapped evaluator has one", () => {
  const quiet = tracedAttentionEvaluator(
    { evaluate: async () => undefined, quietUntil: () => 42 },
    () => undefined,
  );
  assert.equal(quiet.quietUntil?.(), 42);
  const plain = tracedAttentionEvaluator({ evaluate: async () => undefined }, () => undefined);
  assert.equal(plain.quietUntil, undefined);
});
