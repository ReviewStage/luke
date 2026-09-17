import assert from "node:assert/strict";
import {
  HOSTED_AGENT_ID,
  PROVIDER_ID,
  SESSION_APPLICATION_ID,
  SESSION_FILTER,
  SessionFilterSchema,
} from "@sidecar/session";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Result, Schema } from "effect";
import { test } from "vitest";

const NOTHING_ANY_VOCABULARY_HOLDS: readonly UnparsedWireValue[] = [
  "",
  " ",
  "not-a-member",
  undefined,
  17,
  true,
  {},
  [],
];

test("a session filter is a place, the voice kind, an app, or an agent, and nothing else", () => {
  // The filter is a union over four vocabularies, so a member any of them
  // declares has to be admitted and nothing outside the four may be.
  const decode = Schema.decodeUnknownResult(SessionFilterSchema);
  const members = [
    ...Object.values(SESSION_FILTER),
    ...Object.values(PROVIDER_ID),
    ...Object.values(HOSTED_AGENT_ID),
    ...Object.values(SESSION_APPLICATION_ID),
  ];
  for (const member of members) assert.deepEqual(decode(member), Result.succeed(member));
  for (const refused of NOTHING_ANY_VOCABULARY_HOLDS) {
    assert.equal(Result.isFailure(decode(refused)), true);
  }
});
