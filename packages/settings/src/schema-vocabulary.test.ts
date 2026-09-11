import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Either, Schema } from "effect";
import { test } from "vitest";
import { SETTINGS_RESET_SCOPE, VOICE_SOURCE, VoiceSourceSchema } from "./schema.js";
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
  schema: Schema.Schema<Member>,
  members: readonly Member[],
  alsoRefused: readonly UnparsedWireValue[] = [],
): void {
  const decode = Schema.decodeUnknownEither(schema);
  for (const member of members) assert.deepEqual(decode(member), Either.right(member));
  for (const refused of [...NOTHING_ANY_VOCABULARY_HOLDS, ...alsoRefused]) {
    assert.equal(Either.isLeft(decode(refused)), true);
  }
}

test("the voice source schema holds exactly the account and key sources", () => {
  settlesVocabulary(VoiceSourceSchema, Object.values(VOICE_SOURCE), ["accounts", "keys"]);
});

test("the reset scope schema holds exactly the scopes settings resets by", () => {
  settlesVocabulary(SettingsResetScopeSchema, Object.values(SETTINGS_RESET_SCOPE), ["appearances"]);
});
