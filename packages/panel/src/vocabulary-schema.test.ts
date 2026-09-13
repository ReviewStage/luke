import assert from "node:assert/strict";
import { APPLE_CALENDAR_ID, GOOGLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { HOSTED_AGENT_ID, PROVIDER_ID, SESSION_APPLICATION_ID } from "@sidecar/session";
import { Result, Schema } from "effect";
import { test } from "vitest";
import { MarkIdSchema } from "./provider-marks.js";

const MARK_IDS: readonly string[] = [
  APPLE_CALENDAR_ID,
  GOOGLE_CALENDAR_ID,
  CREDENTIAL_PROVIDER_ID.OPENAI,
  ...Object.values(PROVIDER_ID),
  ...Object.values(HOSTED_AGENT_ID),
  ...Object.values(SESSION_APPLICATION_ID),
];

test("the mark id schema holds exactly the ids the registry is required to draw", () => {
  const decode = Schema.decodeUnknownResult(MarkIdSchema);
  for (const markId of MARK_IDS) assert.deepEqual(decode(markId), Result.succeed(markId));
  for (const refused of ["a-provider-luke-has-no-mark-for", "", 17, true, {}, [], undefined]) {
    assert.equal(Result.isFailure(decode(refused)), true);
  }
});
