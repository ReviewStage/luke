import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_TURN_TRIGGER,
  type BrainJournalEntry,
  type BrainPersistedState,
  type BrainRequestRecord,
  BrainStateStore,
  freshBrainState,
} from "@sidecar/brain";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  maximumStoredConversationEntries,
  storedConversationMaximumAgeMs,
} from "@sidecar/session";
import { and, eq, getTableName, sql } from "drizzle-orm";
import {
  COMPACTION_SOURCE,
  CONTEXT_INPUT_KIND,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  RUN_END_REASON,
  RUN_ORIGIN,
  SAVE_KIND,
  type SessionKey,
  TRANSCRIPT_EVENT_KIND,
  type TranscriptEvent,
  threadSessionKey,
} from "../server/core";
import {
  actionReceipt,
  briefing,
  compactionBoundary,
  conversation,
  conversationLine,
  conversationRun,
  conversationSession,
  observationCaptureCursor,
  observationCursor,
  observationInboxEntry,
  personalFact,
  rosterSnapshot,
  runtimeCheckpoint,
  transcriptEvent,
  user,
  workspaceFile,
} from "../server/db/schema";
import { payloadKeyRing } from "../server/hosted/encryption";
import { BRIEFING_STATE } from "../server/hosted/store";
import { loadBrainEnvelope, saveBrainEnvelope } from "../server/hosted/store/brain-envelope";
import { userSeal } from "../server/hosted/store/database";
import {
  type HostedStoreTestDatabase,
  openHostedStoreTestDatabase,
  TEST_PAYLOAD_SECRET,
} from "./support/hosted-store-database";

/** Synthetic fixtures: no real title, branch, or transcript anywhere. */

const NOW = 1_800_000_000_000;
const THREAD_KEY = threadSessionKey("11111111-1111-4111-8111-111111111111");

const opening = openHostedStoreTestDatabase();
after(async () => {
  await (await opening).close();
});

async function conversationFor(
  sessionKey: SessionKey = MAIN_SESSION_KEY,
): Promise<{ database: HostedStoreTestDatabase; userId: string }> {
  const database = await opening;
  const userId = await database.createUser();
  await database.store.conversations.create(userId, {
    sessionKey,
    name: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
  return { database, userId };
}

function request(runId: string, overrides: Partial<BrainRequestRecord> = {}): BrainRequestRecord {
  return {
    runId,
    submissionId: `submission-${runId}`,
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
    question: `question for ${runId}`,
    status: BRAIN_REQUEST_STATUS.QUEUED,
    revision: 0,
    acceptedAt: NOW,
    performedActions: 0,
    unknownActions: 0,
    ...overrides,
  };
}

function receipt(
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

function populatedState(generationId: string): BrainPersistedState {
  return {
    ...freshBrainState(generationId, NOW),
    checkpointFormat: "tool-loop@1:openai-responses-input/1",
    items: [
      { type: "message", role: "user", content: "one" },
      { type: "message", role: "assistant", content: "two" },
    ],
    compactionCount: 1,
    cursors: { conductor: { "session-a": "cursor-a" } },
    captureCursors: { conductor: { "session-a": "cursor-b" } },
    inbox: [
      {
        id: "entry-1",
        kind: "hook",
        providerId: "conductor",
        providerSessionId: "session-a",
        atMs: NOW,
        capturedAt: NOW,
        delta: { text: "delta text", truncated: false, status: "accepted" },
        cursor: "cursor-b",
      },
    ],
    requests: [
      request("run-1", {
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        text: "reply one",
        settledAt: NOW,
      }),
      request("run-2"),
    ],
    journal: [
      receipt("run-1", "call-1", {
        outputJson: JSON.stringify({ status: "accepted" }),
        settledAt: NOW,
      }),
      receipt("run-2", "call-2"),
    ],
  };
}

function line(
  words: string,
  overrides: Partial<ConversationEntry> = {},
): ConversationEntry & { recordedAt: number } {
  return { kind: CONVERSATION_ENTRY_KIND.REPLY, words, recordedAt: NOW, ...overrides };
}

const CHECKPOINT_INPUT: TranscriptEvent = {
  kind: TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
  recordedAt: NOW,
  input: { kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "an ask" },
};

const COMPACTION: TranscriptEvent = {
  kind: TRANSCRIPT_EVENT_KIND.COMPACTION,
  recordedAt: NOW + 1,
  boundary: { source: COMPACTION_SOURCE.PROVIDER_EXPLICIT, dropped: 3 },
};

test("the envelope round-trips through the tables, requests and receipts in their order, every user-derived column sealed", async () => {
  const { database, userId } = await conversationFor();
  const repository = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  assert.deepEqual(await repository.load(), { unreadable: false });

  const state = populatedState("gen-1");
  assert.equal(await repository.save(state), true);
  assert.deepEqual(await database.store.brainStateRepository(userId, MAIN_SESSION_KEY).load(), {
    state,
  });

  const [runRow] = await database.db
    .select()
    .from(conversationRun)
    .where(and(eq(conversationRun.userId, userId), eq(conversationRun.runId, "run-1")));
  assert.ok(runRow);
  assert.doesNotMatch(runRow.sealedQuestion, /question for/);
  assert.doesNotMatch(runRow.sealedText ?? "", /reply one/);
  const [itemRow] = await database.db
    .select()
    .from(runtimeCheckpoint)
    .where(eq(runtimeCheckpoint.userId, userId));
  assert.ok(itemRow);
  assert.doesNotMatch(itemRow.sealedItem, /assistant|one/);
  const [inboxRow] = await database.db
    .select()
    .from(observationInboxEntry)
    .where(eq(observationInboxEntry.userId, userId));
  assert.ok(inboxRow);
  assert.doesNotMatch(inboxRow.sealedPayload, /delta text/);
  assert.equal(inboxRow.entryId, "entry-1");
});

test("deltas leave the tables holding exactly the envelope given, checkpoint by checkpoint", async () => {
  const { database, userId } = await conversationFor();
  const repository = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  await repository.load();
  const first = populatedState("gen-1");
  assert.equal(await repository.save(first), true);

  const second: BrainPersistedState = {
    ...first,
    items: [first.items[0] ?? {}, { type: "message", role: "assistant", content: "changed" }],
    compactionCount: 2,
    cursors: { conductor: { "session-a": "cursor-c", "session-b": "cursor-d" } },
    inbox: [],
    requests: [
      {
        ...request("run-1", { status: BRAIN_REQUEST_STATUS.SUCCEEDED, text: "reply one" }),
        revision: 1,
      },
      request("run-3"),
    ],
    journal: [receipt("run-3", "call-3")],
  };
  assert.equal(await repository.save(second), true);
  const fresh = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  assert.deepEqual(await fresh.load(), { state: second });

  const runs = await database.db
    .select({ runId: conversationRun.runId })
    .from(conversationRun)
    .where(eq(conversationRun.userId, userId));
  assert.deepEqual(runs.map((row) => row.runId).sort(), ["run-1", "run-3"]);
});

test("a stale handle cannot save over a newer generation, whole or by delta, and stays refused until it loads again", async () => {
  const { database, userId } = await conversationFor();
  const first = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  const second = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  await first.load();
  await second.load();
  assert.equal(await first.save(populatedState("gen-1")), true);

  assert.equal(await second.save(populatedState("gen-2")), false);
  assert.equal(await second.save({ ...populatedState("gen-1"), compactionCount: 9 }), false);
  assert.equal((await first.load()).state?.generationId, "gen-1");

  await second.load();
  assert.equal(await second.save(populatedState("gen-2")), true);
  assert.equal(await first.save({ ...populatedState("gen-1"), compactionCount: 9 }), false);
  assert.equal((await second.load()).state?.generationId, "gen-2");
});

test("a generation whose rows cannot be opened is unreadable and is repaired by the store that observed it, by no stale writer", async () => {
  const { database, userId } = await conversationFor();
  const stale = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  await stale.load();
  const writer = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  await writer.load();
  assert.equal(await writer.save(populatedState("gen-1")), true);

  await database.db
    .update(runtimeCheckpoint)
    .set({ sealedItem: "1:not-an-envelope" })
    .where(eq(runtimeCheckpoint.userId, userId));

  const observer = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  assert.deepEqual(await observer.load(), { unreadable: true });
  assert.equal(await stale.save(populatedState("gen-stale")), false);
  assert.equal(await observer.save(populatedState("gen-2")), true);
  assert.deepEqual(await database.store.brainStateRepository(userId, MAIN_SESSION_KEY).load(), {
    state: populatedState("gen-2"),
  });
});

test("the BrainStateStore keeps its fence and Clear guarantees over the hosted repository, and the Clear hard-deletes the lines at or before it", async () => {
  const { database, userId } = await conversationFor();
  const store = new BrainStateStore({
    repository: database.store.brainStateRepository(userId, MAIN_SESSION_KEY),
    createGenerationId: () => "gen-fresh",
    now: () => NOW + 10,
  });
  const loaded = await store.load();
  assert.equal(loaded.generationId, "gen-fresh");
  await store.flush();

  const before = await database.store.lines.append(
    userId,
    MAIN_SESSION_KEY,
    [line("before the clear", { eventId: "line-1" })],
    NOW + 10,
  );
  assert.equal(before.entries.length, 1);

  assert.equal(await store.clear(NOW + 20), true);
  assert.deepEqual(store.resetMarker(), { clearedAt: NOW + 20, generationId: "gen-fresh" });
  assert.equal(await database.store.lines.cutoff(userId, MAIN_SESSION_KEY), NOW + 20);
  const rows = await database.db
    .select()
    .from(conversationLine)
    .where(eq(conversationLine.userId, userId));
  assert.equal(rows.length, 0);

  const late = await database.store.lines.append(
    userId,
    MAIN_SESSION_KEY,
    [
      line("from before, arriving late", { eventId: "line-2", recordedAt: NOW + 15 }),
      line("after the clear", { eventId: "line-3", recordedAt: NOW + 25 }),
    ],
    NOW + 30,
  );
  assert.deepEqual(
    late.entries.map((entry) => entry.words),
    ["after the clear"],
  );

  assert.equal(await store.reset(NOW + 40), true);
  assert.equal(store.resetMarker(), undefined);
  assert.deepEqual(
    (await database.store.lines.list(userId, MAIN_SESSION_KEY, NOW + 50)).map((e) => e.words),
    ["after the clear"],
  );
  assert.equal(await database.store.lines.cutoff(userId, MAIN_SESSION_KEY), NOW + 20);
});

test("line appends are idempotent on the line's own id, a line learns its run, and a run's line of a kind is published once", async () => {
  const { database, userId } = await conversationFor();
  const lines = database.store.lines;

  const first = await lines.append(
    userId,
    MAIN_SESSION_KEY,
    [line("said once", { eventId: "line-1" }), line("said once", { eventId: "line-2" })],
    NOW,
  );
  assert.equal(first.changed, true);
  assert.equal(first.entries.length, 2);
  const again = await lines.append(
    userId,
    MAIN_SESSION_KEY,
    [line("said once", { eventId: "line-1" })],
    NOW,
  );
  assert.equal(again.changed, false);
  assert.equal(again.entries.length, 2);

  const valued = await lines.append(userId, MAIN_SESSION_KEY, [line("no id"), line("no id")], NOW);
  assert.equal(valued.entries.filter((entry) => entry.words === "no id").length, 1);

  const learned = await lines.append(
    userId,
    MAIN_SESSION_KEY,
    [line("said once", { eventId: "line-1", requestId: "run-1" })],
    NOW,
  );
  assert.equal(learned.changed, true);
  assert.equal(learned.entries.find((entry) => entry.eventId === "line-1")?.requestId, "run-1");

  const republished = await lines.append(
    userId,
    MAIN_SESSION_KEY,
    [line("a second reply for the run", { eventId: "line-9", requestId: "run-1" })],
    NOW,
  );
  assert.equal(republished.changed, false);
  assert.equal(
    republished.entries.some((entry) => entry.eventId === "line-9"),
    false,
  );

  const keyRows = await database.db
    .select({ eventKey: conversationLine.eventKey, sealedPayload: conversationLine.sealedPayload })
    .from(conversationLine)
    .where(eq(conversationLine.userId, userId));
  for (const row of keyRows) {
    assert.match(row.eventKey, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(row.sealedPayload, /said once|no id/);
  }
});

test("the sequence counts up and is never reused, and the projection keeps 200 recent lines under the age bound", async () => {
  const { database, userId } = await conversationFor();
  const entries = Array.from({ length: maximumStoredConversationEntries + 5 }, (_, index) =>
    line(`line ${index}`, { eventId: `line-${index}`, recordedAt: NOW + index }),
  );
  entries.push(
    line("too old", { eventId: "old", recordedAt: NOW - storedConversationMaximumAgeMs }),
  );
  const outcome = await database.store.lines.append(userId, MAIN_SESSION_KEY, entries, NOW + 1000);
  assert.equal(outcome.entries.length, maximumStoredConversationEntries);
  assert.equal(outcome.entries[0]?.words, "line 5");
  assert.equal(outcome.entries.at(-1)?.words, `line ${maximumStoredConversationEntries + 4}`);

  const [row] = await database.db
    .select({ next: conversation.nextLineSequence })
    .from(conversation)
    .where(and(eq(conversation.userId, userId), eq(conversation.sessionKey, MAIN_SESSION_KEY)));
  assert.equal(row?.next, entries.length + 1);
  const stored = await database.db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversationLine)
    .where(eq(conversationLine.userId, userId));
  assert.equal(stored[0]?.count, entries.length);
});

test("a checkpoint's transcript lands in the same transaction as the envelope, a compaction keeps the record and the boundary, and Start fresh keeps both", async () => {
  const { database, userId } = await conversationFor();
  const repository = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  await repository.load();
  const state = populatedState("gen-1");
  assert.equal(await repository.save(state, [CHECKPOINT_INPUT, COMPACTION]), true);

  const transcript = await database.store.transcript.list(userId, MAIN_SESSION_KEY);
  assert.deepEqual(
    transcript.map((stored) => ({
      sequence: stored.sequence,
      sessionId: stored.sessionId,
      kind: stored.event.kind,
    })),
    [
      { sequence: 1, sessionId: "gen-1", kind: TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT },
      { sequence: 2, sessionId: "gen-1", kind: TRANSCRIPT_EVENT_KIND.COMPACTION },
    ],
  );
  assert.deepEqual(transcript[0]?.event, CHECKPOINT_INPUT);
  assert.deepEqual(await database.store.transcript.boundaries(userId, MAIN_SESSION_KEY), [
    {
      transcriptSequence: 2,
      sessionId: "gen-1",
      source: COMPACTION_SOURCE.PROVIDER_EXPLICIT,
      dropped: 3,
      createdAt: NOW + 1,
    },
  ]);
  const [eventRow] = await database.db
    .select()
    .from(transcriptEvent)
    .where(eq(transcriptEvent.userId, userId));
  assert.doesNotMatch(eventRow?.sealedPayload ?? "", /an ask/);

  const refused = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  assert.equal(await refused.save(populatedState("gen-x"), [CHECKPOINT_INPUT]), false);
  assert.equal((await database.store.transcript.list(userId, MAIN_SESSION_KEY)).length, 2);

  assert.equal(await repository.save(freshBrainState("gen-2", NOW + 5)), true);
  assert.equal((await database.store.transcript.list(userId, MAIN_SESSION_KEY)).length, 2);
  assert.equal(
    (await database.store.transcript.list(userId, MAIN_SESSION_KEY, { afterSequence: 1 })).length,
    1,
  );
  const rows = await database.db
    .select({ count: sql<number>`count(*)::int` })
    .from(runtimeCheckpoint)
    .where(eq(runtimeCheckpoint.userId, userId));
  assert.equal(rows[0]?.count, 0);
});

test("the conversation directory lists what the user holds, creation is idempotent, and the hard delete takes every row under it", async () => {
  const { database, userId } = await conversationFor();
  const other = await database.createUser();
  await database.store.conversations.create(other, {
    sessionKey: MAIN_SESSION_KEY,
    name: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
  const created = await database.store.conversations.create(userId, {
    sessionKey: THREAD_KEY,
    name: "a thread",
    now: NOW + 1,
  });
  const again = await database.store.conversations.create(userId, {
    sessionKey: THREAD_KEY,
    name: "renamed by a retry",
    now: NOW + 2,
  });
  assert.deepEqual(again, created);
  assert.deepEqual(
    (await database.store.conversations.list(userId)).map((record) => [
      record.sessionKey,
      record.kind,
      record.name,
    ]),
    [
      [MAIN_SESSION_KEY, "main", MAIN_CONVERSATION_NAME],
      [THREAD_KEY, "thread", "a thread"],
    ],
  );

  const repository = database.store.brainStateRepository(userId, THREAD_KEY);
  await repository.load();
  await repository.save(populatedState("gen-thread"), [CHECKPOINT_INPUT, COMPACTION]);
  await database.store.lines.append(
    userId,
    THREAD_KEY,
    [line("in the thread", { eventId: "t-1" })],
    NOW,
  );
  assert.equal((await database.store.conversations.list(userId))[1]?.sessionId, "gen-thread");

  assert.equal(await database.store.conversations.delete(userId, THREAD_KEY), true);
  assert.equal(await database.store.conversations.delete(userId, THREAD_KEY), false);
  assert.equal((await database.store.conversations.list(userId)).length, 1);
  for (const table of [conversationLine, transcriptEvent, compactionBoundary]) {
    const rows = await database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(and(eq(table.userId, userId), eq(table.sessionKey, THREAD_KEY)));
    assert.equal(rows[0]?.count, 0);
  }
  const sessions = await database.db
    .select()
    .from(conversationSession)
    .where(eq(conversationSession.userId, userId));
  assert.equal(sessions.length, 0);
  assert.equal((await database.store.conversations.list(other)).length, 1);
});

test("a run's about-fields land on its row, survive a record upsert, and answer nothing for a run the tables do not hold", async () => {
  const { database, userId } = await conversationFor();
  const repository = database.store.brainStateRepository(userId, MAIN_SESSION_KEY);
  await repository.load();
  const state = populatedState("gen-1");
  await repository.save(state);

  assert.deepEqual(await database.store.runs.about(userId, "run-1"), {});
  assert.equal(await database.store.runs.about(userId, "run-missing"), undefined);
  const about = {
    trigger: BRAIN_TURN_TRIGGER.ASK,
    origin: RUN_ORIGIN.USER,
    ending: RUN_END_REASON.COMPLETED,
    inputTokens: 1200,
    outputTokens: 80,
    inputItemKinds: ["message", "function_call"],
    transcriptBytes: 4096,
    elapsedMs: 2500,
    toolNames: ["send_message", "read_transcript"],
    compacted: false,
  };
  assert.equal(await database.store.runs.recordAbout(userId, "run-1", about), true);
  assert.deepEqual(await database.store.runs.about(userId, "run-1"), about);
  assert.equal(await database.store.runs.recordAbout(userId, "run-missing", about), false);

  await repository.save({
    ...state,
    requests: state.requests.map((record) =>
      record.runId === "run-1" ? { ...record, revision: 2, text: "amended" } : record,
    ),
  });
  assert.deepEqual(await database.store.runs.about(userId, "run-1"), about);
  assert.equal(
    (await repository.load()).state?.requests.find((record) => record.runId === "run-1")?.text,
    "amended",
  );
});

test("facts are listed in order and replaced whole, a kept id keeping its first instant, and sealed at rest", async () => {
  const { database, userId } = await conversationFor();
  assert.deepEqual(await database.store.facts.list(userId), []);
  const first = await database.store.facts.replace(
    userId,
    [
      { id: "fact-1", words: "prefers short replies" },
      { id: "fact-2", words: "works in the mornings" },
    ],
    NOW,
  );
  assert.deepEqual(first, [
    { id: "fact-1", words: "prefers short replies", createdAt: NOW },
    { id: "fact-2", words: "works in the mornings", createdAt: NOW },
  ]);
  const second = await database.store.facts.replace(
    userId,
    [
      { id: "fact-3", words: "uses a standing desk" },
      { id: "fact-1", words: "prefers short replies" },
    ],
    NOW + 5,
  );
  assert.deepEqual(second, [
    { id: "fact-3", words: "uses a standing desk", createdAt: NOW + 5 },
    { id: "fact-1", words: "prefers short replies", createdAt: NOW },
  ]);
  const rows = await database.db.select().from(personalFact).where(eq(personalFact.userId, userId));
  for (const row of rows) assert.doesNotMatch(row.sealedWords, /prefers|standing/);
});

test("workspace files are read and written whole per user and path, seeded once, and refuse a path outside the workspace", async () => {
  const { database, userId } = await conversationFor();
  const workspace = database.store.workspace;
  assert.equal(await workspace.read(userId, "AGENTS.md"), undefined);
  assert.equal(await workspace.seed(userId, "AGENTS.md", "# seed", NOW), true);
  assert.equal(await workspace.seed(userId, "AGENTS.md", "# a later seed", NOW + 1), false);
  await workspace.write(userId, "memory/2026-09-09.md", "- a note", NOW + 2);
  await workspace.write(userId, "AGENTS.md", "# edited", NOW + 3);
  assert.deepEqual(await workspace.read(userId, "AGENTS.md"), {
    path: "AGENTS.md",
    content: "# edited",
    createdAt: NOW,
    updatedAt: NOW + 3,
  });
  assert.deepEqual(await workspace.list(userId), [
    { path: "AGENTS.md", updatedAt: NOW + 3 },
    { path: "memory/2026-09-09.md", updatedAt: NOW + 2 },
  ]);
  for (const path of ["/etc/passwd", "../SOUL.md", "memory/../../x", "", "a//b", "a\\b"]) {
    await assert.rejects(workspace.write(userId, path, "x", NOW), /workspace path/);
    await assert.rejects(workspace.read(userId, path), /workspace path/);
  }
  assert.equal(await workspace.delete(userId, "memory/2026-09-09.md"), true);
  assert.equal(await workspace.delete(userId, "memory/2026-09-09.md"), false);
  const rows = await database.db
    .select()
    .from(workspaceFile)
    .where(eq(workspaceFile.userId, userId));
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0]?.sealedContent ?? "", /edited/);

  const other = await database.createUser();
  assert.equal(await workspace.read(other, "AGENTS.md"), undefined);
});

test("the roster snapshot is one sealed row per user, replaced whole", async () => {
  const { database, userId } = await conversationFor();
  assert.equal(await database.store.roster.read(userId), undefined);
  await database.store.roster.write(userId, {
    body: JSON.stringify({ sessions: ["a"] }),
    observedAt: NOW,
  });
  await database.store.roster.write(userId, {
    body: JSON.stringify({ sessions: ["b"] }),
    observedAt: NOW + 1,
  });
  assert.deepEqual(await database.store.roster.read(userId), {
    body: JSON.stringify({ sessions: ["b"] }),
    observedAt: NOW + 1,
  });
  const rows = await database.db
    .select()
    .from(rosterSnapshot)
    .where(eq(rosterSnapshot.userId, userId));
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0]?.sealedBody ?? "", /sessions/);
});

test("a briefing is offered once, claimed by one device once, settled only by its claimer or the push, and expired when its time comes", async () => {
  const { database, userId } = await conversationFor();
  const briefings = database.store.briefings;
  const offered = {
    id: "briefing-1",
    sessionKey: MAIN_SESSION_KEY,
    runId: "run-1",
    words: "a session needs you",
    decidedAt: NOW,
    expiresAt: NOW + 60_000,
  };
  assert.equal(await briefings.insert(userId, offered), true);
  assert.equal(await briefings.insert(userId, offered), false);
  const other = await database.createUser();
  assert.equal(await briefings.insert(other, offered), true);
  assert.equal((await briefings.list(other)).length, 1);
  assert.deepEqual(await briefings.list(userId, BRIEFING_STATE.OFFERED), [
    { ...offered, state: BRIEFING_STATE.OFFERED },
  ]);

  assert.equal(await briefings.markSpoken(userId, "briefing-1", "mac", NOW + 1), false);
  assert.equal(await briefings.claim(userId, "briefing-1", "mac", NOW + 1), true);
  assert.equal(await briefings.claim(userId, "briefing-1", "phone", NOW + 2), false);
  assert.equal(await briefings.markSpoken(userId, "briefing-1", "phone", NOW + 3), false);
  assert.equal(await briefings.markSpoken(userId, "briefing-1", "mac", NOW + 3), true);
  assert.equal(await briefings.markPushed(userId, "briefing-1", NOW + 4), false);
  assert.deepEqual(await briefings.list(userId), [
    {
      ...offered,
      state: BRIEFING_STATE.SPOKEN,
      claimedByDeviceId: "mac",
      claimedAt: NOW + 1,
      settledAt: NOW + 3,
    },
  ]);

  await briefings.insert(userId, { ...offered, id: "briefing-2", decidedAt: NOW + 10 });
  assert.equal(await briefings.markPushed(userId, "briefing-2", NOW + 11), true);
  await briefings.insert(userId, { ...offered, id: "briefing-3", decidedAt: NOW + 20 });
  await briefings.insert(userId, {
    ...offered,
    id: "briefing-4",
    decidedAt: NOW + 30,
    expiresAt: NOW + 99_000,
  });
  assert.equal(await briefings.claim(userId, "briefing-3", "mac", NOW + 60_000), false);
  assert.deepEqual(await briefings.expire(userId, NOW + 60_000), ["briefing-3"]);
  assert.equal((await briefings.list(userId, BRIEFING_STATE.EXPIRED))[0]?.id, "briefing-3");
  assert.equal((await briefings.list(userId, BRIEFING_STATE.OFFERED))[0]?.id, "briefing-4");
  const rows = await database.db.select().from(briefing).where(eq(briefing.userId, userId));
  for (const row of rows) assert.doesNotMatch(row.sealedWords, /needs you/);
});

test("deleting the user row cascades through every conversation table and leaves another user's rows standing", async () => {
  const { database, userId } = await conversationFor();
  const { userId: other } = await conversationFor();
  for (const id of [userId, other]) {
    const repository = database.store.brainStateRepository(id, MAIN_SESSION_KEY);
    await repository.load();
    await repository.save(populatedState(`gen-${id}`), [CHECKPOINT_INPUT, COMPACTION]);
    await database.store.lines.append(
      id,
      MAIN_SESSION_KEY,
      [line("hello", { eventId: "l-1" })],
      NOW,
    );
    await database.store.facts.replace(id, [{ id: "f-1", words: "a fact" }], NOW);
    await database.store.workspace.write(id, "USER.md", "# user", NOW);
    await database.store.roster.write(id, { body: "{}", observedAt: NOW });
    await database.store.briefings.insert(id, {
      id: "briefing-shared-id",
      sessionKey: MAIN_SESSION_KEY,
      words: "words",
      decidedAt: NOW,
      expiresAt: NOW + 1,
    });
  }

  await database.db.delete(user).where(eq(user.id, userId));

  const tables = [
    conversation,
    conversationSession,
    runtimeCheckpoint,
    observationCursor,
    observationCaptureCursor,
    observationInboxEntry,
    conversationRun,
    actionReceipt,
    conversationLine,
    transcriptEvent,
    compactionBoundary,
    personalFact,
    workspaceFile,
    rosterSnapshot,
    briefing,
  ];
  for (const table of tables) {
    const gone = await database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.userId, userId));
    assert.equal(gone[0]?.count, 0, `${getTableName(table)} still holds rows for the deleted user`);
    const kept = await database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.userId, other));
    assert.ok((kept[0]?.count ?? 0) > 0, `${getTableName(table)} lost the other user's rows`);
  }
});

test("a sealed row under one user does not open as another, and the raw table functions refuse a payload the ring cannot vouch for", async () => {
  const { database, userId } = await conversationFor();
  const other = await database.createUser();
  const keys = payloadKeyRing(TEST_PAYLOAD_SECRET);
  await saveBrainEnvelope(database.db, userSeal(keys, userId), userId, MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    state: populatedState("gen-1"),
  });
  const read = await loadBrainEnvelope(
    database.db,
    userSeal(keys, other),
    userId,
    MAIN_SESSION_KEY,
  );
  assert.deepEqual(read, { unreadable: true, generation: "gen-1" });
  const own = await loadBrainEnvelope(
    database.db,
    userSeal(keys, userId),
    userId,
    MAIN_SESSION_KEY,
  );
  assert.deepEqual(own, { state: populatedState("gen-1"), generation: "gen-1" });
});
