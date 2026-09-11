import type { ToolSet } from "ai";
import { Effect, Option } from "effect";
import { type HostedStoreContext, userSeal } from "./database.js";
import { type FactWrite, listFacts, replaceFacts, type StoredFact } from "./facts.js";
import {
  eventsForMessages,
  latestMessageRating,
  latestTurnPosition,
  listEvents,
  listMessages,
  listTurns,
  type MessageCursor,
  type MessageListRead,
  readMessageByClientId,
  type SequenceCursor,
  type StoredEventRecord,
  type StoredRatingRecord,
  type StoredTurnRecord,
  type TurnCursor,
  type TurnCursorPosition,
  turnsNamed,
} from "./message-reads.js";
import {
  advanceRosterSnapshot,
  consumeRosterDiff,
  forgetObservationIneligible,
  listPendingRosterDiffs,
  type ObservationEligibility,
  type ObservationPassRecord,
  type RosterDiffInsert,
  type RosterDiffRecord,
  type RosterSnapshotRecord,
  readObservationPass,
  readRosterSnapshot,
  recordObservationPass,
  rosterSnapshotObservedAt,
  writeRosterSnapshot,
} from "./roster-snapshot.js";
import {
  type ClearOutcome,
  clearMainConversation,
  purgeClearedConversations,
} from "./soft-delete.js";
import { openSpeechOffers, type SpeechOffer } from "./speech.js";
import { type StandingConversation, standingConversations } from "./standing-conversations.js";
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  seedWorkspaceFile,
  type WorkspaceFileListing,
  type WorkspaceFileRecord,
  writeWorkspaceFile,
} from "./workspace-files.js";

/**
 * The hosted store, over Postgres and keyed by user: the conversation rows
 * the store writer writes and the read routes answer, beside the notebook,
 * the remembered facts, the roster snapshot, and the speech offers. Every
 * method names the user whose rows it reaches, and nothing here resolves a
 * user: the bearer seam above decides who is asking, and the store takes the
 * answer. The notebook, the facts, and the roster still cross the payload
 * envelope on their way to a row and back, bound to the user's id; the
 * conversation rows are plain `jsonb`, readable by an operator.
 */
export interface HostedStore {
  /**
   * The conversation rows: cursor reads a device polls, over the `messages`, `events`,
   * and `turns` tables, and the Clear that stamps the main conversation
   * rather than erasing it. Every read skips a conversation the Clear
   * stamped, so a cleared main is gone from the call after it.
   */
  messages: {
    /** Messages after `after` (and at or after `since`, where a window is given) in sequence order, read back under the registry; a page with an unreadable row is refused whole. */
    list(
      userId: string,
      conversationId: string,
      tools: ToolSet,
      cursor?: MessageCursor,
    ): Promise<MessageListRead>;
    /** The one message a writer's client id names — a turn's journal under the turn's id — read back under the registry; an empty page where none stands. */
    byClientId(
      userId: string,
      conversationId: string,
      tools: ToolSet,
      clientId: string,
    ): Promise<MessageListRead>;
  };
  events: {
    list(
      userId: string,
      conversationId: string,
      cursor?: SequenceCursor,
    ): Promise<readonly StoredEventRecord[]>;
    /** The events about the given messages, across their standing conversations, in each conversation's sequence. */
    forMessages(
      userId: string,
      messageIds: readonly string[],
    ): Promise<readonly StoredEventRecord[]>;
  };
  turns: {
    /** The account's turns in the order they last changed, so a settlement is answered again. */
    list(userId: string, cursor?: TurnCursor): Promise<readonly StoredTurnRecord[]>;
    /** The turn rows the given ids name, over standing conversations, in the order they last changed. */
    named(userId: string, turnIds: readonly string[]): Promise<readonly StoredTurnRecord[]>;
    /** The cursor of the turn that changed last, or of the last one at or before `notAfter`; nothing while no such turn stands. */
    latest(userId: string, notAfter?: TurnCursorPosition): Promise<TurnCursorPosition | undefined>;
  };
  directory: {
    /** The view's conversations: the standing main and every standing observed conversation, with their counters. */
    standing(userId: string): Promise<readonly StandingConversation[]>;
  };
  main: {
    /** Clear: stamps the standing main and its descendants and opens a new main, in one transaction. */
    clear(userId: string, now: Date): Promise<ClearOutcome>;
  };
  retention: {
    /** The cron's purge of every conversation, of any account, stamped past the retention window. */
    purgeCleared(now: Date): Promise<number>;
  };
  ratings: {
    /** The newest rating on one of the caller's messages, or nothing; ratings are written through `rateMessage` over the store writer. */
    latest(userId: string, messageId: string): Promise<StoredRatingRecord | undefined>;
  };
  facts: {
    list(userId: string): Promise<readonly StoredFact[]>;
    replace(
      userId: string,
      facts: readonly FactWrite[],
      now: number,
    ): Promise<readonly StoredFact[]>;
  };
  workspace: {
    read(userId: string, path: string): Promise<WorkspaceFileRecord | undefined>;
    write(userId: string, path: string, content: string, now: number): Promise<void>;
    seed(userId: string, path: string, content: string, now: number): Promise<boolean>;
    delete(userId: string, path: string): Promise<boolean>;
    list(userId: string): Promise<readonly WorkspaceFileListing[]>;
  };
  roster: {
    read(userId: string): Promise<RosterSnapshotRecord | undefined>;
    /** The standing snapshot's instant without opening its body; absent where none stands. */
    observedAt(userId: string): Promise<number | undefined>;
    write(userId: string, snapshot: RosterSnapshotRecord): Promise<void>;
    /**
     * Replaces the snapshot and records the diff against the one it replaced,
     * in one transaction, only while the snapshot standing is still the one
     * observed at `previousObservedAt` (absent for none); answers whether it landed.
     */
    advance(
      userId: string,
      snapshot: RosterSnapshotRecord,
      diff: RosterDiffInsert | undefined,
      previousObservedAt: number | undefined,
    ): Promise<boolean>;
    pendingDiffs(userId: string): Promise<readonly RosterDiffRecord[]>;
    consumeDiff(userId: string, id: string, now: number): Promise<boolean>;
    pass(userId: string): Promise<ObservationPassRecord | undefined>;
    recordPass(userId: string, attempt: { attemptedAt: number; failure?: string }): Promise<void>;
    /** Drops the snapshot, diffs, and pass record of every user the schedule no longer runs for, or of the named ones alone. */
    forgetIneligible(eligibility: ObservationEligibility): Promise<void>;
  };
  speech: {
    /** The account's briefings not yet spoken, pushed, or expired, oldest offer first, each as it stands now; transitions are written through the `speech` module over the store writer. */
    open(userId: string, limit?: number): Promise<readonly SpeechOffer[]>;
  };
}

export function hostedStore({ db, keys, run }: HostedStoreContext): HostedStore {
  const sealFor = (userId: string) => userSeal(keys, userId);
  return {
    messages: {
      list: (userId, conversationId, tools, cursor) =>
        listMessages(db, userId, conversationId, tools, cursor),
      byClientId: (userId, conversationId, tools, clientId) =>
        readMessageByClientId(db, userId, conversationId, tools, clientId),
    },
    events: {
      list: (userId, conversationId, cursor) => listEvents(db, userId, conversationId, cursor),
      forMessages: (userId, messageIds) => eventsForMessages(db, userId, messageIds),
    },
    turns: {
      list: (userId, cursor) => listTurns(db, userId, cursor),
      named: (userId, turnIds) => turnsNamed(db, userId, turnIds),
      latest: (userId, notAfter) => latestTurnPosition(db, userId, notAfter),
    },
    directory: {
      standing: (userId) => run(standingConversations(userId)),
    },
    main: {
      clear: (userId, now) => run(clearMainConversation(userId, now)),
    },
    retention: {
      purgeCleared: (now) => run(purgeClearedConversations(now)),
    },
    ratings: {
      latest: (userId, messageId) => latestMessageRating(db, userId, messageId),
    },
    facts: {
      list: (userId) => listFacts(db, sealFor(userId), userId),
      replace: (userId, facts, now) => replaceFacts(db, sealFor(userId), userId, facts, now),
    },
    workspace: {
      read: (userId, path) =>
        run(Effect.map(readWorkspaceFile(sealFor(userId), userId, path), Option.getOrUndefined)),
      write: (userId, path, content, now) =>
        run(writeWorkspaceFile(sealFor(userId), userId, path, content, now)),
      seed: (userId, path, content, now) =>
        run(seedWorkspaceFile(sealFor(userId), userId, path, content, now)),
      delete: (userId, path) => run(deleteWorkspaceFile(userId, path)),
      list: (userId) => run(listWorkspaceFiles(userId)),
    },
    roster: {
      read: (userId) => readRosterSnapshot(db, sealFor(userId), userId),
      observedAt: (userId) => run(rosterSnapshotObservedAt(userId)),
      write: (userId, snapshot) => run(writeRosterSnapshot(sealFor(userId), userId, snapshot)),
      advance: (userId, snapshot, diff, previousObservedAt) =>
        run(advanceRosterSnapshot(sealFor(userId), userId, snapshot, diff, previousObservedAt)),
      pendingDiffs: (userId) => run(listPendingRosterDiffs(sealFor(userId), userId)),
      consumeDiff: (userId, id, now) => run(consumeRosterDiff(userId, id, now)),
      pass: (userId) => run(readObservationPass(userId)),
      recordPass: (userId, attempt) => run(recordObservationPass(userId, attempt)),
      forgetIneligible: (eligibility) => run(forgetObservationIneligible(eligibility)),
    },
    speech: {
      open: (userId, limit) => run(openSpeechOffers({ userId, limit })),
    },
  };
}

export type { HostedStoreContext, HostedStoreDatabase, HostedStoreRun } from "./database.js";
export {
  findMessageByClientId,
  listRecentMessages,
  MAXIMUM_READ_PAGE,
  readMessageById,
  type StoredEventRecord,
  type StoredMessageRecord,
  type StoredTurnRecord,
} from "./message-reads.js";
export {
  RATING_REFUSAL,
  type RatingStore,
  type RatingWriteResult,
  rateMessage,
} from "./ratings.js";
export {
  MAXIMUM_PENDING_ROSTER_DIFFS,
  type ObservationPassRecord,
  type RosterDiffRecord,
  type RosterSnapshotRecord,
} from "./roster-snapshot.js";
export { CLEARED_CONVERSATION_RETENTION_MS } from "./soft-delete.js";
export {
  claimSpeech,
  markSpeechPushed,
  markSpeechSpoken,
  type OpenSpeechOffersQuery,
  offerSpeech,
  openSpeechOffers,
  quietUntilByAccount,
  SPEECH_OFFER,
  SPEECH_REFUSAL,
  SPEECH_STATE,
  type SpeechOffer,
  type SpeechStore,
  type SpeechSweepOutcome,
  type SpeechSweepStore,
  sweepSpeech,
} from "./speech.js";
export type { StandingConversation } from "./standing-conversations.js";

export {
  type CommentaryAppend,
  VOICE_WRITE_REFUSAL,
  type VoiceTarget,
  type VoiceWriteResult,
  type VoiceWriter,
  voiceWriter,
} from "./voice-writer.js";
export {
  type ConversationTarget,
  STORE_WRITE_EFFECT,
  STORE_WRITE_REFUSAL,
  type StoreWriteResult,
  storeWriter,
} from "./writer.js";
