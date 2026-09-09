import {
  type BrainPersistedState,
  type BrainStateLoad,
  type BrainStateRepository,
  type ConversationAppendOutcome,
  type ConversationEntry,
  type ConversationRecord,
  EnvelopeTracker,
  type SessionKey,
  type StoredTranscriptEvent,
  type TranscriptEvent,
} from "../../core.js";
import { loadBrainEnvelope, saveBrainEnvelope } from "./brain-envelope.js";
import {
  type BriefingInsert,
  type BriefingRecord,
  type BriefingState,
  claimBriefing,
  expireBriefings,
  insertBriefing,
  listBriefings,
  markBriefingPushed,
  markBriefingSpoken,
} from "./briefings.js";
import {
  appendConversationLines,
  conversationClearedAt,
  listConversationLines,
} from "./conversation-lines.js";
import {
  type ConversationCreation,
  createConversation,
  deleteConversation,
  listConversations,
} from "./conversations.js";
import { type HostedStoreContext, userSeal } from "./database.js";
import { type FactWrite, listFacts, replaceFacts, type StoredFact } from "./facts.js";
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
import { type RunAboutFields, recordRunAbout, runAbout } from "./run-about.js";
import {
  listCompactionBoundaries,
  listTranscript,
  type StoredCompactionBoundary,
  type TranscriptListOptions,
} from "./transcript.js";
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
 * The hosted conversation store: the storage contracts the desktop's SQLite
 * store implements, over Postgres and keyed by user, so a brain host composes
 * against it the way the desktop composes against its worker. Every method
 * names the user whose rows it reaches, and nothing here resolves a user: the
 * bearer seam above decides who is asking, and the store takes the answer.
 * Each user-derived value crosses the payload envelope on its way to a row
 * and back, bound to the user's id.
 */
export interface HostedStore {
  /**
   * The brain's envelope as a repository. Each save is a compare-and-set
   * against the generation this handle last observed standing — loaded,
   * readable or not, or saved — and carries only what changed, or the whole
   * envelope when the generation itself changes. A generation whose rows
   * could not be read is still observed by its id, so the store's repair of
   * it lands; a save from a handle whose picture is stale answers false and
   * changes nothing.
   */
  brainStateRepository(userId: string, sessionKey: SessionKey): BrainStateRepository;
  conversations: {
    list(userId: string): Promise<readonly ConversationRecord[]>;
    create(userId: string, creation: ConversationCreation): Promise<ConversationRecord>;
    /** The hard delete: the conversation and every row under it, with no archive behind them. */
    delete(userId: string, sessionKey: SessionKey): Promise<boolean>;
  };
  lines: {
    append(
      userId: string,
      sessionKey: SessionKey,
      entries: readonly ConversationEntry[],
      now: number,
    ): Promise<ConversationAppendOutcome<ConversationEntry>>;
    list(
      userId: string,
      sessionKey: SessionKey,
      now: number,
    ): Promise<readonly ConversationEntry[]>;
    cutoff(userId: string, sessionKey: SessionKey): Promise<number | undefined>;
  };
  transcript: {
    list(
      userId: string,
      sessionKey: SessionKey,
      options?: TranscriptListOptions,
    ): Promise<readonly StoredTranscriptEvent[]>;
    boundaries(
      userId: string,
      sessionKey: SessionKey,
    ): Promise<readonly StoredCompactionBoundary[]>;
  };
  runs: {
    recordAbout(userId: string, runId: string, about: RunAboutFields): Promise<boolean>;
    about(userId: string, runId: string): Promise<RunAboutFields | undefined>;
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
    /** Drops the snapshot, diffs, and pass record of every user the schedule no longer runs for. */
    forgetIneligible(eligibility: ObservationEligibility): Promise<void>;
  };
  briefings: {
    insert(userId: string, insert: BriefingInsert): Promise<boolean>;
    claim(userId: string, id: string, deviceId: string, now: number): Promise<boolean>;
    markSpoken(userId: string, id: string, deviceId: string, now: number): Promise<boolean>;
    markPushed(userId: string, id: string, now: number): Promise<boolean>;
    expire(userId: string, now: number): Promise<readonly string[]>;
    list(userId: string, state?: BriefingState): Promise<readonly BriefingRecord[]>;
  };
}

export function hostedStore({ db, keys }: HostedStoreContext): HostedStore {
  const sealFor = (userId: string) => userSeal(keys, userId);
  return {
    brainStateRepository(userId, sessionKey) {
      const seal = sealFor(userId);
      const tracker = new EnvelopeTracker();
      return {
        load: async (): Promise<BrainStateLoad> => {
          const loaded = await loadBrainEnvelope(db, seal, userId, sessionKey);
          tracker.observe(loaded);
          return loaded.state
            ? { state: loaded.state }
            : { unreadable: loaded.unreadable === true };
        },
        save: async (
          state: BrainPersistedState,
          transcript?: readonly TranscriptEvent[],
        ): Promise<boolean> => {
          const save = tracker.saveFor(state, transcript);
          const landed = await saveBrainEnvelope(db, seal, userId, sessionKey, save);
          if (landed) tracker.landed(state);
          return landed;
        },
      };
    },
    conversations: {
      list: (userId) => listConversations(db, userId),
      create: (userId, creation) => createConversation(db, userId, creation),
      delete: (userId, sessionKey) => deleteConversation(db, userId, sessionKey),
    },
    lines: {
      append: (userId, sessionKey, entries, now) =>
        appendConversationLines(db, sealFor(userId), userId, sessionKey, entries, now),
      list: (userId, sessionKey, now) =>
        listConversationLines(db, sealFor(userId), userId, sessionKey, now),
      cutoff: (userId, sessionKey) => conversationClearedAt(db, userId, sessionKey),
    },
    transcript: {
      list: (userId, sessionKey, options) =>
        listTranscript(db, sealFor(userId), userId, sessionKey, options),
      boundaries: (userId, sessionKey) => listCompactionBoundaries(db, userId, sessionKey),
    },
    runs: {
      recordAbout: (userId, runId, about) => recordRunAbout(db, userId, runId, about),
      about: (userId, runId) => runAbout(db, userId, runId),
    },
    facts: {
      list: (userId) => listFacts(db, sealFor(userId), userId),
      replace: (userId, facts, now) => replaceFacts(db, sealFor(userId), userId, facts, now),
    },
    workspace: {
      read: (userId, path) => readWorkspaceFile(db, sealFor(userId), userId, path),
      write: (userId, path, content, now) =>
        writeWorkspaceFile(db, sealFor(userId), userId, path, content, now),
      seed: (userId, path, content, now) =>
        seedWorkspaceFile(db, sealFor(userId), userId, path, content, now),
      delete: (userId, path) => deleteWorkspaceFile(db, userId, path),
      list: (userId) => listWorkspaceFiles(db, userId),
    },
    roster: {
      read: (userId) => readRosterSnapshot(db, sealFor(userId), userId),
      observedAt: (userId) => rosterSnapshotObservedAt(db, userId),
      write: (userId, snapshot) => writeRosterSnapshot(db, sealFor(userId), userId, snapshot),
      advance: (userId, snapshot, diff, previousObservedAt) =>
        advanceRosterSnapshot(db, sealFor(userId), userId, snapshot, diff, previousObservedAt),
      pendingDiffs: (userId) => listPendingRosterDiffs(db, sealFor(userId), userId),
      consumeDiff: (userId, id, now) => consumeRosterDiff(db, userId, id, now),
      pass: (userId) => readObservationPass(db, userId),
      recordPass: (userId, attempt) => recordObservationPass(db, userId, attempt),
      forgetIneligible: (eligibility) => forgetObservationIneligible(db, eligibility),
    },
    briefings: {
      insert: (userId, insert) => insertBriefing(db, sealFor(userId), userId, insert),
      claim: (userId, id, deviceId, now) => claimBriefing(db, userId, id, deviceId, now),
      markSpoken: (userId, id, deviceId, now) => markBriefingSpoken(db, userId, id, deviceId, now),
      markPushed: (userId, id, now) => markBriefingPushed(db, userId, id, now),
      expire: (userId, now) => expireBriefings(db, userId, now),
      list: (userId, state) => listBriefings(db, sealFor(userId), userId, state),
    },
  };
}

export {
  BRIEFING_STATE,
  type BriefingInsert,
  type BriefingRecord,
  type BriefingState,
} from "./briefings.js";
export type { ConversationCreation } from "./conversations.js";
export type { HostedStoreContext, HostedStoreDatabase } from "./database.js";
export type { FactWrite, StoredFact } from "./facts.js";
export {
  MAXIMUM_PENDING_ROSTER_DIFFS,
  type ObservationEligibility,
  type ObservationPassRecord,
  type RosterDiffInsert,
  type RosterDiffRecord,
  type RosterSnapshotRecord,
} from "./roster-snapshot.js";
export type { RunAboutFields } from "./run-about.js";
export type { StoredCompactionBoundary, TranscriptListOptions } from "./transcript.js";
export {
  isWorkspacePath,
  type WorkspaceFileListing,
  type WorkspaceFileRecord,
} from "./workspace-files.js";
