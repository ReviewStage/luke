import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  type BrainJournalEntry,
  type BrainPersistedState,
  type BrainRequestRecord,
  freshBrainState,
} from "@sidecar/brain";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { createConversation } from "./conversations-table.js";
import { RuntimeDatabase } from "./database.js";

/** Synthetic fixtures for the store's own tests: no real title, branch, or transcript anywhere. */

export const NOW = 1_800_000_000_000;

export function openTestDatabase(location = ":memory:"): RuntimeDatabase {
  const database = RuntimeDatabase.open(location);
  createConversation(database, {
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    name: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
  return database;
}

export function request(
  runId: string,
  overrides: Partial<BrainRequestRecord> = {},
): BrainRequestRecord {
  return {
    runId,
    submissionId: `submission-${runId}`,
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
    question: `question for ${runId}`,
    status: BRAIN_REQUEST_STATUS.QUEUED,
    revision: 0,
    acceptedAt: NOW,
    performedActs: 0,
    unknownActs: 0,
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
export interface HistoryTableContents {
  sequences: readonly number[];
  /** The distinct generations the lines were written under. */
  sessionIds: readonly (string | undefined)[];
  count: number;
}

export function inspectHistory(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
): HistoryTableContents {
  // SAFETY: each query selects the one column its row type names.
  const sequences = database
    .prepare("SELECT sequence FROM history_events WHERE session_key = ? ORDER BY sequence")
    .all(sessionKey) as { sequence: number }[];
  // SAFETY: as above, for the nullable text column.
  const sessionIds = database
    .prepare(
      "SELECT DISTINCT session_id FROM history_events WHERE session_key = ? ORDER BY session_id",
    )
    .all(sessionKey) as { session_id: string | null }[];
  return {
    sequences: sequences.map((row) => row.sequence),
    sessionIds: sessionIds.map((row) => row.session_id ?? undefined),
    count: sequences.length,
  };
}
