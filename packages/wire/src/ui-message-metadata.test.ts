import assert from "node:assert/strict";
import { type Schema as EffectSchema, Either } from "effect";
import { test } from "vitest";
import { emitJsonSchema, readEither } from "./effect/json-schema.js";
import { type UnparsedWireValue, unparsedWire } from "./json.js";
import { SCHEMA_REFUSAL, type SchemaPath } from "./schema-vocabulary.js";
import {
  ASSISTANT_MESSAGE_METADATA,
  COMPACTION_METADATA,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  OBSERVATION_SOURCE,
  USER_MESSAGE_METADATA,
} from "./ui-message-metadata.js";

function parse<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

function refusalOf<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): string {
  return Either.match(readEither(schema)(value), {
    onLeft: (refused) => refused.refusal,
    onRight: () => "admitted",
  });
}

function pathOf<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): SchemaPath {
  return Either.match(readEither(schema)(value), {
    onLeft: (refused) => refused.path,
    onRight: () => [],
  });
}

const spokenAsk = unparsedWire({
  author: MESSAGE_AUTHOR.DEVELOPER,
  channel: MESSAGE_CHANNEL.VOICE,
  voice_session_id: "vs_0f3a1c22",
  delegation_id: "dl_2b8c4d5e",
  from_ms: 1200,
  to_ms: 4800,
});

test("a user row is a typed ask, a spoken ask, or an observation, each admitted whole", () => {
  assert.deepEqual(
    parse(USER_MESSAGE_METADATA, {
      author: MESSAGE_AUTHOR.DEVELOPER,
      channel: MESSAGE_CHANNEL.TYPED,
    }),
    { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
  );
  assert.deepEqual(parse(USER_MESSAGE_METADATA, spokenAsk), {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: "vs_0f3a1c22",
    delegation_id: "dl_2b8c4d5e",
    from_ms: 1200,
    to_ms: 4800,
  });
  assert.deepEqual(
    parse(USER_MESSAGE_METADATA, {
      author: MESSAGE_AUTHOR.VOICE_MODEL,
      channel: MESSAGE_CHANNEL.VOICE,
    }),
    { author: MESSAGE_AUTHOR.VOICE_MODEL, channel: MESSAGE_CHANNEL.VOICE },
  );
  assert.deepEqual(
    parse(USER_MESSAGE_METADATA, {
      author: MESSAGE_AUTHOR.BRAIN,
      source: OBSERVATION_SOURCE.ROSTER_LOOK,
    }),
    { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.ROSTER_LOOK },
  );
});

test("every way the brain writes a user row for itself is a source, and a source the vocabulary does not name is refused", () => {
  const sources = Object.values(OBSERVATION_SOURCE);
  assert.deepEqual(
    sources.map((source) => parse(USER_MESSAGE_METADATA, { author: MESSAGE_AUTHOR.BRAIN, source })),
    sources.map((source) => ({ author: MESSAGE_AUTHOR.BRAIN, source })),
  );
  assert.deepEqual(
    new Set(sources),
    new Set([
      OBSERVATION_SOURCE.HOOK,
      OBSERVATION_SOURCE.ROSTER_LOOK,
      OBSERVATION_SOURCE.HOLD_RELEASE,
      OBSERVATION_SOURCE.CHILD,
      OBSERVATION_SOURCE.CHILD_COMPLETION,
      OBSERVATION_SOURCE.RECALLED_NOTES,
      OBSERVATION_SOURCE.ACTIVITY_NOTICES,
    ]),
  );
  const refused: UnparsedWireValue[] = [
    { author: MESSAGE_AUTHOR.BRAIN, source: "bulletin" },
    { author: MESSAGE_AUTHOR.BRAIN, source: MESSAGE_CHANNEL.TYPED },
    { author: MESSAGE_AUTHOR.BRAIN, source: "" },
    { author: MESSAGE_AUTHOR.BRAIN },
    { author: MESSAGE_AUTHOR.CHILD, source: OBSERVATION_SOURCE.CHILD },
    { author: MESSAGE_AUTHOR.DEVELOPER, source: OBSERVATION_SOURCE.HOLD_RELEASE },
  ];
  for (const value of refused) {
    assert.equal(refusalOf(USER_MESSAGE_METADATA, value), SCHEMA_REFUSAL.MALFORMED);
  }
});

test("the authors are bound to their shapes: a child never speaks as user, the brain never on a channel, the developer never as an observation", () => {
  const refused: UnparsedWireValue[] = [
    { author: MESSAGE_AUTHOR.CHILD, channel: MESSAGE_CHANNEL.TYPED },
    { author: MESSAGE_AUTHOR.BRAIN, channel: MESSAGE_CHANNEL.TYPED },
    { author: MESSAGE_AUTHOR.BRAIN, channel: MESSAGE_CHANNEL.VOICE },
    { author: MESSAGE_AUTHOR.DEVELOPER, source: OBSERVATION_SOURCE.HOOK },
    { author: MESSAGE_AUTHOR.VOICE_MODEL, source: OBSERVATION_SOURCE.ROSTER_LOOK },
    { author: MESSAGE_AUTHOR.VOICE_MODEL, channel: MESSAGE_CHANNEL.TYPED },
    {
      author: MESSAGE_AUTHOR.BRAIN,
      source: OBSERVATION_SOURCE.HOOK,
      channel: MESSAGE_CHANNEL.TYPED,
    },
    { author: MESSAGE_AUTHOR.DEVELOPER },
    { channel: MESSAGE_CHANNEL.TYPED },
    {},
    undefined,
  ];
  for (const value of refused) {
    assert.equal(refusalOf(USER_MESSAGE_METADATA, value), SCHEMA_REFUSAL.MALFORMED);
  }
});

test("the spoken fields belong to the voice channel and the span runs forward with both ends", () => {
  const refused: UnparsedWireValue[] = [
    { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED, voice_session_id: "vs_1" },
    { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED, from_ms: 10, to_ms: 20 },
    {
      author: MESSAGE_AUTHOR.DEVELOPER,
      channel: MESSAGE_CHANNEL.VOICE,
      from_ms: 4800,
      to_ms: 1200,
    },
    { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE, from_ms: 1200 },
    { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE, to_ms: 1200 },
    { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE, from_ms: -1, to_ms: 5 },
    { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE, from_ms: 1.5, to_ms: 5 },
  ];
  for (const value of refused) {
    assert.equal(refusalOf(USER_MESSAGE_METADATA, value), SCHEMA_REFUSAL.MALFORMED);
  }
  assert.deepEqual(
    parse(USER_MESSAGE_METADATA, {
      author: MESSAGE_AUTHOR.DEVELOPER,
      channel: MESSAGE_CHANNEL.VOICE,
      from_ms: 1200,
      to_ms: 1200,
    }),
    {
      author: MESSAGE_AUTHOR.DEVELOPER,
      channel: MESSAGE_CHANNEL.VOICE,
      from_ms: 1200,
      to_ms: 1200,
    },
  );
});

test("a key the vocabulary does not name is refused", () => {
  assert.equal(
    refusalOf(USER_MESSAGE_METADATA, {
      author: MESSAGE_AUTHOR.DEVELOPER,
      channel: MESSAGE_CHANNEL.TYPED,
      mood: "cheerful",
    }),
    SCHEMA_REFUSAL.MALFORMED,
  );
  assert.deepEqual(
    pathOf(ASSISTANT_MESSAGE_METADATA, { author: MESSAGE_AUTHOR.BRAIN, mood: "cheerful" }),
    ["mood"],
  );
});

test("an assistant row's author is the brain, the voice model, or a child, and never the developer", () => {
  for (const author of [MESSAGE_AUTHOR.BRAIN, MESSAGE_AUTHOR.VOICE_MODEL, MESSAGE_AUTHOR.CHILD]) {
    assert.deepEqual(parse(ASSISTANT_MESSAGE_METADATA, { author }), { author });
  }
  assert.deepEqual(pathOf(ASSISTANT_MESSAGE_METADATA, { author: MESSAGE_AUTHOR.DEVELOPER }), [
    "author",
  ]);
  assert.deepEqual(pathOf(ASSISTANT_MESSAGE_METADATA, {}), ["author"]);
  assert.equal(refusalOf(ASSISTANT_MESSAGE_METADATA, undefined), SCHEMA_REFUSAL.MALFORMED);
});

test("a compaction row names the first kept message, and the tokens it folded where the runtime counted them", () => {
  const compaction = {
    first_kept_message_id: "8a1d2e3f-4b5c-4d6e-8f90-1a2b3c4d5e6f",
    tokens_before: 48210,
  };
  assert.deepEqual(
    parse(ASSISTANT_MESSAGE_METADATA, { author: MESSAGE_AUTHOR.BRAIN, compaction }),
    {
      author: MESSAGE_AUTHOR.BRAIN,
      compaction,
    },
  );
  const uncounted = { first_kept_message_id: compaction.first_kept_message_id };
  assert.deepEqual(parse(COMPACTION_METADATA, uncounted), uncounted);
  assert.deepEqual(pathOf(COMPACTION_METADATA, { ...uncounted, tokens_before: null }), [
    "tokens_before",
  ]);
  assert.deepEqual(pathOf(COMPACTION_METADATA, { first_kept_message_id: "m", tokens_before: -1 }), [
    "tokens_before",
  ]);
  assert.deepEqual(
    pathOf(COMPACTION_METADATA, { first_kept_message_id: "m", tokens_before: 1.5 }),
    ["tokens_before"],
  );
  assert.deepEqual(pathOf(COMPACTION_METADATA, { tokens_before: 3 }), ["first_kept_message_id"]);
  assert.deepEqual(
    pathOf(ASSISTANT_MESSAGE_METADATA, {
      author: MESSAGE_AUTHOR.CHILD,
      compaction: { tokens_before: 3 },
    }),
    ["compaction", "first_kept_message_id"],
  );
});

test("the emitted schema offers the three user shapes and names only the fields each parser reads", () => {
  const user = emitJsonSchema(USER_MESSAGE_METADATA);
  assert.equal("anyOf" in user, true);
  if (!("anyOf" in user)) return;
  const shapes = user.anyOf.map((member) =>
    "type" in member && member.type === "object"
      ? { keys: Object.keys(member.properties).sort(), required: [...member.required].sort() }
      : undefined,
  );
  assert.deepEqual(shapes, [
    { keys: ["author", "channel"], required: ["author", "channel"] },
    {
      keys: ["author", "channel", "delegation_id", "from_ms", "to_ms", "voice_session_id"],
      required: ["author", "channel"],
    },
    { keys: ["author", "source"], required: ["author", "source"] },
  ]);
  const assistant = emitJsonSchema(ASSISTANT_MESSAGE_METADATA);
  assert.equal("type" in assistant && assistant.type, "object");
  if (!("type" in assistant) || assistant.type !== "object") return;
  assert.deepEqual(Object.keys(assistant.properties).sort(), ["author", "compaction"]);
  assert.deepEqual([...assistant.required], ["author"]);
  assert.equal(assistant.additionalProperties, false);
});
