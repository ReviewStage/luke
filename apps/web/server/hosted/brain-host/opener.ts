import { catchAllButInterrupt } from "@sidecar/runtime/effect";
import type { Schema } from "effect";
import { Cause, Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  ACTION_RESULT_STATUS,
  type CloudAgentProviderId,
  isCloudAgentProviderId,
  type ObservedMessagesEnvelope,
  observedMessagesText,
  PROVIDER_IDENTITY_BY_ID,
  type SessionIdentity,
} from "../../core.js";
import type { ConversationTarget, HostedStore } from "../store/index.js";
import type { ObservedSessionNaming } from "../store/observed-conversations.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import type { EveSessions } from "./eve-sessions.js";
import { handToEve, SESSION_OPENING } from "./handover.js";
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
 * The visit is per account by construction: it reads one account's changes,
 * opens that account's conversations, and never a bounded page across
 * accounts, so no account's burst can stand in another's way. Within an
 * account it opens at most `TURNS_PER_ACCOUNT` conversations a tick, oldest
 * change first; the chats past the bound are held back, and the mark stops
 * strictly before the first held-back instant so a tie is never jumped, and
 * the next minute reads them again. The bound counts turns opened, not
 * chats read: a change whose words an earlier visit already read — a chat
 * taken at a tied instant the mark could not pass — costs a read and no
 * turn, so the chats behind it are reached the next minute rather than held
 * back behind it forever; the reads themselves stop at `CHANGED_CHATS_READ`.
 */

const TURN_OPENER = {
  /** The most conversations one account is opened a turn for in one tick. */
  TURNS_PER_ACCOUNT: 8,
  /** The most changed chats one account's visit reads in one tick, turns or not, so a burst of changes already read stays under the deadline. */
  CHANGED_CHATS_READ: 32,
} as const;

/** What an opening answers: an effect over the ambient client, run by the tick's own edge. */
type OpenerEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

/** The kinds of turn the opener sends, which is what its eve client is admitted for and nothing wider. */
export type ScheduledTurn = typeof BRAIN_HOST_TURN.OBSERVATION;

export interface TurnOpenerSeams {
  readonly store: Pick<HostedStore, "roster" | "directory">;
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
  /** Conversations the visit could not open a turn for: eve refused, a transcript could not be read, or no conversation could stand for the chat. */
  readonly failed: number;
}

export const NOTHING_OPENED: TurnOpeningOutcome = { observation: 0, failed: 0 };

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

/** What the roster calls the chat now, for its row to keep; nothing where the roster no longer holds it, whose row keeps what it had. */
function namingOf(roster: HostedRoster, chat: ChangedChat): ObservedSessionNaming | undefined {
  const session = observedSession(roster, chat.identity);
  if (session === undefined) return undefined;
  const workspace = session.workspace?.name;
  return { title: session.title, ...(workspace !== undefined ? { workspace } : undefined) };
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
  // Without the row lock: the visit is the one thing opening this account's observed sessions.
  // A cancelled tick is not a refused send; it is the tick ending, and passes through.
  return catchAllButInterrupt(
    handToEve(seams, target, turn, words, SESSION_OPENING.UNLOCKED),
    (cause) => {
      seams.report(
        `A ${turn} turn for conversation ${target.conversationId} could not be handed over: ${Cause.pretty(cause)}`,
      );
      return Effect.succeed(false);
    },
  );
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
  // whatever the bound left, so a bound already spent cannot leave an account unmarked.
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
      namingOf(seams.roster, chat),
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
    if (read === undefined) return { observation, failed: failed + 1 };
    // A chat the roster no longer holds has nothing to read; the mark covers its change all the same.
    if (read.reading === undefined) continue;
    const { delta, cursor, from: cursorFrom } = read.reading;
    if (delta.status !== ACTION_RESULT_STATUS.ACCEPTED) {
      seams.report(
        `The transcript of ${chat.identity.providerSessionId} was not answered (${delta.status}); the visit ends and the next tick reads it again.`,
      );
      return { observation, failed: failed + 1 };
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
      return { observation, failed: failed + 1 };
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
  return { observation, failed };
});

/** One account's opening whole: the changed chats under the bound. Kept as the tick's one door, since what the tick counts is the account's opening and not one read of it. */
export const openAccountTurns = /* @__PURE__ */ Effect.fn("openAccountTurns")(function* (
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): Effect.fn.Return<TurnOpeningOutcome, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  return yield* openObservationTurns(seams, userId, options);
});
