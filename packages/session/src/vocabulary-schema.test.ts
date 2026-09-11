import assert from "node:assert/strict";
import {
  CLOUD_AGENT_PROVIDER_ID,
  CloudAgentProviderIdSchema,
  CONVERSATION_ENTRY_KIND,
  ConversationEntryKindSchema,
  HOSTED_AGENT_ID,
  HostedAgentIdSchema,
  ISSUE_TRACKER_ID,
  IssueTrackerIdSchema,
  PROVIDER_ID,
  ProviderIdSchema,
  SESSION_APPLICATION_ID,
  SESSION_FILTER,
  SESSION_LINK_SCHEME,
  SessionApplicationIdSchema,
  SessionFilterSchema,
  SessionLinkSchemeSchema,
  TOOL_PART_STATE,
  ToolPartStateSchema,
  WorkspaceProviderIdSchema,
} from "@sidecar/session";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Either, Schema } from "effect";
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

test("the provider catalog's schemas hold exactly the ids the build declares", () => {
  settlesVocabulary(ProviderIdSchema, Object.values(PROVIDER_ID), [
    SESSION_APPLICATION_ID.SUPERSET,
    HOSTED_AGENT_ID.CURSOR,
  ]);
  settlesVocabulary(CloudAgentProviderIdSchema, Object.values(CLOUD_AGENT_PROVIDER_ID), [
    PROVIDER_ID.CLAUDE_CODE,
    PROVIDER_ID.CODEX,
    PROVIDER_ID.OMP,
  ]);
  settlesVocabulary(HostedAgentIdSchema, Object.values(HOSTED_AGENT_ID), [PROVIDER_ID.CODEX]);
  settlesVocabulary(WorkspaceProviderIdSchema, Object.values(PROVIDER_ID), [
    SESSION_APPLICATION_ID.SUPERSET,
  ]);
});

test("a session filter is a place, the voice kind, an app, or an agent, and nothing else", () => {
  settlesVocabulary(SessionFilterSchema, [
    ...Object.values(SESSION_FILTER),
    ...Object.values(PROVIDER_ID),
    ...Object.values(HOSTED_AGENT_ID),
    ...Object.values(SESSION_APPLICATION_ID),
  ]);
  settlesVocabulary(SessionApplicationIdSchema, Object.values(SESSION_APPLICATION_ID), [
    SESSION_FILTER.VOICE,
    PROVIDER_ID.CODEX,
  ]);
});

test("an openable address wears one of the schemes this build fixed", () => {
  settlesVocabulary(SessionLinkSchemeSchema, Object.values(SESSION_LINK_SCHEME), [
    "http:",
    "file:",
    "https",
  ]);
});

test("the stored message vocabularies hold their own states alone", () => {
  settlesVocabulary(ToolPartStateSchema, Object.values(TOOL_PART_STATE), [
    "approval-requested",
    "output-denied",
  ]);
  settlesVocabulary(ConversationEntryKindSchema, Object.values(CONVERSATION_ENTRY_KIND), [
    "observation",
    "briefing",
  ]);
  settlesVocabulary(IssueTrackerIdSchema, Object.values(ISSUE_TRACKER_ID), [PROVIDER_ID.CODEX]);
});
