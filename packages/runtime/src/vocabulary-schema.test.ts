import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Either, Schema } from "effect";
import { test } from "vitest";
import {
  ARCHIVE_REASON,
  ArchiveReasonSchema,
  CHILD_CLEANUP,
  CHILD_CONTEXT_MODE,
  CHILD_RUN_STATUS,
  ChildCleanupSchema,
  ChildContextModeSchema,
  ChildRunStatusSchema,
  COMPACTION_SOURCE,
  CONVERSATION_KIND,
  CompactionSourceSchema,
  ConversationKindSchema,
  isTerminalChildRunStatus,
  REASONING_EFFORT,
  ReasoningEffortSchema,
  RUN_ORIGIN,
  RunOriginSchema,
} from "./vocabulary.js";

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

test("a child's context mode and cleanup hold exactly the words the build declares", () => {
  settlesVocabulary(ChildContextModeSchema, Object.values(CHILD_CONTEXT_MODE));
  settlesVocabulary(ChildCleanupSchema, Object.values(CHILD_CLEANUP));
});

test("a reasoning effort is one of the three fixed words", () => {
  settlesVocabulary(ReasoningEffortSchema, Object.values(REASONING_EFFORT));
});

test("a conversation kind and a run origin hold exactly the words the build declares", () => {
  settlesVocabulary(ConversationKindSchema, Object.values(CONVERSATION_KIND));
  settlesVocabulary(RunOriginSchema, Object.values(RUN_ORIGIN));
});

test("a compaction source and an archive reason hold exactly the words the build declares", () => {
  settlesVocabulary(CompactionSourceSchema, Object.values(COMPACTION_SOURCE));
  settlesVocabulary(ArchiveReasonSchema, Object.values(ARCHIVE_REASON));
});

test("a child run status holds exactly the words the build declares, terminal or not", () => {
  settlesVocabulary(ChildRunStatusSchema, Object.values(CHILD_RUN_STATUS));
  assert.equal(isTerminalChildRunStatus(CHILD_RUN_STATUS.ACCEPTED), false);
  assert.equal(isTerminalChildRunStatus(CHILD_RUN_STATUS.RUNNING), false);
  assert.equal(isTerminalChildRunStatus(CHILD_RUN_STATUS.COMPLETED), true);
  assert.equal(isTerminalChildRunStatus(CHILD_RUN_STATUS.FAILED), true);
  assert.equal(isTerminalChildRunStatus(CHILD_RUN_STATUS.TIMED_OUT), true);
  assert.equal(isTerminalChildRunStatus(CHILD_RUN_STATUS.CANCELLED), true);
  assert.equal(isTerminalChildRunStatus(CHILD_RUN_STATUS.UNKNOWN), true);
});
