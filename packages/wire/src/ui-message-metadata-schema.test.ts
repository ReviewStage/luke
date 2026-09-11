import assert from "node:assert/strict";
import { Either, Schema } from "effect";
import { test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  ActionResultSchema,
  ActionResultStatusSchema,
} from "./action-result.js";
import { type UnparsedWireValue, unparsedWire } from "./json.js";
import {
  ASSISTANT_MESSAGE_METADATA_STANDARD_SCHEMA,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MessageAuthorSchema,
  MessageChannelSchema,
  MessageRoleSchema,
  OBSERVATION_SOURCE,
  ObservationSourceSchema,
  USER_MESSAGE_METADATA_STANDARD_SCHEMA,
} from "./ui-message-metadata.js";

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
): void {
  const decode = Schema.decodeUnknownEither(schema);
  for (const member of members) assert.deepEqual(decode(member), Either.right(member));
  for (const refused of NOTHING_ANY_VOCABULARY_HOLDS) {
    assert.equal(Either.isLeft(decode(refused)), true);
  }
}

test("the message vocabularies hold exactly the members the build declares", () => {
  settlesVocabulary(MessageAuthorSchema, Object.values(MESSAGE_AUTHOR));
  settlesVocabulary(MessageChannelSchema, Object.values(MESSAGE_CHANNEL));
  settlesVocabulary(ObservationSourceSchema, Object.values(OBSERVATION_SOURCE));
  settlesVocabulary(ActionResultStatusSchema, Object.values(ACTION_RESULT_STATUS));
});

test("MessageRoleSchema admits the three roles a stored row may carry, and nothing else", () => {
  const decode = Schema.decodeUnknownEither(MessageRoleSchema);
  assert.deepEqual(
    ["user", "assistant", "system"].map((role) => decode(role)),
    ["user", "assistant", "system"].map((role) => Either.right(role)),
  );
  assert.equal(Either.isLeft(decode("developer")), true);
});

test("the accepted action result carries exactly its one field", () => {
  const decode = Schema.decodeUnknownEither(ActionResultSchema);
  assert.deepEqual(
    decode({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    Either.right({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  );
  assert.equal(Either.isLeft(decode({ status: ACTION_RESULT_STATUS.ACCEPTED, reason: "x" })), true);
});

test("the standard schema twin of the user metadata validates the same shape its wire schema admits", async () => {
  const outcome = await USER_MESSAGE_METADATA_STANDARD_SCHEMA["~standard"].validate(
    unparsedWire({ author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED }),
  );
  assert.deepEqual(outcome, {
    value: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
  });
  const refused = await USER_MESSAGE_METADATA_STANDARD_SCHEMA["~standard"].validate(
    unparsedWire({ author: MESSAGE_AUTHOR.BRAIN, channel: MESSAGE_CHANNEL.TYPED }),
  );
  assert.equal("issues" in refused && refused.issues !== undefined, true);
});

test("the standard schema twin of the assistant metadata validates the same shape its wire schema admits", async () => {
  const outcome = await ASSISTANT_MESSAGE_METADATA_STANDARD_SCHEMA["~standard"].validate(
    unparsedWire({ author: MESSAGE_AUTHOR.BRAIN }),
  );
  assert.deepEqual(outcome, { value: { author: MESSAGE_AUTHOR.BRAIN } });
  const refused = await ASSISTANT_MESSAGE_METADATA_STANDARD_SCHEMA["~standard"].validate(
    unparsedWire({ author: MESSAGE_AUTHOR.DEVELOPER }),
  );
  assert.equal("issues" in refused && refused.issues !== undefined, true);
});
