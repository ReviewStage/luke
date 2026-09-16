import { Cause, Effect, Option, type Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { BrainWakeEvent, SessionIdentity } from "../../core.js";
import { wakeInputText } from "../../core.js";
import { OBSERVATION_TICK } from "../observation-bounds.js";
import {
  decodeObservedRoster,
  encodeObservedRoster,
  type ObservedRoster,
} from "../observed-roster.js";
import {
  type RosterDiff,
  rosterCarrying,
  rosterComparable,
  rosterDiff,
  rosterDiffIsEmpty,
} from "../roster-diff.js";
import type { ConversationTarget, HostedStore } from "../store/index.js";
import { CONSUMED_ROSTER, type RosterSnapshotRecord } from "../store/roster-snapshot.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import type { EveSessions } from "./eve-sessions.js";
import { handToEve, SESSION_OPENING } from "./handover.js";
import type { HostedRoster } from "./roster.js";
import { type HostedTranscriptReads, keepTranscriptCursor } from "./transcript.js";
import { type DatedRosterDiff, identityKey, wakeEventsFromDiffs } from "./wake-events.js";

/**
 * The opener: what turns the roster diffs the scheduled pass wrote down into
 * turns of the hosted brain. Once per account per tick, after that account's
 * own pass, it reads the diffs still pending, groups every change they name
 * by the session it happened to, and hands eve one message per observed
 * conversation carrying all of that session's news together — the same
 * `[observed events]` item the desktop's brain opens its observation turns
 * with, each live chat's transcript delta read from its cursor and riding on
 * the session's first wake. The conversation is a row of kind `observed`,
 * opened on the first diff that names its session; the turn itself is eve's,
 * recorded under eve's own identity by the relay as eve starts it, with the
 * received message as the observation message and `transcript_change` as its
 * origin. No queued `turns` row is written here: under eve a queued delivery
 * is the queue, and a row minted ahead of eve's turn could only ever fail to
 * be the turn eve folds it into.
 *
 * The bookmarks and the diffs move together, and only behind eve's word.
 * Every message of the pass is handed to eve first; then, in one
 * transaction, each transcript cursor the pass read past is kept — over the
 * bookmark the read began from and no other, so a pass that ran long cannot
 * put a bookmark back behind one a later pass kept — and each diff the pass
 * carried is marked consumed. A send eve refuses ends the pass
 * before that transaction, so the diffs stay pending and the cursors stand
 * where they were, and the next tick opens the same news again — including,
 * for the messages eve did accept before the refusal, a second time, which
 * the model is told to read as data. Nothing is recorded that eve has not
 * accepted.
 *
 * The one change the opener refuses to derive is one across a stale gap.
 * The bookmark's instant is the snapshot it was last kept level with — a
 * visit that finds nothing to wake keeps it level all the same, so an idle
 * roster is never mistaken for a gap — and the snapshot's is the pass that
 * wrote it; a bookmark trailing the snapshot by more than
 * `OBSERVATION_TICK.STALE_GAP_MS` means no visit has caught the brain up for
 * that long — the cron paused, a deploy left a gap, the secret rotated, the
 * provider refused every pass, or eve refused every turn — and what changed
 * in between is history the roster already shows, not news. The
 * visit reseeds the bookmark from the snapshot as it stands, over the
 * bookmark's own instant, wakes nothing, and counts the reseed in its
 * outcome, so the tick's answer says it happened. The next change under the
 * reseeded bookmark wakes as usual. Nothing deterministic decides an
 * announcement here either: the gate decides what the brain is told, and
 * across a gap it is told nothing.
 *
 * The pass is per account by construction: it reads one account's diffs,
 * opens that account's conversations, and never a bounded page across
 * accounts, so no account's burst can stand in another's way. Within an
 * account it opens at most `TURNS_PER_ACCOUNT` conversations a tick, taking
 * whole diffs oldest first while their sessions fit and leaving the rest
 * pending for the next minute; the one diff that alone names more sessions
 * than the bound is cut to the bound, oldest change first, and the sessions
 * past it are not woken for that diff, since the snapshot is the truth the
 * diff was read from and their next change wakes them.
 */

const TURN_OPENER = {
  /** The most conversations one account is opened a turn for in one tick. */
  TURNS_PER_ACCOUNT: 8,
} as const;

/** What an opening answers: an effect over the ambient client, run by the tick's own edge. */
type OpenerEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

/**
 * A read whose answer is optional however it failed: the payload envelope
 * refuses a body it cannot open by throwing, which is a defect rather than a
 * typed failure, and a snapshot this build cannot open wakes nothing rather
 * than failing the account's whole opening.
 */
const optionally = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.option(Effect.catchDefect(effect, () => Effect.fail(undefined)));

/** The kinds of turn the opener sends, which is what its eve client is admitted for and nothing wider. */
export type ScheduledTurn = typeof BRAIN_HOST_TURN.OBSERVATION;

export interface TurnOpenerSeams {
  readonly store: Pick<HostedStore, "roster" | "directory">;
  readonly eve: EveSessions<ScheduledTurn>;
  /** The roster as the pass just left it, which the wakes describe sessions from. */
  readonly roster: HostedRoster;
  readonly transcripts: Pick<HostedTranscriptReads, "since">;
  readonly now: () => number;
  /** Where a refusal or a skipped session is said; the opener never throws into the tick. */
  readonly report: (message: string) => void;
}

interface TurnOpeningOptions {
  readonly limit?: number;
}

/** What one account's opening did, as the tick counts it. */
export interface TurnOpeningOutcome {
  /** Observation turns eve accepted, one per observed conversation. */
  readonly observation: number;
  /** Conversations the pass could not open a turn for: eve refused, or no conversation could stand for the session. */
  readonly failed: number;
  /** Bookmarks found trailing the snapshot past the stale gap and reseeded from it, waking nothing: one per account at most. */
  readonly reseeded: number;
}

export const NOTHING_OPENED: TurnOpeningOutcome = {
  observation: 0,
  failed: 0,
  reseeded: 0,
};

/** What the opener derived this visit: the snapshot it read, the bookmark it read against, and the change between them. */
interface DerivedChange {
  readonly snapshot: RosterSnapshotRecord;
  readonly current: ObservedRoster;
  readonly consumed: ObservedRoster;
  /** The bookmark's instant the read began from; absent where none stood yet. */
  readonly from: number | undefined;
  readonly diff: RosterDiff;
}

/** What a visit settled: the change it derived, if it derived one, and whether it reseeded the bookmark across a stale gap instead. */
interface Settled {
  readonly change?: DerivedChange;
  readonly reseeded: boolean;
}

const NOTHING_SETTLED: Settled = { reseeded: false };
const RESEEDED: Settled = { reseeded: true };

/** The outcome of a visit that woke nothing: nothing opened, and the reseed counted where the visit made one. */
function nothingWoken(settled: Settled): TurnOpeningOutcome {
  return { ...NOTHING_OPENED, reseeded: settled.reseeded ? 1 : 0 };
}

/**
 * The one function that reads the snapshot and the bookmark, settles every
 * bookkeeping the bookmark owes — a first adoption, the replacement of one
 * this build cannot read, a reseed across a stale gap, a key change
 * absorbed — and only then derives the change. The wakes take its result as
 * their argument and cannot run without it, so no bound, emptiness, or
 * refusal placed in front of the wakes can skip the bookkeeping: state
 * advances unconditionally and output is what is bounded. The account's
 * change is the snapshot the pass just wrote, diffed against the consumed
 * roster. There is no queue of diffs to drain; a visit that could not hand
 * its change over leaves the bookmark where it was, and the next visit
 * derives the same change again, wider by whatever moved since, which is the
 * coalescing wanted anyway, until the two stand a stale gap apart. A first
 * visit finds no bookmark and adopts the snapshot as it stands, waking
 * nothing, exactly as the first pass records no change against nothing.
 */
const settledChange = /* @__PURE__ */ Effect.fn("settledChange")(function* (
  seams: TurnOpenerSeams,
  userId: string,
): Effect.fn.Return<Settled, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  // A snapshot this build cannot open is the pass's to replace on its next whole read; until then
  // the visit wakes nothing from it and says so, rather than failing the account's whole opening.
  const read = yield* optionally(seams.store.roster.read(userId));
  if (Option.isNone(read)) {
    seams.report(
      `The roster snapshot of account ${userId} cannot be opened; nothing is woken from it.`,
    );
    return NOTHING_SETTLED;
  }
  const snapshot: RosterSnapshotRecord | undefined = read.value;
  if (snapshot === undefined) return NOTHING_SETTLED;
  const current = decodeObservedRoster(snapshot.body);
  if (current === undefined) {
    seams.report(
      `The roster snapshot of account ${userId} cannot be read; nothing is woken from it.`,
    );
    return NOTHING_SETTLED;
  }
  const bookmark = yield* seams.store.roster.consumed(userId);
  if (bookmark.state === CONSUMED_ROSTER.ABSENT) {
    yield* seams.store.roster.keepConsumed(userId, snapshot, undefined);
    return NOTHING_SETTLED;
  }
  // A bookmark this build cannot open or read is replaced by the snapshot as it stands, over the
  // bookmark's own instant: kept where none stands it would lose to the row it meant to replace,
  // and every later visit would adopt in silence.
  const replace = (from: number): OpenerEffect<Settled> =>
    Effect.gen(function* () {
      seams.report(
        `The roster bookmark of account ${userId} could not be read; it is replaced by the snapshot as it stands, and nothing is woken from it.`,
      );
      yield* seams.store.roster.keepConsumed(userId, snapshot, from);
      return NOTHING_SETTLED;
    });
  if (bookmark.state === CONSUMED_ROSTER.UNREADABLE) return yield* replace(bookmark.observedAt);
  const heard = decodeObservedRoster(bookmark.roster.body);
  if (heard === undefined) return yield* replace(bookmark.roster.observedAt);
  // A bookmark trailing the snapshot past the stale gap has not been caught up for that long — an
  // empty visit keeps it level below, so this is never an idle roster — and what changed in between
  // is history the roster shows rather than news: the bookmark is reseeded from the snapshot as it
  // stands, over its own instant, and nothing is woken from the gap. The gap is the two rows' own
  // instants apart, never the clock's reading.
  const gap = snapshot.observedAt - bookmark.roster.observedAt;
  if (gap > OBSERVATION_TICK.STALE_GAP_MS) {
    seams.report(
      `The roster bookmark of account ${userId} trails the snapshot by ${gap} ms, past the stale gap; it is reseeded from the snapshot as it stands, and nothing is woken from the gap.`,
    );
    yield* seams.store.roster.keepConsumed(userId, snapshot, bookmark.roster.observedAt);
    return RESEEDED;
  }
  // A provider whose key was replaced, added, or removed since the bookmark is another account's
  // roster to compare against; it is taken from the snapshot as it stands, as the pass refuses the
  // same comparison, so a key change wakes nothing and the bookmark settles on the new key at once.
  const consumed = rosterComparable(heard, current);
  const change: DerivedChange = {
    snapshot,
    current,
    consumed,
    from: bookmark.roster.observedAt,
    diff: rosterDiff(consumed, current),
  };
  // Nothing to wake, and the bookmark is kept level with the snapshot all the same, over its own
  // instant: its instant is what the stale gap reads as when the brain was last caught up, so an
  // idle roster must move it as a woken change does, and a provider taken from the snapshot on a
  // key change must reach it or the same adoption is made on every visit. A visit whose pass left
  // the snapshot standing, and whose bookmark already holds it, writes nothing.
  if (
    rosterDiffIsEmpty(change.diff) &&
    (snapshot.observedAt !== change.from ||
      encodeObservedRoster(consumed) !== encodeObservedRoster(heard))
  ) {
    yield* seams.store.roster.keepConsumed(userId, snapshot, change.from);
  }
  return { change, reseeded: false };
});

interface Opening {
  readonly identity: SessionIdentity;
  readonly events: BrainWakeEvent[];
}

interface Plan {
  readonly openings: readonly Opening[];
  /** Sessions the change named past the bound, left at their earlier state in the bookmark so the next visit derives them again. */
  readonly heldBack: readonly SessionIdentity[];
}

/** One opening per session the change names, oldest change first; the sessions past the bound are held back by identity. */
function plan(change: DatedRosterDiff, roster: HostedRoster, limit: number): Plan {
  const openings = new Map<string, Opening>();
  const heldBack = new Map<string, SessionIdentity>();
  for (const wake of wakeEventsFromDiffs([change], roster)) {
    const key = identityKey(wake.identity);
    const held = openings.get(key);
    if (held) {
      held.events.push(wake);
    } else if (openings.size < limit) {
      openings.set(key, { identity: wake.identity, events: [wake] });
    } else {
      heldBack.set(key, wake.identity);
    }
  }
  return { openings: [...openings.values()], heldBack: [...heldBack.values()] };
}

/** One session's transcript since the cursor kept for it, riding on its first wake; a read that throws is a read not made, and the cursor stands for the next. */
const withTranscript = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: TurnOpenerSeams,
  opening: Opening,
): Effect.fn.Return<{ events: readonly BrainWakeEvent[]; cursor?: string; from?: string }> {
  // A defect as well as a failure: a read that dies — a provider plugin
  // that throws where its effect declares no error — was a read not made
  // when it was a rejected promise, and stays one now. Neither catch
  // reaches an interruption, so a cancelled tick still ends the tick.
  const read = yield* Effect.asSome(seams.transcripts.since(opening.identity)).pipe(
    Effect.catchDefect(Effect.fail),
    Effect.catch((failure) => {
      seams.report(
        `The transcript of ${opening.identity.providerSessionId} could not be read: ${String(failure)}.`,
      );
      return Effect.succeedNone;
    }),
  );
  if (Option.isNone(read)) return { events: opening.events };
  const reading = read.value;
  if (reading === undefined) return { events: opening.events };
  const [first, ...rest] = opening.events;
  if (first === undefined) return { events: opening.events };
  return {
    events: [{ ...first, transcriptDelta: reading.delta }, ...rest],
    ...(reading.cursor !== undefined ? { cursor: reading.cursor } : undefined),
    ...(reading.from !== undefined ? { from: reading.from } : undefined),
  };
});

/**
 * Whether eve took the message. A handover that fails for any reason is one
 * refused send, said and counted: eve unreachable is the reason it was
 * written for, and the read of the conversation's own session is the other,
 * since a store failure there is this account's alone and must not end a
 * visit that has already handed turns over.
 */
function offered(
  seams: TurnOpenerSeams,
  target: ConversationTarget,
  turn: ScheduledTurn,
  words: string,
): OpenerEffect<boolean> {
  // Without the row lock: the visit is the one thing opening this account's observed sessions.
  return Effect.catchCause(
    handToEve(seams, target, turn, words, SESSION_OPENING.UNLOCKED),
    (cause) => {
      // A cancelled tick is not a refused send; it is the tick ending.
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      seams.report(
        `A ${turn} turn for conversation ${target.conversationId} could not be handed over: ${String(Cause.squash(cause))}.`,
      );
      return Effect.succeed(false);
    },
  );
}

/** Opens the account's observation turns for the diffs pending now, as the module comment describes. */
export const openObservationTurns = /* @__PURE__ */ Effect.fn("openObservationTurns")(function* (
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): Effect.fn.Return<TurnOpeningOutcome, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const settled = yield* settledChange(seams, userId);
  if (settled.change === undefined) return nothingWoken(settled);
  return yield* wakeFrom(
    seams,
    userId,
    settled.change,
    options.limit ?? TURN_OPENER.TURNS_PER_ACCOUNT,
  );
});

/** The wakes a settled change owes, under the bound; the change is required, so nothing here runs before the bookmark's own bookkeeping did. */
function wakeFrom(
  seams: TurnOpenerSeams,
  userId: string,
  change: DerivedChange,
  limit: number,
): OpenerEffect<TurnOpeningOutcome> {
  return Effect.gen(function* () {
    if (rosterDiffIsEmpty(change.diff) || limit <= 0) return NOTHING_OPENED;
    const planned = plan(
      { diff: change.diff, observedAt: change.snapshot.observedAt },
      seams.roster,
      limit,
    );
    if (planned.heldBack.length > 0) {
      seams.report(
        `The roster of account ${userId} changed for ${planned.heldBack.length} more sessions than the opener wakes in one tick; the next tick derives them again.`,
      );
    }
    // The bookmark follows the snapshot for everything but the sessions held back: a change that woke
    // nothing (a workspace coming or going, a session's fields no wake is derived from) settles on this
    // visit rather than deriving again on every one.
    const heldBack = new Set(planned.heldBack.map(identityKey));
    const cursors: { identity: SessionIdentity; cursor: string; from: string | undefined }[] = [];
    let observation = 0;
    let failed = 0;
    for (const opening of planned.openings) {
      const conversationId = yield* seams.store.directory.observed(
        userId,
        opening.identity,
        seams.now(),
      );
      if (conversationId === undefined) {
        seams.report(
          `No observed conversation can stand for ${opening.identity.providerSessionId}; its news is dropped.`,
        );
        failed += 1;
        continue;
      }
      const target: ConversationTarget = { userId, conversationId };
      const read = yield* withTranscript(seams, opening);
      const words = wakeInputText(read.events, seams.now());
      if (!(yield* offered(seams, target, BRAIN_HOST_TURN.OBSERVATION, words))) {
        return { observation, failed: failed + 1, reseeded: 0 };
      }
      if (read.cursor !== undefined) {
        cursors.push({ identity: opening.identity, cursor: read.cursor, from: read.from });
      }
      observation += 1;
    }
    const bookmark: RosterSnapshotRecord = {
      body: encodeObservedRoster(
        rosterCarrying(
          change.consumed,
          change.current,
          (providerId, providerSessionId) =>
            !heldBack.has(identityKey({ providerId, providerSessionId })),
        ),
      ),
      observedAt: change.snapshot.observedAt,
    };
    const now = new Date(seams.now());
    yield* Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql.withTransaction(
        Effect.all(
          [
            ...cursors.map(({ identity, cursor, from }) =>
              keepTranscriptCursor(userId, identity, cursor, from, now),
            ),
            seams.store.roster.keepConsumed(userId, bookmark, change.from),
          ],
          { discard: true },
        ),
      ),
    );
    return { observation, failed, reseeded: 0 };
  });
}

/** One account's opening whole: the bookmark settled, then the observations under the bound. */
export const openAccountTurns = /* @__PURE__ */ Effect.fn("openAccountTurns")(function* (
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): Effect.fn.Return<TurnOpeningOutcome, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const limit = options.limit ?? TURN_OPENER.TURNS_PER_ACCOUNT;
  // The bookmark is settled before anything is woken, so eve refusing a wake cannot leave a first
  // bookmark unplaced for a visit.
  const settled = yield* settledChange(seams, userId);
  if (settled.change === undefined) return nothingWoken(settled);
  return yield* wakeFrom(seams, userId, settled.change, limit);
});
