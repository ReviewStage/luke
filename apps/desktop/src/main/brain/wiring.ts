import {
  BRAIN_IDENTITY_LINE,
  BRAIN_INPUT_MARKER,
  BRAIN_TURN_KIND,
  BRAIN_WORKSPACE_SEEDS,
  BrainAgent,
  type BrainDelivery,
  BrainGenerationClock,
  type BrainRoster,
  type BrainStateRepository,
  BrainStateStore,
  type BrainTurnDescription,
  type BrainTurnPreparation,
  type BrainTurnTraceRecord,
  type BrainWorkspaceAccess,
  brainToolNotes,
  HOSTED_MODEL_ADAPTER_ID,
  OPENAI_MODEL_ADAPTER_ID,
  RESPONSES_CONTEXT_ENGINE_ID,
  registerBrainBuiltIns,
  resolveTurnToolPolicy,
  runOriginOf,
  TOOL_LOOP_RUNTIME,
} from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import {
  type BuiltPrompt,
  buildSystemPrompt,
  ConfigurationStore,
  CREDENTIAL_REFERENCE_KIND,
  type CredentialReference,
  createRuntimeRegistries,
  defaultAgentConfiguration,
  discoverSkills,
  eligibleSkills,
  gatherPromptFacts,
  loadSkill,
  type ResolvedConfiguration,
  type RuntimeRegistries,
  readWorkspaceFile,
  recentDailyNotes,
  type SkillDescriptor,
  seedWorkspace,
  type WorkspaceSeeding,
  writeWorkspaceFile,
} from "@sidecar/runtime";
import type { ModelAdapter } from "@sidecar/runtime-contracts";
import { MAIN_SESSION_KEY, RUN_ORIGIN, type SessionKey } from "@sidecar/runtime-contracts";
import {
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_LOCATION,
  type Session,
  type SessionIdentity,
} from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { type BrainRequestSnapshot, brainRequestPending } from "#shared/wire/brain";
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
  /** A conversation's envelope, read and written only through the store built here; a temporary thread's lives in memory alone. */
  repositoryFor: (sessionKey: SessionKey) => BrainStateRepository;
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
  /** Which credential the policy would build an adapter under, by reference; the value never enters a configuration. */
  credential: () => CredentialReference;
  /** The agent's identity workspace: seeded once, edited by the developer or by the agent's own tools. */
  workspaceDirectory: () => string;
  /** The roots skills are discovered under. */
  skillRoots: () => readonly string[];
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
  /** The registries every configuration resolves against, for the diagnostics view. */
  readonly registries: RuntimeRegistries;
  /** The standing configuration snapshot, republished whenever the credential policy chooses a source. */
  configuration: () => ResolvedConfiguration;
  /**
   * The prompt a turn of this kind would run under right now, built by the
   * same three stages a live turn uses — the standing configuration, the
   * facts gathered from the workspace, the pure builder — so what the
   * diagnostics view shows is what the model is sent; nothing while no model
   * stands.
   */
  inspectPrompt: (turn: BrainTurnDescription) => Promise<BuiltPrompt | undefined>;
  /** Seeds the workspace's missing files; safe to run at every launch. */
  seedWorkspace: () => Promise<WorkspaceSeeding>;
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
    const store = new BrainStateStore({
      repository: dependencies.repositoryFor(sessionKey),
      createGenerationId: dependencies.createId,
      report: dependencies.report,
    });
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

  // Nothing is opened here: a store is built the first time a conversation is
  // asked for, so a run with nothing on disk — a fixture, a capture, a launch
  // before the database is open — never reaches the worker for a load.
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

  // The registries hold what this build compiled in; the configuration names
  // entries by id and is republished, atomically, whenever the credential
  // policy chooses a source. Every turn takes the snapshot standing when it
  // is prepared and reads nothing else.
  const registries = registerBrainBuiltIns(createRuntimeRegistries());
  const configurationFor = (credential: CredentialReference) =>
    defaultAgentConfiguration({
      agentRuntimeId: TOOL_LOOP_RUNTIME.ID,
      modelAdapterId:
        credential.kind === CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY
          ? OPENAI_MODEL_ADAPTER_ID
          : HOSTED_MODEL_ADAPTER_ID,
      contextEngineId: RESPONSES_CONTEXT_ENGINE_ID,
      credential,
      workspaceDirectory: dependencies.workspaceDirectory(),
      skillRoots: dependencies.skillRoots(),
    });
  const configurationStore = new ConfigurationStore(
    registries,
    configurationFor(dependencies.credential()),
  );
  const publishConfiguration = (credential: CredentialReference): ResolvedConfiguration => {
    const published = configurationStore.publish(configurationFor(credential));
    if (!published.ok) {
      dependencies.report(`Brain configuration refused: ${published.refusals.join(", ")}`);
    }
    return configurationStore.snapshot();
  };

  /** The skills the latest preparation listed to the model: the only ones `load_skill` may load. */
  interface ListedSkills {
    skills: readonly SkillDescriptor[];
  }

  const workspaceFor = (
    snapshot: ResolvedConfiguration,
    listed: ListedSkills,
  ): BrainWorkspaceAccess => {
    const directory = snapshot.configuration.workspaceDirectory;
    return {
      read: (name) => readWorkspaceFile(directory, name),
      write: (name, content) => writeWorkspaceFile(directory, name, content),
      loadSkill: (location) => loadSkill(location, listed.skills),
    };
  };

  /**
   * The three stages of one turn's prompt: the configuration already
   * resolved, the facts gathered from the workspace and the skill roots under
   * it, and the pure builder. The tools the prompt names are the ones the
   * agent will resolve for the turn — the same layers over the same catalog
   * with the turn's own layer — so the prompt and the schemas agree.
   */
  const prepare = async (
    snapshot: ResolvedConfiguration,
    model: ModelAdapter,
    turn: BrainTurnDescription,
    listed: ListedSkills,
  ): Promise<BrainTurnPreparation & { built: BuiltPrompt }> => {
    const layers = snapshot.configuration.toolPolicy;
    const catalog = registries.tools.entries();
    const trigger = turn.kind === BRAIN_TURN_KIND.TURN ? turn.trigger : undefined;
    const policy = resolveTurnToolPolicy(catalog, layers, trigger);
    const discovered = eligibleSkills(
      await discoverSkills(snapshot.configuration.skillRoots),
      snapshot.configuration.agentId,
    );
    listed.skills = discovered;
    const facts = await gatherPromptFacts({
      configuration: snapshot,
      run: { origin: trigger === undefined ? RUN_ORIGIN.MAINTENANCE : runOriginOf(trigger) },
      identity: BRAIN_IDENTITY_LINE,
      tools: policy.allowed.map((tool) => tool.schema),
      toolNotes: brainToolNotes(),
      runtimeContextMarker: BRAIN_INPUT_MARKER.STANDING_CONTEXT,
      runtimeId: TOOL_LOOP_RUNTIME.ID,
      skills: discovered,
      ...(model.model ? { model: model.model } : undefined),
    });
    const built = buildSystemPrompt(facts);
    return { prompt: built.text, layers, catalog, built };
  };

  // The runtime is composed here, once per agent, from the entries the
  // resolved configuration names: the tool loop over the Responses context
  // engine on whichever adapter the policy chose. A different runtime is a
  // different registration and configuration, not a change to the host.
  const build = (
    model: ModelAdapter,
    snapshot: ResolvedConfiguration,
    store: BrainStateStore,
  ): BrainAgent => {
    const runtimeDescriptor = registries.agentRuntimes.get(snapshot.configuration.agentRuntimeId);
    const engineDescriptor = registries.contextEngines.get(snapshot.configuration.contextEngineId);
    if (!runtimeDescriptor || !engineDescriptor) {
      throw new Error("the resolved configuration names entries the registries do not hold");
    }
    const listed: ListedSkills = { skills: [] };
    const { reasoningEffort, maximumOutputTokens } = snapshot.configuration;
    return new BrainAgent({
      runtime: runtimeDescriptor.create(model, engineDescriptor),
      acts,
      roster: dependencies.roster,
      standingContext: dependencies.standingContext,
      prepareTurn: (turn) => prepare(snapshot, model, turn, listed),
      workspace: workspaceFor(snapshot, listed),
      ...(reasoningEffort ? { reasoningEffort } : undefined),
      ...(maximumOutputTokens !== undefined ? { maximumOutputTokens } : undefined),
      // Today's and yesterday's notes, primed once into a conversation that
      // just started fresh and read on no ordinary turn.
      primeFreshContext: async () => {
        const notes = await recentDailyNotes(snapshot.configuration.workspaceDirectory, Date.now());
        if (notes.length === 0) return undefined;
        return notes.map((note) => `## ${note.name}\n\n${note.content}`).join("\n\n");
      },
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
  };

  /** The model the policy chose, or nothing when no brain may stand: no key, no account, a run off the network. */
  const liveModel = (): ModelAdapter | undefined => {
    const model = dependencies.model();
    return model && dependencies.runnable() ? model : undefined;
  };

  const rebuildOne = (
    sessionKey: SessionKey,
    opened: OpenConversation,
    model: ModelAdapter | undefined,
  ): Promise<void> =>
    opened.host.replace(() => {
      if (!model) {
        if (sessionKey === MAIN_SESSION_KEY) dependencies.dropBriefings();
        return undefined;
      }
      return build(model, publishConfiguration(dependencies.credential()), opened.store);
    });

  const rebuild = async (): Promise<void> => {
    const model = liveModel();
    // Main's conversation is opened the moment a brain may stand on it, and
    // not before: a launch with nothing to run leaves the store untouched.
    if (model) openConversation(MAIN_SESSION_KEY);
    await Promise.all(
      [...conversations.entries()].map(([sessionKey, opened]) =>
        rebuildOne(sessionKey, opened, model),
      ),
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
        .filter(([, records]) => records.some(brainRequestPending))
        .map(([sessionKey]) => sessionKey),
    rebuild,
    retire,
    openConversation: async (sessionKey) => {
      const opened = openConversation(sessionKey);
      if (!opened.host.current()) await rebuildOne(sessionKey, opened, liveModel());
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
    registries,
    configuration: () => configurationStore.snapshot(),
    inspectPrompt: async (turn) => {
      const model = liveModel();
      if (!model) return undefined;
      const prepared = await prepare(configurationStore.snapshot(), model, turn, { skills: [] });
      return prepared.built;
    },
    seedWorkspace: () => seedWorkspace(dependencies.workspaceDirectory(), BRAIN_WORKSPACE_SEEDS),
  };
}
