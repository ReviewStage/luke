import assert from "node:assert/strict";
import { Result } from "effect";
import { test } from "vitest";
import { ACTION_RESULT_STATUS, ActionResultSchema } from "./action-result.js";
import { readEither } from "./effect/json-schema.js";

test("the accepted action result carries exactly its one field", () => {
  // The read is what refuses a key the declaration does not name: v4 settles
  // parse options at the read rather than on the declaration.
  const decode = readEither(ActionResultSchema);
  assert.deepEqual(
    decode({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    Result.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  );
  assert.equal(
    Result.isFailure(decode({ status: ACTION_RESULT_STATUS.ACCEPTED, reason: "x" })),
    true,
  );
});
