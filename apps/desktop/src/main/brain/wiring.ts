import {
  BrainAgent,
  type BrainDelivery,
  BrainGenerationClock,
  type BrainRoster,
  type BrainStateRepository,
  type BrainStateStorage,
  BrainStateStore,
  type BrainTurnTraceRecord,
  responsesToolLoopRuntime,
} from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import type { ModelAdapter } from "@sidecar/runtime-contracts";
import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime-contracts";
import {
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_LOCATION,
  type Session,
  type SessionIdentity,
} from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type { BrainRequestSnapshot } from "#shared/wire/brain";
import { type BrainActPerformerDependencies, createBrainActPerformer } from "./act-performer";
import { BrainHost } from "./host";
import {
  type BrainIpcDependencies,
  type BrainSubmitters,
  followBrainRequests,
  registerBrainIpc,
} from "./ipc";

/** What a provider adapter answers a transcript read with, by the session's own id. */
interface TranscriptReader {
  readTranscriptSince(
    providerSessionId: string,
    cursor: string | undefined,
  ): Promise<ProviderTranscriptSinceResult>;
  readTranscript(providerSessionId: string): Promise<ProviderTranscriptResult>;
}

export interface BrainWiringDependencies {
  /** A conversation's envelope in the runtime store, read and written only through the store built here. */
  repositoryFor: (sessionKey: SessionKey) => BrainStateRepository;
  /** Whether a conversation is a temporary thread, whose envelope lives in this process alone. */
  isTemporary: (sessionKey: SessionKey) => boolean;
  createId: () => string;
  report: (message: string) => void;
  traceTurn?: (record: BrainTurnTraceRecord) => void;
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt: number,
    sessionKey: SessionKey,
  ) => boolean | Promise<boolean>;
  broadcastRequests: (snapshots: readonly BrainRequestSnapshot[]) => void;
  /** A run's end stands in History, written and marked: the moment its reply may be owed to the ear. */
  onEndPublished?: BrainIpcDependencies["onEndPublished"];
  /** The voice window's grants: claims and acknowledgements of offered replies, and the on-call grant. */
  replies?: BrainIpcDependencies["replies"];
  /** A conversation's generation ended — reset, expired, or replaced — and its unspoken briefings and replies go with it. */
  onGenerationReplaced: (sessionKey: SessionKey) => void;
  acts: BrainActPerformerDependencies;
  roster: () => BrainRoster;
  standingContext: () => string;
  adapterFor: (providerId: string) => TranscriptReader | undefined;
  session: (identity: SessionIdentity) => Session | undefined;
  deliver: (delivery: BrainDelivery) => Promise<void>;
  /** The model adapter the credential policy built, or nothing when it built none. */
  model: () => ModelAdapter | undefined;
  /** Whether a brain may stand at all: observing, on the network, and past the account gate. */
  runnable: () => boolean;
  dropBriefings: () => void;
}

export interface BrainIpcRegistration {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  submitters: BrainSubmitters;
}

export interface BrainWiring {
  /** Main's host, the one every observation reaches. */
  readonly host: BrainHost;
  /** The brain of one conversation as it stands now, main's by default; nothing between transitions and on a run with no key. */
  current: (sessionKey?: SessionKey) => BrainAgent | undefined;
  /** The brain holding the run named, whichever conversation it is in. */
  agentForRun: (runId: string) => BrainAgent | undefined;
  /** The conversation holding the run named. */
  conversationForRun: (runId: string) => SessionKey | undefined;
  /**
   * The one writer of a conversation's envelope, owned here and outliving
   * every agent built on it: a key or account change rebuilds the agents,
   * never the stores, so two agents can never write one envelope past each other.
   */
  store: (sessionKey?: SessionKey) => BrainStateStore;
  /** Whether any conversation's standing generation is the one named. */
  holdsGeneration: (generationId: string) => boolean;
  /** Every run every standing brain holds, main's first. */
  allRequests: () => readonly BrainRequestSnapshot[];
  /** The conversations with a run under way, which maintenance must keep. */
  busyConversations: () => readonly SessionKey[];
  /**
   * Stands every open conversation's brain up on the client the credential
   * policy built, or down when it built none. Runs wherever the policy is
   * applied — launch, a key stored or removed, an account transition — so
   * the brains follow the chosen source exactly as the voice does. Never in
   * a fixture or capture run, which observes nothing and sends nothing, and
   * never past a closed account gate.
   */
  rebuild: () => Promise<void>;
  /** Withdraws every standing brain now; their stops are awaited by the next rebuild. */
  retire: () => void;
  /** Opens a conversation for asks: its store is built and, when a model stands, its brain. */
  openConversation: (sessionKey: SessionKey) => Promise<void>;
  /**
   * Retires a conversation's brain, drains its publication, and forgets its
   * store, so nothing of the old lifetime can write. An archive closes a
   * thread for good; a deletion closes any conversation, main included, and
   * opens it again over the emptied rows.
   */
  closeConversation: (sessionKey: SessionKey) => Promise<void>;
  /** Start fresh: a new lifetime for the conversation, its history and transcript untouched. */
  resetConversation: (sessionKey: SessionKey) => Promise<boolean>;
  registerIpc: (registration: BrainIpcRegistration) => void;
}

/** A temporary thread's envelope, held in this process and gone with it. */
class MemoryEnvelopeStorage implements BrainStateStorage {
  #record: string | undefined;
  read(): string | undefined {
    return this.#record;
  }
  write(contents: string): boolean {
    this.#record = contents;
    return true;
  }
}

interface OpenConversation {
  host: BrainHost;
  store: BrainStateStore;
  clock: BrainGenerationClock;
  unsubscribe: () => void;
}

/**
 * The brains: one long-lived agent per open conversation, main's woken by
 * the hooks and by its own scheduled look at the roster, every one asked
 * things by the developer, and answering with briefings for the voice and
 * acts for the performer. Nothing here detects a change for a brain — no
 * status edge, no notice — because the brain notices changes itself,
 * against its own memory. Built by `rebuild` whenever the credential policy
 * is applied, on whichever model adapter the policy chose: the developer's
 * own OpenAI key directly, or Luke's hosted service on the signed-in
 * account. With neither there is no brain, nothing is announced, and an ask
 * is answered with the honest refusal.
 */
export function wireBrain(dependencies: BrainWiringDependencies): BrainWiring {
  const conversations = new Map<SessionKey, OpenConversation>();
  const latestRecords = new Map<SessionKey, readonly BrainRequestSnapshot[]>();
  // Each standing follower's publication, awaited by a wait that found its
  // run ended: the end is said only once the follower has written and marked it.
  const publications = new Map<SessionKey, () => Promise<void>>();

  const allRequests = (): readonly BrainRequestSnapshot[] => {
    const main = latestRecords.get(MAIN_SESSION_KEY) ?? [];
    const rest = [...latestRecords.entries()]
      .filter(([sessionKey]) => sessionKey !== MAIN_SESSION_KEY)
      .flatMap(([, records]) => records);
    return [...main, ...rest];
  };
  const broadcast = () => dependencies.broadcastRequests(allRequests());

  const openConversation = (sessionKey: SessionKey): OpenConversation => {
    const held = conversations.get(sessionKey);
    if (held) return held;
    const host = new BrainHost({
      follow: (agent) =>
        followBrainRequests(
          agent,
          {
            recordConversationEntry: dependencies.recordConversationEntry,
            broadcastRequests: (records) => {
              latestRecords.set(sessionKey, records);
              broadcast();
            },
            ...(dependencies.onEndPublished
              ? { onEndPublished: dependencies.onEndPublished }
              : undefined),
            onPublication: (settled) => {
              publications.set(sessionKey, settled);
            },
          },
          sessionKey,
        ),
      publishEmpty: () => {
        latestRecords.delete(sessionKey);
        broadcast();
      },
    });
    const store = new BrainStateStore(
      dependencies.isTemporary(sessionKey)
        ? {
            storage: new MemoryEnvelopeStorage(),
            createGenerationId: dependencies.createId,
            report: dependencies.report,
          }
        : {
            repository: dependencies.repositoryFor(sessionKey),
            createGenerationId: dependencies.createId,
            report: dependencies.report,
          },
    );
    // A generation that ends — reset, expired, or replaced — takes its
    // unspoken briefings and replies with it, the one in the mouth's hand
    // included: they are that generation's words, and an offer is not proof
    // they were said. The agent hears the same announcement and stands its
    // runs down itself.
    const unsubscribe = store.onReplaced(() => dependencies.onGenerationReplaced(sessionKey));
    // The generation's clock stands with the store, not with an agent: a
    // launch with no key or account, and an app left open after its agent was
    // retired, still see the generation die on time and the file replaced.
    const clock = new BrainGenerationClock({ store });
    void clock.start();
    const opened: OpenConversation = { host, store, clock, unsubscribe };
    conversations.set(sessionKey, opened);
    return opened;
  };

  openConversation(MAIN_SESSION_KEY);
  const current = (sessionKey: SessionKey = MAIN_SESSION_KEY) =>
    conversations.get(sessionKey)?.host.current();
  const conversationForRun = (runId: string): SessionKey | undefined => {
    for (const [sessionKey, records] of latestRecords) {
      if (records.some((record) => record.runId === runId)) return sessionKey;
    }
    return undefined;
  };
  const agentForRun = (runId: string): BrainAgent | undefined => {
    const sessionKey = conversationForRun(runId);
    return sessionKey === undefined ? undefined : conversations.get(sessionKey)?.host.current();
  };

  /**
   * The gauntlet every act the brain asks for runs, in this process: validated
   * against the roster, the issue board, the offered projects, the guide, or
   * the remembered facts as each stands at the moment of the act, then carried
   * by the performer. Only a turn the developer opened may act, and the
   * validators guard what it may act on.
   */
  const acts = createBrainActPerformer(dependencies.acts);

  // The runtime this build ships is composed here, once per agent: the tool
  // loop over the Responses context engine on whichever adapter the policy
  // chose. A different runtime would be a different composition at this line
  // and nothing else in the host.
  const build = (model: ModelAdapter, store: BrainStateStore): BrainAgent =>
    new BrainAgent({
      runtime: responsesToolLoopRuntime(model),
      acts,
      roster: dependencies.roster,
      standingContext: dependencies.standingContext,
      readTranscriptSince: (identity, cursor) => {
        const adapter = dependencies.adapterFor(identity.providerId);
        if (!adapter) {
          return Promise.resolve({
            status: ACT_RESULT_STATUS.UNSUPPORTED,
            reason: "That session's provider is not connected.",
          });
        }
        return adapter.readTranscriptSince(identity.providerSessionId, cursor);
      },
      readTranscript: (identity) => {
        const session = dependencies.session(identity);
        const adapter = dependencies.adapterFor(identity.providerId);
        if (!session || !adapter) {
          return Promise.resolve({
            status: ACT_RESULT_STATUS.REJECTED,
            reason: "No observed session matches that identity.",
          });
        }
        if (session.location !== SESSION_LOCATION.LOCAL) {
          return Promise.resolve({
            status: ACT_RESULT_STATUS.UNSUPPORTED,
            reason: "A cloud session's conversation lives with its provider, not on this machine.",
          });
        }
        return adapter.readTranscript(identity.providerSessionId);
      },
      deliver: dependencies.deliver,
      store,
      createRunId: dependencies.createId,
      ...(dependencies.traceTurn ? { trace: dependencies.traceTurn } : undefined),
      report: dependencies.report,
    });

  const rebuildOne = (sessionKey: SessionKey, opened: OpenConversation): Promise<void> =>
    opened.host.replace(() => {
      const model = dependencies.model();
      if (!model || !dependencies.runnable()) {
        if (sessionKey === MAIN_SESSION_KEY) dependencies.dropBriefings();
        return undefined;
      }
      return build(model, opened.store);
    });

  const rebuild = async (): Promise<void> => {
    await Promise.all(
      [...conversations.entries()].map(([sessionKey, opened]) => rebuildOne(sessionKey, opened)),
    );
  };

  const retire = (): void => {
    for (const opened of conversations.values()) opened.host.retire();
  };

  const registerIpc = (registration: BrainIpcRegistration): void => {
    registerBrainIpc({
      ...registration,
      brain: current,
      brainForRun: agentForRun,
      allRequests,
      recordConversationEntry: dependencies.recordConversationEntry,
      broadcastRequests: dependencies.broadcastRequests,
      publicationSettled: async () => {
        await Promise.all([...publications.values()].map((settled) => settled()));
      },
      ...(dependencies.replies ? { replies: dependencies.replies } : undefined),
    });
  };

  return {
    get host() {
      return openConversation(MAIN_SESSION_KEY).host;
    },
    current,
    agentForRun,
    conversationForRun,
    store: (sessionKey = MAIN_SESSION_KEY) => openConversation(sessionKey).store,
    holdsGeneration: (generationId) =>
      [...conversations.values()].some((opened) => opened.store.holdsGeneration(generationId)),
    allRequests,
    busyConversations: () =>
      [...latestRecords.entries()]
        .filter(([, records]) =>
          records.some((record) => record.status === "queued" || record.status === "running"),
        )
        .map(([sessionKey]) => sessionKey),
    rebuild,
    retire,
    openConversation: async (sessionKey) => {
      const opened = openConversation(sessionKey);
      if (!opened.host.current()) await rebuildOne(sessionKey, opened);
    },
    closeConversation: async (sessionKey) => {
      const opened = conversations.get(sessionKey);
      if (!opened) return;
      conversations.delete(sessionKey);
      // The replacement with nothing awaits every retirement's drain, so the
      // follower has written its last interruption before the store is let go.
      opened.host.retire();
      await opened.host.replace(() => undefined);
      opened.clock.stop();
      opened.unsubscribe();
      latestRecords.delete(sessionKey);
      publications.delete(sessionKey);
      broadcast();
    },
    resetConversation: (sessionKey) => openConversation(sessionKey).store.reset(),
    registerIpc,
  };
}
