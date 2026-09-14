import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Result, Schema } from "effect";
import { test } from "vitest";
import { SETTINGS_RESET_SCOPE } from "./schema.js";
import { SettingsResetScopeSchema } from "./schema-access.js";

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

function settlesVocabulary<Member extends string>(
  schema: Schema.Codec<Member>,
  members: readonly Member[],
  alsoRefused: readonly UnparsedWireValue[] = [],
): void {
  const decode = Schema.decodeUnknownResult(schema);
  for (const member of members) assert.deepEqual(decode(member), Result.succeed(member));
  for (const refused of [...NOTHING_ANY_VOCABULARY_HOLDS, ...alsoRefused]) {
    assert.equal(Result.isFailure(decode(refused)), true);
  }
}

test("the reset scope schema holds exactly the scopes settings resets by", () => {
  settlesVocabulary(SettingsResetScopeSchema, Object.values(SETTINGS_RESET_SCOPE), ["appearances"]);
});
