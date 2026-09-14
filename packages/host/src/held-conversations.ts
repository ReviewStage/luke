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

/**
 * The conversations this process holds for the local brain, in memory and
 * for this run alone: main, and each observed session's or child's, listed
 * as the brain opens it. Each holds its envelope, the brain's working memory,
 * and no lines: the Conversation the developer reads is the account's, kept
 * by Luke's service and drawn by `compose-conversation.ts`. Nothing here
 * reaches a disk, so nothing here survives the next launch, and the brain
 * that will keep a working memory across launches is the hosted one.
 */
export interface HeldConversationsDependencies {
  now: () => number;
}

export interface HeldConversations {
  /** A conversation's envelope, for the brain wiring to build its writer on: held for as long as the brain over it stands. */
  brainStateRepository: (sessionKey?: SessionKey) => BrainStateRepository;
  directory: () => readonly ConversationRecord[];
  holds: (sessionKey: SessionKey) => boolean;
  /** Whether the key names a conversation opened in this run, which is never a recall source; main is not one. */
  isTemporary: (sessionKey: SessionKey) => boolean;
  /**
   * Lists a runtime-owned conversation — an observed session's, a child's —
   * creating its record when none stands and bringing an archived one back.
   */
  ensureConversation: (
    sessionKey: SessionKey,
    kind: ConversationKind,
    name: string,
  ) => Promise<ConversationRecord>;
  /** The child service's records and completions, held in memory alone. */
  childStore: () => ChildStore;
  /** Retires a conversation's record: the brain's own cleanup of an ended child. Main is never archived. */
  archive: (sessionKey: SessionKey) => Promise<boolean>;
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
  const repositories = new Map<SessionKey, BrainStateRepository>();
  const opened = new Map<SessionKey, ConversationRecord>();
  const children = memoryChildStore();

  const directory = (): readonly ConversationRecord[] => [MAIN_RECORD, ...opened.values()];
  const holds = (sessionKey: SessionKey) =>
    sessionKey === MAIN_SESSION_KEY || opened.has(sessionKey);

  return {
    brainStateRepository: (sessionKey = MAIN_SESSION_KEY) => {
      let held = repositories.get(sessionKey);
      if (!held) {
        held = memoryRepository();
        repositories.set(sessionKey, held);
      }
      return held;
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
  };
}
