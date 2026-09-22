import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Result, Schema } from "effect";
import { test } from "vitest";
import { APP_SETTING_ID, AppSettingIdSchema } from "./app-settings.js";
import { APP_PANEL_TAB, APP_SETTING_KIND } from "./guide.js";

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

test("a setting id is one of the ids the build declares", () => {
  settlesVocabulary(AppSettingIdSchema, Object.values(APP_SETTING_ID), [
    APP_SETTING_KIND.TOGGLE,
    APP_PANEL_TAB.SESSIONS,
  ]);
});
