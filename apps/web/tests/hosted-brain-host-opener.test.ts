import assert from "node:assert/strict";
import { SqlClient } from "@effect/sql";
import { Effect, Schema } from "effect";
import { afterAll, test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  BRAIN_TOOL,
  CONVERSATION_EVENT_KIND,
  holdReleasedInputText,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionIdentity,
  SPEECH_EXPIRY_REASON,
  TURN_ORIGIN,
  TURN_STATUS,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import {
  openAccountTurns,
  openHoldReleaseTurns,
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
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { payloadKeyRing } from "../server/hosted/encryption";
import { decodeObservedRoster, type ObservedRoster } from "../server/hosted/observed-roster";
import {
  CONSUMED_ROSTER,
  type HostedStoreRun,
  releasedBriefings,
  storeWriter,
} from "../server/hosted/store";
import { EpochMillisColumnSchema, userSeal } from "../server/hosted/store/database";
import { keepConsumedRoster, writeRosterSnapshot } from "../server/hosted/store/roster-snapshot";
import { openHostedStoreTestDatabase, TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";

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
const writer = await storeWriter({
  run: database.run,
  tools: CATALOG_TOOL_SET,
  now: () => new Date(NOW),
});

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

/** An account whose first pass saw `first`, and whose opener has visited once since, so its bookmark stands at `first` and nothing is owed. */
async function accountSeeing(first: ObservedRoster): Promise<string> {
  const userId = await database.createUser();
  await passed(userId, first, NOW, undefined);
  await database.run(
    database.store.roster.keepConsumed(
      userId,
      { body: JSON.stringify(first), observedAt: NOW },
      undefined,
    ),
  );
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
    writer,
    eve: fakeEve().eve,
    transcripts: fakeTranscripts(),
    now: () => NOW + 5_000,
    report: (message) => reports.push(message),
    ...overrides,
    reports,
  };
}

const IdRowSchema = Schema.Struct({ id: Schema.String });

const CursorRowSchema = Schema.Struct({ cursor: Schema.String });

async function cursorOf(userId: string, who: SessionIdentity): Promise<string | undefined> {
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select cursor from provider_cursors
        where user_id = ${userId}
          and provider_id = ${who.providerId}
          and provider_session_id = ${who.providerSessionId}
      `;
    }),
  );
  const row = rows[0];
  return row === undefined ? undefined : Schema.decodeUnknownSync(CursorRowSchema)(row).cursor;
}

function setConversationRuntimeSessionId(conversationId: string, sessionId: string) {
  return database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        update conversations set runtime_session_id = ${sessionId} where id = ${conversationId}
      `;
    }),
  );
}

function insertSettledTurn(userId: string, conversationId: string, at: Date): Promise<string> {
  return database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        insert into turns (user_id, conversation_id, origin, status, queued_at, settled_at)
        values (
          ${userId}, ${conversationId}, ${TURN_ORIGIN.ROSTER_DIFF}, ${TURN_STATUS.SETTLED}, ${at}, ${at}
        )
        returning id
      `;
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

/** Where the opener's bookmark over the roster stands: the instant of the snapshot it last heard through, and the sessions it holds. */
async function bookmarkOf(
  userId: string,
): Promise<{ observedAt: number; sessions: string[] } | undefined> {
  const bookmark = await database.run(database.store.roster.consumed(userId));
  if (bookmark.state !== CONSUMED_ROSTER.STANDING) return undefined;
  const decoded = decodeObservedRoster(bookmark.roster.body);
  assert.ok(decoded);
  return {
    observedAt: bookmark.roster.observedAt,
    sessions: decoded.providers
      .flatMap((provider) => provider.observations.map((one) => one.providerSessionId))
      .sort(),
  };
}

const ObservedConversationRowSchema = Schema.Struct({
  id: Schema.String,
  providerSessionId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("provider_session_id"),
  ),
  runtimeSessionId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("runtime_session_id"),
  ),
});

async function observedConversations(
  userId: string,
): Promise<{ id: string; providerSessionId: string | null; runtimeSessionId: string | null }[]> {
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select id, provider_session_id, runtime_session_id from conversations
        where user_id = ${userId}
          and kind = ${CONVERSATION_KIND.OBSERVED}
          and deleted_at is null
        order by provider_session_id
      `;
    }),
  );
  return rows.map((row) => Schema.decodeUnknownSync(ObservedConversationRowSchema)(row));
}

/** Three passes each moving one session since the opener last visited, so its bookmark stands three passes behind the snapshot. */
async function threePassesAboutOneSession(): Promise<{ userId: string }> {
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
  await passed(userId, waiting, NOW + 1_000, NOW);
  await passed(userId, erroring, NOW + 2_000, NOW + 1_000);
  await passed(userId, complete, NOW + 3_000, NOW + 2_000);
  return { userId };
}

test("three passes about one session before one visit become one turn: one eve message carrying the net change, the observed conversation opened, the cursor and the bookmark kept together", async () => {
  const { userId } = await threePassesAboutOneSession();
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

  assert.deepEqual(outcome, {
    observation: 1,
    holdRelease: 0,
    failed: 0,
  } satisfies TurnOpeningOutcome);
  assert.equal(handed.length, 1);
  const [turn] = handed;
  assert.ok(turn);
  assert.equal(turn.kind, "open");
  assert.equal(turn.message.turn, BRAIN_HOST_TURN.OBSERVATION);
  const events = eventsOf(turn.message);
  // The net change since the bookmark, not the three passes' own: working to complete, the error line that came and went netting to nothing.
  assert.deepEqual(
    events.map((event) => event.provider_session_id),
    ["s-1"],
  );
  assert.equal(events.filter((event) => event.transcript_delta !== undefined).length, 1);
  assert.deepEqual(transcripts.asked, ["s-1"]);

  const opened = await observedConversations(userId);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.providerSessionId, "s-1");
  assert.equal(turn.message.conversationId, opened[0]?.id);
  assert.equal(await cursorOf(userId, identity("s-1")), "cursor-1");
  assert.deepEqual(await bookmarkOf(userId), { observedAt: NOW + 3_000, sessions: ["s-1"] });

  const again = await openObservationTurns(opener, userId);
  assert.deepEqual(again, { observation: 0, holdRelease: 0, failed: 0 });
  assert.equal(handed.length, 1);
});

test("a conversation already running in an eve session is sent to, not reopened; one eve has retired is opened again", async () => {
  const { userId } = await threePassesAboutOneSession();
  const conversationId = await database.run(
    database.store.directory.observed(userId, identity("s-1"), NOW),
  );
  assert.ok(conversationId);
  await setConversationRuntimeSessionId(conversationId, SESSION_ID);
  const current = fakeEve();
  const rosterNow = hostedRosterFrom(roster([observation("s-1")]), NOW + 3_000);
  await openObservationTurns(seams({ eve: current.eve, roster: rosterNow }), userId);
  assert.deepEqual(
    current.handed.map((turn) => [turn.kind, turn.sessionId]),
    [["send", SESSION_ID]],
  );

  const { userId: retiredUser } = await threePassesAboutOneSession();
  const retiredConversation = await database.run(
    database.store.directory.observed(retiredUser, identity("s-1"), NOW),
  );
  assert.ok(retiredConversation);
  await setConversationRuntimeSessionId(retiredConversation, SESSION_ID);
  const retired = fakeEve((handed) =>
    handed.kind === "send" ? { outcome: EVE_SEND_OUTCOME.RETIRED } : ACCEPTING(handed),
  );
  const outcome = await openObservationTurns(
    seams({ eve: retired.eve, roster: rosterNow }),
    retiredUser,
  );
  assert.deepEqual(outcome, { observation: 1, holdRelease: 0, failed: 0 });
  assert.deepEqual(
    retired.handed.map((turn) => turn.kind),
    ["send", "open"],
  );
  assert.equal((await bookmarkOf(retiredUser))?.observedAt, NOW + 3_000);
});

test("a turn eve refuses leaves the cursor and the bookmark standing, and nothing of the visit is recorded", async () => {
  const { userId } = await threePassesAboutOneSession();
  const refusing = fakeEve(() => ({ outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }));
  const opener = seams({
    eve: refusing.eve,
    transcripts: fakeTranscripts({ deltas: { "s-1": { text: "words", cursor: "cursor-1" } } }),
    roster: hostedRosterFrom(roster([observation("s-1")]), NOW + 3_000),
  });

  const outcome = await openObservationTurns(opener, userId);

  assert.deepEqual(outcome, { observation: 0, holdRelease: 0, failed: 1 });
  assert.equal(refusing.handed.length, 1);
  assert.equal(await cursorOf(userId, identity("s-1")), undefined);
  assert.equal((await bookmarkOf(userId))?.observedAt, NOW);
  assert.equal(opener.reports.length, 1);

  const throwing = fakeEve(() => {
    throw new Error("eve is unreachable");
  });
  const thrown = await openObservationTurns(
    seams({ eve: throwing.eve, roster: opener.roster }),
    userId,
  );
  assert.deepEqual(thrown, { observation: 0, holdRelease: 0, failed: 1 });
  assert.equal((await bookmarkOf(userId))?.observedAt, NOW);
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

test("the cursor and the bookmark move in one transaction: a write that fails after eve accepted leaves both standing for the next tick", async () => {
  const { userId } = await threePassesAboutOneSession();
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
  assert.equal((await bookmarkOf(userId))?.observedAt, NOW);
});

test("a transcript read that throws costs the turn its delta and nothing else; the cursor it would have moved stands", async () => {
  const { userId } = await threePassesAboutOneSession();
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
  assert.deepEqual(outcome, { observation: 1, holdRelease: 0, failed: 0 });
  assert.equal(
    eventsOf(
      handed[0]?.message ?? { conversationId: "", turn: BRAIN_HOST_TURN.OBSERVATION, message: "" },
    ).some((event) => event.transcript_delta !== undefined),
    false,
  );
  assert.equal(await cursorOf(userId, identity("s-1")), undefined);
  assert.equal((await bookmarkOf(userId))?.observedAt, NOW + 3_000);
  assert.equal(opener.reports.length, 1);
});

test("the bound is per account: two accounts under a bound of one each get their one turn, and neither waits on the other", async () => {
  const before = roster([observation("s-1")]);
  const after = roster([observation("s-1", { status: SESSION_STATUS.WAITING })]);
  const accounts = await Promise.all(
    [0, 1].map(async () => {
      const userId = await accountSeeing(before);
      await passed(userId, after, NOW + 1_000, NOW);
      return userId;
    }),
  );
  const rosterNow = hostedRosterFrom(after, NOW + 1_000);
  for (const userId of accounts) {
    const { eve, handed } = fakeEve();
    const outcome = await openObservationTurns(seams({ eve, roster: rosterNow }), userId, {
      limit: 1,
    });
    assert.deepEqual(outcome, { observation: 1, holdRelease: 0, failed: 0 });
    assert.equal(handed.length, 1);
    assert.equal((await bookmarkOf(userId))?.observedAt, NOW + 1_000);
  }
});

test("within an account the bound wakes the oldest changes first and leaves the rest in the bookmark to derive again; a change wider than the bound is cut to it, reported, and finished on the next tick", async () => {
  const one = roster([observation("s-1")]);
  const three = roster([observation("s-1"), observation("s-2"), observation("s-3")]);
  const userId = await accountSeeing(one);
  await passed(userId, roster([observation("s-1"), observation("s-2")]), NOW + 1_000, NOW);
  await passed(userId, three, NOW + 2_000, NOW + 1_000);
  const rosterNow = hostedRosterFrom(three, NOW + 2_000);

  const bounded = fakeEve();
  const cut = seams({ eve: bounded.eve, roster: rosterNow });
  const outcome = await openObservationTurns(cut, userId, { limit: 1 });
  assert.deepEqual(outcome, { observation: 1, holdRelease: 0, failed: 0 });
  assert.deepEqual(
    bounded.handed.map((turn) => eventsOf(turn.message).map((event) => event.provider_session_id)),
    [["s-2"]],
  );
  assert.equal(cut.reports.length, 1);
  // The bookmark carries s-2 and still lacks s-3, so s-3 derives again as appeared.
  assert.deepEqual(await bookmarkOf(userId), { observedAt: NOW + 2_000, sessions: ["s-1", "s-2"] });

  const next = fakeEve();
  await openObservationTurns(seams({ eve: next.eve, roster: rosterNow }), userId, { limit: 1 });
  assert.deepEqual(
    next.handed.map((turn) => eventsOf(turn.message).map((event) => event.provider_session_id)),
    [["s-3"]],
  );
  assert.deepEqual(await bookmarkOf(userId), {
    observedAt: NOW + 2_000,
    sessions: ["s-1", "s-2", "s-3"],
  });
  assert.deepEqual(
    await openObservationTurns(seams({ eve: fakeEve().eve, roster: rosterNow }), userId),
    {
      observation: 0,
      holdRelease: 0,
      failed: 0,
    },
  );

  const wide = await accountSeeing(roster([]));
  await passed(wide, three, NOW + 1_000, NOW);
  const cutting = fakeEve();
  const wideOutcome = await openObservationTurns(
    seams({ eve: cutting.eve, roster: rosterNow }),
    wide,
    { limit: 2 },
  );
  assert.deepEqual(wideOutcome, { observation: 2, holdRelease: 0, failed: 0 });
  assert.equal(cutting.handed.length, 2);
  assert.deepEqual(await bookmarkOf(wide), { observedAt: NOW + 1_000, sessions: ["s-1", "s-2"] });
});

test("a bookmark this build cannot open is replaced by the snapshot over its own instant, so wakes resume on the next change instead of stopping for good", async () => {
  const userId = await database.createUser();
  const before = roster([observation("s-1")]);
  await passed(userId, before, NOW, undefined);
  // A bookmark sealed under another account: it stands, and this account's seal cannot open it.
  const other = await database.createUser();
  await database.run(
    keepConsumedRoster(
      userSeal(payloadKeyRing(TEST_PAYLOAD_SECRET), other),
      userId,
      { body: JSON.stringify(roster([])), observedAt: NOW - 60_000 },
      undefined,
    ),
  );
  assert.equal(
    (await database.run(database.store.roster.consumed(userId))).state,
    CONSUMED_ROSTER.UNREADABLE,
  );

  const { eve, handed } = fakeEve();
  const first = seams({ eve, roster: hostedRosterFrom(before, NOW) });
  assert.deepEqual(await openObservationTurns(first, userId), {
    observation: 0,
    holdRelease: 0,
    failed: 0,
  });
  assert.equal(handed.length, 0);
  assert.equal(first.reports.length, 1);
  assert.deepEqual(await bookmarkOf(userId), { observedAt: NOW, sessions: ["s-1"] });

  const after = roster([observation("s-1", { status: SESSION_STATUS.WAITING })]);
  await passed(userId, after, NOW + 1_000, NOW);
  assert.deepEqual(
    await openObservationTurns(
      seams({ eve, roster: hostedRosterFrom(after, NOW + 1_000) }),
      userId,
    ),
    { observation: 1, holdRelease: 0, failed: 0 },
  );
  assert.equal(handed.length, 1);
});

test("a change no wake is derived from, a workspace coming or going, settles the bookmark on the visit that saw it rather than deriving again every tick", async () => {
  const before = roster([observation("s-1")]);
  const after = roster([
    observation("s-1", { workspace: { providerWorkspaceId: "workspace-b", name: "b" } }),
  ]);
  const userId = await accountSeeing(before);
  await passed(userId, after, NOW + 1_000, NOW);
  const { eve, handed } = fakeEve();
  const rosterNow = hostedRosterFrom(after, NOW + 1_000);
  assert.deepEqual(await openObservationTurns(seams({ eve, roster: rosterNow }), userId), {
    observation: 0,
    holdRelease: 0,
    failed: 0,
  });
  assert.equal(handed.length, 0);
  assert.equal((await bookmarkOf(userId))?.observedAt, NOW + 1_000);
  // The bookmark now holds the change: the next visit derives nothing and writes nothing.
  const bookmark = await database.run(database.store.roster.consumed(userId));
  assert.equal(bookmark.state, CONSUMED_ROSTER.STANDING);
  assert.deepEqual(
    bookmark.state === CONSUMED_ROSTER.STANDING
      ? decodeObservedRoster(bookmark.roster.body)
      : undefined,
    after,
  );
});

test("a provider key replaced since the bookmark wakes nothing: the bookmark settles on the new key's roster, and the next change under it wakes as usual", async () => {
  const userId = await accountSeeing(roster([observation("s-1"), observation("s-2")]));
  const rekeyed: ObservedRoster = {
    version: 1,
    providers: [
      {
        providerId: PROVIDER,
        keyFingerprint: "g",
        observations: [observation("s-9")],
        projects: [],
      },
    ],
  };
  await passed(userId, rekeyed, NOW + 1_000, NOW);
  const { eve, handed } = fakeEve();
  assert.deepEqual(
    await openObservationTurns(
      seams({ eve, roster: hostedRosterFrom(rekeyed, NOW + 1_000) }),
      userId,
    ),
    { observation: 0, holdRelease: 0, failed: 0 },
  );
  assert.equal(handed.length, 0);
  assert.deepEqual(await bookmarkOf(userId), { observedAt: NOW + 1_000, sessions: ["s-9"] });

  const moved: ObservedRoster = {
    version: 1,
    providers: [
      {
        providerId: PROVIDER,
        keyFingerprint: "g",
        observations: [observation("s-9", { status: SESSION_STATUS.WAITING })],
        projects: [],
      },
    ],
  };
  await passed(userId, moved, NOW + 2_000, NOW + 1_000);
  assert.deepEqual(
    await openObservationTurns(
      seams({ eve, roster: hostedRosterFrom(moved, NOW + 2_000) }),
      userId,
    ),
    { observation: 1, holdRelease: 0, failed: 0 },
  );
  assert.deepEqual(
    handed.map((turn) => eventsOf(turn.message).map((event) => event.provider_session_id)),
    [["s-9"]],
  );
});

test("a snapshot this build cannot open wakes nothing and is said, rather than failing the account's opening until a pass replaces it", async () => {
  const userId = await accountSeeing(roster([observation("s-1")]));
  const other = await database.createUser();
  await database.run(
    writeRosterSnapshot(userSeal(payloadKeyRing(TEST_PAYLOAD_SECRET), other), userId, {
      body: JSON.stringify(roster([observation("s-1")])),
      observedAt: NOW + 1_000,
    }),
  );
  const { eve, handed } = fakeEve();
  const opener = seams({
    eve,
    roster: hostedRosterFrom(roster([observation("s-1")]), NOW + 1_000),
  });
  assert.deepEqual(await openObservationTurns(opener, userId), {
    observation: 0,
    holdRelease: 0,
    failed: 0,
  });
  assert.equal(handed.length, 0);
  assert.equal(opener.reports.length, 1);
  assert.equal((await bookmarkOf(userId))?.observedAt, NOW);
});

test("a bookmark first stands where the snapshot does: an account the opener has never visited is adopted whole and woken for nothing, and derived from on the next change", async () => {
  const userId = await database.createUser();
  const before = roster([observation("s-1"), observation("s-2")]);
  await passed(userId, before, NOW, undefined);
  const { eve, handed } = fakeEve();
  assert.deepEqual(
    await openObservationTurns(seams({ eve, roster: hostedRosterFrom(before, NOW) }), userId),
    { observation: 0, holdRelease: 0, failed: 0 },
  );
  assert.equal(handed.length, 0);
  assert.deepEqual(await bookmarkOf(userId), { observedAt: NOW, sessions: ["s-1", "s-2"] });

  const after = roster([
    observation("s-1", { status: SESSION_STATUS.WAITING }),
    observation("s-2"),
  ]);
  await passed(userId, after, NOW + 1_000, NOW);
  const outcome = await openObservationTurns(
    seams({ eve, roster: hostedRosterFrom(after, NOW + 1_000) }),
    userId,
  );
  assert.deepEqual(outcome, { observation: 1, holdRelease: 0, failed: 0 });
  assert.deepEqual(
    handed.map((turn) => eventsOf(turn.message).map((event) => event.provider_session_id)),
    [["s-1"]],
  );
});

test("a change about a session the snapshot no longer holds still wakes its conversation, with what the diff last knew of it and no transcript read", async () => {
  const before = roster([observation("s-1")]);
  const gone = roster([]);
  const userId = await accountSeeing(before);
  await passed(userId, gone, NOW + 1_000, NOW);
  const { eve, handed } = fakeEve();
  const transcripts = fakeTranscripts({ deltas: { "s-1": { text: "late words", cursor: "c" } } });
  const outcome = await openObservationTurns(
    seams({ eve, transcripts, roster: hostedRosterFrom(gone, NOW + 1_000) }),
    userId,
  );
  assert.deepEqual(outcome, { observation: 1, holdRelease: 0, failed: 0 });
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
  const { userId: first } = await threePassesAboutOneSession();
  const raced = eveRacedBy(() => keep(first, "cursor-later", undefined));
  const slow = seams({
    eve: raced.eve,
    transcripts: fakeTranscripts({ deltas: { "s-1": { text: "words", cursor: "cursor-slow" } } }),
    roster: rosterNow,
  });
  assert.deepEqual(await openObservationTurns(slow, first), {
    observation: 1,
    holdRelease: 0,
    failed: 0,
  });
  assert.equal(await cursorOf(first, who), "cursor-later");
  assert.equal((await bookmarkOf(first))?.observedAt, NOW + 3_000);

  // Read from a bookmark another pass then moved on.
  const { userId: second } = await threePassesAboutOneSession();
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
  const { userId: third } = await threePassesAboutOneSession();
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

test("the bookmark is kept only over the one the read began from, so a visit that ran long cannot put a later visit's bookmark back", async () => {
  const rosterNow = hostedRosterFrom(roster([observation("s-1")]), NOW + 3_000);
  const { userId } = await threePassesAboutOneSession();
  const laterBookmark = {
    body: JSON.stringify(roster([observation("s-1")])),
    observedAt: NOW + 9_000,
  };
  const raced = eveRacedBy(() =>
    database.run(database.store.roster.keepConsumed(userId, laterBookmark, NOW)).then(() => {}),
  );
  const outcome = await openObservationTurns(seams({ eve: raced.eve, roster: rosterNow }), userId);
  assert.deepEqual(outcome, { observation: 1, holdRelease: 0, failed: 0 });
  assert.equal((await bookmarkOf(userId))?.observedAt, NOW + 9_000);
});

/** The hold-release drain. */

interface Released {
  readonly userId: string;
  readonly conversationId: string;
  readonly queued: string[];
}

/** One held briefing as the opener reads it back: the briefing's words and when the brain decided it. */
interface HeldBriefingRecord {
  readonly briefing: string;
  readonly decided_at: string;
}

function heldBriefingsOf(message: EveMessage<ScheduledTurn>): readonly HeldBriefingRecord[] {
  const [, ...body] = message.message.split("\n");
  // SAFETY: the words are the host's own JSON behind the marker, read here to assert on their shape.
  const parsed = JSON.parse(body.join("\n")) as { held_briefings: HeldBriefingRecord[] };
  return parsed.held_briefings;
}

/**
 * An observed conversation whose one settled turn announced a briefing that a
 * hold then released unspoken, with `rows` hold-release turns queued for it
 * the way the sweep queues them. The release event and the announcing row
 * are written as the sweep and the relay leave them.
 */
async function releasedConversation(
  userId: string,
  sessionId: string,
  options: { rows: number; briefings?: number; releasedAt?: number; carried?: boolean } = {
    rows: 1,
  },
): Promise<Released> {
  const conversationId = await database.run(
    database.store.directory.observed(userId, identity(sessionId), NOW),
  );
  assert.ok(conversationId);
  const target = { userId, conversationId };
  const decided: { briefing: string; decidedAt: number }[] = [];
  for (let index = 0; index < (options.briefings ?? 1); index += 1) {
    const at = new Date(NOW - 60_000 + index);
    const turnId = await insertSettledTurn(userId, conversationId, at);
    const parts = JSON.stringify([
      {
        type: `tool-${BRAIN_TOOL.ANNOUNCE}`,
        toolCallId: `call-${index}`,
        state: "output-available",
        input: { briefing: `Fixture briefing ${index + 1}.` },
        output: { status: "accepted" },
      },
    ]);
    const metadata = JSON.stringify({ author: MESSAGE_AUTHOR.BRAIN });
    const messageId = await database.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql`
          insert into messages (
            user_id, conversation_id, seq, turn_id, client_id, role, parts, metadata, created_at, finished_at
          )
          values (
            ${userId}, ${conversationId}, ${index + 1}, ${turnId}, ${turnId}, ${MESSAGE_ROLE.ASSISTANT},
            ${parts}::jsonb, ${metadata}::jsonb, ${at}, ${at}
          )
          returning id
        `;
        return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
      }),
    );
    const payload = JSON.stringify({ reason: SPEECH_EXPIRY_REASON.HOLD_RELEASED });
    await database.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          insert into events (user_id, conversation_id, seq, message_id, kind, payload, created_at)
          values (
            ${userId}, ${conversationId}, ${index + 1}, ${messageId},
            ${CONVERSATION_EVENT_KIND.SPEECH_EXPIRED}, ${payload}::jsonb,
            ${new Date(options.releasedAt ?? NOW - 30_000)}
          )
        `;
      }),
    );
    decided.push({ briefing: `Fixture briefing ${index + 1}.`, decidedAt: NOW - 60_000 + index });
  }
  if (options.carried) {
    // The re-decision eve already ran, as the relay records its opening words: every briefing so far is named there.
    const words = await writer.recordUserMessage(target, {
      clientId: `carried-${conversationId}`,
      text: holdReleasedInputText(decided, NOW - 20_000),
      metadata: { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.HOLD_RELEASE },
    });
    assert.equal(words.ok, true);
  }
  const queued: string[] = [];
  for (let index = 0; index < options.rows; index += 1) {
    const row = await writer.enqueueTurn(target, { origin: TURN_ORIGIN.HOLD_RELEASE });
    assert.equal(row.ok, true);
    if (row.ok) queued.push(row.turnId);
  }
  return { userId, conversationId, queued };
}

async function queuedRows(conversationId: string): Promise<string[]> {
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select id from turns where conversation_id = ${conversationId} and status = ${TURN_STATUS.QUEUED}
      `;
    }),
  );
  return rows.map((row) => Schema.decodeUnknownSync(IdRowSchema)(row).id);
}

test("a conversation's queued hold releases become one hold_release message listing the briefings the hold released, and the rows go once eve has it", async () => {
  const userId = await accountSeeing(roster([observation("s-1")]));
  const released = await releasedConversation(userId, "s-1", { rows: 2, briefings: 2 });
  const { eve, handed } = fakeEve();
  const opener = seams({ eve, roster: hostedRosterFrom(roster([observation("s-1")]), NOW) });

  const outcome = await openHoldReleaseTurns(opener, userId);

  assert.deepEqual(outcome, { observation: 0, holdRelease: 1, failed: 0 });
  assert.equal(handed.length, 1);
  const [turn] = handed;
  assert.ok(turn);
  assert.equal(turn.message.turn, BRAIN_HOST_TURN.HOLD_RELEASE);
  assert.equal(turn.message.conversationId, released.conversationId);
  assert.deepEqual(
    heldBriefingsOf(turn.message).map((briefing) => briefing.briefing),
    ["Fixture briefing 1.", "Fixture briefing 2."],
  );
  assert.deepEqual(await queuedRows(released.conversationId), []);
  assert.equal(released.queued.length, 2);
  assert.deepEqual(await openHoldReleaseTurns(opener, userId), {
    observation: 0,
    holdRelease: 0,
    failed: 0,
  });
  assert.equal(handed.length, 1);
});

test("a hold-release row the relay has moved to running is the run's record and not the inbox: the drain hands eve nothing for it and leaves it standing", async () => {
  const userId = await accountSeeing(roster([observation("s-1")]));
  const released = await releasedConversation(userId, "s-1", { rows: 1 });
  const [running] = released.queued;
  assert.ok(running);
  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        update turns set status = ${TURN_STATUS.RUNNING}, started_at = ${new Date(NOW - 1_000)}
        where id = ${running}
      `;
    }),
  );
  const { eve, handed } = fakeEve();

  const outcome = await openHoldReleaseTurns(
    seams({ eve, roster: hostedRosterFrom(roster([observation("s-1")]), NOW) }),
    userId,
  );

  assert.deepEqual(outcome, { observation: 0, holdRelease: 0, failed: 0 });
  assert.deepEqual(handed, []);
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select status from turns where id = ${running}`;
    }),
  );
  assert.deepEqual(rows[0], { status: TURN_STATUS.RUNNING });
});

test("a hold release eve refuses leaves its rows queued; one whose briefings a hold-release message already names goes without a turn, said rather than sent", async () => {
  const userId = await accountSeeing(roster([observation("s-1"), observation("s-2")]));
  const refused = await releasedConversation(userId, "s-1", { rows: 1 });
  const refusing = fakeEve(() => ({ outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }));
  const rosterNow = hostedRosterFrom(roster([observation("s-1"), observation("s-2")]), NOW);
  assert.deepEqual(
    await openHoldReleaseTurns(seams({ eve: refusing.eve, roster: rosterNow }), userId),
    { observation: 0, holdRelease: 0, failed: 1 },
  );
  assert.deepEqual(await queuedRows(refused.conversationId), refused.queued);

  const stale = await releasedConversation(userId, "s-2", { rows: 1, carried: true });
  const { eve, handed } = fakeEve();
  const opener = seams({ eve, roster: rosterNow });
  const outcome = await openHoldReleaseTurns(opener, userId, { limit: 8 });
  assert.equal(outcome.holdRelease, 1);
  assert.deepEqual(
    handed.map((turn) => turn.message.conversationId),
    [refused.conversationId],
  );
  assert.deepEqual(await queuedRows(stale.conversationId), []);
  assert.equal(opener.reports.length, 1);
});

test("an account's opening takes the hold releases first and the observations under what remains of one bound", async () => {
  const before = roster([observation("s-1"), observation("s-2")]);
  const after = roster([
    observation("s-1"),
    observation("s-2", { status: SESSION_STATUS.WAITING }),
  ]);
  const userId = await accountSeeing(before);
  await passed(userId, after, NOW + 1_000, NOW);
  await releasedConversation(userId, "s-1", { rows: 1 });
  const rosterNow = hostedRosterFrom(after, NOW + 1_000);

  const bounded = fakeEve();
  assert.deepEqual(
    await openAccountTurns(seams({ eve: bounded.eve, roster: rosterNow }), userId, { limit: 1 }),
    { observation: 0, holdRelease: 1, failed: 0 },
  );
  assert.deepEqual(
    bounded.handed.map((turn) => turn.message.turn),
    [BRAIN_HOST_TURN.HOLD_RELEASE],
  );
  assert.equal((await bookmarkOf(userId))?.observedAt, NOW);

  const next = fakeEve();
  assert.deepEqual(
    await openAccountTurns(seams({ eve: next.eve, roster: rosterNow }), userId, { limit: 1 }),
    { observation: 1, holdRelease: 0, failed: 0 },
  );
  assert.deepEqual(
    next.handed.map((turn) => turn.message.turn),
    [BRAIN_HOST_TURN.OBSERVATION],
  );
});

test("a first bookmark is adopted whatever the bound has left: a visit whose bound the hold releases used up, or whose hold release eve refused, still places it, so no later adoption swallows the changes in between", async () => {
  const before = roster([observation("s-1")]);
  const filled = await database.createUser();
  await passed(filled, before, NOW, undefined);
  await releasedConversation(filled, "s-1", { rows: 1 });
  const { eve } = fakeEve();
  assert.deepEqual(
    await openAccountTurns(seams({ eve, roster: hostedRosterFrom(before, NOW) }), filled, {
      limit: 1,
    }),
    { observation: 0, holdRelease: 1, failed: 0 },
  );
  assert.deepEqual(await bookmarkOf(filled), { observedAt: NOW, sessions: ["s-1"] });

  const refused = await database.createUser();
  await passed(refused, before, NOW, undefined);
  await releasedConversation(refused, "s-1", { rows: 1 });
  const refusing = fakeEve(() => ({ outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }));
  assert.deepEqual(
    await openAccountTurns(
      seams({ eve: refusing.eve, roster: hostedRosterFrom(before, NOW) }),
      refused,
    ),
    { observation: 0, holdRelease: 0, failed: 1 },
  );
  assert.deepEqual(await bookmarkOf(refused), { observedAt: NOW, sessions: ["s-1"] });
});

test("a re-decision carries every release no hold-release message has named, however many, and none a message already names", async () => {
  const userId = await accountSeeing(roster([observation("s-1")]));
  const released = await releasedConversation(userId, "s-1", { rows: 1, briefings: 12 });
  // One more, released earlier and named by the re-decision that carried it.
  const earlierParts = JSON.stringify([
    {
      type: `tool-${BRAIN_TOOL.ANNOUNCE}`,
      toolCallId: "call-earlier",
      state: "output-available",
      input: { briefing: "An earlier briefing." },
      output: { status: "accepted" },
    },
  ]);
  const earlierMetadata = JSON.stringify({ author: MESSAGE_AUTHOR.BRAIN });
  const earlierId = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        insert into messages (
          user_id, conversation_id, seq, client_id, role, parts, metadata, created_at, finished_at
        )
        values (
          ${userId}, ${released.conversationId}, ${40}, ${"earlier-announcement"}, ${MESSAGE_ROLE.ASSISTANT},
          ${earlierParts}::jsonb, ${earlierMetadata}::jsonb, ${new Date(NOW - 120_000)}, ${new Date(NOW - 120_000)}
        )
        returning id
      `;
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
  const earlierPayload = JSON.stringify({ reason: SPEECH_EXPIRY_REASON.HOLD_RELEASED });
  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        insert into events (user_id, conversation_id, seq, message_id, kind, payload, created_at)
        values (
          ${userId}, ${released.conversationId}, ${40}, ${earlierId},
          ${CONVERSATION_EVENT_KIND.SPEECH_EXPIRED}, ${earlierPayload}::jsonb, ${new Date(NOW - 60_000)}
        )
      `;
    }),
  );
  const carried = await writer.recordUserMessage(
    { userId, conversationId: released.conversationId },
    {
      clientId: "carried-earlier",
      text: holdReleasedInputText(
        [{ briefing: "An earlier briefing.", decidedAt: NOW - 120_000 }],
        NOW - 50_000,
      ),
      metadata: { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.HOLD_RELEASE },
    },
  );
  assert.equal(carried.ok, true);
  // Three sentences for a recurrence, in the order a row travels: the fixture's rows stand, the drain reads them, eve receives them. A failure here says which of the three it was.
  const expected = Array.from({ length: 12 }, (_, index) => `Fixture briefing ${index + 1}.`);
  const target = { userId, conversationId: released.conversationId };
  const releaseEvents = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select seq from events
        where conversation_id = ${released.conversationId}
          and kind = ${CONVERSATION_EVENT_KIND.SPEECH_EXPIRED}
        order by seq
      `;
    }),
  );
  assert.deepEqual(
    releaseEvents.map((row) => Schema.decodeUnknownSync(EpochMillisColumnSchema)(row.seq)),
    [...Array.from({ length: 12 }, (_, index) => index + 1), 40],
  );
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select seq from messages where conversation_id = ${released.conversationId} order by seq
      `;
    }),
  );
  assert.deepEqual(
    rows.map((row) => Schema.decodeUnknownSync(EpochMillisColumnSchema)(row.seq)),
    [...Array.from({ length: 12 }, (_, index) => index + 1), 40, 41],
  );
  const read = await database.run(releasedBriefings(target, { limit: 64 }));
  assert.deepEqual(
    read.map((briefing) => briefing.briefing),
    expected,
  );
  const { eve, handed } = fakeEve();
  const opener = seams({ eve, roster: hostedRosterFrom(roster([observation("s-1")]), NOW) });
  const outcome = await openHoldReleaseTurns(opener, userId);
  assert.deepEqual(outcome, { observation: 0, holdRelease: 1, failed: 0 });
  // The read bound (64) is reported when met; thirteen rows sit well inside it, so a full page here would be a different failure and says so.
  assert.deepEqual(opener.reports, []);
  const listed = heldBriefingsOf(
    handed[0]?.message ?? { conversationId: "", turn: BRAIN_HOST_TURN.HOLD_RELEASE, message: "" },
  );
  assert.deepEqual(
    listed.map((briefing) => briefing.briefing),
    expected,
  );
  assert.deepEqual(await queuedRows(released.conversationId), []);
});
