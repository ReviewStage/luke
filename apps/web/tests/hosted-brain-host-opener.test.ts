import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { ConnectionError, SqlError } from "effect/unstable/sql/SqlError";
import { afterAll, test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  BRAIN_INPUT_MARKER,
  OBSERVED_MESSAGES_CUT,
  type ProviderSessionObservation,
  type ProviderTranscriptChange,
  type ProviderTranscriptChangesResult,
  SESSION_STATUS,
  type SessionIdentity,
} from "../server/core";
import { db } from "../server/db/query";
import { conversations, providerCursors } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import {
  openAccountTurns,
  openObservationTurns,
  type ScheduledTurn,
  type TurnOpenerSeams,
  type TurnOpeningOutcome,
} from "../server/hosted/brain-host/opener";
import { hostedRosterFrom } from "../server/hosted/brain-host/roster";
import {
  type HostedTranscriptReads,
  keepTranscriptCursor,
} from "../server/hosted/brain-host/transcript";
import type { ObservedRoster } from "../server/hosted/observed-roster";

import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The opener over the real migrations on PGlite: what the chats a provider
 * says gained transcript since the account's mark become in eve, and what
 * they leave behind. Synthetic fixtures throughout — no real title, branch,
 * or transcript word. What is held to is the acceptance the ticket names:
 * one message per changed chat carrying its envelope and its lines, the
 * cursors and the mark moving in one transaction and only once eve has
 * accepted, a turn eve refuses leaving all of it standing, and the mark
 * never jumping a chat held back by the bound. Every account here is one
 * the test created, since the store suite shares one database on CI.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());
const NOW = Date.parse("2026-09-11T09:00:00.000Z");
const PROVIDER = "conductor";
const SESSION_ID = "wrun_01M0000000000000000000OPEN";

function observation(
  id: string,
  overrides: Partial<ProviderSessionObservation> = {},
): ProviderSessionObservation {
  return {
    providerSessionId: id,
    title: `Chat ${id}`,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW,
    workspace: { providerWorkspaceId: "workspace-a", name: "workspace-a-name" },
    detail: { repository: "repo" },
    advertises: [{ kind: "message" }],
    ...overrides,
  };
}

function roster(observations: readonly ProviderSessionObservation[]): ObservedRoster {
  return {
    version: 1,
    providers: [{ providerId: PROVIDER, keyFingerprint: "f", observations, projects: [] }],
  };
}

function identity(providerSessionId: string): SessionIdentity {
  return { providerId: PROVIDER, providerSessionId };
}

function change(providerSessionId: string, updatedAt: number): ProviderTranscriptChange {
  return { providerSessionId, updatedAt };
}

/** One pass of the account's roster, written down as the pass writes it: the snapshot advanced over the one it read against. */
async function passed(
  userId: string,
  to: ObservedRoster,
  observedAt: number,
  previousObservedAt: number | undefined,
): Promise<void> {
  const landed = await database.run(
    database.store.roster.advance(
      userId,
      { body: JSON.stringify(to), observedAt },
      previousObservedAt,
    ),
  );
  assert.equal(landed, true);
}

/** An account whose first pass saw `first`, and whose opener has visited once since, so its mark stands at `NOW` and nothing is owed. */
async function accountSeeing(first: ObservedRoster): Promise<string> {
  const userId = await database.createUser();
  await passed(userId, first, NOW, undefined);
  await database.run(database.store.roster.keepMark(userId, NOW, undefined, NOW));
  return userId;
}

interface Handed {
  readonly kind: "open" | "send";
  readonly sessionId?: string;
  readonly message: EveMessage<ScheduledTurn>;
}

/** What one observation turn's opening words carry after the marker line: the envelope, then the lines. */
function linesOf(message: EveMessage<ScheduledTurn>): readonly string[] {
  const [marker, ...body] = message.message.split("\n");
  assert.ok(marker?.startsWith(BRAIN_INPUT_MARKER.OBSERVED_MESSAGES));
  return body;
}

type Answer = (handed: Handed) => Awaited<ReturnType<EveSessions<ScheduledTurn>["send"]>>;

const ACCEPTING: Answer = () => ({
  outcome: EVE_SEND_OUTCOME.ACCEPTED,
  sessionId: SESSION_ID,
  deliveryId: "delivery-1",
});

/** A fake eve recording what it was handed and answering as the test says. */
function fakeEve(answer: Answer = ACCEPTING) {
  const handed: Handed[] = [];
  const eve: EveSessions<ScheduledTurn> = {
    async open(message) {
      const record: Handed = { kind: "open", message };
      handed.push(record);
      const answered = answer(record);
      return answered.outcome === EVE_SEND_OUTCOME.RETIRED
        ? { outcome: EVE_SEND_OUTCOME.FAILED, status: 409 }
        : answered;
    },
    async send(sessionId, message) {
      const record: Handed = { kind: "send", sessionId, message };
      handed.push(record);
      return answer(record);
    },
    cancel: () => {
      throw new Error("the opener cancels nothing");
    },
  };
  return { eve, handed };
}

interface TranscriptFixture {
  /** What the provider says changed, or how it refused; absent, nothing changed. */
  readonly changes?: readonly ProviderTranscriptChange[] | ProviderTranscriptChangesResult;
  /** The delta each session answers, by its id; a session not named answers no reading. */
  readonly deltas?: Readonly<
    Record<
      string,
      { lines: readonly string[]; truncated?: boolean; cursor?: string; from?: string }
    >
  >;
}

interface FakeTranscripts extends Pick<HostedTranscriptReads, "since" | "changedSince"> {
  /** The chats read, in order. */
  readonly asked: string[];
  /** The instants the changes were asked since, one per provider asked. */
  readonly askedSince: (number | undefined)[];
}

function fakeTranscripts(fixture: TranscriptFixture = {}): FakeTranscripts {
  const asked: string[] = [];
  const askedSince: (number | undefined)[] = [];
  return {
    asked,
    askedSince,
    changedSince(_providerId, since) {
      return Effect.sync(() => {
        askedSince.push(since);
        const changes = fixture.changes ?? [];
        if ("status" in changes) return changes;
        return { status: ACTION_RESULT_STATUS.ACCEPTED, changes };
      });
    },
    since(who) {
      return Effect.sync(() => {
        asked.push(who.providerSessionId);
        const delta = fixture.deltas?.[who.providerSessionId];
        if (!delta) return undefined;
        return {
          delta: {
            lines: delta.lines,
            truncated: delta.truncated ?? false,
            status: ACTION_RESULT_STATUS.ACCEPTED,
          },
          ...(delta.cursor !== undefined ? { cursor: delta.cursor } : undefined),
          ...(delta.from !== undefined ? { from: delta.from } : undefined),
        };
      });
    },
  };
}

function seams(
  overrides: Partial<TurnOpenerSeams> & { readonly roster: TurnOpenerSeams["roster"] },
): TurnOpenerSeams & { reports: string[] } {
  const reports: string[] = [];
  return {
    store: database.store,
    eve: fakeEve().eve,
    transcripts: fakeTranscripts(),
    now: () => NOW + 5_000,
    report: (message) => reports.push(message),
    ...overrides,
    reports,
  };
}

const CursorRowSchema = Schema.Struct({ cursor: Schema.String });

async function cursorOf(userId: string, who: SessionIdentity): Promise<string | undefined> {
  const rows = await database.run(
    db
      .select({ cursor: providerCursors.cursor })
      .from(providerCursors)
      .where(
        and(
          eq(providerCursors.userId, userId),
          eq(providerCursors.providerId, who.providerId),
          eq(providerCursors.providerSessionId, who.providerSessionId),
        ),
      ),
  );
  const row = rows[0];
  return row === undefined ? undefined : Schema.decodeUnknownSync(CursorRowSchema)(row).cursor;
}

function setConversationRuntimeSessionId(conversationId: string, sessionId: string) {
  return database.run(
    Effect.asVoid(
      db
        .update(conversations)
        .set({ runtimeSessionId: sessionId })
        .where(eq(conversations.id, conversationId)),
    ),
  );
}

/** Where the opener's mark stands for the account. */
function markOf(userId: string): Promise<number | undefined> {
  return database.run(database.store.roster.mark(userId));
}

const ObservedConversationRowSchema = Schema.Struct({
  id: Schema.String,
  providerSessionId: Schema.NullOr(Schema.String),
  runtimeSessionId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  workspace: Schema.NullOr(Schema.String),
});

type ObservedConversationRow = typeof ObservedConversationRowSchema.Type;

async function observedConversations(userId: string): Promise<ObservedConversationRow[]> {
  const rows = await database.run(
    db
      .select({
        id: conversations.id,
        providerSessionId: conversations.providerSessionId,
        runtimeSessionId: conversations.runtimeSessionId,
        title: conversations.title,
        workspace: conversations.workspace,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.kind, CONVERSATION_KIND.OBSERVED),
          isNull(conversations.deletedAt),
        ),
      )
      .orderBy(conversations.providerSessionId),
  );
  return rows.map((row) => Schema.decodeUnknownSync(ObservedConversationRowSchema)(row));
}

const ONE_CHAT = roster([observation("s-1")]);
const ONE_CHAT_NOW = hostedRosterFrom(ONE_CHAT, NOW);
const ONE_CHANGE = [change("s-1", NOW + 3_000)];

/** An account whose one chat gained words since the opener's mark. */
async function oneChatChanged(): Promise<{ userId: string }> {
  return { userId: await accountSeeing(ONE_CHAT) };
}

test("two chats that gained messages become two turns, each the envelope and one line per message, the observed conversations opened, the cursors and the mark kept together", async () => {
  const two = roster([observation("s-1"), observation("s-2")]);
  const userId = await accountSeeing(two);
  const { eve, handed } = fakeEve();
  const transcripts = fakeTranscripts({
    changes: [change("s-2", NOW + 1_000), change("s-1", NOW + 2_000)],
    deltas: {
      "s-1": { lines: ["Developer: go on", "Conductor: going"], cursor: "cursor-1" },
      "s-2": { lines: ["Conductor: done"], cursor: "cursor-2", truncated: true },
    },
  });
  const opener = seams({ eve, transcripts, roster: hostedRosterFrom(two, NOW) });

  const outcome = await database.run(openObservationTurns(opener, userId));

  assert.deepEqual(outcome, {
    observation: 2,
    failed: 0,
  } satisfies TurnOpeningOutcome);
  assert.deepEqual(transcripts.askedSince, [NOW]);
  // Oldest change first, and every message an `open` of the chat's own conversation.
  assert.deepEqual(transcripts.asked, ["s-2", "s-1"]);
  assert.deepEqual(
    handed.map((turn) => [turn.kind, turn.message.turn]),
    [
      ["open", BRAIN_HOST_TURN.OBSERVATION],
      ["open", BRAIN_HOST_TURN.OBSERVATION],
    ],
  );
  assert.deepEqual(
    handed.map((turn) => linesOf(turn.message)),
    [
      [
        `[Conductor · workspace-a-name · Chat s-2 · ${new Date(NOW + 1_000).toISOString()}]`,
        OBSERVED_MESSAGES_CUT,
        "Conductor: done",
      ],
      [
        `[Conductor · workspace-a-name · Chat s-1 · ${new Date(NOW + 2_000).toISOString()}]`,
        "Developer: go on",
        "Conductor: going",
      ],
    ],
  );

  const opened = await observedConversations(userId);
  assert.deepEqual(
    opened.map((row) => row.providerSessionId),
    ["s-1", "s-2"],
  );
  // Each row keeps what the roster calls its chat, for a device whose own roster no longer lists it.
  assert.deepEqual(
    opened.map((row) => [row.title, row.workspace]),
    [
      ["Chat s-1", "workspace-a-name"],
      ["Chat s-2", "workspace-a-name"],
    ],
  );
  assert.deepEqual(
    handed.map((turn) => turn.message.conversationId),
    [opened[1]?.id, opened[0]?.id],
  );
  assert.equal(await cursorOf(userId, identity("s-1")), "cursor-1");
  assert.equal(await cursorOf(userId, identity("s-2")), "cursor-2");
  assert.equal(await markOf(userId), NOW + 2_000);

  // Nothing changed since: nothing opened, the mark stands.
  const again = await database.run(
    openObservationTurns(seams({ eve, roster: opener.roster }), userId),
  );
  assert.deepEqual(again, { observation: 0, failed: 0 });
  assert.equal(handed.length, 2);
  assert.equal(await markOf(userId), NOW + 2_000);
});

test("a delta with no attributed message opens no turn, and moves its cursor and the mark all the same", async () => {
  const { userId } = await oneChatChanged();
  const { eve, handed } = fakeEve();
  const opener = seams({
    eve,
    transcripts: fakeTranscripts({
      changes: ONE_CHANGE,
      deltas: { "s-1": { lines: [], cursor: "cursor-tools" } },
    }),
    roster: ONE_CHAT_NOW,
  });

  const outcome = await database.run(openObservationTurns(opener, userId));

  assert.deepEqual(outcome, { observation: 0, failed: 0 });
  assert.equal(handed.length, 0);
  assert.equal(await cursorOf(userId, identity("s-1")), "cursor-tools");
  assert.equal(await markOf(userId), NOW + 3_000);
  assert.deepEqual(opener.reports, []);
});

test("a first visit adopts the newest instant the provider answers and wakes nothing; a first visit answered nothing keeps no mark, so the next visit adopts", async () => {
  const userId = await database.createUser();
  await passed(userId, ONE_CHAT, NOW, undefined);
  const { eve, handed } = fakeEve();
  const empty = fakeTranscripts({ changes: [] });
  assert.deepEqual(
    await database.run(
      openObservationTurns(seams({ eve, transcripts: empty, roster: ONE_CHAT_NOW }), userId),
    ),
    { observation: 0, failed: 0 },
  );
  assert.deepEqual(empty.askedSince, [undefined]);
  assert.equal(await markOf(userId), undefined);

  const transcripts = fakeTranscripts({
    changes: [change("s-1", NOW - 60_000), change("s-1", NOW - 10_000)],
    deltas: { "s-1": { lines: ["Developer: old words"], cursor: "cursor-1" } },
  });
  assert.deepEqual(
    await database.run(
      openObservationTurns(seams({ eve, transcripts, roster: ONE_CHAT_NOW }), userId),
    ),
    { observation: 0, failed: 0 },
  );
  assert.equal(handed.length, 0);
  assert.deepEqual(transcripts.asked, []);
  assert.equal(await cursorOf(userId, identity("s-1")), undefined);
  assert.equal(await markOf(userId), NOW - 10_000);

  // The next change under the adopted mark wakes as usual.
  const next = fakeTranscripts({
    changes: [change("s-1", NOW + 1_000)],
    deltas: { "s-1": { lines: ["Developer: new words"], cursor: "cursor-2" } },
  });
  assert.deepEqual(
    await database.run(
      openObservationTurns(seams({ eve, transcripts: next, roster: ONE_CHAT_NOW }), userId),
    ),
    { observation: 1, failed: 0 },
  );
  assert.deepEqual(next.askedSince, [NOW - 10_000]);
  assert.equal(await markOf(userId), NOW + 1_000);
});

test("a provider that would not say what changed wakes nothing and leaves the mark standing, said once", async () => {
  const { userId } = await oneChatChanged();
  const { eve, handed } = fakeEve();
  const refused = seams({
    eve,
    transcripts: fakeTranscripts({
      changes: {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "Conductor rejected the configured API key.",
      },
    }),
    roster: ONE_CHAT_NOW,
  });
  assert.deepEqual(await database.run(openObservationTurns(refused, userId)), {
    observation: 0,
    failed: 0,
  });
  assert.equal(handed.length, 0);
  assert.equal(await markOf(userId), NOW);
  assert.equal(refused.reports.length, 1);

  const throwing = seams({
    eve,
    transcripts: {
      ...fakeTranscripts(),
      changedSince: () =>
        Effect.sync(() => {
          throw new Error("Conductor did not answer");
        }),
    },
    roster: ONE_CHAT_NOW,
  });
  assert.deepEqual(await database.run(openObservationTurns(throwing, userId)), {
    observation: 0,
    failed: 0,
  });
  assert.equal(await markOf(userId), NOW);
  assert.equal(throwing.reports.length, 1);
});

/**
 * The client with every read of a conversation's own eve session refused, and
 * nothing else changed: the same proxy shape as the transaction one below,
 * with the one statement `recordedRuntimeSession` makes failing and every
 * other statement the real client's.
 */
function sessionReadsRefused(sql: SqlClient.SqlClient): SqlClient.SqlClient {
  return new Proxy(sql, {
    // oxlint-disable-next-line anti-slop/no-reflect -- forwarding a call the proxy does not interpret
    apply: (target, receiver, args) => {
      const [strings] = args;
      if (Array.isArray(strings) && strings.join("?").includes("select runtime_session_id")) {
        return Effect.fail(
          new SqlError({
            reason: new ConnectionError({
              cause: new Error("the connection dropped"),
              message: "the conversation's session could not be read",
            }),
          }),
        );
      }
      // oxlint-disable-next-line anti-slop/no-reflect -- forwarding a call the proxy does not interpret
      return Reflect.apply(target, receiver, args);
    },
    // oxlint-disable-next-line anti-slop/no-reflect -- forwarding a property the proxy does not interpret
    get: (target, property, receiver) => Reflect.get(target, property, receiver),
  });
}

/** The fixture behind most single-chat tests: one change, one line, one cursor. */
function oneChatTranscripts(overrides: Partial<TranscriptFixture> = {}) {
  return fakeTranscripts({
    changes: ONE_CHANGE,
    deltas: { "s-1": { lines: ["Developer: go on"], cursor: "cursor-1" } },
    ...overrides,
  });
}

test("a handover the store refuses is one refused send, said and counted, rather than the end of the account's visit", async () => {
  const { userId } = await oneChatChanged();
  const { eve, handed } = fakeEve();
  const opener = seams({ eve, transcripts: oneChatTranscripts(), roster: ONE_CHAT_NOW });

  const outcome = await database.run(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.provideService(
        openObservationTurns(opener, userId),
        SqlClient.SqlClient,
        sessionReadsRefused(sql),
      ),
    ),
  );

  assert.deepEqual(outcome, {
    observation: 0,
    failed: 1,
  } satisfies TurnOpeningOutcome);
  assert.equal(handed.length, 0);
  assert.equal(opener.reports.length, 1);
  assert.equal(await markOf(userId), NOW);
});

test("a conversation already running in an eve session is sent to, not reopened; one eve has retired is opened again", async () => {
  const { userId } = await oneChatChanged();
  const conversationId = await database.run(
    database.store.directory.observed(userId, identity("s-1"), NOW),
  );
  assert.ok(conversationId);
  await setConversationRuntimeSessionId(conversationId, SESSION_ID);
  const current = fakeEve();
  await database.run(
    openObservationTurns(
      seams({ eve: current.eve, transcripts: oneChatTranscripts(), roster: ONE_CHAT_NOW }),
      userId,
    ),
  );
  assert.deepEqual(
    current.handed.map((turn) => [turn.kind, turn.sessionId]),
    [["send", SESSION_ID]],
  );

  const { userId: retiredUser } = await oneChatChanged();
  const retiredConversation = await database.run(
    database.store.directory.observed(retiredUser, identity("s-1"), NOW),
  );
  assert.ok(retiredConversation);
  await setConversationRuntimeSessionId(retiredConversation, SESSION_ID);
  const reopened = "wrun_01M000000000000000000REOPEN";
  const retired = fakeEve((handed) =>
    handed.kind === "send"
      ? { outcome: EVE_SEND_OUTCOME.RETIRED }
      : { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: reopened, deliveryId: "delivery-1" },
  );
  const outcome = await database.run(
    openObservationTurns(
      seams({ eve: retired.eve, transcripts: oneChatTranscripts(), roster: ONE_CHAT_NOW }),
      retiredUser,
    ),
  );
  assert.deepEqual(outcome, { observation: 1, failed: 0 });
  assert.deepEqual(
    retired.handed.map((turn) => turn.kind),
    ["send", "open"],
  );
  assert.equal(await markOf(retiredUser), NOW + 3_000);
  // The session eve opened is the conversation's at once, forward-only, so a second handover
  // landing before eve's own start has claimed it sends into this session rather than opening another.
  assert.deepEqual(
    (await observedConversations(retiredUser)).map((row) => row.runtimeSessionId),
    [reopened],
  );
});

test("a turn eve refuses leaves the cursor and the mark standing, and nothing of the visit is recorded", async () => {
  const { userId } = await oneChatChanged();
  const refusing = fakeEve(() => ({ outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }));
  const opener = seams({
    eve: refusing.eve,
    transcripts: oneChatTranscripts(),
    roster: ONE_CHAT_NOW,
  });

  const outcome = await database.run(openObservationTurns(opener, userId));

  assert.deepEqual(outcome, { observation: 0, failed: 1 });
  assert.equal(refusing.handed.length, 1);
  assert.equal(await cursorOf(userId, identity("s-1")), undefined);
  assert.equal(await markOf(userId), NOW);
  assert.equal(opener.reports.length, 1);

  const throwing = fakeEve(() => {
    throw new Error("eve is unreachable");
  });
  const thrown = await database.run(
    openObservationTurns(
      seams({ eve: throwing.eve, transcripts: oneChatTranscripts(), roster: ONE_CHAT_NOW }),
      userId,
    ),
  );
  assert.deepEqual(thrown, { observation: 0, failed: 1 });
  assert.equal(await markOf(userId), NOW);
});

test("a refusal on the second chat ends the visit with nothing committed: the first chat's cursor and the mark stand, and the next tick reads both again", async () => {
  const two = roster([observation("s-1"), observation("s-2")]);
  const userId = await accountSeeing(two);
  const refusingSecond = fakeEve((handed) =>
    handed.message.message.includes("Chat s-2")
      ? { outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }
      : ACCEPTING(handed),
  );
  const opener = seams({
    eve: refusingSecond.eve,
    transcripts: fakeTranscripts({
      changes: [change("s-1", NOW + 1_000), change("s-2", NOW + 2_000)],
      deltas: {
        "s-1": { lines: ["Developer: one"], cursor: "cursor-1" },
        "s-2": { lines: ["Developer: two"], cursor: "cursor-2" },
      },
    }),
    roster: hostedRosterFrom(two, NOW),
  });

  const outcome = await database.run(openObservationTurns(opener, userId));

  assert.deepEqual(outcome, { observation: 1, failed: 1 });
  assert.equal(refusingSecond.handed.length, 2);
  assert.equal(await cursorOf(userId, identity("s-1")), undefined);
  assert.equal(await cursorOf(userId, identity("s-2")), undefined);
  assert.equal(await markOf(userId), NOW);
});

/**
 * The client with every transaction failing after its body ran, and nothing
 * else changed: a proxy over the real one, since the client is a callable
 * with its statements as properties. A write the opener makes outside its
 * transaction is committed by the real client and seen by the test.
 */
function transactionsFailingAfter(sql: SqlClient.SqlClient): SqlClient.SqlClient {
  const failing: SqlClient.SqlClient["withTransaction"] = (body) =>
    sql.withTransaction(
      Effect.flatMap(body, () => Effect.die(new Error("the connection dropped before commit"))),
    );
  // The client is called as a template tag and read for its statements, so
  // both traps forward to the real client untyped; the one property swapped
  // is the transaction, and everything else is the client's own.
  return new Proxy(sql, {
    // oxlint-disable-next-line anti-slop/no-reflect -- forwarding a call the proxy does not interpret
    apply: (target, receiver, args) => Reflect.apply(target, receiver, args),
    get: (target, property, receiver) =>
      // oxlint-disable-next-line anti-slop/no-reflect -- forwarding a property the proxy does not interpret
      property === "withTransaction" ? failing : Reflect.get(target, property, receiver),
  });
}

test("the cursor and the mark move in one transaction: a write that fails after eve accepted leaves both standing for the next tick", async () => {
  const { userId } = await oneChatChanged();
  const { eve } = fakeEve();
  // The real database, every transaction of which fails after its body ran:
  // a write made outside the transaction lands anyway, which is what this
  // test exists to see.
  const underFailingTransactions = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
    database.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        Effect.provideService(effect, SqlClient.SqlClient, transactionsFailingAfter(sql)),
      ),
    );
  const opener = seams({ eve, transcripts: oneChatTranscripts(), roster: ONE_CHAT_NOW });

  await assert.rejects(underFailingTransactions(openObservationTurns(opener, userId)));

  assert.equal(await cursorOf(userId, identity("s-1")), undefined);
  assert.equal(await markOf(userId), NOW);
});

test("a transcript the provider would not answer ends the visit with nothing committed, so the next tick reads the chat again with its words", async () => {
  const { userId } = await oneChatChanged();
  const { eve, handed } = fakeEve();
  const throwing = seams({
    eve,
    transcripts: {
      ...fakeTranscripts({ changes: ONE_CHANGE }),
      since: () =>
        Effect.sync(() => {
          throw new Error("Conductor did not answer");
        }),
    },
    roster: ONE_CHAT_NOW,
  });
  assert.deepEqual(await database.run(openObservationTurns(throwing, userId)), {
    observation: 0,
    failed: 1,
  });
  assert.equal(handed.length, 0);
  assert.equal(await markOf(userId), NOW);
  assert.equal(throwing.reports.length, 1);

  const rejected = seams({
    eve,
    transcripts: {
      ...fakeTranscripts({ changes: ONE_CHANGE }),
      since: () =>
        Effect.succeed({
          delta: { lines: [], truncated: false, status: ACTION_RESULT_STATUS.REJECTED },
        }),
    },
    roster: ONE_CHAT_NOW,
  });
  assert.deepEqual(await database.run(openObservationTurns(rejected, userId)), {
    observation: 0,
    failed: 1,
  });
  assert.equal(await markOf(userId), NOW);
  assert.equal(rejected.reports.length, 1);
});

test("the bound is per account: two accounts under a bound of one each get their one turn, and neither waits on the other", async () => {
  const accounts = await Promise.all([0, 1].map(() => accountSeeing(ONE_CHAT)));
  for (const userId of accounts) {
    const { eve, handed } = fakeEve();
    const outcome = await database.run(
      openObservationTurns(
        seams({ eve, transcripts: oneChatTranscripts(), roster: ONE_CHAT_NOW }),
        userId,
        {
          limit: 1,
        },
      ),
    );
    assert.deepEqual(outcome, { observation: 1, failed: 0 });
    assert.equal(handed.length, 1);
    assert.equal(await markOf(userId), NOW + 3_000);
  }
});

test("within an account the bound takes the oldest changes first and holds the rest back, reported; the mark stops strictly before the first held-back instant, so a tie is never jumped", async () => {
  const three = roster([observation("s-1"), observation("s-2"), observation("s-3")]);
  const rosterNow = hostedRosterFrom(three, NOW);
  const deltas = {
    "s-1": { lines: ["Developer: one"], cursor: "c-1" },
    "s-2": { lines: ["Developer: two"], cursor: "c-2" },
    "s-3": { lines: ["Developer: three"], cursor: "c-3" },
  };

  // Distinct instants: the mark moves to the last taken.
  const spaced = await accountSeeing(three);
  const bounded = fakeEve();
  const cut = seams({
    eve: bounded.eve,
    transcripts: fakeTranscripts({
      changes: [change("s-3", NOW + 1_000), change("s-1", NOW + 2_000), change("s-2", NOW + 3_000)],
      deltas,
    }),
    roster: rosterNow,
  });
  assert.deepEqual(await database.run(openObservationTurns(cut, spaced, { limit: 2 })), {
    observation: 2,
    failed: 0,
  });
  assert.deepEqual(
    bounded.handed.map((turn) => linesOf(turn.message)[1]),
    ["Developer: three", "Developer: one"],
  );
  assert.equal(cut.reports.length, 1);
  assert.equal(await markOf(spaced), NOW + 2_000);
  assert.equal(await cursorOf(spaced, identity("s-2")), undefined);

  // A tie between the last taken and the first held back: the mark stops before it.
  const tied = await accountSeeing(three);
  const tiedEve = fakeEve();
  await database.run(
    openObservationTurns(
      seams({
        eve: tiedEve.eve,
        transcripts: fakeTranscripts({
          changes: [
            change("s-1", NOW + 1_000),
            change("s-2", NOW + 2_000),
            change("s-3", NOW + 2_000),
          ],
          deltas,
        }),
        roster: rosterNow,
      }),
      tied,
      { limit: 2 },
    ),
  );
  assert.equal(tiedEve.handed.length, 2);
  assert.equal(await markOf(tied), NOW + 1_000);

  // Every taken chat at the held-back instant: the mark cannot move, and the next tick reads them again.
  const stuck = await accountSeeing(three);
  const stuckEve = fakeEve();
  const tiedChanges = [
    change("s-1", NOW + 2_000),
    change("s-2", NOW + 2_000),
    change("s-3", NOW + 2_000),
  ];
  await database.run(
    openObservationTurns(
      seams({
        eve: stuckEve.eve,
        transcripts: fakeTranscripts({ changes: tiedChanges, deltas }),
        roster: rosterNow,
      }),
      stuck,
      { limit: 2 },
    ),
  );
  assert.equal(stuckEve.handed.length, 2);
  assert.equal(await markOf(stuck), NOW);
  assert.equal(await cursorOf(stuck, identity("s-1")), "c-1");

  // The next tick: the two chats already read gain nothing and cost no turn, so the third is
  // reached under the same bound and the mark passes the tie.
  const nextEve = fakeEve();
  const nextTranscripts = fakeTranscripts({
    changes: tiedChanges,
    deltas: {
      "s-1": { lines: [], cursor: "c-1", from: "c-1" },
      "s-2": { lines: [], cursor: "c-2", from: "c-2" },
      "s-3": deltas["s-3"],
    },
  });
  const next = seams({ eve: nextEve.eve, transcripts: nextTranscripts, roster: rosterNow });
  assert.deepEqual(await database.run(openObservationTurns(next, stuck, { limit: 2 })), {
    observation: 1,
    failed: 0,
  });
  assert.deepEqual(nextTranscripts.asked, ["s-1", "s-2", "s-3"]);
  assert.deepEqual(
    nextEve.handed.map((turn) => linesOf(turn.message)[1]),
    ["Developer: three"],
  );
  assert.equal(next.reports.length, 0);
  assert.equal(await markOf(stuck), NOW + 2_000);
});

test("a change read to no turn does not count against the bound, and the reads themselves stop at their own bound with the rest held back", async () => {
  const ids = Array.from({ length: 34 }, (_, index) => `s-${index + 1}`);
  const many = roster(ids.map((id) => observation(id)));
  const rosterNow = hostedRosterFrom(many, NOW);
  const userId = await accountSeeing(many);
  const { eve, handed } = fakeEve();
  // Only the last chat has words; every earlier one was read already.
  const transcripts = fakeTranscripts({
    changes: ids.map((id, index) => change(id, NOW + (index + 1) * 1_000)),
    deltas: Object.fromEntries(
      ids.map((id, index) => [
        id,
        index === ids.length - 1
          ? { lines: ["Developer: last"], cursor: "c-last" }
          : { lines: [], cursor: `c-${id}`, from: `c-${id}` },
      ]),
    ),
  });
  const opener = seams({ eve, transcripts, roster: rosterNow });

  assert.deepEqual(await database.run(openObservationTurns(opener, userId, { limit: 2 })), {
    observation: 0,
    failed: 0,
  });
  assert.equal(handed.length, 0);
  assert.equal(transcripts.asked.length, 32);
  assert.equal(opener.reports.length, 1);
  assert.equal(await markOf(userId), NOW + 32_000);
});

test("a chat the roster no longer holds is named by its id alone; one the transcript seam does not answer for is covered by the mark and read no words", async () => {
  const userId = await accountSeeing(ONE_CHAT);
  const { eve, handed } = fakeEve();
  const transcripts = fakeTranscripts({
    changes: [change("s-gone", NOW + 1_000), change("s-silent", NOW + 2_000)],
    deltas: { "s-gone": { lines: ["Developer: still here"], cursor: "c-gone" } },
  });
  const opener = seams({ eve, transcripts, roster: ONE_CHAT_NOW });

  assert.deepEqual(await database.run(openObservationTurns(opener, userId)), {
    observation: 1,
    failed: 0,
  });
  assert.deepEqual(
    handed.map((turn) => linesOf(turn.message)),
    [
      [
        `[Conductor · chat s-gone · ${new Date(NOW + 1_000).toISOString()}]`,
        "Developer: still here",
      ],
    ],
  );
  assert.deepEqual(transcripts.asked, ["s-gone", "s-silent"]);
  assert.equal(await markOf(userId), NOW + 2_000);
});

/** An eve that, while taking the message, sees another visit keep a bookmark, as a visit that ran long into the next tick would. */
function eveRacedBy(keep: () => Promise<void>) {
  return fakeEve((handed) => {
    void keep();
    return ACCEPTING(handed);
  });
}

test("a cursor is kept only over the one the read began from, so a visit that ran long cannot put a later visit's cursor back", async () => {
  const who = identity("s-1");
  const at = new Date(NOW);
  const keep = (userId: string, cursor: string, from: string | undefined) =>
    database.run(keepTranscriptCursor(userId, who, cursor, from, at));

  // Read from no bookmark; another visit kept one before this visit's transaction.
  const { userId: first } = await oneChatChanged();
  const raced = eveRacedBy(() => keep(first, "cursor-later", undefined));
  const slow = seams({
    eve: raced.eve,
    transcripts: oneChatTranscripts({
      deltas: { "s-1": { lines: ["words"], cursor: "cursor-slow" } },
    }),
    roster: ONE_CHAT_NOW,
  });
  assert.deepEqual(await database.run(openObservationTurns(slow, first)), {
    observation: 1,
    failed: 0,
  });
  assert.equal(await cursorOf(first, who), "cursor-later");
  assert.equal(await markOf(first), NOW + 3_000);

  // Read from a bookmark another visit then moved on.
  const { userId: second } = await oneChatChanged();
  await keep(second, "cursor-later", undefined);
  const racedAgain = eveRacedBy(() => keep(second, "cursor-latest", "cursor-later"));
  await database.run(
    openObservationTurns(
      seams({
        eve: racedAgain.eve,
        transcripts: oneChatTranscripts({
          deltas: { "s-1": { lines: ["words"], cursor: "cursor-slow", from: "cursor-later" } },
        }),
        roster: ONE_CHAT_NOW,
      }),
      second,
    ),
  );
  assert.equal(await cursorOf(second, who), "cursor-latest");

  // Unraced, the bookmark moves over the one the read began from.
  const { userId: third } = await oneChatChanged();
  await keep(third, "cursor-0", undefined);
  await database.run(
    openObservationTurns(
      seams({
        eve: fakeEve().eve,
        transcripts: oneChatTranscripts({
          deltas: { "s-1": { lines: ["words"], cursor: "cursor-1", from: "cursor-0" } },
        }),
        roster: ONE_CHAT_NOW,
      }),
      third,
    ),
  );
  assert.equal(await cursorOf(third, who), "cursor-1");
});

test("the mark is kept only over the one the visit read, so a visit that ran long cannot put a later visit's mark back", async () => {
  const { userId } = await oneChatChanged();
  const raced = eveRacedBy(() =>
    database.run(database.store.roster.keepMark(userId, NOW + 9_000, NOW, NOW)).then(() => {}),
  );
  const outcome = await database.run(
    openObservationTurns(
      seams({ eve: raced.eve, transcripts: oneChatTranscripts(), roster: ONE_CHAT_NOW }),
      userId,
    ),
  );
  assert.deepEqual(outcome, { observation: 1, failed: 0 });
  assert.equal(await markOf(userId), NOW + 9_000);
});

test("an account's opening is its observation opening: the tick's one door answers what the changed chats opened", async () => {
  const { userId } = await oneChatChanged();
  const { eve, handed } = fakeEve();
  const outcome = await database.run(
    openAccountTurns(
      seams({ eve, transcripts: oneChatTranscripts(), roster: ONE_CHAT_NOW }),
      userId,
    ),
  );
  assert.deepEqual(outcome, { observation: 1, failed: 0 });
  assert.deepEqual(
    handed.map((turn) => turn.message.turn),
    [BRAIN_HOST_TURN.OBSERVATION],
  );
});
