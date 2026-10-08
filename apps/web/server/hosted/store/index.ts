import type { ToolSet } from "ai";
import { Effect, Option, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { SessionIdentity } from "../../core.js";
import { type HostedStoreContext, userSeal } from "./database.js";
import {
  type MessageListRead,
  readMessageByClientId,
  readMessagesByIds,
  type StoredTurnRecord,
  turnsNamed,
} from "./message-reads.js";
import {
  type ObservedSessionNaming,
  retireDepartedObservedConversations,
  type StandingProviderSessions,
  standingObservedConversation,
} from "./observed-conversations.js";
import {
  advanceRosterSnapshot,
  forgetObservationIneligible,
  type ObservationEligibility,
  type ObservationPassRecord,
  type RosterSnapshotRecord,
  readObservationPass,
  readRosterSnapshot,
  recordObservationPass,
  rosterSnapshotObservedAt,
  writeRosterSnapshot,
} from "./roster-snapshot.js";
import { purgeClearedConversations } from "./soft-delete.js";
import {
  type RecentBriefingOffer,
  type RecentBriefingOffersQuery,
  recentBriefingOffers,
} from "./speech.js";
import { keepTranscriptMark, readTranscriptMark } from "./transcript-mark.js";
import {
  pruneWorkspaceEmbeddings,
  readWorkspaceEmbeddings,
  type WorkspaceEmbeddingWrite,
  writeWorkspaceEmbeddings,
} from "./workspace-embeddings.js";
import {
  type DailyNoteRecord,
  type DailyNoteRow,
  listDailyNotes,
  listWorkspaceFiles,
  readDailyNotesForDays,
  readWorkspaceFile,
  reviseWorkspaceFile,
  seedWorkspaceFile,
  type WorkspaceFileListing,
  type WorkspaceFileRecord,
  writeWorkspaceFile,
} from "./workspace-files.js";

/** How a store read or write fails: the driver's own refusal, or a row this build cannot decode. */
type HostedStoreFailure = SqlError | Schema.SchemaError;

/**
 * What every `HostedStore` method answers: an effect over the ambient client,
 * so a caller composes it into the transaction it already holds and the edge
 * that owns the connection is the one that runs it.
 */
type HostedStoreEffect<A> = Effect.Effect<A, HostedStoreFailure, SqlClient.SqlClient>;

/**
 * The hosted store, over Postgres and keyed by user: the conversation rows
 * the store writer writes and the brain reads, beside the notebook,
 * the roster snapshot, and the speech offers. Every
 * method names the user whose rows it reaches, and nothing here resolves a
 * user: the bearer seam above decides who is asking, and the store takes the
 * answer. The notebook and the roster still cross the payload
 * envelope on their way to a row and back, bound to the user's id; the
 * conversation rows are plain `jsonb`, readable by an operator.
 */
export interface HostedStore {
  /** The conversation rows the brain and the voice read; every read skips a conversation stamped deleted. */
  messages: {
    /** The one message a writer's client id names — a turn's journal under the turn's id — read back under the registry; an empty page where none stands. */
    byClientId(
      userId: string,
      conversationId: string,
      tools: ToolSet,
      clientId: string,
    ): HostedStoreEffect<MessageListRead>;
    /** The account's messages the ids name, across their standing conversations, read back under the registry in one statement; an id naming no standing row is absent. */
    byIds(
      userId: string,
      tools: ToolSet,
      messageIds: readonly string[],
    ): HostedStoreEffect<MessageListRead>;
  };
  turns: {
    /** The turn rows the given ids name, over standing conversations, in the order they last changed. */
    named(
      userId: string,
      turnIds: readonly string[],
    ): HostedStoreEffect<readonly StoredTurnRecord[]>;
  };
  directory: {
    /** The observed conversation for one session, opened on its first diff and standing while the roster lists the session, its naming kept level with the roster's where one is handed; a retired session opens a fresh row. */
    observed(
      userId: string,
      identity: SessionIdentity,
      now: number,
      naming?: ObservedSessionNaming,
    ): HostedStoreEffect<string | undefined>;
  };
  retention: {
    /** The cron's purge of every conversation, of any account, stamped past the retention window. */
    purgeCleared(now: Date): HostedStoreEffect<number>;
  };
  workspace: {
    read(userId: string, path: string): HostedStoreEffect<WorkspaceFileRecord | undefined>;
    write(userId: string, path: string, content: string, now: number): HostedStoreEffect<void>;
    /**
     * Rewrites the file from what stands, under the account's lock; the
     * revision answers the new content or nothing to leave the file as it
     * was, and what is answered is what landed.
     */
    revise(
      userId: string,
      path: string,
      revise: (existing: string | undefined) => string | undefined,
      now: number,
    ): HostedStoreEffect<string | undefined>;
    seed(userId: string, path: string, content: string, now: number): HostedStoreEffect<boolean>;
    list(userId: string): HostedStoreEffect<readonly WorkspaceFileListing[]>;
    /** The dated notes under `memory/`, newest first and at most `limit` of them, each with its character count and none of its words. */
    listNotes(userId: string, limit: number): HostedStoreEffect<readonly DailyNoteRecord[]>;
    /** The dated notes for the given `YYYY-MM-DD` days, slugged variants included and in path order, read whole. */
    readNotes(userId: string, days: readonly string[]): HostedStoreEffect<readonly DailyNoteRow[]>;
  };
  /**
   * The notebook search's embedding cache: a vector per passage hash, under
   * the model it was made by, and never the passage's words. Filled lazily by
   * a search and pruned to the passages the workspace holds now.
   */
  embeddings: {
    /** The cached vectors among the hashes given, under the model named; a hash embedded under another model, or never, is absent. */
    read(
      userId: string,
      model: string,
      hashes: readonly string[],
    ): HostedStoreEffect<ReadonlyMap<string, readonly number[]>>;
    write(
      userId: string,
      model: string,
      writes: readonly WorkspaceEmbeddingWrite[],
      now: number,
    ): HostedStoreEffect<void>;
    /** Drops every cached vector whose hash is not among those given; answers how many went. */
    prune(userId: string, hashes: readonly string[]): HostedStoreEffect<number>;
  };
  roster: {
    read(userId: string): HostedStoreEffect<RosterSnapshotRecord | undefined>;
    /** The standing snapshot's instant without opening its body; absent where none stands. */
    observedAt(userId: string): HostedStoreEffect<number | undefined>;
    write(userId: string, snapshot: RosterSnapshotRecord): HostedStoreEffect<void>;
    /**
     * Replaces the snapshot, in one transaction, only while the snapshot
     * standing is still the one observed at `previousObservedAt` (absent for
     * none); answers whether it landed. No change is derived from it: the
     * opener wakes on transcript changes, under its own mark.
     */
    advance(
      userId: string,
      snapshot: RosterSnapshotRecord,
      previousObservedAt: number | undefined,
    ): HostedStoreEffect<boolean>;
    /** The instant up to which every transcript change has been handed to the brain; absent before the opener's first visit. */
    mark(userId: string): HostedStoreEffect<number | undefined>;
    /**
     * Moves that mark, only over the one standing at `from` (absent for
     * none), so the opener composes it into the one transaction that also
     * keeps its transcript cursors.
     */
    keepMark(
      userId: string,
      mark: number,
      from: number | undefined,
      now: number,
    ): HostedStoreEffect<boolean>;
    /**
     * Retires the conversation of every observed chat the roster no longer
     * lists, per provider the pass read: stamped now,
     * hidden from every read, purged thirty days on. Answers the ids stamped.
     */
    retireDeparted(
      userId: string,
      standing: readonly StandingProviderSessions[],
      now: number,
    ): HostedStoreEffect<readonly string[]>;
    pass(userId: string): HostedStoreEffect<ObservationPassRecord | undefined>;
    recordPass(
      userId: string,
      attempt: { attemptedAt: number; failure?: string },
    ): HostedStoreEffect<void>;
    /** Drops the snapshot, transcript mark, and pass record of every user the schedule no longer runs for, or of the named ones alone. */
    forgetIneligible(eligibility: ObservationEligibility): HostedStoreEffect<void>;
  };
  speech: {
    /** The briefings offered from the account's observed conversations since the instant and since its main opened, newest first and bounded, whatever became of each. */
    recentBriefings(
      query: RecentBriefingOffersQuery,
    ): HostedStoreEffect<readonly RecentBriefingOffer[]>;
  };
}

export function hostedStore({ keys }: HostedStoreContext): HostedStore {
  const sealFor = (userId: string) => userSeal(keys, userId);
  return {
    messages: {
      byClientId: (userId, conversationId, tools, clientId) =>
        readMessageByClientId(userId, conversationId, tools, clientId),
      byIds: (userId, tools, messageIds) => readMessagesByIds(userId, tools, messageIds),
    },
    turns: {
      named: (userId, turnIds) => turnsNamed(userId, turnIds),
    },
    directory: {
      observed: (userId, identity, now, naming) =>
        standingObservedConversation(userId, identity, new Date(now), naming),
    },
    retention: {
      purgeCleared: (now) => purgeClearedConversations(now),
    },
    workspace: {
      read: (userId, path) => Effect.map(readWorkspaceFile(userId, path), Option.getOrUndefined),
      write: (userId, path, content, now) => writeWorkspaceFile(userId, path, content, now),
      revise: (userId, path, revise, now) => reviseWorkspaceFile(userId, path, revise, now),
      seed: (userId, path, content, now) => seedWorkspaceFile(userId, path, content, now),
      list: (userId) => listWorkspaceFiles(userId),
      listNotes: (userId, limit) => listDailyNotes(userId, limit),
      readNotes: (userId, days) => readDailyNotesForDays(userId, days),
    },
    embeddings: {
      read: (userId, model, hashes) => readWorkspaceEmbeddings(userId, model, hashes),
      write: (userId, model, writes, now) => writeWorkspaceEmbeddings(userId, model, writes, now),
      prune: (userId, hashes) => pruneWorkspaceEmbeddings(userId, hashes),
    },
    roster: {
      read: (userId) => readRosterSnapshot(sealFor(userId), userId),
      observedAt: (userId) => rosterSnapshotObservedAt(userId),
      write: (userId, snapshot) => writeRosterSnapshot(sealFor(userId), userId, snapshot),
      advance: (userId, snapshot, previousObservedAt) =>
        advanceRosterSnapshot(sealFor(userId), userId, snapshot, previousObservedAt),
      mark: (userId) => readTranscriptMark(userId),
      keepMark: (userId, mark, from, now) => keepTranscriptMark(userId, mark, from, new Date(now)),
      retireDeparted: (userId, standing, now) =>
        retireDepartedObservedConversations(userId, standing, new Date(now)),
      pass: (userId) => readObservationPass(userId),
      recordPass: (userId, attempt) => recordObservationPass(userId, attempt),
      forgetIneligible: (eligibility) => forgetObservationIneligible(eligibility),
    },
    speech: {
      recentBriefings: (query) => recentBriefingOffers(query),
    },
  };
}

export { promptHashOf } from "./content-addressed.js";
export type { HostedStoreContext } from "./database.js";
export {
  findMessageByClientId,
  listRecentMessages,
  readMessageById,
  type StoredMessageRecord,
  type StoredTurnRecord,
} from "./message-reads.js";
export type { RosterSnapshotRecord } from "./roster-snapshot.js";
export {
  claimSpeech,
  markSpeechPushed,
  offerSpeech,
  openSpeechOffers,
  quietUntilByAccount,
  SPEECH_STATE,
  type SpeechOffer,
  type SpeechStore,
  type SpeechSweepOutcome,
  sweepSpeech,
} from "./speech.js";
export {
  type VoiceTarget,
  type VoiceWriteResult,
  type VoiceWriter,
  voiceWriter,
} from "./voice-writer.js";
export {
  type ConversationTarget,
  STORE_WRITE_EFFECT,
  type StoreWriter,
  storeWriter,
} from "./writer.js";
