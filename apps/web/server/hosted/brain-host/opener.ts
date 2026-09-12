import { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Cause, Effect, Either, Option, type ParseResult } from "effect";
import type { BrainWakeEvent, SessionIdentity } from "../../core.js";
import { holdReleasedInputText, TURN_ORIGIN, wakeInputText } from "../../core.js";
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
import type { ConversationTarget, HostedStore, StoreWriter } from "../store/index.js";
import { type QueuedTurnRecord, queuedTurns } from "../store/message-reads.js";
import { CONSUMED_ROSTER, type RosterSnapshotRecord } from "../store/roster-snapshot.js";
import { releasedBriefings } from "../store/speech.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import { EVE_SEND_OUTCOME, type EveSessions } from "./eve-sessions.js";
import { recordedRuntimeSession } from "./recorded-session.js";
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
 * received message as the observation message and `roster_diff` as its
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
 * The other thing the opener drains is the queued `turns` rows the speech
 * sweep writes when a hold lifts: one per conversation per release, saying
 * the briefings a meeting or a pause held back deserve a fresh decision
 * against the roster as it now is. A queued row is the opener's inbox and
 * never the run's record. The opener hands eve one `hold_release` message
 * per conversation, listing every briefing released and named in no
 * hold-release message of the conversation yet — the record's own contents
 * as the boundary, since the message the relay writes for each re-decision
 * names what it carried — and once eve has taken it removes the rows through
 * the writer, so the turn eve runs is recorded by the relay under eve's
 * identity with `hold_release` as its origin, the one row of the record that
 * says why Luke spoke, and the inbox is empty. A row eve refuses stands for
 * the next tick like a pending diff does. Nothing here keeps time: a
 * hold-release message the relay has not written yet can only make the next
 * drain list a release again, never lose one, and a turn eve took and never
 * ran leaves its releases uncarried for the next release's drain to carry.
 *
 * The pass is per account by construction: it reads one account's diffs
 * and one account's queued rows, opens that account's conversations, and
 * never a bounded page across accounts, so no account's burst can stand in
 * another's way. Within an account it opens at most `TURNS_PER_ACCOUNT`
 * conversations a tick, the hold releases first since they are the older
 * news, then the observations under what remains of the bound, taking
 * whole diffs oldest first while their sessions fit and leaving the rest
 * pending for the next minute; the one diff that alone names more sessions
 * than the bound is cut to the bound, oldest change first, and the sessions
 * past it are not woken for that diff, since the snapshot is the truth the
 * diff was read from and their next change wakes them.
 */

const TURN_OPENER = {
  /** The most conversations one account is opened a turn for in one tick, hold releases and observations together. */
  TURNS_PER_ACCOUNT: 8,
  /** The most queued rows one account's inbox is read for in one tick; the rest wait, since their conversations would exceed the bound anyway. */
  QUEUED_ROWS_READ: 50,
  /**
   * The most released briefings one hold-release turn is read for. Every
   * release not yet carried is handed over in the one message, since a
   * release left behind would wait for another hold's release to be carried
   * and a re-decision owed now should not wait on one; the bound is a read
   * bound against a runaway, said when met, and far past the briefings one
   * hold could release.
   */
  RELEASED_BRIEFINGS_READ: 64,
} as const;

/** What an opening answers: an effect over the ambient client, run by the tick's own edge. */
type OpenerEffect<A> = Effect.Effect<A, SqlError | ParseResult.ParseError, SqlClient.SqlClient>;

/**
 * A read whose answer is optional however it failed: the payload envelope
 * refuses a body it cannot open by throwing, which is a defect rather than a
 * typed failure, and a snapshot this build cannot open wakes nothing rather
 * than failing the account's whole opening.
 */
const optionally = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.option(Effect.catchAllDefect(effect, () => Effect.fail(undefined)));

/** The kinds of turn the opener sends, which is what its eve client is admitted for and nothing wider. */
export type ScheduledTurn =
  | typeof BRAIN_HOST_TURN.OBSERVATION
  | typeof BRAIN_HOST_TURN.HOLD_RELEASE;

export interface TurnOpenerSeams {
  readonly store: Pick<HostedStore, "roster" | "directory">;
  /** The writer, for the one write the drain makes: removing a queued row eve has taken. */
  readonly writer: Pick<StoreWriter, "dequeueTurn">;
  readonly eve: EveSessions<ScheduledTurn>;
  /** The roster as the pass just left it, which the wakes describe sessions from. */
  readonly roster: HostedRoster;
  readonly transcripts: Pick<HostedTranscriptReads, "since">;
  readonly now: () => number;
  /** Where a refusal or a skipped session is said; the opener never throws into the tick. */
  readonly report: (message: string) => void;
}

export interface TurnOpeningOptions {
  readonly limit?: number;
}

/** What one account's opening did, as the tick counts it. */
export interface TurnOpeningOutcome {
  /** Observation turns eve accepted, one per observed conversation. */
  readonly observation: number;
  /** Hold-release turns eve accepted, one per conversation with rows queued. */
  readonly holdRelease: number;
  /** Conversations the pass could not open a turn for: eve refused, or no conversation could stand for the session. */
  readonly failed: number;
}

export const NOTHING_OPENED: TurnOpeningOutcome = { observation: 0, holdRelease: 0, failed: 0 };

function summed(left: TurnOpeningOutcome, right: TurnOpeningOutcome): TurnOpeningOutcome {
  return {
    observation: left.observation + right.observation,
    holdRelease: left.holdRelease + right.holdRelease,
    failed: left.failed + right.failed,
  };
}

/** What the opener derived this visit: the snapshot it read, the bookmark it read against, and the change between them. */
interface DerivedChange {
  readonly snapshot: RosterSnapshotRecord;
  readonly current: ObservedRoster;
  readonly consumed: ObservedRoster;
  /** The bookmark's instant the read began from; absent where none stood yet. */
  readonly from: number | undefined;
  readonly diff: RosterDiff;
}

/**
 * The one function that reads the snapshot and the bookmark, settles every
 * bookkeeping the bookmark owes — a first adoption, the replacement of one
 * this build cannot read, a key change absorbed — and only then derives the
 * change. The wakes take its result as their argument and cannot run without
 * it, so no bound, emptiness, or refusal placed in front of the wakes can
 * skip the bookkeeping: state advances unconditionally and output is what
 * is bounded. The account's change is the snapshot the pass
 * just wrote, diffed against the consumed roster. There is no queue of diffs
 * to drain; a visit that could not hand its change over leaves the bookmark
 * where it was, and the next visit derives the same change again, wider by
 * whatever moved since, which is the coalescing wanted anyway. A first visit
 * finds no bookmark and adopts the snapshot as it stands, waking nothing,
 * exactly as the first pass records no change against nothing.
 */
function settledChange(
  seams: TurnOpenerSeams,
  userId: string,
): OpenerEffect<DerivedChange | undefined> {
  return Effect.gen(function* () {
    // A snapshot this build cannot open is the pass's to replace on its next whole read; until then
    // the visit wakes nothing from it and says so, rather than failing the account's whole opening.
    const read = yield* optionally(seams.store.roster.read(userId));
    if (Option.isNone(read)) {
      seams.report(
        `The roster snapshot of account ${userId} cannot be opened; nothing is woken from it.`,
      );
      return undefined;
    }
    const snapshot: RosterSnapshotRecord | undefined = read.value;
    if (snapshot === undefined) return undefined;
    const current = decodeObservedRoster(snapshot.body);
    if (current === undefined) {
      seams.report(
        `The roster snapshot of account ${userId} cannot be read; nothing is woken from it.`,
      );
      return undefined;
    }
    const bookmark = yield* seams.store.roster.consumed(userId);
    if (bookmark.state === CONSUMED_ROSTER.ABSENT) {
      yield* seams.store.roster.keepConsumed(userId, snapshot, undefined);
      return undefined;
    }
    // A bookmark this build cannot open or read is replaced by the snapshot as it stands, over the
    // bookmark's own instant: kept where none stands it would lose to the row it meant to replace,
    // and every later visit would adopt in silence.
    const replace = (from: number): OpenerEffect<undefined> =>
      Effect.gen(function* () {
        seams.report(
          `The roster bookmark of account ${userId} could not be read; it is replaced by the snapshot as it stands, and nothing is woken from it.`,
        );
        yield* seams.store.roster.keepConsumed(userId, snapshot, from);
        return undefined;
      });
    if (bookmark.state === CONSUMED_ROSTER.UNREADABLE) return yield* replace(bookmark.observedAt);
    const heard = decodeObservedRoster(bookmark.roster.body);
    if (heard === undefined) return yield* replace(bookmark.roster.observedAt);
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
    // Nothing to wake, but a provider taken from the snapshot still has to reach the bookmark, or the
    // same adoption is made on every visit and the bookmark never settles on the new key.
    if (
      rosterDiffIsEmpty(change.diff) &&
      encodeObservedRoster(consumed) !== encodeObservedRoster(heard)
    ) {
      yield* seams.store.roster.keepConsumed(userId, snapshot, change.from);
    }
    return change;
  });
}

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

/** Whether eve took the message: sent to the session the conversation runs in, or opened in a new one where none runs. */
function handToEve(
  seams: TurnOpenerSeams,
  target: ConversationTarget,
  turn: ScheduledTurn,
  words: string,
): OpenerEffect<boolean> {
  return Effect.gen(function* () {
    const message = { conversationId: target.conversationId, turn, message: words };
    const recorded = yield* recordedRuntimeSession(target);
    if (recorded !== undefined) {
      const sent = yield* Effect.promise(() => seams.eve.send(recorded, message));
      if (sent.outcome === EVE_SEND_OUTCOME.ACCEPTED) return true;
      if (sent.outcome === EVE_SEND_OUTCOME.FAILED) {
        seams.report(
          `eve refused a ${turn} turn on conversation ${target.conversationId} with status ${sent.status}.`,
        );
        return false;
      }
    }
    const opened = yield* Effect.promise(() => seams.eve.open(message));
    if (opened.outcome === EVE_SEND_OUTCOME.ACCEPTED) return true;
    seams.report(
      `eve refused to open a session for conversation ${target.conversationId} with status ${opened.status}.`,
    );
    return false;
  });
}

/** One session's transcript since the cursor kept for it, riding on its first wake; a read that throws is a read not made, and the cursor stands for the next. */
function withTranscript(
  seams: TurnOpenerSeams,
  opening: Opening,
): Effect.Effect<{ events: readonly BrainWakeEvent[]; cursor?: string; from?: string }> {
  return Effect.gen(function* () {
    const read = yield* Effect.either(
      Effect.tryPromise(() => seams.transcripts.since(opening.identity)),
    );
    if (Either.isLeft(read)) {
      seams.report(
        `The transcript of ${opening.identity.providerSessionId} could not be read: ${String(read.left.error)}.`,
      );
      return { events: opening.events };
    }
    const reading = read.right;
    if (reading === undefined) return { events: opening.events };
    const [first, ...rest] = opening.events;
    if (first === undefined) return { events: opening.events };
    return {
      events: [{ ...first, transcriptDelta: reading.delta }, ...rest],
      ...(reading.cursor !== undefined ? { cursor: reading.cursor } : undefined),
      ...(reading.from !== undefined ? { from: reading.from } : undefined),
    };
  });
}

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
  return Effect.catchAllCause(handToEve(seams, target, turn, words), (cause) => {
    // A cancelled tick is not a refused send; it is the tick ending.
    if (Cause.isInterruptedOnly(cause)) return Effect.failCause(cause);
    seams.report(
      `A ${turn} turn for conversation ${target.conversationId} could not be handed over: ${String(Cause.squash(cause))}.`,
    );
    return Effect.succeed(false);
  });
}

/** Opens the account's observation turns for the diffs pending now, as the module comment describes. */
export function openObservationTurns(
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): OpenerEffect<TurnOpeningOutcome> {
  return Effect.gen(function* () {
    const change = yield* settledChange(seams, userId);
    if (change === undefined) return NOTHING_OPENED;
    return yield* wakeFrom(seams, userId, change, options.limit ?? TURN_OPENER.TURNS_PER_ACCOUNT);
  });
}

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
        return { observation, holdRelease: 0, failed: failed + 1 };
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
    return { observation, holdRelease: 0, failed };
  });
}

/**
 * Opens the account's hold-release turns for the queued rows standing now:
 * one message per conversation carrying the briefings released since a
 * little before its oldest row was queued, the rows removed once eve has
 * the message. A conversation whose rows name no released briefing — an
 * earlier turn already carried them — has nothing left to decide, and its
 * rows go without a turn, said rather than sent as an empty ask.
 */
export function openHoldReleaseTurns(
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): OpenerEffect<TurnOpeningOutcome> {
  return Effect.gen(function* () {
    const limit = options.limit ?? TURN_OPENER.TURNS_PER_ACCOUNT;
    if (limit <= 0) return NOTHING_OPENED;
    const rows = yield* queuedTurns(userId, TURN_ORIGIN.HOLD_RELEASE, TURN_OPENER.QUEUED_ROWS_READ);
    const byConversation = new Map<string, QueuedTurnRecord[]>();
    for (const row of rows) {
      const held = byConversation.get(row.conversationId);
      if (held) held.push(row);
      else if (byConversation.size < limit) byConversation.set(row.conversationId, [row]);
    }
    let holdRelease = 0;
    for (const [conversationId, queued] of byConversation) {
      const target: ConversationTarget = { userId, conversationId };
      const briefings = yield* releasedBriefings(target, {
        limit: TURN_OPENER.RELEASED_BRIEFINGS_READ,
      });
      if (briefings.length >= TURN_OPENER.RELEASED_BRIEFINGS_READ) {
        seams.report(
          `Conversation ${conversationId} has at least ${TURN_OPENER.RELEASED_BRIEFINGS_READ} briefings released since its last re-decision; only that many are handed over.`,
        );
      }
      if (briefings.length > 0) {
        const words = holdReleasedInputText(
          briefings.map((briefing) => ({
            briefing: briefing.briefing,
            decidedAt: briefing.decidedAt,
          })),
          seams.now(),
        );
        if (!(yield* offered(seams, target, BRAIN_HOST_TURN.HOLD_RELEASE, words))) {
          return { observation: 0, holdRelease, failed: 1 };
        }
        holdRelease += 1;
      } else {
        seams.report(
          `Conversation ${conversationId} queued a hold release with no released briefing left to decide; its rows go without a turn.`,
        );
      }
      for (const row of queued) {
        const removed = yield* seams.writer.dequeueTurn(target, row.id);
        if (!removed.ok) {
          seams.report(`The queued turn ${row.id} could not be removed: ${removed.refusal}.`);
        }
      }
    }
    return { observation: 0, holdRelease, failed: 0 };
  });
}

/** One account's opening whole: the hold releases first, then the observations under what remains of the bound. */
export function openAccountTurns(
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): OpenerEffect<TurnOpeningOutcome> {
  return Effect.gen(function* () {
    const limit = options.limit ?? TURN_OPENER.TURNS_PER_ACCOUNT;
    // The bookmark is settled before anything is woken, so neither the hold releases filling the bound
    // nor eve refusing one can leave a first bookmark unplaced for a visit.
    const change = yield* settledChange(seams, userId);
    const released = yield* openHoldReleaseTurns(seams, userId, { limit });
    // A refused hold release ends the visit's wakes, since eve is refusing.
    if (released.failed > 0 || change === undefined) return released;
    const observed = yield* wakeFrom(
      seams,
      userId,
      change,
      Math.max(0, limit - released.holdRelease),
    );
    return summed(released, observed);
  });
}
