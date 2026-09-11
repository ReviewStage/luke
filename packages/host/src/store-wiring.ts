import type { RememberedFact } from "@sidecar/actions";
import type { BrainPersistedState, BrainStateRepository } from "@sidecar/brain";
import {
  type DeletionOutcome,
  type MaintenanceReport,
  type NotebookEntry,
  type NotebookMutation,
  type StoreClient,
  type StorePort,
  storeClient,
} from "@sidecar/brain/store";
import { type ChildStore, memoryChildStore } from "@sidecar/runtime";
import {
  ARCHIVE_REASON,
  CONVERSATION_KIND,
  type ConversationKind,
  type ConversationRecord,
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import type { CutoffBefore } from "./brain/conversation-deletion.js";
import { ConversationThread, MemoryConversationStore } from "./conversation-thread.js";

/**
 * The brain's store as the host composes it: one database under the
 * agent's own directory, spoken to on its own worker thread so the main
 * thread never waits on the disk. It holds every conversation's envelope,
 * thread, and transcript, the notebook's provenance and search index, and
 * the archives of deleted history, and it is opened once at launch in every
 * run that observes providers. A fixture or capture run has nothing on disk:
 * its threads live in memory under the same append rule, the notebook is
 * empty and refuses every write, and nothing is recorded from this process.
 *
 * The conversation directory is held here too: what the store lists, and
 * beside it the conversations a run with nothing on disk holds in this
 * process alone, which are gone at the next launch.
 */
export interface StoreWiringDependencies {
  /** Whether this run keeps anything on disk; a fixture or capture run does not. */
  persistent: boolean;
  createWorker: () => StorePort;
  /** The agent's directory under Luke's application data, created on open. */
  agentRoot: () => string;
  /** The agent's identity workspace, the notebook's root; the worker writes USER.md there. */
  workspaceDirectory: () => string;
  ensureDirectory: (directory: string) => void;
  now: () => number;
  createEventId: () => string;
  /** Hears one conversation's thread as every window should now draw it, less the window that reported the change. */
  onConversationChanged: (
    sessionKey: SessionKey,
    entries: readonly ConversationEntry[],
    except?: ConversationReporter,
  ) => void;
  /** Hears the directory whenever a conversation is created, archived, or deleted. */
  onDirectoryChanged: (entries: readonly ConversationRecord[]) => void;
  report: (message: string) => void;
}

/**
 * What names the window a Conversation change came from: an opaque token the
 * client minted for that window, carried on its report and echoed on the
 * change so the client can skip the window that already holds the lines.
 * The host reads nothing into it.
 */
type ConversationReporter = string;

/** How the store's side of a deletion ended; the archive itself stays with the store. */
export type ConversationErasure = Pick<DeletionOutcome, "published">;

export interface StoreWiring {
  client: () => StoreClient;
  /** One conversation's thread, relayed between windows through this process; created on first use. */
  thread: (sessionKey?: SessionKey) => ConversationThread;
  /** A conversation's envelope, for the brain wiring to build its writer on: the store's, or memory alone where nothing is kept on disk. */
  brainStateRepository: (sessionKey?: SessionKey) => BrainStateRepository;
  open: () => Promise<void>;
  restore: () => Promise<void>;
  /**
   * The notebook's entries as last read from the worker — the facts Luke
   * remembers about the developer, each with the id the model may name — for
   * the standing context and the validators. Refreshed after every write and
   * whenever the notebook's files are reconciled.
   */
  rememberedFacts: () => readonly RememberedFact[];
  refreshNotebook: () => Promise<readonly NotebookEntry[]>;
  /**
   * The notebook's two writes. Each is one request to the worker, which
   * serializes every mutation of the workspace, so two conversations
   * remembering at once cannot drop each other's entry; the answer says
   * whether the words now stand or the entry is gone.
   */
  rememberNotebookEntry: (ask: {
    id: string;
    words: string;
    replaces?: string;
  }) => Promise<boolean>;
  forgetNotebookEntry: (id: string) => Promise<boolean>;
  /**
   * Records a line in one conversation from the main process — the ask a
   * carried action was, a typed ask the brain accepted, a run's end — minting
   * the line's id here, since this process is its writer.
   */
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt?: number,
    sessionKey?: SessionKey,
  ) => Promise<boolean>;
  directory: () => readonly ConversationRecord[];
  holds: (sessionKey: SessionKey) => boolean;
  /** Whether the key names a conversation held in memory alone for this run, which is never a recall source. */
  isTemporary: (sessionKey: SessionKey) => boolean;
  /**
   * Lists a runtime-owned conversation — an observed session's — creating
   * its row when none stands and bringing an archived one back, so the
   * selector shows it and its thread takes lines. In a run with nothing on
   * disk it is held in memory alone and is gone at the next launch.
   */
  ensureConversation: (
    sessionKey: SessionKey,
    kind: ConversationKind,
    name: string,
  ) => Promise<ConversationRecord>;
  /** Closes the worker, once opened; the host's last action at a shutdown. */
  close: () => Promise<void>;
  /** The child service's records and completions; a run with nothing on disk keeps them in memory alone. */
  childStore: () => ChildStore;
  /** Retires a conversation's row, keeping its history: the brain's own cleanup of an ended child. */
  archive: (sessionKey: SessionKey) => Promise<boolean>;
  /**
   * The conversation's durable Clear cutoff as the store holds it now, in
   * the store's own order behind every request already sent and ahead of
   * every one sent after; nothing when the store could not answer. A thread
   * held in memory alone has no durable cutoff and answers an absent one.
   */
  conversationCutoff: (sessionKey: SessionKey) => Promise<CutoffBefore | undefined>;
  /**
   * The store side of Delete conversation, called once the thread is fenced and
   * the conversation's brain retired: the rows go behind a committed archive
   * and the archive is published. A thread held in memory alone has nothing
   * on disk to archive, so forgetting its lines is the whole erasure and
   * answers as published.
   */
  eraseConversation: (
    sessionKey: SessionKey,
    now: number,
    keepSessionId: string | undefined,
    cutoffBefore: number | undefined,
  ) => Promise<ConversationErasure | undefined>;
  runMaintenance: (preserve: readonly SessionKey[]) => Promise<MaintenanceReport | undefined>;
  refreshDirectory: () => Promise<void>;
}

export function wireStore(dependencies: StoreWiringDependencies): StoreWiring {
  let store: StoreClient | undefined;
  const client = (): StoreClient => {
    store ??= storeClient(dependencies.createWorker());
    return store;
  };

  const threads = new Map<SessionKey, ConversationThread>();
  const temporary = new Map<SessionKey, ConversationRecord>();
  let stored: readonly ConversationRecord[] = [];

  const memoryStores = new Map<SessionKey, MemoryConversationStore>();
  const memoryThread = (sessionKey: SessionKey) => {
    const store = new MemoryConversationStore();
    memoryStores.set(sessionKey, store);
    return new ConversationThread({
      store,
      now: dependencies.now,
      onChanged: (entries, except) =>
        dependencies.onConversationChanged(sessionKey, entries, except),
      report: dependencies.report,
    });
  };

  const thread = (sessionKey: SessionKey = MAIN_SESSION_KEY): ConversationThread => {
    let held = threads.get(sessionKey);
    if (held) return held;
    held =
      dependencies.persistent && !temporary.has(sessionKey)
        ? new ConversationThread({
            store: {
              appendConversation: (entries, now) =>
                client().ask("conversation.append", { sessionKey, entries, now }),
            },
            now: dependencies.now,
            onChanged: (entries, except) =>
              dependencies.onConversationChanged(sessionKey, entries, except),
            report: dependencies.report,
          })
        : memoryThread(sessionKey);
    threads.set(sessionKey, held);
    return held;
  };

  const directory = (): readonly ConversationRecord[] => [...stored, ...temporary.values()];
  const announce = () => dependencies.onDirectoryChanged(directory());

  const refreshDirectory = async (): Promise<void> => {
    if (dependencies.persistent) stored = await client().ask("conversations.list", {});
    announce();
  };

  const restoreThread = async (sessionKey: SessionKey): Promise<void> => {
    const [entries, clearedAt] = await Promise.all([
      client().ask("conversation.list", { sessionKey, now: dependencies.now() }),
      client().ask("conversation.cutoff", { sessionKey }),
    ]);
    thread(sessionKey).restore(entries, clearedAt);
  };

  let notebookEntries: readonly NotebookEntry[] = [];
  const rememberedFacts = (): readonly RememberedFact[] =>
    notebookEntries.map((entry) => ({ id: entry.id, words: entry.words }));

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

  /** A memory-held conversation's envelope: kept for as long as the brain over it stands, and gone with it. */
  const memoryRepository = (): BrainStateRepository => {
    let held: BrainPersistedState | undefined;
    return {
      load: () => (held ? { state: held } : {}),
      save: (state) => {
        held = state;
        return true;
      },
    };
  };

  /**
   * A conversation this process holds alone: every conversation of a run
   * that keeps nothing on disk. Its history lives in memory with it and is
   * gone at the next launch.
   */
  const temporaryRecord = (
    sessionKey: SessionKey,
    kind: ConversationKind,
    name: string,
    now: number,
  ): ConversationRecord => {
    const record: ConversationRecord = {
      sessionKey,
      kind,
      name,
      createdAt: now,
      lastActivityAt: now,
      temporary: true,
    };
    temporary.set(sessionKey, record);
    threads.set(sessionKey, memoryThread(sessionKey));
    announce();
    return record;
  };

  const unarchive = async (sessionKey: SessionKey): Promise<boolean> => {
    if (temporary.has(sessionKey) || !dependencies.persistent) return false;
    const restored = await client().ask("conversations.unarchive", { sessionKey });
    if (restored) await restoreThread(sessionKey);
    await refreshDirectory();
    return restored;
  };

  const holds = (sessionKey: SessionKey) =>
    temporary.has(sessionKey) || stored.some((record) => record.sessionKey === sessionKey);

  const refreshNotebook = async (): Promise<readonly NotebookEntry[]> => {
    if (!dependencies.persistent) return notebookEntries;
    try {
      notebookEntries = await client().ask("notebook.list", { now: dependencies.now() });
    } catch (error) {
      dependencies.report(
        `Could not read Luke's notebook: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return notebookEntries;
  };
  const mutateNotebook = async (
    request: (store: StoreClient, now: number) => Promise<NotebookMutation>,
  ): Promise<boolean> => {
    if (!dependencies.persistent) return false;
    try {
      const mutation = await request(client(), dependencies.now());
      notebookEntries = mutation.entries;
      return mutation.ok;
    } catch (error) {
      dependencies.report(
        `Could not write Luke's notebook: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  };
  const rememberNotebookEntry = (ask: { id: string; words: string; replaces?: string }) =>
    mutateNotebook((store, now) => store.ask("notebook.remember", { ...ask, now }));
  const forgetNotebookEntry = (id: string) =>
    mutateNotebook((store, now) => store.ask("notebook.forget", { id, now }));

  const childStore = memoryChildStore();

  return {
    client,
    thread,
    close: async () => {
      if (!store) return;
      const held = store;
      store = undefined;
      await held.close().catch(() => undefined);
    },
    brainStateRepository: (sessionKey = MAIN_SESSION_KEY) =>
      dependencies.persistent && !temporary.has(sessionKey)
        ? client().brainStateRepository(sessionKey)
        : memoryRepository(),
    open: async () => {
      const agentRoot = dependencies.agentRoot();
      dependencies.ensureDirectory(agentRoot);
      await client().open({
        agentRoot,
        workspaceDirectory: dependencies.workspaceDirectory(),
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
      await refreshNotebook();
    },
    rememberedFacts,
    refreshNotebook,
    rememberNotebookEntry,
    forgetNotebookEntry,
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
    isTemporary: (sessionKey) => temporary.has(sessionKey),
    ensureConversation: async (sessionKey, kind, name) => {
      const now = dependencies.now();
      const held =
        temporary.get(sessionKey) ?? stored.find((record) => record.sessionKey === sessionKey);
      if (held && held.archivedAt === undefined) return held;
      if (!dependencies.persistent) return temporaryRecord(sessionKey, kind, name, now);
      if (held) {
        await unarchive(sessionKey);
        return stored.find((record) => record.sessionKey === sessionKey) ?? held;
      }
      const created = await client().ask("conversations.create", {
        agentId: DEFAULT_AGENT_ID,
        sessionKey,
        name,
        kind,
        now,
      });
      await refreshDirectory();
      return created;
    },
    childStore: () => (dependencies.persistent ? client().childStore() : childStore),
    archive: async (sessionKey) => {
      // Archiving preserves history, and a memory-held conversation has
      // nowhere to preserve it: the ask is refused and it is left as it was.
      if (temporary.has(sessionKey) || !dependencies.persistent) return false;
      const archived = await client().ask("conversations.archive", {
        sessionKey,
        now: dependencies.now(),
        reason: ARCHIVE_REASON.USER,
      });
      await refreshDirectory();
      return archived;
    },
    conversationCutoff: async (sessionKey) => {
      if (temporary.has(sessionKey) || !dependencies.persistent) return { value: undefined };
      try {
        return { value: await client().ask("conversation.cutoff", { sessionKey }) };
      } catch (error) {
        dependencies.report(
          `Could not read the conversation's cutoff: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
    },
    eraseConversation: async (sessionKey, now, keepSessionId, cutoffBefore) => {
      if (temporary.has(sessionKey) || !dependencies.persistent) {
        memoryStores.get(sessionKey)?.eraseAtOrBefore(now);
        return { published: true };
      }
      try {
        return await client().ask(
          "conversations.delete",
          keepSessionId === undefined
            ? { sessionKey, now, cutoffBefore: { value: cutoffBefore } }
            : { sessionKey, now, keepSessionId, cutoffBefore: { value: cutoffBefore } },
        );
      } catch (error) {
        dependencies.report(
          `Could not delete the conversation's history: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      } finally {
        await refreshDirectory();
      }
    },
    runMaintenance: async (preserve) => {
      if (!dependencies.persistent) return undefined;
      try {
        const report = await client().ask("maintenance.run", { now: dependencies.now(), preserve });
        if (report.unpublishedArchives.length > 0) {
          dependencies.report(
            `${report.unpublishedArchives.length} history archive(s) could not be published; the next launch retries`,
          );
        }
        if (report.disk && report.disk.remainingPressureBytes > 0) {
          dependencies.report(
            `Conversation storage is still ${report.disk.remainingPressureBytes} bytes over its target after cleanup; the rest is protected`,
          );
        }
        await refreshDirectory();
        return report;
      } catch (error) {
        dependencies.report(
          `Conversation maintenance did not run: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
    },
    refreshDirectory,
  };
}
