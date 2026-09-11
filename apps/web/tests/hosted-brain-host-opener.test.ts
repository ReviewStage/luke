import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SqlClient } from "@effect/sql";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionIdentity,
} from "../server/core";
import { rosterDiff as rosterDiffTable } from "../server/db/roster-schema";
import { CONVERSATION_KIND, conversations, providerCursors } from "../server/db/storage-schema";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import {
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
import { encodeRosterDiff, rosterDiff } from "../server/hosted/roster-diff";
import type { HostedStoreRun } from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The opener over the real migrations on PGlite: what the pending roster
 * diffs of one account become in eve, and what they leave behind. Synthetic
 * fixtures throughout — no real title, branch, or transcript word. What is
 * held to is the acceptance the ticket names: several diffs about one
 * session in one pass become one turn, the cursor moves in the same
 * transaction as the diffs are consumed and only once eve has accepted, and
 * a turn eve refuses leaves both standing. Every account here is one the
 * test created, since the store suite shares one database on CI.
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

/** One transition of the account's roster, written down as a pass would: the snapshot advanced and the diff pending. */
async function passed(
  userId: string,
  from: ObservedRoster,
  to: ObservedRoster,
  observedAt: number,
  previousObservedAt: number | undefined,
): Promise<string> {
  const id = randomUUID();
  const landed = await database.store.roster.advance(
    userId,
    { body: JSON.stringify(to), observedAt },
    previousObservedAt === undefined
      ? undefined
      : { id, observedAt, previousObservedAt, payload: encodeRosterDiff(rosterDiff(from, to)) },
    previousObservedAt,
  );
  assert.equal(landed, true);
  return id;
}

/** An account whose first pass saw `first`; nothing is pending yet. */
async function accountSeeing(first: ObservedRoster): Promise<string> {
  const userId = await database.createUser();
  await passed(userId, first, first, NOW, undefined);
  return userId;
}

interface Handed {
  readonly kind: "open" | "send";
  readonly sessionId?: string;
  readonly message: EveMessage<ScheduledTurn>;
}

/** One event as the opening words carry it, in the two fields these tests read. */
interface ObservedEventRecord {
  readonly provider_session_id: string;
  readonly transcript_delta?: { readonly text: string };
}

/** What one observation turn's opening words carry, read back as the data they are. */
function eventsOf(message: EveMessage<ScheduledTurn>): readonly ObservedEventRecord[] {
  const [, ...body] = message.message.split("\n");
  // SAFETY: the words are the host's own JSON behind the marker, read here to assert on their shape.
  const parsed = JSON.parse(body.join("\n")) as { events: ObservedEventRecord[] };
  return parsed.events;
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
  /** The delta each session answers, by its id; a session not named answers no reading. */
  readonly deltas?: Readonly<Record<string, { text: string; cursor?: string; from?: string }>>;
}

function fakeTranscripts(fixture: TranscriptFixture = {}): Pick<HostedTranscriptReads, "since"> & {
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    async since(who) {
      asked.push(who.providerSessionId);
      const delta = fixture.deltas?.[who.providerSessionId];
      if (!delta) return undefined;
      return {
        delta: { text: delta.text, truncated: false, status: ACTION_RESULT_STATUS.ACCEPTED },
        ...(delta.cursor !== undefined ? { cursor: delta.cursor } : undefined),
        ...(delta.from !== undefined ? { from: delta.from } : undefined),
      };
    },
  };
}

function seams(
  overrides: Partial<TurnOpenerSeams> & { readonly roster: TurnOpenerSeams["roster"] },
): TurnOpenerSeams & { reports: string[] } {
  const reports: string[] = [];
  return {
    run: database.run,
    store: database.store,
    eve: fakeEve().eve,
    transcripts: fakeTranscripts(),
    now: () => NOW + 5_000,
    report: (message) => reports.push(message),
    ...overrides,
    reports,
  };
}

async function cursorOf(userId: string, who: SessionIdentity): Promise<string | undefined> {
  const [row] = await database.db
    .select({ cursor: providerCursors.cursor })
    .from(providerCursors)
    .where(
      and(
        eq(providerCursors.userId, userId),
        eq(providerCursors.providerId, who.providerId),
        eq(providerCursors.providerSessionId, who.providerSessionId),
      ),
    );
  return row?.cursor;
}

async function pendingDiffIds(userId: string): Promise<string[]> {
  return (await database.store.roster.pendingDiffs(userId)).map((diff) => diff.id);
}

async function observedConversations(
  userId: string,
): Promise<{ id: string; providerSessionId: string | null; runtimeSessionId: string | null }[]> {
  return database.db
    .select({
      id: conversations.id,
      providerSessionId: conversations.providerSessionId,
      runtimeSessionId: conversations.runtimeSessionId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        eq(conversations.kind, CONVERSATION_KIND.OBSERVED),
        isNull(conversations.deletedAt),
      ),
    )
    .orderBy(conversations.providerSessionId);
}

/** Three passes each moving one session, as three diffs pending for it. */
async function threeDiffsAboutOneSession(): Promise<{ userId: string; diffs: string[] }> {
  const working = roster([observation("s-1")]);
  const waiting = roster([observation("s-1", { status: SESSION_STATUS.WAITING })]);
  const erroring = roster([
    observation("s-1", {
      status: SESSION_STATUS.WAITING,
      detail: { repository: "repo", error: "boom" },
    }),
  ]);
  const complete = roster([observation("s-1", { status: SESSION_STATUS.COMPLETE })]);
  const userId = await accountSeeing(working);
  const diffs = [
    await passed(userId, working, waiting, NOW + 1_000, NOW),
    await passed(userId, waiting, erroring, NOW + 2_000, NOW + 1_000),
    await passed(userId, erroring, complete, NOW + 3_000, NOW + 2_000),
  ];
  return { userId, diffs };
}

test("three diffs about one session in one pass become one turn: one eve message carrying every change, the observed conversation opened on the first, the cursor kept and the diffs consumed together", async () => {
  const { userId, diffs } = await threeDiffsAboutOneSession();
  const { eve, handed } = fakeEve();
  const transcripts = fakeTranscripts({
    deltas: { "s-1": { text: "Developer: go on", cursor: "cursor-1" } },
  });
  const opener = seams({
    eve,
    transcripts,
    roster: hostedRosterFrom(
      roster([observation("s-1", { status: SESSION_STATUS.COMPLETE })]),
      NOW + 3_000,
    ),
  });

  const outcome = await openObservationTurns(opener, userId);

  assert.deepEqual(outcome, { observation: 1, failed: 0 } satisfies TurnOpeningOutcome);
  assert.equal(handed.length, 1);
  const [turn] = handed;
  assert.ok(turn);
  assert.equal(turn.kind, "open");
  assert.equal(turn.message.turn, BRAIN_HOST_TURN.OBSERVATION);
  const events = eventsOf(turn.message);
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((event) => event.provider_session_id),
    ["s-1", "s-1", "s-1"],
  );
  assert.equal(events.filter((event) => event.transcript_delta !== undefined).length, 1);
  assert.deepEqual(transcripts.asked, ["s-1"]);

  const opened = await observedConversations(userId);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.providerSessionId, "s-1");
  assert.equal(turn.message.conversationId, opened[0]?.id);
  assert.equal(await cursorOf(userId, identity("s-1")), "cursor-1");
  assert.deepEqual(await pendingDiffIds(userId), []);
  assert.equal(diffs.length, 3);

  const again = await openObservationTurns(opener, userId);
  assert.deepEqual(again, { observation: 0, failed: 0 });
  assert.equal(handed.length, 1);
});

test("a conversation already running in an eve session is sent to, not reopened; one eve has retired is opened again", async () => {
  const { userId } = await threeDiffsAboutOneSession();
  const conversationId = await database.store.directory.observed(userId, identity("s-1"), NOW);
  assert.ok(conversationId);
  await database.db
    .update(conversations)
    .set({ runtimeSessionId: SESSION_ID })
    .where(eq(conversations.id, conversationId));
  const current = fakeEve();
  const rosterNow = hostedRosterFrom(roster([observation("s-1")]), NOW + 3_000);
  await openObservationTurns(seams({ eve: current.eve, roster: rosterNow }), userId);
  assert.deepEqual(
    current.handed.map((turn) => [turn.kind, turn.sessionId]),
    [["send", SESSION_ID]],
  );

  const { userId: retiredUser } = await threeDiffsAboutOneSession();
  const retiredConversation = await database.store.directory.observed(
    retiredUser,
    identity("s-1"),
    NOW,
  );
  assert.ok(retiredConversation);
  await database.db
    .update(conversations)
    .set({ runtimeSessionId: SESSION_ID })
    .where(eq(conversations.id, retiredConversation));
  const retired = fakeEve((handed) =>
    handed.kind === "send" ? { outcome: EVE_SEND_OUTCOME.RETIRED } : ACCEPTING(handed),
  );
  const outcome = await openObservationTurns(
    seams({ eve: retired.eve, roster: rosterNow }),
    retiredUser,
  );
  assert.deepEqual(outcome, { observation: 1, failed: 0 });
  assert.deepEqual(
    retired.handed.map((turn) => turn.kind),
    ["send", "open"],
  );
  assert.deepEqual(await pendingDiffIds(retiredUser), []);
});

test("a turn eve refuses leaves the cursor and the diffs standing, and nothing of the pass is recorded", async () => {
  const { userId, diffs } = await threeDiffsAboutOneSession();
  const refusing = fakeEve(() => ({ outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }));
  const opener = seams({
    eve: refusing.eve,
    transcripts: fakeTranscripts({ deltas: { "s-1": { text: "words", cursor: "cursor-1" } } }),
    roster: hostedRosterFrom(roster([observation("s-1")]), NOW + 3_000),
  });

  const outcome = await openObservationTurns(opener, userId);

  assert.deepEqual(outcome, { observation: 0, failed: 1 });
  assert.equal(refusing.handed.length, 1);
  assert.equal(await cursorOf(userId, identity("s-1")), undefined);
  assert.deepEqual((await pendingDiffIds(userId)).sort(), [...diffs].sort());
  assert.equal(opener.reports.length, 1);

  const throwing = fakeEve(() => {
    throw new Error("eve is unreachable");
  });
  const thrown = await openObservationTurns(
    seams({ eve: throwing.eve, roster: opener.roster }),
    userId,
  );
  assert.deepEqual(thrown, { observation: 0, failed: 1 });
  assert.deepEqual((await pendingDiffIds(userId)).sort(), [...diffs].sort());
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

test("the cursor and the diffs move in one transaction: a write that fails after eve accepted leaves both standing for the next tick", async () => {
  const { userId, diffs } = await threeDiffsAboutOneSession();
  const { eve } = fakeEve();
  // The real database, every transaction of which fails after its body ran:
  // a write made outside the transaction lands anyway, which is what this
  // test exists to see.
  const failingAfterWrites: HostedStoreRun = (effect) =>
    database.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        Effect.provideService(effect, SqlClient.SqlClient, transactionsFailingAfter(sql)),
      ),
    );
  const opener = seams({
    run: failingAfterWrites,
    eve,
    transcripts: fakeTranscripts({ deltas: { "s-1": { text: "words", cursor: "cursor-1" } } }),
    roster: hostedRosterFrom(roster([observation("s-1")]), NOW + 3_000),
  });

  await assert.rejects(openObservationTurns(opener, userId));

  assert.equal(await cursorOf(userId, identity("s-1")), undefined);
  assert.deepEqual((await pendingDiffIds(userId)).sort(), [...diffs].sort());
});

test("a transcript read that throws costs the turn its delta and nothing else; the cursor it would have moved stands", async () => {
  const { userId } = await threeDiffsAboutOneSession();
  const { eve, handed } = fakeEve();
  const opener = seams({
    eve,
    transcripts: {
      since: async () => {
        throw new Error("Conductor did not answer");
      },
    },
    roster: hostedRosterFrom(roster([observation("s-1")]), NOW + 3_000),
  });
  const outcome = await openObservationTurns(opener, userId);
  assert.deepEqual(outcome, { observation: 1, failed: 0 });
  assert.equal(
    eventsOf(
      handed[0]?.message ?? { conversationId: "", turn: BRAIN_HOST_TURN.OBSERVATION, message: "" },
    ).some((event) => event.transcript_delta !== undefined),
    false,
  );
  assert.equal(await cursorOf(userId, identity("s-1")), undefined);
  assert.deepEqual(await pendingDiffIds(userId), []);
  assert.equal(opener.reports.length, 1);
});

test("the bound is per account: two accounts under a bound of one each get their one turn, and neither waits on the other", async () => {
  const before = roster([observation("s-1")]);
  const after = roster([observation("s-1", { status: SESSION_STATUS.WAITING })]);
  const accounts = await Promise.all(
    [0, 1].map(async () => {
      const userId = await accountSeeing(before);
      await passed(userId, before, after, NOW + 1_000, NOW);
      return userId;
    }),
  );
  const rosterNow = hostedRosterFrom(after, NOW + 1_000);
  for (const userId of accounts) {
    const { eve, handed } = fakeEve();
    const outcome = await openObservationTurns(seams({ eve, roster: rosterNow }), userId, {
      limit: 1,
    });
    assert.deepEqual(outcome, { observation: 1, failed: 0 });
    assert.equal(handed.length, 1);
    assert.deepEqual(await pendingDiffIds(userId), []);
  }
});

test("within an account the bound takes whole diffs oldest first and leaves the rest pending; the one diff wider than the bound is cut to it and the cut is reported", async () => {
  const one = roster([observation("s-1")]);
  const two = roster([observation("s-1"), observation("s-2")]);
  const three = roster([observation("s-1"), observation("s-2"), observation("s-3")]);
  const userId = await accountSeeing(one);
  const first = await passed(userId, one, two, NOW + 1_000, NOW);
  const second = await passed(userId, two, three, NOW + 2_000, NOW + 1_000);
  const rosterNow = hostedRosterFrom(three, NOW + 2_000);

  const bounded = fakeEve();
  const outcome = await openObservationTurns(
    seams({ eve: bounded.eve, roster: rosterNow }),
    userId,
    {
      limit: 1,
    },
  );
  assert.deepEqual(outcome, { observation: 1, failed: 0 });
  assert.deepEqual(
    bounded.handed.map((turn) => eventsOf(turn.message).map((event) => event.provider_session_id)),
    [["s-2"]],
  );
  assert.deepEqual(await pendingDiffIds(userId), [second]);
  assert.notEqual(first, second);

  const next = fakeEve();
  await openObservationTurns(seams({ eve: next.eve, roster: rosterNow }), userId, { limit: 1 });
  assert.deepEqual(
    next.handed.map((turn) => eventsOf(turn.message).map((event) => event.provider_session_id)),
    [["s-3"]],
  );
  assert.deepEqual(await pendingDiffIds(userId), []);

  const wide = await accountSeeing(roster([]));
  await passed(wide, roster([]), three, NOW + 1_000, NOW);
  const cutting = fakeEve();
  const cut = seams({ eve: cutting.eve, roster: rosterNow });
  const wideOutcome = await openObservationTurns(cut, wide, { limit: 2 });
  assert.deepEqual(wideOutcome, { observation: 2, failed: 0 });
  assert.equal(cutting.handed.length, 2);
  assert.deepEqual(await pendingDiffIds(wide), []);
  assert.equal(cut.reports.length, 1);
  const rows = await database.db
    .select()
    .from(rosterDiffTable)
    .where(eq(rosterDiffTable.userId, wide));
  assert.equal(
    rows.every((row) => row.consumedAt !== null),
    true,
  );
});

test("a diff about a session the snapshot no longer holds still wakes its conversation, with what the diff last knew of it and no transcript read", async () => {
  const before = roster([observation("s-1")]);
  const gone = roster([]);
  const userId = await accountSeeing(before);
  await passed(userId, before, gone, NOW + 1_000, NOW);
  const { eve, handed } = fakeEve();
  const transcripts = fakeTranscripts({ deltas: { "s-1": { text: "late words", cursor: "c" } } });
  const outcome = await openObservationTurns(
    seams({ eve, transcripts, roster: hostedRosterFrom(gone, NOW + 1_000) }),
    userId,
  );
  assert.deepEqual(outcome, { observation: 1, failed: 0 });
  const events = eventsOf(
    handed[0]?.message ?? { conversationId: "", turn: BRAIN_HOST_TURN.OBSERVATION, message: "" },
  );
  assert.equal(events.length, 1);
  assert.deepEqual(transcripts.asked, ["s-1"]);
});

/** An eve that, while taking the message, sees another pass keep the session's bookmark, as a pass that ran long into the next tick would. */
function eveRacedBy(keep: () => Promise<void>) {
  return fakeEve((handed) => {
    void keep();
    return ACCEPTING(handed);
  });
}

test("a bookmark is kept only over the one the read began from, so a pass that ran long cannot put a later pass's bookmark back", async () => {
  const who = identity("s-1");
  const rosterNow = hostedRosterFrom(roster([observation("s-1")]), NOW + 3_000);
  const at = new Date(NOW);
  const keep = (userId: string, cursor: string, from: string | undefined) =>
    database.run(keepTranscriptCursor(userId, who, cursor, from, at));

  // Read from no bookmark; another pass kept one before this pass's transaction.
  const { userId: first } = await threeDiffsAboutOneSession();
  const raced = eveRacedBy(() => keep(first, "cursor-later", undefined));
  const slow = seams({
    eve: raced.eve,
    transcripts: fakeTranscripts({ deltas: { "s-1": { text: "words", cursor: "cursor-slow" } } }),
    roster: rosterNow,
  });
  assert.deepEqual(await openObservationTurns(slow, first), { observation: 1, failed: 0 });
  assert.equal(await cursorOf(first, who), "cursor-later");
  assert.deepEqual(await pendingDiffIds(first), []);

  // Read from a bookmark another pass then moved on.
  const { userId: second } = await threeDiffsAboutOneSession();
  await keep(second, "cursor-later", undefined);
  const racedAgain = eveRacedBy(() => keep(second, "cursor-latest", "cursor-later"));
  await openObservationTurns(
    seams({
      eve: racedAgain.eve,
      transcripts: fakeTranscripts({
        deltas: { "s-1": { text: "words", cursor: "cursor-slow", from: "cursor-later" } },
      }),
      roster: rosterNow,
    }),
    second,
  );
  assert.equal(await cursorOf(second, who), "cursor-latest");

  // Unraced, the bookmark moves over the one the read began from.
  const { userId: third } = await threeDiffsAboutOneSession();
  await keep(third, "cursor-0", undefined);
  await openObservationTurns(
    seams({
      eve: fakeEve().eve,
      transcripts: fakeTranscripts({
        deltas: { "s-1": { text: "words", cursor: "cursor-1", from: "cursor-0" } },
      }),
      roster: rosterNow,
    }),
    third,
  );
  assert.equal(await cursorOf(third, who), "cursor-1");
});
