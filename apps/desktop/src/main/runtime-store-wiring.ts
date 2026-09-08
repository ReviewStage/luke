import type { RememberedFact } from "@sidecar/acts";
import type { BrainStateRepository, BrainStateStore } from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
} from "@sidecar/runtime-contracts";
import { RuntimeStoreClient, type RuntimeStorePort } from "@sidecar/runtime-store";
import type { WebContents } from "electron";
import { clearConversationAndBrain } from "./brain/conversation-clear";
import { ConversationThread, MemoryHistoryStore } from "./conversation-thread";

/**
 * The runtime store as the desktop composes it: one database under the
 * agent's own directory, spoken to on its own worker thread so the main
 * thread never waits on the disk. It holds the brain's envelope, the
 * conversation, and the remembered facts, and it is opened once at launch in
 * every run that observes providers. A fixture or capture run has nothing on
 * disk: the thread lives in memory under the same append rule, the facts are
 * empty and refuse every write, and nothing is recorded from this process.
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
  /** Hears the thread as every window should now draw it, less the window that reported the change. */
  onHistoryChanged: (entries: readonly ConversationEntry[], except?: WebContents) => void;
  report: (message: string) => void;
}

export interface RuntimeStoreWiring {
  /** The client, started on first use; the worker's answers stand behind every method below. */
  client: () => RuntimeStoreClient;
  /** The conversation every panel is shown, relayed between windows through this process. */
  thread: ConversationThread<WebContents>;
  /** The brain's envelope in the store, for the brain wiring to build its one writer on. */
  brainStateRepository: () => BrainStateRepository;
  /** Opens the database for this launch. */
  open: () => Promise<void>;
  /** Restores the thread, its Clear cutoff, and the remembered facts from the store, once opened. */
  restore: () => Promise<void>;
  rememberedFacts: () => readonly RememberedFact[];
  /** The remembered entries' write back through the store; answers whether the list persisted. */
  writeRememberedFacts: (facts: readonly RememberedFact[]) => Promise<boolean>;
  /**
   * Records a line in the shared conversation from the main process — the ask
   * a carried act was, a typed ask the brain accepted, a run's end — minting
   * the line's id here, since this process is its writer.
   */
  recordConversationEntry: (entry: ConversationEntry, recordedAt?: number) => Promise<boolean>;
  /**
   * The History Clear a panel pressed: the cutoff raised and the relay
   * emptied for every panel first, so no context, publication, or report can
   * carry the old lines whatever the disk does; the brain's generation fenced
   * and marked erased; then the thread's lines at or before the cutoff
   * deleted from the store. Answers whether every step landed, which is what
   * the panel reports; the fence stands either way. What Luke separately
   * remembers about the developer is another table under another rule, and
   * a Clear does not reach it.
   */
  clearConversation: (store: Pick<BrainStateStore, "clear">) => Promise<boolean>;
}

export function wireRuntimeStore(dependencies: RuntimeStoreWiringDependencies): RuntimeStoreWiring {
  let runtimeStore: RuntimeStoreClient | undefined;
  const client = (): RuntimeStoreClient => {
    runtimeStore ??= new RuntimeStoreClient(dependencies.createWorker());
    return runtimeStore;
  };

  const thread = new ConversationThread<WebContents>({
    store: dependencies.persistent
      ? {
          appendHistory: (entries, now) => client().appendHistory(MAIN_SESSION_KEY, entries, now),
        }
      : new MemoryHistoryStore(),
    now: dependencies.now,
    onChanged: dependencies.onHistoryChanged,
    report: dependencies.report,
  });

  let rememberedFacts: readonly RememberedFact[] = [];

  return {
    client,
    thread,
    brainStateRepository: () => client().brainStateRepository(MAIN_SESSION_KEY),
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
      thread.restore(
        await client().listHistory(MAIN_SESSION_KEY, dependencies.now()),
        await client().historyClearedAt(MAIN_SESSION_KEY),
      );
      rememberedFacts = await client().personalFacts();
    },
    rememberedFacts: () => rememberedFacts,
    writeRememberedFacts: async (facts) => {
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
    },
    recordConversationEntry: (entry, recordedAt = dependencies.now()) => {
      if (!dependencies.persistent) return Promise.resolve(false);
      return thread.append([
        { ...entry, recordedAt, eventId: entry.eventId ?? dependencies.createEventId() },
      ]);
    },
    clearConversation: (store) => {
      if (!dependencies.persistent) {
        thread.fence(dependencies.now());
        return Promise.resolve(true);
      }
      let cutoff: number | undefined;
      return clearConversationAndBrain({
        store,
        now: dependencies.now,
        fence: (clearedAt) => {
          cutoff = clearedAt;
          thread.fence(clearedAt);
        },
        eraseConversation: async () => {
          if (cutoff === undefined) return false;
          try {
            return await client().clearHistoryAtOrBefore(MAIN_SESSION_KEY, cutoff);
          } catch {
            return false;
          }
        },
        report: dependencies.report,
      });
    },
  };
}
