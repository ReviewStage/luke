import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { hostedActionAnswerSchema, hostedActionWorkspaceAnswerSchema } from "./action-wire.js";

test("an action answer names one of the three outcomes and carries its reason as written", () => {
  assert.deepEqual(hostedActionAnswerSchema.parse({ result: ACTION_RESULT_STATUS.ACCEPTED }), {
    result: ACTION_RESULT_STATUS.ACCEPTED,
  });
  assert.deepEqual(
    hostedActionAnswerSchema.parse({
      result: ACTION_RESULT_STATUS.REJECTED,
      reason: " not found ",
    }),
    { result: ACTION_RESULT_STATUS.REJECTED, reason: " not found " },
  );
  assert.equal(hostedActionAnswerSchema.parse({ result: "queued" }), undefined);
  assert.equal(hostedActionAnswerSchema.parse({}), undefined);
});

test("a reason that says nothing is left out rather than refusing the outcome", () => {
  const answer = hostedActionAnswerSchema.parse({
    result: ACTION_RESULT_STATUS.ACCEPTED,
    reason: "",
  });
  assert.deepEqual(answer, { result: ACTION_RESULT_STATUS.ACCEPTED });
  assert.deepEqual(
    hostedActionAnswerSchema.parse({ result: ACTION_RESULT_STATUS.ACCEPTED, reason: 7 }),
    {
      result: ACTION_RESULT_STATUS.ACCEPTED,
    },
  );
});

test("a creation answer carries the session id the provider named, when it named one", () => {
  assert.deepEqual(
    hostedActionWorkspaceAnswerSchema.parse({
      result: ACTION_RESULT_STATUS.ACCEPTED,
      providerSessionId: "session-9",
    }),
    { result: ACTION_RESULT_STATUS.ACCEPTED, providerSessionId: "session-9" },
  );
  assert.deepEqual(
    hostedActionWorkspaceAnswerSchema.parse({
      result: ACTION_RESULT_STATUS.ACCEPTED,
      providerSessionId: "",
    }),
    { result: ACTION_RESULT_STATUS.ACCEPTED },
  );
});
