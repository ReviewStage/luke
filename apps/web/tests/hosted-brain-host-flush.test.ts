import assert from "node:assert/strict";
import { MEMORY_FLUSH_DEFAULTS, MEMORY_HOUSEKEEPING_OUTCOME } from "@sidecar/memory";
import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Effect, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { MemoryCompactionRequestedContext } from "eve/memory";
import { afterAll, test } from "vitest";
import { BRAIN_TOOL } from "../server/core";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
  type BrainHostTurn,
} from "../server/hosted/brain-host/bounds";
import { conversationOwnedBy, runtimeSessionOwner } from "../server/hosted/brain-host/conversation";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import {
  contextAsData,
  MEMORY_FLUSH,
  MEMORY_FLUSH_REFUSAL,
} from "../server/hosted/brain-host/memory-flush";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { storeWriter } from "../server/hosted/store";
import { InstantColumnSchema } from "../server/hosted/store/database";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, readMessagesByConversation } from "./support/store-rows";

/**
 * The pre-compaction memory flush as eve's memory slot hands it to the host,
 * over the real migrations on PGlite and a mock model standing where the
 * account's metered OpenAI would: an ask's compaction runs one housekeeping
 * turn offered `append_daily_note` alone, whose appends land in the day's
 * note and nowhere on the conversation; the cycle eve names flushes once,
 * however often eve replays the capture; a scaffolding turn — the roster's
 * observation, a hold's release — flushes nothing, as does a session the host
 * does not admit; and every failure is an outcome written on the
 * conversation's row rather than an error the developer's turn would meet.
 * Synthetic accounts, sessions, and words throughout.
 */

/** 2027-01-15T08:00:00Z; the day's note is `memory/2027-01-15.md`. */
const NOW = 1_800_000_000_000;
const NOTE_PATH = "memory/2027-01-15.md";
const TEST_VAULT_SECRET = "v".repeat(64);
const SESSION_ID = "wrun_01MFLUSH0000000000000001";
const OTHER_SESSION_ID = "wrun_01MFLUSH0000000000000002";

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(
  storeWriter({
    tools: CATALOG_TOOL_SET,
    now: () => new Date(NOW),
  }),
);

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached by a flush that offers it nothing`);
  };
}

const seams: BrainHostSeams = {
  eveOrigin: () => undefined,
  store: () => database.store,
  writer: () => Effect.succeed(writer),
  userInfo: () => Effect.succeed(undefined),
  ownership: {
    sessionOwner: (sessionId) => database.run(runtimeSessionOwner(sessionId)),
    ownsConversation: (userId, conversationId) =>
      database.run(conversationOwnedBy(userId, conversationId)),
  },
  openAi: () => undefined,
  embedder: () => undefined,
  deploymentSecret: () => undefined,
  scriptedModel: () => false,
  spend: unreached("spend"),
  vaultRows: () => Effect.succeed([]),
  vaultSecret: () => TEST_VAULT_SECRET,
  providerKey: unreached("providerKey"),
  executeAction: unreached("executeAction"),
  now: () => NOW,
};

const host: BrainHost = brainHost(seams);

function principal(id: string, attributes: Readonly<Record<string, string>>): SessionAuthContext {
  return { principalId: id, principalType: "user", authenticator: "test", attributes };
}

/** One account's seat in its conversation: the same principal opened the session and is running a turn of the given kind now. */
function seat(userId: string, conversationId: string, turn: BrainHostTurn): SessionAuth {
  const opened = principal(userId, { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId });
  return {
    initiator: opened,
    current: principal(userId, {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: turn,
    }),
  };
}

const HISTORY: readonly ModelMessage[] = [
  { role: "user", content: "We decided the release ships Friday; remind me to tag it." },
  { role: "assistant", content: "Noted. Friday it is." },
];

let operations = 0;

/** eve's own id for one compaction cycle of one session; a new one per compaction, the same one across eve's replays. */
function operationId(): string {
  operations += 1;
  return `eve-memory-operation-v1:${SESSION_ID}:${operations}:turn_1:compaction.requested:notebook`;
}

/** The capture context eve hands a memory slot's `compaction.requested`, over the given seat. */
function capture(
  auth: SessionAuth,
  input: {
    readonly operationId: string;
    readonly sessionId?: string;
    readonly messages?: readonly ModelMessage[];
    readonly signal?: AbortSignal;
  },
): MemoryCompactionRequestedContext {
  const unreachable = (): never => {
    throw new Error("not reached in these tests");
  };
  return {
    session: {
      id: input.sessionId ?? SESSION_ID,
      auth,
      turn: { id: "turn_1", sequence: 1 },
    },
    getSandbox: unreachable,
    getSkill: unreachable,
    abortSignal: input.signal ?? new AbortController().signal,
    messages: input.messages ?? HISTORY,
    operationId: input.operationId,
    memory: {
      scope: { key: "scope-key", namespace: "luke:notebook", value: "account" },
      slot: "notebook",
    },
    turn: null,
    compaction: { modelId: "test-model", usageInputTokens: 320_000 },
  };
}

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that answers every call by appending the given entry; nothing else. */
function appendingModel(entry: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "call-1",
          toolName: BRAIN_TOOL.APPEND_DAILY_NOTE,
          input: JSON.stringify({ content: entry }),
        },
      ],
      finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
      usage: USAGE,
      warnings: [],
    },
  });
}

/** A model that answers in words alone. */
function wordsModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: USAGE,
      warnings: [],
    },
  });
}

/** The row's flush columns as either dialect hands them back: the instant read the way the store reads every `timestamptz`. */
const FlushRowSchema = Schema.Struct({
  memory_flush_operation_id: Schema.NullOr(Schema.String),
  memory_flush_outcome: Schema.NullOr(Schema.String),
  memory_flushed_at: Schema.NullOr(InstantColumnSchema),
});

/** What the conversation's row records of its last flush. */
function flushRecord(conversationId: string) {
  return database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        select memory_flush_operation_id, memory_flush_outcome, memory_flushed_at
        from conversations
        where id = ${conversationId}
      `;
      return Schema.decodeUnknownSync(FlushRowSchema)(rows[0]);
    }),
  );
}

function noteFor(userId: string) {
  return database.run(database.store.workspace.read(userId, NOTE_PATH));
}

async function ownedConversation(userId: string, runtimeSessionId = SESSION_ID) {
  return insertConversation(database.run, { userId, runtimeSessionId });
}

test("an ask's compaction runs one housekeeping turn offered append_daily_note alone; its appends land in the day's note and the conversation gains no row", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  const model = appendingModel(
    "- The release ships Friday; the developer wants a reminder to tag it.",
  );
  const operation = operationId();

  const result = await database.run(
    host.flush(
      capture(seat(userId, conversationId, BRAIN_HOST_TURN.TYPED), { operationId: operation }),
      model,
    ),
  );

  assert.deepEqual(result, { outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED, writes: 1 });
  assert.equal(model.doGenerateCalls.length, 1);
  const call = model.doGenerateCalls[0];
  assert.ok(call);
  assert.deepEqual(
    call.tools?.map((offered) => offered.name),
    [BRAIN_TOOL.APPEND_DAILY_NOTE],
    "the one tool offered",
  );
  assert.equal(call.maxOutputTokens, MEMORY_FLUSH_DEFAULTS.MAXIMUM_OUTPUT_TOKENS);
  const [system, user] = call.prompt;
  assert.equal(system?.role, "system");
  assert.match(String(system?.content), /Pre-compaction memory flush turn/);
  assert.match(String(system?.content), new RegExp(`Store durable memories only in ${NOTE_PATH}`));
  assert.equal(user?.role, "user");
  const userText = JSON.stringify(user?.content);
  assert.match(userText, /The conversation so far, as data/);
  assert.match(userText, /the release ships Friday/);
  assert.match(userText, /If nothing to store, reply with NO_REPLY/);

  const note = await noteFor(userId);
  assert.match(note?.content ?? "", /The release ships Friday/);
  assert.equal((await readMessagesByConversation(database.run, conversationId)).length, 0);
  assert.deepEqual(await flushRecord(conversationId), {
    memory_flush_operation_id: operation,
    memory_flush_outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED,
    memory_flushed_at: new Date(NOW),
  });
});

test("one compaction cycle flushes once: a replayed capture runs no turn, and the next cycle runs again", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  const model = appendingModel("- First cycle.");
  const auth = seat(userId, conversationId, BRAIN_HOST_TURN.SPOKEN);
  const first = operationId();

  await database.run(host.flush(capture(auth, { operationId: first }), model));
  const replayed = await database.run(host.flush(capture(auth, { operationId: first }), model));
  assert.deepEqual(replayed, {
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
    writes: 0,
    reason: MEMORY_FLUSH_REFUSAL.ALREADY_FLUSHED,
  });
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal((await flushRecord(conversationId)).memory_flush_operation_id, first);

  const second = operationId();
  const next = await database.run(host.flush(capture(auth, { operationId: second }), model));
  assert.equal(next.outcome, MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED);
  assert.equal(model.doGenerateCalls.length, 2);
  assert.equal((await flushRecord(conversationId)).memory_flush_operation_id, second);
  assert.equal((await noteFor(userId))?.content.match(/First cycle/g)?.length, 2);
});

test("a scaffolding turn flushes nothing: the roster's observation, a hold's release, a child's task, and a child's completion run no turn and claim no cycle", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  const model = appendingModel("- Never written.");

  for (const turn of [
    BRAIN_HOST_TURN.OBSERVATION,
    BRAIN_HOST_TURN.HOLD_RELEASE,
    BRAIN_HOST_TURN.CHILD_TASK,
    BRAIN_HOST_TURN.CHILD_COMPLETION,
  ]) {
    const result = await database.run(
      host.flush(
        capture(seat(userId, conversationId, turn), { operationId: operationId() }),
        model,
      ),
    );
    assert.deepEqual(result, {
      outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
      writes: 0,
      reason: MEMORY_FLUSH_REFUSAL.NOT_AN_ASK,
    });
  }
  assert.equal(model.doGenerateCalls.length, 0);
  assert.equal(await noteFor(userId), undefined);
  assert.equal((await flushRecord(conversationId)).memory_flush_operation_id, null);
});

test("a session the host does not admit flushes nothing, and a deployment holding no model flushes nothing", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  const model = appendingModel("- Never written.");
  const auth = seat(userId, conversationId, BRAIN_HOST_TURN.TYPED);

  const rotated = await database.run(
    host.flush(capture(auth, { operationId: operationId(), sessionId: OTHER_SESSION_ID }), model),
  );
  assert.deepEqual(rotated, {
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
    writes: 0,
    reason: BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION,
  });

  const unkeyed = await database.run(host.flush(capture(auth, { operationId: operationId() })));
  assert.deepEqual(unkeyed, {
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED,
    writes: 0,
    reason: BRAIN_HOST_REFUSAL.NO_MODEL,
  });
  assert.equal(model.doGenerateCalls.length, 0);
  assert.equal((await flushRecord(conversationId)).memory_flush_operation_id, null);
});

test("NO_REPLY stores nothing and is written down as nothing to store; so is a reply in words", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  const auth = seat(userId, conversationId, BRAIN_HOST_TURN.TYPED);

  const silent = await database.run(
    host.flush(capture(auth, { operationId: operationId() }), wordsModel("NO_REPLY")),
  );
  assert.deepEqual(silent, {
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE,
    writes: 0,
    reason: "NO_REPLY",
  });
  const worded = await database.run(
    host.flush(capture(auth, { operationId: operationId() }), wordsModel("Nothing durable here.")),
  );
  assert.deepEqual(worded, {
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE,
    writes: 0,
    reason: MEMORY_FLUSH_REFUSAL.REPLIED_IN_WORDS,
  });
  assert.equal(await noteFor(userId), undefined);
  assert.equal((await readMessagesByConversation(database.run, conversationId)).length, 0);
  assert.equal(
    (await flushRecord(conversationId)).memory_flush_outcome,
    MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE,
  );
});

test("a model failure is written down as failed and a cancelled operation as interrupted; neither writes, and neither fails the effect", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  const auth = seat(userId, conversationId, BRAIN_HOST_TURN.TYPED);
  const refusing = new MockLanguageModelV4({
    doGenerate: () => {
      throw new Error("The account's daily hosted allowance is spent.");
    },
  });

  const failed = await database.run(
    host.flush(capture(auth, { operationId: operationId() }), refusing),
  );
  assert.deepEqual(failed, {
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.FAILED,
    writes: 0,
    reason: "The account's daily hosted allowance is spent.",
  });
  assert.equal(
    (await flushRecord(conversationId)).memory_flush_outcome,
    MEMORY_HOUSEKEEPING_OUTCOME.FAILED,
  );

  const controller = new AbortController();
  controller.abort();
  const model = appendingModel("- Never written.");
  const cancelled = await database.run(
    host.flush(capture(auth, { operationId: operationId(), signal: controller.signal }), model),
  );
  assert.equal(cancelled.outcome, MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED);
  assert.equal(cancelled.writes, 0);
  assert.equal(await noteFor(userId), undefined);
  assert.equal((await readMessagesByConversation(database.run, conversationId)).length, 0);
});

test("an append the workspace refuses is written down as failed, with the workspace's own reason", async () => {
  const userId = await database.createUser();
  const conversationId = await ownedConversation(userId);
  const auth = seat(userId, conversationId, BRAIN_HOST_TURN.TYPED);
  const oversized = appendingModel("x".repeat(30_000));

  const result = await database.run(
    host.flush(capture(auth, { operationId: operationId() }), oversized),
  );
  assert.equal(result.outcome, MEMORY_HOUSEKEEPING_OUTCOME.FAILED);
  assert.equal(result.writes, 0);
  assert.match(result.reason ?? "", /20,?000/);
  assert.equal(await noteFor(userId), undefined);
});

test("the context is handed as data: system messages left out, tool calls and results one line each, files named by kind, and the front cut at the bound", () => {
  const messages: readonly ModelMessage[] = [
    { role: "system", content: "You are Luke." },
    { role: "user", content: [{ type: "text", text: "Look at the build." }] },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "Reading it." },
        { type: "tool-call", toolCallId: "c1", toolName: "read_transcript", input: { id: "s1" } },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "read_transcript",
          output: { type: "json", value: { lines: 3 } },
        },
      ],
    },
    { role: "user", content: [{ type: "file", data: "AAAA", mediaType: "image/png" }] },
  ];
  const data = contextAsData(messages);
  assert.equal(
    data,
    [
      "[user]\nLook at the build.",
      '[assistant]\nReading it.\n-> read_transcript {"id":"s1"}',
      '[tool]\n<- read_transcript: {"lines":3}',
      "[user]\n[file]",
    ].join("\n\n"),
  );
  assert.doesNotMatch(data, /You are Luke|thinking/);

  const cut = contextAsData(messages, 20);
  assert.match(cut, /^\[earlier context cut\]\n/);
  assert.equal(cut.length, "[earlier context cut]\n".length + 20);
  assert.ok(cut.endsWith("[user]\n[file]"));
  assert.ok(MEMORY_FLUSH.CONTEXT_CHARS > 0);
});
