import assert from "node:assert/strict";
import test from "node:test";
import type { SubjectInput } from "@sidecar/attention";
import { tracedSubjectEvaluator } from "./subject-trace.js";
import type { SubjectTraceRecord } from "./trace-writer.js";

const INPUT: SubjectInput = {
  providerName: "Codex",
  title: "what is our burn",
  recap: "About 40k a month.",
  transcript: "User: what is our burn\nAssistant: about 40k — ok",
};

test("a traced derivation returns the answer unchanged and records the transcript's bytes, not its text", async () => {
  const records: SubjectTraceRecord[] = [];
  let clock = 1_000;
  const evaluator = tracedSubjectEvaluator(
    { derive: async () => ({ subject: "the monthly burn" }) },
    (record) => records.push(record),
    () => {
      clock += 40;
      return clock;
    },
  );
  assert.deepEqual(await evaluator.derive(INPUT), { subject: "the monthly burn" });
  assert.deepEqual(records, [
    {
      providerName: "Codex",
      title: "what is our burn",
      recap: "About 40k a month.",
      transcriptBytes: Buffer.byteLength(INPUT.transcript, "utf8"),
      subject: "the monthly burn",
      elapsedMs: 40,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(records), /Assistant/);
});

test("a failed derivation still throws, and the trace keeps the failure", async () => {
  const records: SubjectTraceRecord[] = [];
  const evaluator = tracedSubjectEvaluator(
    {
      derive: async () => {
        throw new Error("rate limited");
      },
    },
    (record) => records.push(record),
    () => 7,
  );
  await assert.rejects(() => evaluator.derive(INPUT), /rate limited/u);
  assert.equal(records[0]?.error, "rate limited");
  assert.equal(records[0]?.subject, undefined);
});

test("a recorder that throws costs the trace line, never the derivation", async () => {
  const evaluator = tracedSubjectEvaluator({ derive: async () => ({ subject: null }) }, () => {
    throw new Error("disk full");
  });
  assert.deepEqual(await evaluator.derive(INPUT), { subject: null });
});

test("model and quietUntil are forwarded only when the evaluator has them", async () => {
  const records: SubjectTraceRecord[] = [];
  const keyed = tracedSubjectEvaluator(
    { derive: async () => undefined, model: "gpt-5.6-luna", quietUntil: () => 42 },
    (record) => records.push(record),
    () => 0,
  );
  assert.equal(keyed.model, "gpt-5.6-luna");
  assert.equal(keyed.quietUntil?.(), 42);
  await keyed.derive(INPUT);
  assert.equal(records[0]?.model, "gpt-5.6-luna");
  const plain = tracedSubjectEvaluator({ derive: async () => undefined }, () => undefined);
  assert.equal(plain.model, undefined);
  assert.equal(plain.quietUntil, undefined);
});
