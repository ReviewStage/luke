import assert from "node:assert/strict";
import test from "node:test";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { hostedActAnswerSchema, hostedActWorkspaceAnswerSchema } from "./act-wire.js";

test("an act answer names one of the three outcomes and carries its reason as written", () => {
  assert.deepEqual(hostedActAnswerSchema.parse({ result: ACT_RESULT_STATUS.ACCEPTED }), {
    result: ACT_RESULT_STATUS.ACCEPTED,
  });
  assert.deepEqual(
    hostedActAnswerSchema.parse({ result: ACT_RESULT_STATUS.REJECTED, reason: " not found " }),
    { result: ACT_RESULT_STATUS.REJECTED, reason: " not found " },
  );
  assert.equal(hostedActAnswerSchema.parse({ result: "queued" }), undefined);
  assert.equal(hostedActAnswerSchema.parse({}), undefined);
});

test("a reason that says nothing is left out rather than refusing the outcome", () => {
  const answer = hostedActAnswerSchema.parse({ result: ACT_RESULT_STATUS.ACCEPTED, reason: "" });
  assert.deepEqual(answer, { result: ACT_RESULT_STATUS.ACCEPTED });
  assert.deepEqual(hostedActAnswerSchema.parse({ result: ACT_RESULT_STATUS.ACCEPTED, reason: 7 }), {
    result: ACT_RESULT_STATUS.ACCEPTED,
  });
});

test("a creation answer carries the session id the provider named, when it named one", () => {
  assert.deepEqual(
    hostedActWorkspaceAnswerSchema.parse({
      result: ACT_RESULT_STATUS.ACCEPTED,
      providerSessionId: "session-9",
    }),
    { result: ACT_RESULT_STATUS.ACCEPTED, providerSessionId: "session-9" },
  );
  assert.deepEqual(
    hostedActWorkspaceAnswerSchema.parse({
      result: ACT_RESULT_STATUS.ACCEPTED,
      providerSessionId: "",
    }),
    { result: ACT_RESULT_STATUS.ACCEPTED },
  );
});
