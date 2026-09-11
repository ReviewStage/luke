import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import type { BrainWakeEvent, SessionIdentity } from "../../core.js";
import { wakeInputText } from "../../core.js";
import { decodeRosterDiff } from "../roster-diff.js";
import type { HostedStoreRun } from "../store/database.js";
import type { ConversationTarget, HostedStore } from "../store/index.js";
import { consumeRosterDiff } from "../store/roster-snapshot.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import { recordedRuntimeSession } from "./conversation.js";
import { EVE_SEND_OUTCOME, type EveSessions } from "./eve-sessions.js";
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
  /** The most observed conversations one account is opened a turn for in one tick. */
  TURNS_PER_ACCOUNT: 8,
} as const;

/** The kinds of turn the opener sends, which is what its eve client is admitted for and nothing wider. */
export type ScheduledTurn = typeof BRAIN_HOST_TURN.OBSERVATION;

export interface TurnOpenerSeams {
  /** The runner the consuming transaction is answered through: the edge's own, over the same database. */
  readonly run: HostedStoreRun;
  readonly store: Pick<HostedStore, "roster" | "directory">;
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
  /** Conversations the pass could not open a turn for: eve refused, or no conversation could stand for the session. */
  readonly failed: number;
}

export const NOTHING_OPENED: TurnOpeningOutcome = { observation: 0, failed: 0 };

interface PendingDiff extends DatedRosterDiff {
  readonly id: string;
}

/** The news one observed conversation is opened with: its identity and every wake the taken diffs carry for it, oldest first. */
interface Opening {
  readonly identity: SessionIdentity;
  readonly events: BrainWakeEvent[];
}

/** The pending diffs decoded and dated, oldest first; a payload this build cannot read is skipped, never guessed at. */
async function pendingDiffs(
  store: Pick<HostedStore, "roster">,
  userId: string,
): Promise<readonly PendingDiff[]> {
  const pending = await store.roster.pendingDiffs(userId);
  return pending.flatMap((record) => {
    const diff = decodeRosterDiff(record.payload);
    return diff ? [{ id: record.id, diff, observedAt: record.observedAt }] : [];
  });
}

interface Plan {
  /** The diffs this pass carries, to be consumed once eve has every message. */
  readonly taken: readonly PendingDiff[];
  readonly openings: readonly Opening[];
  /** Sessions the one over-wide diff named past the bound, not woken for it. */
  readonly cut: number;
}

/**
 * Which diffs this pass carries and which conversations it opens: whole
 * diffs oldest first while the sessions they name fit under the bound, the
 * first diff always, and the sessions of that first diff cut to the bound
 * when it alone exceeds it.
 */
function plan(diffs: readonly PendingDiff[], roster: HostedRoster, limit: number): Plan {
  const taken: PendingDiff[] = [];
  const openings = new Map<string, Opening>();
  let cut = 0;
  for (const dated of diffs) {
    const wakes = wakeEventsFromDiffs([dated], roster);
    const fresh = new Set(
      wakes.map((wake) => identityKey(wake.identity)).filter((key) => !openings.has(key)),
    );
    if (taken.length > 0 && openings.size + fresh.size > limit) break;
    taken.push(dated);
    for (const wake of wakes) {
      const key = identityKey(wake.identity);
      const held = openings.get(key);
      if (held) {
        held.events.push(wake);
      } else if (openings.size < limit) {
        openings.set(key, { identity: wake.identity, events: [wake] });
      } else {
        cut += 1;
      }
    }
  }
  return { taken, openings: [...openings.values()], cut };
}

/** Whether eve took the message: sent to the session the conversation runs in, or opened in a new one where none runs. */
async function handToEve(
  seams: TurnOpenerSeams,
  target: ConversationTarget,
  words: string,
): Promise<boolean> {
  const message = {
    conversationId: target.conversationId,
    turn: BRAIN_HOST_TURN.OBSERVATION,
    message: words,
  };
  const recorded = await seams.run(recordedRuntimeSession(target));
  if (recorded !== undefined) {
    const sent = await seams.eve.send(recorded, message);
    if (sent.outcome === EVE_SEND_OUTCOME.ACCEPTED) return true;
    if (sent.outcome === EVE_SEND_OUTCOME.FAILED) {
      seams.report(
        `eve refused an observation turn on conversation ${target.conversationId} with status ${sent.status}.`,
      );
      return false;
    }
  }
  const opened = await seams.eve.open(message);
  if (opened.outcome === EVE_SEND_OUTCOME.ACCEPTED) return true;
  seams.report(
    `eve refused to open a session for conversation ${target.conversationId} with status ${opened.status}.`,
  );
  return false;
}

/** One session's transcript since the cursor kept for it, riding on its first wake; a read that throws is a read not made, and the cursor stands for the next. */
async function withTranscript(
  seams: TurnOpenerSeams,
  opening: Opening,
): Promise<{ events: readonly BrainWakeEvent[]; cursor?: string; from?: string }> {
  let reading: Awaited<ReturnType<HostedTranscriptReads["since"]>>;
  try {
    reading = await seams.transcripts.since(opening.identity);
  } catch (error) {
    seams.report(
      `The transcript of ${opening.identity.providerSessionId} could not be read: ${String(error)}.`,
    );
    reading = undefined;
  }
  if (reading === undefined) return { events: opening.events };
  const [first, ...rest] = opening.events;
  if (first === undefined) return { events: opening.events };
  return {
    events: [{ ...first, transcriptDelta: reading.delta }, ...rest],
    ...(reading.cursor !== undefined ? { cursor: reading.cursor } : undefined),
    ...(reading.from !== undefined ? { from: reading.from } : undefined),
  };
}

/** Opens the account's observation turns for the diffs pending now, as the module comment describes. */
export async function openObservationTurns(
  seams: TurnOpenerSeams,
  userId: string,
  options: TurnOpeningOptions = {},
): Promise<TurnOpeningOutcome> {
  const limit = options.limit ?? TURN_OPENER.TURNS_PER_ACCOUNT;
  const diffs = await pendingDiffs(seams.store, userId);
  if (diffs.length === 0) return NOTHING_OPENED;
  const planned = plan(diffs, seams.roster, limit);
  if (planned.cut > 0) {
    seams.report(
      `One roster diff of account ${userId} named ${planned.cut} more sessions than the opener wakes in one tick; their next change wakes them.`,
    );
  }
  const cursors: { identity: SessionIdentity; cursor: string; from: string | undefined }[] = [];
  let observation = 0;
  let failed = 0;
  for (const opening of planned.openings) {
    const conversationId = await seams.store.directory.observed(
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
    const read = await withTranscript(seams, opening);
    let accepted: boolean;
    try {
      accepted = await handToEve(seams, target, wakeInputText(read.events, seams.now()));
    } catch (error) {
      seams.report(
        `eve could not be reached for conversation ${conversationId}: ${String(error)}.`,
      );
      accepted = false;
    }
    if (!accepted) {
      return { observation, failed: failed + 1 };
    }
    if (read.cursor !== undefined) {
      cursors.push({ identity: opening.identity, cursor: read.cursor, from: read.from });
    }
    observation += 1;
  }
  const now = new Date(seams.now());
  await seams.run(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql.withTransaction(
        Effect.all(
          [
            ...cursors.map(({ identity, cursor, from }) =>
              keepTranscriptCursor(userId, identity, cursor, from, now),
            ),
            ...planned.taken.map((diff) => consumeRosterDiff(userId, diff.id, now.getTime())),
          ],
          { discard: true },
        ),
      ),
    ),
  );
  return { observation, failed };
}
