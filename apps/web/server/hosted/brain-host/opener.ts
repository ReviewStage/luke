import type { Schema } from "effect";
import { Cause, Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  ACTION_RESULT_STATUS,
  type CloudAgentProviderId,
  holdReleasedInputText,
  isCloudAgentProviderId,
  type ObservedMessagesEnvelope,
  observedMessagesText,
  PROVIDER_IDENTITY_BY_ID,
  type SessionIdentity,
  TURN_ORIGIN,
} from "../../core.js";
import type { ConversationTarget, HostedStore, StoreWriter } from "../store/index.js";
import { type QueuedTurnRecord, queuedTurns } from "../store/message-reads.js";
import { releasedBriefings } from "../store/speech.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import type { EveSessions } from "./eve-sessions.js";
import { handToEve } from "./handover.js";
import { type HostedRoster, observedSession } from "./roster.js";
import {
  type HostedTranscriptReads,
  keepTranscriptCursor,
  type TranscriptDeltaReading,
} from "./transcript.js";

/**
 * The opener: what turns a chat gaining messages into a turn of the hosted
 * brain. Once per account per tick, after that account's own pass, it asks
 * each cloud provider in the roster which of the roster's chats gained
 * transcript since the account's mark — the provider's own documented
 * last-changed instant per chat, read with no message bodies — takes the
 * oldest changes under the bound, reads what each chat gained since the
 * cursor kept for it, and hands eve one `[observed messages]` item per
 * changed chat: an envelope naming the chat, then the messages it gained,
 * one line each under the speaker's name, the way a room receives them. A
 * delta with no attributed message — tool calls, thinking — opens no turn
 * and moves its cursor all the same. The roster snapshot is never diffed:
 * it names the chats a provider is asked about and describes them in the
 * envelope, and that is all. The conversation is a row of kind `observed`,
 * opened on the first change that names its chat; the turn itself is eve's,
 * recorded under eve's own identity by the relay as eve starts it, with the
 * received message as the observation message and `transcript_change` as
 * its origin. No queued `turns` row is written here: under eve a queued
 * delivery is the queue, and a row minted ahead of eve's turn could only
 * ever fail to be the turn eve folds it into.
 *
 * The mark and the cursors move together, and only behind eve's word.
 * Every message of the visit is handed to eve first; then, in one
 * transaction, each transcript cursor the visit read past is kept — over
 * the bookmark the read began from and no other, so a visit that ran long
 * cannot put a cursor back behind one a later visit kept — and the mark is
 * moved to the last instant taken, over the mark the visit read. A send eve
 * refuses, or a transcript the provider would not answer, ends the visit
 * before that transaction, so the mark and the cursors stand where they
 * were and the next tick reads the same changes again — including, for the
 * messages eve did accept before the refusal, a second time, which the model
 * is told to read as data. Nothing is recorded that eve has not accepted.
 * A first visit finds no mark, adopts the newest instant the providers
 * answer, and wakes nothing: what stood before Luke was watching is history
 * the roster already shows, not news.
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
 * the next tick like an unread change does. Nothing here keeps time: a
 * hold-release message the relay has not written yet can only make the next
 * drain list a release again, never lose one, and a turn eve took and never
 * ran leaves its releases uncarried for the next release's drain to carry.
 *
 * The visit is per account by construction: it reads one account's changes
 * and one account's queued rows, opens that account's conversations, and
 * never a bounded page across accounts, so no account's burst can stand in
 * another's way. Within an account it opens at most `TURNS_PER_ACCOUNT`
 * conversations a tick, the hold releases first since they are the older
 * news, then the changed chats under what remains of the bound, oldest
 * change first; the chats past the bound are held back, and the mark stops
 * strictly before the first held-back instant so a tie is never jumped, and
 * the next minute reads them again. The bound counts turns opened, not
 * chats read: a change whose words an earlier visit already read — a chat
 * taken at a tied instant the mark could not pass — costs a read and no
 * turn, so the chats behind it are reached the next minute rather than held
 * back behind it forever; the reads themselves stop at `CHANGED_CHATS_READ`.
 */

const TURN_OPENER = {
  /** The most conversations one account is opened a turn for in one tick, hold releases and observations together. */
  TURNS_PER_ACCOUNT: 8,
  /** The most changed chats one account's visit reads in one tick, turns or not, so a burst of changes already read stays under the deadline. */
  CHANGED_CHATS_READ: 32,
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
type OpenerEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

/** The kinds of turn the opener sends, which is what its eve client is admitted for and nothing wider. */
export type ScheduledTurn =
  | typeof BRAIN_HOST_TURN.OBSERVATION
  | typeof BRAIN_HOST_TURN.HOLD_RELEASE;

export interface TurnOpenerSeams {
  readonly store: Pick<HostedStore, "roster" | "directory">;
  /** The writer, for the one write the drain makes: removing a queued row eve has taken. */
  readonly writer: Pick<StoreWriter, "dequeueTurn">;
  readonly eve: EveSessions<ScheduledTurn>;
  /** The roster as the pass just left it: the chats each provider is asked about, and what the envelope says of them. */
  readonly roster: HostedRoster;
  readonly transcripts: Pick<HostedTranscriptReads, "since" | "changedSince">;
  readonly now: () => number;
  /** Where a refusal or a skipped session is said; the opener never throws into the tick. */
  readonly report: (message: string) => void;
}

interface TurnOpeningOptions {
  readonly limit?: number;
}

/** What one account's opening did, as the tick counts it. */
export interface TurnOpeningOutcome {
  /** Observation turns eve accepted, one per changed chat with words to carry. */
  readonly observation: number;
  /** Hold-release turns eve accepted, one per conversation with rows queued. */
  readonly holdRelease: number;
  /** Conversations the visit could not open a turn for: eve refused, a transcript could not be read, or no conversation could stand for the chat. */
  readonly failed: number;
}

export const NOTHING_OPENED: TurnOpeningOutcome = {
  observation: 0,
  holdRelease: 0,
  failed: 0,
};

function summed(left: TurnOpeningOutcome, right: TurnOpeningOutcome): TurnOpeningOutcome {
  return {
    observation: left.observation + right.observation,
    holdRelease: left.holdRelease + right.holdRelease,
    failed: left.failed + right.failed,
  };
}

/** One chat the providers say gained transcript, and the instant they say it last did. */
interface ChangedChat {
  readonly identity: SessionIdentity;
  readonly updatedAt: number;
}

/** Oldest first, and two at one instant in one fixed order, so the bound cuts the same way on every visit. */
function byInstantThenIdentity(left: ChangedChat, right: ChangedChat): number {
  return (
    left.updatedAt - right.updatedAt ||
    left.identity.providerId.localeCompare(right.identity.providerId) ||
    left.identity.providerSessionId.localeCompare(right.identity.providerSessionId)
  );
}

/**
 * Every chat the roster's cloud providers say changed since the mark, or
 * nothing where any one of them would not say. The mark is one instant for
 * the whole account, so a provider that refused cannot be left behind while
 * the mark moves past its instants on another's answer: the visit wakes
 * nothing and the mark stands, and the next tick asks again.
 */
const changedChats = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: TurnOpenerSeams,
  userId: string,
  since: number | undefined,
): Effect.fn.Return<readonly ChangedChat[] | undefined> {
  const rows: ChangedChat[] = [];
  for (const providerId of seams.roster.observations.keys()) {
    if (!isCloudAgentProviderId(providerId)) continue;
    const answer = yield* Effect.asSome(seams.transcripts.changedSince(providerId, since)).pipe(
      Effect.catchDefect(Effect.fail),
      Effect.catch((failure) => {
        seams.report(
          `The transcript changes of ${providerId} for account ${userId} could not be read: ${String(failure)}; nothing is woken this tick.`,
        );
        return Effect.succeedNone;
      }),
    );
    if (answer._tag === "None") return undefined;
    const read = answer.value;
    if (read.status !== ACTION_RESULT_STATUS.ACCEPTED) {
      seams.report(
        `${providerId} would not say which transcripts of account ${userId} changed: ${read.reason}; nothing is woken this tick.`,
      );
      return undefined;
    }
    for (const change of read.changes) {
      rows.push({
        identity: { providerId, providerSessionId: change.providerSessionId },
        updatedAt: change.updatedAt,
      });
    }
  }
  rows.sort(byInstantThenIdentity);
  return rows;
});

/**
 * Where the mark moves to for the chats taken: the last instant taken, or,
 * where chats were held back, the last taken instant strictly before the
 * first held-back one. The provider's comparison is `>`, so a mark placed
 * at a held-back chat's own instant would skip it; a tie between the last
 * taken and the first held back leaves the mark where the visit read it.
 */
function markAfter(
  taken: readonly ChangedChat[],
  heldBack: readonly ChangedChat[],
  from: number,
): number {
  const boundary = heldBack[0]?.updatedAt;
  const earlier =
    boundary === undefined ? taken : taken.filter((chat) => chat.updatedAt < boundary);
  return earlier.at(-1)?.updatedAt ?? from;
}

/** What the envelope says of the chat: the roster's own words for it, or its id alone where the roster no longer holds it. */
function envelopeOf(roster: HostedRoster, chat: ChangedChat): ObservedMessagesEnvelope {
  const session = observedSession(roster, chat.identity);
  const providerId: CloudAgentProviderId | string = chat.identity.providerId;
  const provider = isCloudAgentProviderId(providerId)
    ? PROVIDER_IDENTITY_BY_ID[providerId]
    : undefined;
  return {
    providerName: provider?.displayName ?? chat.identity.providerId,
    ...(session?.workspace?.name !== undefined ? { workspace: session.workspace.name } : undefined),
    ...(session?.title !== undefined ? { title: session.title } : undefined),
    providerSessionId: chat.identity.providerSessionId,
    updatedAt: chat.updatedAt,
  };
}

/** One chat's transcript since the cursor kept for it; a read that throws is a read not made, said and answered as nothing. */
const readDelta = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: TurnOpenerSeams,
  identity: SessionIdentity,
): Effect.fn.Return<{ reading: TranscriptDeltaReading | undefined } | undefined> {
  // A defect as well as a failure: a read that dies — a provider plugin
  // that throws where its effect declares no error — was a read not made
  // when it was a rejected promise, and stays one now. Neither catch
  // reaches an interruption, so a cancelled tick still ends the tick.
  const read = yield* Effect.asSome(seams.transcripts.since(identity)).pipe(
    Effect.catchDefect(Effect.fail),
    Effect.catch((failure) => {
      seams.report(
        `The transcript of ${identity.providerSessionId} could not be read: ${String(failure)}.`,
      );
      return Effect.succeedNone;
    }),
  );
  return read._tag === "None" ? undefined : { reading: read.value };
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
  return Effect.catchCause(handToEve(seams, target, turn, words), (cause) => {
    // A cancelled tick is not a refused send; it is the tick ending.
    if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
    seams.report(
      `A ${turn} turn for conversation ${target.conversationId} could not be handed over: ${String(Cause.squash(cause))}.`,
    );
    return Effect.succeed(false);
  });
}

/** Opens the account's observation turns for the chats changed since its mark, as the module comment describes. */
export const openObservationTurns = /* @__PURE__ */ Effect.fn("openObservationTurns")(function* (
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): Effect.fn.Return<TurnOpeningOutcome, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const limit = options.limit ?? TURN_OPENER.TURNS_PER_ACCOUNT;
  const from = yield* seams.store.roster.mark(userId);
  const rows = yield* changedChats(seams, userId, from);
  if (rows === undefined) return NOTHING_OPENED;
  // A first visit adopts the newest instant the providers answer and wakes nothing; it is made
  // whatever the bound left, so hold releases filling a tick cannot leave an account unmarked.
  if (from === undefined) {
    const newest = rows.at(-1);
    if (newest !== undefined) {
      yield* seams.store.roster.keepMark(userId, newest.updatedAt, undefined, seams.now());
    }
    return NOTHING_OPENED;
  }
  if (rows.length === 0 || limit <= 0) return NOTHING_OPENED;
  const cursors: { identity: SessionIdentity; cursor: string; from: string | undefined }[] = [];
  let observation = 0;
  let failed = 0;
  let visited = 0;
  // The bound is on turns, so a chat read to no turn does not hold the ones behind it back.
  for (const chat of rows) {
    if (observation >= limit || visited >= TURN_OPENER.CHANGED_CHATS_READ) break;
    visited += 1;
    const conversationId = yield* seams.store.directory.observed(
      userId,
      chat.identity,
      seams.now(),
    );
    if (conversationId === undefined) {
      seams.report(
        `No observed conversation can stand for ${chat.identity.providerSessionId}; its news is dropped.`,
      );
      failed += 1;
      continue;
    }
    // A transcript the provider would not answer ends the visit with nothing committed: the chat
    // is named by the change and the next tick reads it again, words and all.
    const read = yield* readDelta(seams, chat.identity);
    if (read === undefined) return { observation, holdRelease: 0, failed: failed + 1 };
    // A chat the roster no longer holds has nothing to read; the mark covers its change all the same.
    if (read.reading === undefined) continue;
    const { delta, cursor, from: cursorFrom } = read.reading;
    if (delta.status !== ACTION_RESULT_STATUS.ACCEPTED) {
      seams.report(
        `The transcript of ${chat.identity.providerSessionId} was not answered (${delta.status}); the visit ends and the next tick reads it again.`,
      );
      return { observation, holdRelease: 0, failed: failed + 1 };
    }
    if (cursor !== undefined) cursors.push({ identity: chat.identity, cursor, from: cursorFrom });
    // Nothing attributed gained — tool calls, thinking — is no message for the room, and no turn.
    if (delta.lines.length === 0) continue;
    const words = observedMessagesText(
      envelopeOf(seams.roster, chat),
      delta.lines,
      delta.truncated,
      seams.now(),
    );
    const target: ConversationTarget = { userId, conversationId };
    if (!(yield* offered(seams, target, BRAIN_HOST_TURN.OBSERVATION, words))) {
      return { observation, holdRelease: 0, failed: failed + 1 };
    }
    observation += 1;
  }
  const heldBack = rows.slice(visited);
  if (heldBack.length > 0) {
    seams.report(
      `The transcripts of account ${userId} changed for ${heldBack.length} more chats than the opener reads in one tick; the next tick reads them again.`,
    );
  }
  const next = markAfter(rows.slice(0, visited), heldBack, from);
  const now = new Date(seams.now());
  yield* Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.all(
        [
          ...cursors.map(({ identity, cursor, from: cursorFrom }) =>
            keepTranscriptCursor(userId, identity, cursor, cursorFrom, now),
          ),
          ...(next !== from ? [seams.store.roster.keepMark(userId, next, from, seams.now())] : []),
        ],
        { discard: true },
      ),
    ),
  );
  return { observation, holdRelease: 0, failed };
});

/**
 * Opens the account's hold-release turns for the queued rows standing now:
 * one message per conversation carrying the briefings released since a
 * little before its oldest row was queued, the rows removed once eve has
 * the message. A conversation whose rows name no released briefing — an
 * earlier turn already carried them — has nothing left to decide, and its
 * rows go without a turn, said rather than sent as an empty ask.
 */
export const openHoldReleaseTurns = /* @__PURE__ */ Effect.fn("openHoldReleaseTurns")(function* (
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): Effect.fn.Return<TurnOpeningOutcome, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
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

/** One account's opening whole: the hold releases first, then the changed chats under what remains of the bound. */
export const openAccountTurns = /* @__PURE__ */ Effect.fn("openAccountTurns")(function* (
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): Effect.fn.Return<TurnOpeningOutcome, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const limit = options.limit ?? TURN_OPENER.TURNS_PER_ACCOUNT;
  const released = yield* openHoldReleaseTurns(seams, userId, { limit });
  // A refused hold release ends the visit's wakes, since eve is refusing; the observation visit
  // still runs under no bound so a first mark is adopted, and it wakes nothing that way.
  const remaining = released.failed > 0 ? 0 : Math.max(0, limit - released.holdRelease);
  const observed = yield* openObservationTurns(seams, userId, { limit: remaining });
  return summed(released, observed);
});
