import path from "node:path";
import type { PlatformError } from "@effect/platform/Error";
import { NodeFileSystem } from "@effect/platform-node";
import type { SqlClient } from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import { Cause, Effect, Exit } from "effect";
import { type BrainPersistedState, freshBrainState } from "../envelope.js";
import type { BrainJournalEntry } from "../journal.js";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  type BrainRequestRecord,
} from "../requests.js";
import { createConversation, createConversationEffect } from "./conversations-table.js";
import { AGENT_DATABASE_FILE, StoreDatabase } from "./database.js";
import type { StoreSchemaRefused } from "./migration.js";

/** Synthetic fixtures for the store's own tests: no real title, branch, or transcript anywhere. */

export const NOW = 1_800_000_000_000;

/**
 * A database opened by hand for a test that holds the handle itself, run on
 * the test's own runtime; the test releases it with `close()`. What the open
 * failed with is thrown as itself, so a test asserts the refusal it names.
 */
export function openDatabase(location: string): StoreDatabase {
  const exit = Effect.runSyncExit(StoreDatabase.open(location));
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}

export function openTestDatabase(location = ":memory:"): StoreDatabase {
  const database = openDatabase(location);
  createConversation(database, {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    name: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
  return database;
}

/**
 * A table module's effect over a database on disk that lives and dies with
 * the test's scope, with the main conversation standing: what a table test
 * in this directory opens with, since a module over the client takes no
 * handle of its own.
 */
export function overStore<A, E>(
  effect: Effect.Effect<A, E, SqlClient>,
): Effect.Effect<A, E | SqlError | StoreSchemaRefused | PlatformError> {
  return Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped();
    const database = yield* Effect.acquireRelease(
      StoreDatabase.open(path.join(directory, AGENT_DATABASE_FILE)),
      (opened) => Effect.sync(() => opened.close()),
    );
    return yield* Effect.provide(
      Effect.zipRight(
        createConversationEffect({
          agentId: DEFAULT_AGENT_ID,
          sessionKey: MAIN_SESSION_KEY,
          name: MAIN_CONVERSATION_NAME,
          now: NOW,
        }),
        effect,
      ),
      database.sql,
    );
  }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer));
}

export function request(
  runId: string,
  overrides: Partial<BrainRequestRecord> = {},
): BrainRequestRecord {
  return {
    runId,
    submissionId: `submission-${runId}`,
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
    question: `question for ${runId}`,
    status: BRAIN_REQUEST_STATUS.QUEUED,
    revision: 0,
    acceptedAt: NOW,
    performedActions: 0,
    unknownActions: 0,
    ...overrides,
  };
}

export function receipt(
  runId: string,
  callId: string,
  overrides: Partial<BrainJournalEntry> = {},
): BrainJournalEntry {
  return {
    runId,
    callId,
    name: "send_message",
    argumentsJson: JSON.stringify({ text: "hello" }),
    startedAt: NOW,
    ...overrides,
  };
}

export function populatedState(generationId: string, createdAt = NOW): BrainPersistedState {
  return {
    ...freshBrainState(generationId, createdAt),
    // A well-formed stamp, as `checkpointFormatTag` writes this build's own.
    checkpointFormat: "tool-loop@1:openai-responses-input/1",
    items: [
      { type: "message", role: "user", content: "first" },
      { type: "function_call", call_id: "call-1", name: "send_message", arguments: "{}" },
      { type: "function_call_output", call_id: "call-1", output: '{"status":"accepted"}' },
    ],
    cursors: { "claude-code": { "session-a": "cursor-1" }, codex: { "session-b": "cursor-2" } },
    requests: [
      request("run-1", {
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        text: "done",
        settledAt: NOW + 5,
      }),
      request("run-2", { status: BRAIN_REQUEST_STATUS.RUNNING, startedAt: NOW + 1 }),
    ],
    journal: [
      receipt("run-1", "call-1", { outputJson: '{"status":"accepted"}', settledAt: NOW + 2 }),
      receipt("run-2", "call-2"),
    ],
  };
}

export function line(
  words: string,
  recordedAt: number,
  overrides: Partial<ConversationEntry> = {},
): ConversationEntry {
  return { kind: CONVERSATION_ENTRY_KIND.REPLY, words, recordedAt, ...overrides };
}

/** What the history table holds for a conversation, retention or not: the raw rows a test asserts on. */
export interface ConversationTableContents {
  sequences: readonly number[];
  /** The distinct generations the lines were written under. */
  sessionIds: readonly (string | undefined)[];
  count: number;
}

export function inspectConversation(
  database: StoreDatabase,
  sessionKey: SessionKey,
): ConversationTableContents {
  // SAFETY: each query selects the one column its row type names.
  const sequences = database
    .prepare("SELECT sequence FROM conversation_events WHERE session_key = ? ORDER BY sequence")
    .all(sessionKey) as { sequence: number }[];
  // SAFETY: as above, for the nullable text column.
  const sessionIds = database
    .prepare(
      "SELECT DISTINCT session_id FROM conversation_events WHERE session_key = ? ORDER BY session_id",
    )
    .all(sessionKey) as { session_id: string | null }[];
  return {
    sequences: sequences.map((row) => row.sequence),
    sessionIds: sessionIds.map((row) => row.session_id ?? undefined),
    count: sequences.length,
  };
}
