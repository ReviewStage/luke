import type { RememberedFact } from "@sidecar/acts";
import { type BrainStateRepository, brainStateRepositoryFromStorage } from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import {
  ARCHIVE_REASON,
  CONVERSATION_KIND,
  type ConversationRecord,
  DEFAULT_AGENT_ID,
  type HistoryArchiveRecord,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  RESTORE_OUTCOME,
  type RestoreOutcome,
  type SessionKey,
  threadSessionKey,
} from "@sidecar/runtime-contracts";
import {
  type DeletionOutcome,
  type MaintenanceReport,
  RuntimeStoreClient,
  type RuntimeStorePort,
} from "@sidecar/runtime-store";
import type { WebContents } from "electron";
import type { CutoffBefore } from "./brain/conversation-deletion";
import { ConversationThread, MemoryHistoryStore } from "./conversation-thread";

/**
 * The runtime store as the desktop composes it: one database under the
 * agent's own directory, spoken to on its own worker thread so the main
 * thread never waits on the disk. It holds every conversation's envelope,
 * thread, and transcript, the remembered facts, and the archives of deleted
 * history, and it is opened once at launch in every run that observes
 * providers. A fixture or capture run has nothing on disk: its threads live
 * in memory under the same append rule, the facts are empty and refuse every
 * write, and nothing is recorded from this process.
 *
 * The conversation directory is held here too: what the store lists, and
 * beside it the temporary threads that exist in this process alone and are
 * gone at the next launch.
 */
export interface RuntimeStoreWiringDependencies {
  /** Whether this run keeps anything on disk; a fixture or capture run does not. */
  persistent: boolean;
  createWorker: () => RuntimeStorePort;
  /** The agent's directory under Luke's application data, created on open. */
  agentRoot: () => string;
  ensureDirectory: (directory: string) => void;
  now: () => number;
  createEventId: () => string;
  /** Hears one conversation's thread as every window should now draw it, less the window that reported the change. */
  onHistoryChanged: (
    sessionKey: SessionKey,
    entries: readonly ConversationEntry[],
    except?: WebContents,
  ) => void;
  /** Hears the directory whenever a conversation is created, archived, restored, or deleted. */
  onDirectoryChanged: (directory: ConversationDirectorySnapshot) => void;
  report: (message: string) => void;
}

/** How the store's side of a deletion ended; the archive itself stays with the store. */
export type HistoryErasure = Pick<DeletionOutcome, "published">;

export interface ConversationDirectorySnapshot {
  entries: readonly ConversationRecord[];
  archives: readonly HistoryArchiveRecord[];
}

export interface RuntimeStoreWiring {
  /** The client, started on first use; the worker's answers stand behind every method below. */
  client: () => RuntimeStoreClient;
  /** One conversation's thread, relayed between windows through this process; created on first use. */
  thread: (sessionKey?: SessionKey) => ConversationThread<WebContents>;
  /** A conversation's envelope, for the brain wiring to build its writer on: the store's, or memory alone for a temporary thread. */
  brainStateRepository: (sessionKey?: SessionKey) => BrainStateRepository;
  /** Opens the database for this launch. */
  open: () => Promise<void>;
  /** Restores every stored conversation's thread, its cutoff, and the remembered facts, once opened. */
  restore: () => Promise<void>;
  rememberedFacts: () => readonly RememberedFact[];
  /**
   * One mutation of the remembered facts, read and replaced under one queue.
   * Two conversations may run turns at once, so a remember in one and a
   * forget in another must not each read the list, compute, and replace it
   * past the other; `work` is handed the list as it stands when its turn in
   * the queue comes and the store's own writer, and what it answers is the
   * list that then stands.
   */
  mutateRememberedFacts: (
    work: (
      current: readonly RememberedFact[],
      write: (facts: readonly RememberedFact[]) => Promise<boolean>,
    ) => Promise<readonly RememberedFact[]>,
  ) => Promise<readonly RememberedFact[]>;
  /**
   * Records a line in one conversation from the main process — the ask a
   * carried act was, a typed ask the brain accepted, a run's end — minting
   * the line's id here, since this process is its writer.
   */
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt?: number,
    sessionKey?: SessionKey,
  ) => Promise<boolean>;
  /** The directory as this process holds it: stored conversations and the temporary threads of this run. */
  directory: () => ConversationDirectorySnapshot;
  /** Whether the key names a conversation the directory lists right now. */
  holds: (sessionKey: SessionKey) => boolean;
  createThread: (temporary: boolean) => Promise<ConversationRecord>;
  archive: (sessionKey: SessionKey) => Promise<boolean>;
  unarchive: (sessionKey: SessionKey) => Promise<boolean>;
  /**
   * The store side of Delete history, called once the thread is fenced and
   * the conversation's brain retired: the rows go behind a committed archive
   * and the archive is published. A thread held in memory alone has nothing
   * on disk to archive, so forgetting its lines is the whole erasure and
   * answers as published.
   */
  /**
   * The conversation's durable Clear cutoff as the store holds it now, in
   * the store's own order behind every request already sent and ahead of
   * every one sent after; nothing when the store could not answer. A thread
   * held in memory alone has no durable cutoff and answers an absent one.
   */
  historyCutoff: (sessionKey: SessionKey) => Promise<CutoffBefore | undefined>;
  eraseHistory: (
    sessionKey: SessionKey,
    now: number,
    keepSessionId: string | undefined,
    cutoffBefore: number | undefined,
  ) => Promise<HistoryErasure | undefined>;
  restoreArchive: (archiveId: string) => Promise<RestoreOutcome>;
  /** One maintenance pass, with the conversations that must be kept whatever their age. */
  runMaintenance: (preserve: readonly SessionKey[]) => Promise<MaintenanceReport | undefined>;
  /** Refreshes the directory from the store and tells every window. */
  refreshDirectory: () => Promise<void>;
}

const THREAD_NAME_PREFIX = "Thread";

export function wireRuntimeStore(dependencies: RuntimeStoreWiringDependencies): RuntimeStoreWiring {
  let runtimeStore: RuntimeStoreClient | undefined;
  const client = (): RuntimeStoreClient => {
    runtimeStore ??= new RuntimeStoreClient(dependencies.createWorker());
    return runtimeStore;
  };

  const threads = new Map<SessionKey, ConversationThread<WebContents>>();
  const temporary = new Map<SessionKey, ConversationRecord>();
  let stored: readonly ConversationRecord[] = [];
  let archives: readonly HistoryArchiveRecord[] = [];

  const memoryStores = new Map<SessionKey, MemoryHistoryStore>();
  const memoryThread = (sessionKey: SessionKey) => {
    const store = new MemoryHistoryStore();
    memoryStores.set(sessionKey, store);
    return new ConversationThread<WebContents>({
      store,
      now: dependencies.now,
      onChanged: (entries, except) => dependencies.onHistoryChanged(sessionKey, entries, except),
      report: dependencies.report,
    });
  };

  const thread = (sessionKey: SessionKey = MAIN_SESSION_KEY): ConversationThread<WebContents> => {
    let held = threads.get(sessionKey);
    if (held) return held;
    held =
      dependencies.persistent && !temporary.has(sessionKey)
        ? new ConversationThread<WebContents>({
            store: {
              appendHistory: (entries, now) => client().appendHistory(sessionKey, entries, now),
            },
            now: dependencies.now,
            onChanged: (entries, except) =>
              dependencies.onHistoryChanged(sessionKey, entries, except),
            report: dependencies.report,
          })
        : memoryThread(sessionKey);
    threads.set(sessionKey, held);
    return held;
  };

  const directory = (): ConversationDirectorySnapshot => ({
    entries: [...stored, ...temporary.values()],
    archives,
  });
  const announce = () => dependencies.onDirectoryChanged(directory());

  const refreshDirectory = async (): Promise<void> => {
    if (dependencies.persistent) {
      [stored, archives] = await Promise.all([
        client().listConversations(),
        client().listArchives(),
      ]);
    }
    announce();
  };

  const restoreThread = async (sessionKey: SessionKey): Promise<void> => {
    const [entries, clearedAt] = await Promise.all([
      client().listHistory(sessionKey, dependencies.now()),
      client().historyClearedAt(sessionKey),
    ]);
    thread(sessionKey).restore(entries, clearedAt);
  };

  let rememberedFacts: readonly RememberedFact[] = [];
  let factMutations: Promise<unknown> = Promise.resolve();

  // A run with nothing on disk still lists main, so the selector has a conversation to stand on.
  if (!dependencies.persistent) {
    stored = [
      {
        sessionKey: MAIN_SESSION_KEY,
        kind: CONVERSATION_KIND.MAIN,
        name: MAIN_CONVERSATION_NAME,
        createdAt: 0,
        lastActivityAt: 0,
      },
    ];
  }

  /** A temporary thread's envelope: held in this process for as long as the brain over it stands, and gone with it. */
  const memoryRepository = (): BrainStateRepository => {
    let record: string | undefined;
    return brainStateRepositoryFromStorage({
      read: () => record,
      write: (contents) => {
        record = contents;
        return true;
      },
    });
  };

  const holds = (sessionKey: SessionKey) =>
    temporary.has(sessionKey) || stored.some((record) => record.sessionKey === sessionKey);

  const writeRememberedFacts = async (facts: readonly RememberedFact[]): Promise<boolean> => {
    if (!dependencies.persistent) return false;
    let persisted: boolean;
    try {
      persisted = await client().replacePersonalFacts(facts);
    } catch (error) {
      dependencies.report(
        `Could not persist Luke's memory: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    if (!persisted) return false;
    rememberedFacts = facts;
    return true;
  };

  return {
    client,
    thread,
    brainStateRepository: (sessionKey = MAIN_SESSION_KEY) =>
      temporary.has(sessionKey) ? memoryRepository() : client().brainStateRepository(sessionKey),
    open: async () => {
      const agentRoot = dependencies.agentRoot();
      dependencies.ensureDirectory(agentRoot);
      await client().open({
        agentRoot,
        agentId: DEFAULT_AGENT_ID,
        sessionKey: MAIN_SESSION_KEY,
        conversationName: MAIN_CONVERSATION_NAME,
        now: dependencies.now(),
      });
    },
    restore: async () => {
      await refreshDirectory();
      // Every conversation's thread, archived ones included: an archived
      // thread is still shown, read-only, when the developer selects it.
      await Promise.all(stored.map((record) => restoreThread(record.sessionKey)));
      rememberedFacts = await client().personalFacts();
    },
    rememberedFacts: () => rememberedFacts,
    mutateRememberedFacts: (work) => {
      const mutation = factMutations.then(
        () => work(rememberedFacts, writeRememberedFacts),
        () => work(rememberedFacts, writeRememberedFacts),
      );
      factMutations = mutation.catch(() => undefined);
      return mutation;
    },
    recordConversationEntry: (
      entry,
      recordedAt = dependencies.now(),
      sessionKey = MAIN_SESSION_KEY,
    ) => {
      if (!dependencies.persistent && !temporary.has(sessionKey)) return Promise.resolve(false);
      if (!holds(sessionKey)) return Promise.resolve(false);
      return thread(sessionKey).append([
        { ...entry, recordedAt, eventId: entry.eventId ?? dependencies.createEventId() },
      ]);
    },
    directory,
    holds,
    createThread: async (isTemporary) => {
      const now = dependencies.now();
      const ordinal =
        stored.filter((record) => record.kind === CONVERSATION_KIND.THREAD).length +
        temporary.size +
        1;
      const name = `${THREAD_NAME_PREFIX} ${ordinal}`;
      const sessionKey = threadSessionKey(dependencies.createEventId());
      if (isTemporary || !dependencies.persistent) {
        const record: ConversationRecord = {
          sessionKey,
          kind: CONVERSATION_KIND.THREAD,
          name,
          createdAt: now,
          lastActivityAt: now,
          temporary: true,
        };
        temporary.set(sessionKey, record);
        threads.set(sessionKey, memoryThread(sessionKey));
        announce();
        return record;
      }
      const created = await client().createConversation({
        agentId: DEFAULT_AGENT_ID,
        sessionKey,
        name,
        kind: CONVERSATION_KIND.THREAD,
        now,
      });
      await refreshDirectory();
      return created;
    },
    archive: async (sessionKey) => {
      // Archiving preserves history, and a temporary thread has nowhere to
      // preserve it: the ask is refused and the thread left exactly as it was.
      if (temporary.has(sessionKey) || !dependencies.persistent) return false;
      const archived = await client().archiveConversation(
        sessionKey,
        dependencies.now(),
        ARCHIVE_REASON.USER,
      );
      await refreshDirectory();
      return archived;
    },
    unarchive: async (sessionKey) => {
      if (temporary.has(sessionKey) || !dependencies.persistent) return false;
      const restored = await client().unarchiveConversation(sessionKey);
      if (restored) await restoreThread(sessionKey);
      await refreshDirectory();
      return restored;
    },
    historyCutoff: async (sessionKey) => {
      if (temporary.has(sessionKey) || !dependencies.persistent) return { value: undefined };
      try {
        return { value: await client().historyClearedAt(sessionKey) };
      } catch (error) {
        dependencies.report(
          `Could not read the conversation's cutoff: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
    },
    eraseHistory: async (sessionKey, now, keepSessionId, cutoffBefore) => {
      if (temporary.has(sessionKey) || !dependencies.persistent) {
        memoryStores.get(sessionKey)?.eraseAtOrBefore(now);
        return { published: true };
      }
      try {
        return await client().deleteConversationHistory(sessionKey, now, {
          keepSessionId,
          cutoffBefore: { value: cutoffBefore },
        });
      } catch (error) {
        dependencies.report(
          `Could not delete the conversation's history: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      } finally {
        await refreshDirectory();
      }
    },
    restoreArchive: async (archiveId) => {
      if (!dependencies.persistent) return RESTORE_OUTCOME.MISSING;
      const result = await client().restoreArchive(archiveId, DEFAULT_AGENT_ID, dependencies.now());
      if (result.outcome === RESTORE_OUTCOME.RESTORED && result.sessionKey) {
        await restoreThread(result.sessionKey);
        thread(result.sessionKey).announce();
      }
      await refreshDirectory();
      return result.outcome;
    },
    runMaintenance: async (preserve) => {
      if (!dependencies.persistent) return undefined;
      try {
        const report = await client().runMaintenance({ now: dependencies.now(), preserve });
        if (report.unpublishedArchives.length > 0) {
          dependencies.report(
            `${report.unpublishedArchives.length} history archive(s) could not be published; the next launch retries`,
          );
        }
        if (report.disk && report.disk.remainingPressureBytes > 0) {
          dependencies.report(
            `History storage is still ${report.disk.remainingPressureBytes} bytes over its target after cleanup; the rest is protected`,
          );
        }
        await refreshDirectory();
        return report;
      } catch (error) {
        dependencies.report(
          `History maintenance did not run: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
    },
    refreshDirectory,
  };
}
