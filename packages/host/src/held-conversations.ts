import type { BrainPersistedState, BrainStateRepository } from "@sidecar/brain";
import { type ChildStore, memoryChildStore } from "@sidecar/runtime";
import {
  ARCHIVE_REASON,
  CONVERSATION_KIND,
  type ConversationKind,
  type ConversationRecord,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import { ConversationThread, MemoryConversationStore } from "./conversation-thread.js";

/**
 * The conversations this process holds for the local brain, in memory and
 * for this run alone: main, and each observed session's or child's, listed
 * as the brain opens it. Each holds its thread, relayed between windows
 * through this process, and its envelope, the brain's working memory. Nothing
 * here reaches a disk, so nothing here survives the next launch: the
 * Conversation the developer reads is the account's, kept by Luke's service
 * and drawn by `compose-conversation.ts`, and the brain that will keep a
 * working memory across launches is the hosted one.
 */
export interface HeldConversationsDependencies {
  now: () => number;
  createEventId: () => string;
  /** Hears one conversation's thread as every window should now draw it, less the window that reported the change. */
  onConversationChanged: (
    sessionKey: SessionKey,
    entries: readonly ConversationEntry[],
    except?: ConversationReporter,
  ) => void;
  report: (message: string) => void;
}

/**
 * What names the window a Conversation change came from: an opaque token the
 * client minted for that window, carried on its report and echoed on the
 * change so the client can skip the window that already holds the lines.
 * The host reads nothing into it.
 */
type ConversationReporter = string;

export interface HeldConversations {
  /** One conversation's thread, relayed between windows through this process; created on first use. */
  thread: (sessionKey?: SessionKey) => ConversationThread;
  /** A conversation's envelope, for the brain wiring to build its writer on: held for as long as the brain over it stands. */
  brainStateRepository: (sessionKey?: SessionKey) => BrainStateRepository;
  /**
   * Records a line in one conversation from the main process — the ask a
   * carried action was, an utterance the live record settled — minting the
   * line's id here, since this process is its writer. A key the directory
   * does not list takes no line.
   */
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt?: number,
    sessionKey?: SessionKey,
  ) => Promise<boolean>;
  directory: () => readonly ConversationRecord[];
  holds: (sessionKey: SessionKey) => boolean;
  /** Whether the key names a conversation opened in this run, which is never a recall source; main is not one. */
  isTemporary: (sessionKey: SessionKey) => boolean;
  /**
   * Lists a runtime-owned conversation — an observed session's, a child's —
   * creating its record when none stands and bringing an archived one back,
   * so its thread takes lines.
   */
  ensureConversation: (
    sessionKey: SessionKey,
    kind: ConversationKind,
    name: string,
  ) => Promise<ConversationRecord>;
  /** The child service's records and completions, held in memory alone. */
  childStore: () => ChildStore;
  /** Retires a conversation's record, keeping its thread: the brain's own cleanup of an ended child. Main is never archived. */
  archive: (sessionKey: SessionKey) => Promise<boolean>;
  /** Forgets the lines recorded at or before the instant: the whole of a deletion here, since nothing stands behind the thread. */
  erase: (sessionKey: SessionKey, deletedAt: number) => void;
}

/** Main's record, listed from the first read so the selector has a conversation to stand on. */
const MAIN_RECORD: ConversationRecord = {
  sessionKey: MAIN_SESSION_KEY,
  kind: CONVERSATION_KIND.MAIN,
  name: MAIN_CONVERSATION_NAME,
  createdAt: 0,
  lastActivityAt: 0,
};

/** A conversation's envelope: kept for as long as the brain over it stands, and gone with it. */
function memoryRepository(): BrainStateRepository {
  let held: BrainPersistedState | undefined;
  return {
    load: () => (held ? { state: held } : {}),
    save: (state) => {
      held = state;
      return true;
    },
  };
}

export function wireHeldConversations(
  dependencies: HeldConversationsDependencies,
): HeldConversations {
  const threads = new Map<SessionKey, ConversationThread>();
  const stores = new Map<SessionKey, MemoryConversationStore>();
  const repositories = new Map<SessionKey, BrainStateRepository>();
  const opened = new Map<SessionKey, ConversationRecord>();
  const children = memoryChildStore();

  const thread = (sessionKey: SessionKey = MAIN_SESSION_KEY): ConversationThread => {
    let held = threads.get(sessionKey);
    if (held) return held;
    const store = new MemoryConversationStore();
    stores.set(sessionKey, store);
    held = new ConversationThread({
      store,
      now: dependencies.now,
      onChanged: (entries, except) =>
        dependencies.onConversationChanged(sessionKey, entries, except),
      report: dependencies.report,
    });
    threads.set(sessionKey, held);
    return held;
  };

  const directory = (): readonly ConversationRecord[] => [MAIN_RECORD, ...opened.values()];
  const holds = (sessionKey: SessionKey) =>
    sessionKey === MAIN_SESSION_KEY || opened.has(sessionKey);

  return {
    thread,
    brainStateRepository: (sessionKey = MAIN_SESSION_KEY) => {
      let held = repositories.get(sessionKey);
      if (!held) {
        held = memoryRepository();
        repositories.set(sessionKey, held);
      }
      return held;
    },
    recordConversationEntry: (
      entry,
      recordedAt = dependencies.now(),
      sessionKey = MAIN_SESSION_KEY,
    ) => {
      if (!holds(sessionKey)) return Promise.resolve(false);
      return thread(sessionKey).append([
        { ...entry, recordedAt, eventId: entry.eventId ?? dependencies.createEventId() },
      ]);
    },
    directory,
    holds,
    isTemporary: (sessionKey) => opened.has(sessionKey),
    ensureConversation: async (sessionKey, kind, name) => {
      if (sessionKey === MAIN_SESSION_KEY) return MAIN_RECORD;
      const held = opened.get(sessionKey);
      if (held && held.archivedAt === undefined) return held;
      const now = dependencies.now();
      const record: ConversationRecord = {
        sessionKey,
        kind: held?.kind ?? kind,
        name: held?.name ?? name,
        createdAt: held?.createdAt ?? now,
        lastActivityAt: now,
        temporary: true,
      };
      opened.set(sessionKey, record);
      return record;
    },
    childStore: () => children,
    archive: async (sessionKey) => {
      const held = opened.get(sessionKey);
      if (!held || held.archivedAt !== undefined) return false;
      opened.set(sessionKey, {
        ...held,
        archivedAt: dependencies.now(),
        archiveReason: ARCHIVE_REASON.USER,
      });
      return true;
    },
    erase: (sessionKey, deletedAt) => {
      stores.get(sessionKey)?.eraseAtOrBefore(deletedAt);
    },
  };
}
