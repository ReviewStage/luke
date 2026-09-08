import {
  BrainAgent,
  type BrainDelivery,
  BrainGenerationClock,
  type BrainRoster,
  type BrainStateRepository,
  BrainStateStore,
  type BrainTurnTraceRecord,
  responsesToolLoopRuntime,
} from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import type { ModelAdapter } from "@sidecar/runtime-contracts";
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
  /** The brain's envelope in the runtime store, read and written only through the store built here. */
  repository: BrainStateRepository;
  createId: () => string;
  report: (message: string) => void;
  traceTurn?: (record: BrainTurnTraceRecord) => void;
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt?: number,
  ) => boolean | Promise<boolean>;
  broadcastRequests: (snapshots: readonly BrainRequestSnapshot[]) => void;
  /** A run's end stands in History, written and marked: the moment its reply may be owed to the ear. */
  onEndPublished?: BrainIpcDependencies["onEndPublished"];
  /** The voice window's grants: claims and acknowledgements of offered replies, and the on-call grant. */
  replies?: BrainIpcDependencies["replies"];
  /** A generation ended — cleared, expired, or replaced — and its unspoken briefings go with it. */
  onGenerationReplaced: () => void;
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
  host: BrainHost;
  /** The brain that stands now, or nothing between transitions and on a run with no key. */
  current: () => BrainAgent | undefined;
  /**
   * The one writer of the brain's envelope, owned here and outliving every
   * agent built on it: a key or account change rebuilds the agent, never the
   * store, so two agents can never write the envelope past each other.
   */
  store: () => BrainStateStore;
  /**
   * Stands the brain up on the client the credential policy built, or down
   * when it built none. Runs wherever the policy is applied — launch, a key
   * stored or removed, an account transition — so the brain follows the
   * chosen source exactly as the voice does. Never in a fixture or capture
   * run, which observes nothing and sends nothing, and never past a closed
   * account gate.
   */
  rebuild: () => Promise<void>;
  registerIpc: (registration: BrainIpcRegistration) => void;
}

/**
 * The brain: one long-lived agent, woken by the hooks and by its own
 * scheduled look at the roster, asked things by the developer, and answering
 * with briefings for the voice and acts for the performer. Nothing here
 * detects a change for it — no status edge, no notice — because the brain
 * notices changes itself, against its own memory. Built by `rebuild`
 * whenever the credential policy is applied, on whichever model adapter the
 * policy chose: the developer's own OpenAI key directly, or Luke's hosted
 * service on the signed-in account. With neither there is no brain, nothing
 * is announced, and an ask is answered with the honest refusal.
 */
export function wireBrain(dependencies: BrainWiringDependencies): BrainWiring {
  // The standing follower's publication, awaited by a wait that found its run
  // ended: the end is said only once the follower has written and marked it.
  let publicationSettled: () => Promise<void> = () => Promise.resolve();
  const host = new BrainHost({
    follow: (agent) =>
      followBrainRequests(agent, {
        recordConversationEntry: dependencies.recordConversationEntry,
        broadcastRequests: dependencies.broadcastRequests,
        ...(dependencies.onEndPublished
          ? { onEndPublished: dependencies.onEndPublished }
          : undefined),
        onPublication: (settled) => {
          publicationSettled = settled;
        },
      }),
    publishEmpty: () => dependencies.broadcastRequests([]),
  });
  const current = () => host.current();

  let stateStore: BrainStateStore | undefined;
  let generationClock: BrainGenerationClock | undefined;
  const store = (): BrainStateStore => {
    if (stateStore) return stateStore;
    stateStore = new BrainStateStore({
      repository: dependencies.repository,
      createGenerationId: dependencies.createId,
      report: dependencies.report,
    });
    // A generation that ends — cleared, expired, or replaced — takes its
    // unspoken briefings with it, the one in the mouth's hand included: they
    // are that generation's words, and an offer is not proof they were said.
    // The agent hears the same announcement and stands its runs down itself.
    stateStore.onReplaced(() => dependencies.onGenerationReplaced());
    // The generation's clock stands with the store, not with an agent: a
    // launch with no key or account, and an app left open after its agent was
    // retired, still see the generation die on time and the file replaced.
    generationClock = new BrainGenerationClock({ store: stateStore });
    void generationClock.start();
    return stateStore;
  };

  /**
   * The gauntlet every act the brain asks for runs, in this process: validated
   * against the roster, the issue board, the offered projects, the guide, or
   * the remembered facts as each stands at the moment of the act, then carried
   * by the performer. Only a turn the developer opened may act, and the
   * validators guard what it may act on.
   */
  const acts = createBrainActPerformer(dependencies.acts);

  const build = (model: ModelAdapter): BrainAgent =>
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
      store: store(),
      createRunId: dependencies.createId,
      ...(dependencies.traceTurn ? { trace: dependencies.traceTurn } : undefined),
      report: dependencies.report,
    });

  const rebuild = (): Promise<void> =>
    host.replace(() => {
      const model = dependencies.model();
      if (!model || !dependencies.runnable()) {
        dependencies.dropBriefings();
        return undefined;
      }
      return build(model);
    });

  const registerIpc = (registration: BrainIpcRegistration): void => {
    registerBrainIpc({
      ...registration,
      brain: current,
      recordConversationEntry: dependencies.recordConversationEntry,
      broadcastRequests: dependencies.broadcastRequests,
      publicationSettled: () => publicationSettled(),
      ...(dependencies.replies ? { replies: dependencies.replies } : undefined),
    });
  };

  return { host, current, store, rebuild, registerIpc };
}
