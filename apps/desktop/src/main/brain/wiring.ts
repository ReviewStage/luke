import {
  BRAIN_IDENTITY_LINE,
  BRAIN_INPUT_MARKER,
  BRAIN_TURN_KIND,
  BRAIN_TURN_TRIGGER,
  BRAIN_WORKSPACE_SEEDS,
  BrainAgent,
  type BrainDelivery,
  type BrainFlushInput,
  BrainGenerationClock,
  type BrainMemoryAccess,
  type BrainRecallAsk,
  type BrainRoster,
  type BrainStateRepository,
  BrainStateStore,
  type BrainTurnDescription,
  type BrainTurnNotice,
  type BrainTurnPreparation,
  type BrainTurnReport,
  type BrainTurnTraceRecord,
  type BrainTurnTrigger,
  type BrainWakeEvent,
  type BrainWorkspaceAccess,
  brainToolNotes,
  HOSTED_MODEL_ADAPTER_ID,
  LOOK_SUBJECT,
  notebookMemoryProviderFor,
  OPENAI_MODEL_ADAPTER_ID,
  RESPONSES_CONTEXT_ENGINE_ID,
  registerBrainBuiltIns,
  resolveTurnToolPolicy,
  runOriginOf,
  TOOL_LOOP_RUNTIME,
} from "@sidecar/brain";
import {
  housekeepingCompleted,
  MEMORY_HOUSEKEEPING_OUTCOME,
  type MemoryHousekeepingResult,
} from "@sidecar/memory";
import type { ConversationEntry } from "@sidecar/realtime";
import {
  type BuiltPrompt,
  buildSystemPrompt,
  type ChildPolicyContext,
  type ChildRunService,
  ConfigurationStore,
  CREDENTIAL_REFERENCE_KIND,
  type CredentialReference,
  createRuntimeRegistries,
  defaultAgentConfiguration,
  discoverSkills,
  eligibleSkills,
  gatherPromptFacts,
  LANE,
  type Lane,
  LaneScheduler,
  laneConfiguration,
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
import type { AgentRuntime, ModelAdapter } from "@sidecar/runtime-contracts";
import {
  CONVERSATION_KIND,
  childIdOf,
  conversationKindOf,
  MAIN_SESSION_KEY,
  observedSessionKey,
  observedSessionRefOf,
  RUN_ORIGIN,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import {
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_LOCATION,
  SESSION_STATUS,
  type Session,
  type SessionIdentity,
} from "@sidecar/session";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
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
import {
  type ChildWiringDependencies,
  childName,
  childRecordOf,
  wireChildren,
} from "./wiring-children";

/** What a provider adapter answers a transcript read with, by the session's own id. */
interface TranscriptReader {
  readTranscriptSince(
    providerSessionId: string,
    cursor: string | undefined,
  ): Promise<ProviderTranscriptSinceResult>;
  readTranscript(providerSessionId: string): Promise<ProviderTranscriptResult>;
}

export interface BrainWiringDependencies extends ChildWiringDependencies {
  /** A conversation's envelope, read and written only through the store built here; a temporary thread's lives in memory alone. */
  repositoryFor: (sessionKey: SessionKey) => BrainStateRepository;
  /** Lists an observed session's conversation in the store, creating its row when none stands; absent, the row is not kept. */
  ensureObservedConversation?: (sessionKey: SessionKey, name: string) => Promise<void>;
  /** The machine's parallelism, for the agent lane's width; absent means the host asks the OS. */
  parallelism?: () => number;
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
  /** Which credential the policy would build an adapter under, by reference; the value never enters a configuration. */
  credential: () => CredentialReference;
  /** The agent's identity workspace: seeded once, edited by the developer or by the agent's own tools. */
  workspaceDirectory: () => string;
  /** The roots skills are discovered under. */
  skillRoots: () => readonly string[];
  /** Whether a brain may stand at all: observing, on the network, and past the account gate. */
  runnable: () => boolean;
  dropBriefings: () => void;
  /**
   * The notebook's search and read for one conversation's memory tools: a
   * search may reach past private conversations, never the asking one, whose
   * words are already its context. Absent, or answering nothing, the tools refuse.
   */
  memory?: (sessionKey: SessionKey) => BrainMemoryAccess | undefined;
  /**
   * Private-conversation recall for one conversation's asks: the host decides
   * which conversations recall (main and the developer's private threads,
   * never a temporary thread, an observed session, or a child) and answers
   * nothing for one that does not.
   */
  recall?: (
    sessionKey: SessionKey,
  ) => ((ask: BrainRecallAsk) => Promise<string | undefined>) | undefined;
  /**
   * The pre-compaction memory flush for one conversation: the host decides
   * which conversations flush (main and the developer's durable private
   * threads, never a temporary thread, an observed session, or a child) and
   * answers nothing for one that does not.
   */
  beforeCompaction?: (
    sessionKey: SessionKey,
  ) => ((input: BrainFlushInput) => Promise<MemoryHousekeepingResult>) | undefined;
  /**
   * The capture run before an eligible conversation starts fresh, over a
   * copy of its context. Its outcome is reported and never decides the
   * reset: a capture that failed is recorded honestly and the reset proceeds.
   */
  beforeReset?: (
    sessionKey: SessionKey,
    items: readonly WireRecord[],
  ) => Promise<MemoryHousekeepingResult>;
}

export interface BrainIpcRegistration {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  submitters: BrainSubmitters;
}

export interface BrainWiring {
  /** Main's host. */
  readonly host: BrainHost;
  /** The lanes every conversation's turns run under. */
  readonly lanes: LaneScheduler;
  /**
   * Routes provider hooks to the conversations of the sessions they name:
   * each observed session has a conversation of its own, opened here on its
   * first wake, and main is handed none of them.
   */
  wake: (events: readonly BrainWakeEvent[]) => void;
  /**
   * The roster look after an observation pass: each live local session's
   * conversation looks at its own session alone, a session gone from the
   * roster has its conversation stood down once idle, and main looks at no
   * transcript at all.
   */
  rosterLook: () => void;
  /** Hands held briefings back to the conversations that decided them, main's for one with no source. */
  releaseHeld: (held: readonly BrainDelivery[]) => void;
  /** Opens the scheduled review in a conversation, main's by default; settles when its turn has. */
  heartbeat: (sessionKey?: SessionKey) => Promise<void>;
  /** The compact notices main has not yet read, for inspection. */
  pendingNotices: () => readonly BrainTurnNotice[];
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
  /**
   * Start fresh: a new lifetime for the conversation, its history and
   * transcript untouched. Every child the conversation asked for, and theirs,
   * is cancelled first; a cancellation that did not land refuses the reset
   * rather than reporting a success over a child still running.
   */
  resetConversation: (sessionKey: SessionKey) => Promise<boolean>;
  /** Delegation: the child records, completions, and their lifecycle, for inspection and tests. */
  readonly children: ChildRunService;
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
  /**
   * A fresh runtime over the standing configuration and the live model, for
   * a run outside any conversation — the recall subrun — or nothing when no
   * brain may stand. Its context is the caller's to open and dispose.
   */
  createRuntime: () => AgentRuntime | undefined;
}

interface OpenConversation {
  host: BrainHost;
  store: BrainStateStore;
  clock: BrainGenerationClock;
  unsubscribe: () => void;
}

/** How many notices main keeps unread before the oldest go; each is one line about one turn. */
const MAXIMUM_PENDING_NOTICES = 50;

/** What a conversation that is not main is handed: main alone reads the notices its siblings leave. */
const NO_OPENING_NOTES = {
  take: () => [],
  restore: () => {},
};

/** The lane a turn runs under, by what opened it: hooks share the cron inner budget, heartbeats are cron work, the rest is the agent's. */
function laneFor(trigger: BrainTurnTrigger): Lane {
  switch (trigger) {
    case BRAIN_TURN_TRIGGER.WAKE:
      return LANE.HOOK_DISPATCH;
    case BRAIN_TURN_TRIGGER.HEARTBEAT:
      return LANE.CRON_NESTED;
    case BRAIN_TURN_TRIGGER.CHILD_TASK:
      return LANE.CHILD;
    default:
      return LANE.AGENT;
  }
}

function observedName(session: Session | undefined, identity: SessionIdentity): string {
  return session?.title ?? `${identity.providerId} ${identity.providerSessionId}`;
}

/**
 * The brains: one long-lived agent per open conversation. Each observed
 * coding session has a conversation of its own, opened on its first hook or
 * roster look, which reads that session's transcript, briefs the developer
 * about it directly, and leaves main a compact notice of what it did; main
 * is asked things by the developer and runs the scheduled heartbeat, and
 * never reads a provider's transcript on a look. Every conversation's turns
 * run under the shared lanes, one execution per conversation at a time. Nothing here detects a change for a brain — no
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
    // The generation's clock stands with the store, not with an agent, so a
    // store whose automatic reset is enabled sees the generation die on time
    // through a launch with no key or account, and after its agent was
    // retired. Under the default policy of no automatic reset it arms nothing.
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

  // The lanes are one scheduler over every conversation: hooks are enabled
  // in every observing build, so the hook reservation stands inside the cron
  // budget from the start.
  const lanes = new LaneScheduler(
    laneConfiguration({
      hooksEnabled: true,
      ...(dependencies.parallelism ? { parallelism: dependencies.parallelism() } : undefined),
    }),
  );

  // What the observed conversations did, for main's next turn: taken when
  // that turn opens, handed back if it fails, bounded so a quiet main never
  // accumulates a day of notices.
  let notices: readonly BrainTurnNotice[] = [];
  /** The one place the bound is applied, so a record and a hand-back cannot each trim differently. */
  const holdNotices = (held: readonly BrainTurnNotice[]) => {
    notices = held.slice(-MAXIMUM_PENDING_NOTICES);
  };
  const openingNotes = {
    take: () => {
      const taken = notices;
      notices = [];
      return taken;
    },
    restore: (returned: readonly BrainTurnNotice[]) => holdNotices([...returned, ...notices]),
  };
  /**
   * What one of main's siblings did, as main will read it: the conversation's
   * own counts, and the name this host resolved for the session the turn
   * looked at — its own session when the turn named none.
   */
  const recordNotice = (report: BrainTurnReport, observed: SessionIdentity) => {
    const identity = report.identities[0] ?? observed;
    holdNotices([
      ...notices,
      { ...report, label: observedName(dependencies.session(identity), identity) },
    ]);
  };

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
      memoryProviderId: notebookMemoryProviderFor(credential.kind),
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

  // The memory tools reach the notebook's index through the host's one
  // service; a host with none, or one not yet open, refuses them in the agent.
  const memoryAccessFor = (sessionKey: SessionKey): BrainMemoryAccess => ({
    search: async (ask) => {
      const memory = dependencies.memory?.(sessionKey);
      if (!memory)
        return { status: ACT_RESULT_STATUS.REJECTED, reason: "no notebook index stands" };
      return memory.search(ask);
    },
    get: async (ask) => {
      const memory = dependencies.memory?.(sessionKey);
      if (!memory)
        return { status: ACT_RESULT_STATUS.REJECTED, reason: "no notebook index stands" };
      return memory.get(ask);
    },
  });
  const recallFor = (sessionKey: SessionKey) => dependencies.recall?.(sessionKey);
  const flushFor = (sessionKey: SessionKey) => dependencies.beforeCompaction?.(sessionKey);

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
    child?: ChildPolicyContext,
  ): Promise<BrainTurnPreparation & { built: BuiltPrompt }> => {
    const layers = snapshot.configuration.toolPolicy;
    const catalog = registries.tools.entries();
    const trigger = turn.kind === BRAIN_TURN_KIND.TURN ? turn.trigger : undefined;
    const policy = resolveTurnToolPolicy(catalog, layers, trigger, child);
    const discovered = eligibleSkills(
      await discoverSkills(snapshot.configuration.skillRoots),
      snapshot.configuration.agentId,
    );
    listed.skills = discovered;
    const facts = await gatherPromptFacts({
      configuration: snapshot,
      run: {
        origin: trigger === undefined ? RUN_ORIGIN.MAINTENANCE : runOriginOf(trigger),
        ...(child ? { child } : undefined),
      },
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
    sessionKey: SessionKey,
    fork: readonly WireRecord[] | undefined,
  ): BrainAgent => {
    const runtimeDescriptor = registries.agentRuntimes.get(snapshot.configuration.agentRuntimeId);
    const engineDescriptor = registries.contextEngines.get(snapshot.configuration.contextEngineId);
    if (!runtimeDescriptor || !engineDescriptor) {
      throw new Error("the resolved configuration names entries the registries do not hold");
    }
    const listed: ListedSkills = { skills: [] };
    const { reasoningEffort, maximumOutputTokens } = snapshot.configuration;
    // An observed conversation looks at its one session and reports each
    // turn as a notice; every other conversation looks at no transcript on
    // a roster look, and main is the one that reads the notices. Which
    // conversation this is is the host's own routing, so the agent is handed
    // the same fields whichever it is.
    const observed = observedSessionRefOf(sessionKey);
    // A child's conversation is prepared as a child's: the minimal profile,
    // the child restriction at its depth, the fork it inherited if any, and
    // its own deadline when the spawn set one.
    const childRecord = childRecordOf(children.service, sessionKey);
    return new BrainAgent({
      observes: observed
        ? { kind: LOOK_SUBJECT.SESSION, identity: observed }
        : { kind: LOOK_SUBJECT.NONE },
      lane: (trigger, work) => lanes.run(laneFor(trigger), work),
      notice: observed ? (report) => recordNotice(report, observed) : () => {},
      openingNotes: sessionKey === MAIN_SESSION_KEY ? openingNotes : NO_OPENING_NOTES,
      ...(childRecord ? { child: { depth: childRecord.depth } } : undefined),
      ...(fork ? { inheritedContext: fork } : undefined),
      ...(childRecord && childRecord.timeoutMs > 0
        ? { executionDeadlineMs: childRecord.timeoutMs }
        : undefined),
      children: children.accessFor(sessionKey),
      ...(dependencies.memory ? { memory: memoryAccessFor(sessionKey) } : undefined),
      ...(recallFor(sessionKey) ? { recall: recallFor(sessionKey) } : undefined),
      ...(flushFor(sessionKey) ? { beforeCompaction: flushFor(sessionKey) } : undefined),
      runtime: runtimeDescriptor.create(model, engineDescriptor),
      acts,
      roster: dependencies.roster,
      standingContext: dependencies.standingContext,
      prepareTurn: (turn) =>
        prepare(
          snapshot,
          model,
          turn,
          listed,
          childRecord ? { depth: childRecord.depth } : undefined,
        ),
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
      deliver: (delivery) => dependencies.deliver({ ...delivery, sessionKey }),
      store,
      createRunId: dependencies.createId,
      ...(dependencies.traceTurn ? { trace: dependencies.traceTurn } : undefined),
      report: dependencies.report,
    });
  };

  // Delegation runs on these conversations, reached only through what is
  // lent here: the helpers below are read at the call, so a child opened or
  // a completion delivered sees the wiring as it then stands.
  const children = wireChildren(dependencies, {
    current,
    open: (sessionKey, fork) => openAny(sessionKey, fork),
    closeConversation: (sessionKey) => closeConversation(sessionKey),
  });

  /** The model the policy chose, or nothing when no brain may stand: no key, no account, a run off the network. */
  const liveModel = (): ModelAdapter | undefined => {
    const model = dependencies.model();
    return model && dependencies.runnable() ? model : undefined;
  };

  const rebuildOne = (
    sessionKey: SessionKey,
    opened: OpenConversation,
    model: ModelAdapter | undefined,
    fork?: readonly WireRecord[],
  ): Promise<void> =>
    opened.host.replace(() => {
      if (!model) {
        if (sessionKey === MAIN_SESSION_KEY) dependencies.dropBriefings();
        return undefined;
      }
      return build(
        model,
        publishConfiguration(dependencies.credential()),
        opened.store,
        sessionKey,
        fork,
      );
    });

  // Conversations standing down, until their store is let go.
  const closings = new Map<SessionKey, Promise<void>>();
  const rebuild = async (): Promise<void> => {
    const model = liveModel();
    // Main's conversation is opened the moment a brain may stand on it, and
    // not before: a launch with nothing to run leaves the store untouched.
    if (model) openConversation(MAIN_SESSION_KEY);
    // A conversation standing down is left to its close: a rebuild landing
    // while its drain is awaited would be the newer transition, and would
    // install a live agent on a host the close is about to drop from the
    // directory, where nothing could ever retire it. The reopen that follows
    // the close builds on the model then standing.
    await Promise.all(
      [...conversations.entries()]
        .filter(([sessionKey]) => !closings.has(sessionKey))
        .map(([sessionKey, opened]) => rebuildOne(sessionKey, opened, model)),
    );
    // Recovery of what the last launch left waits for a model to stand: a
    // launch with none has nothing to run a child on, and a child marked
    // unknown for that alone would be a budget spent on nothing.
    if (model) await children.service.start();
  };

  const retire = (): void => {
    for (const opened of conversations.values()) opened.host.retire();
  };

  /**
   * The directory row a conversation is listed under before its brain is
   * built, by the kind its key says it is: an observed session's, named for
   * the session; a child's, named for its label; main and a thread are
   * listed by whoever created them and need nothing here.
   */
  const ensureListed = async (sessionKey: SessionKey): Promise<void> => {
    switch (conversationKindOf(sessionKey)) {
      case CONVERSATION_KIND.OBSERVED: {
        const identity = observedSessionRefOf(sessionKey);
        if (!identity) return;
        await dependencies.ensureObservedConversation?.(
          sessionKey,
          observedName(dependencies.session(identity), identity),
        );
        return;
      }
      case CONVERSATION_KIND.CHILD: {
        const record = childRecordOf(children.service, sessionKey);
        await dependencies.ensureChildConversation(
          sessionKey,
          record ? childName(record) : `Child ${childIdOf(sessionKey)}`,
        );
        return;
      }
      default:
        return;
    }
  };

  /**
   * The one way a conversation of any kind is opened for a brain: its row in
   * the directory, its store, and — when a model stands — its brain, with a
   * child's inherited fork as its opening history. Openings of one key are
   * serialized so two hooks, two completions, or a hook and a completion
   * landing together build one conversation, not two; a conversation still
   * standing down finishes first, so its store is let go of before another is
   * built on the same envelope and two writers never hold one repository.
   * With no model nothing is opened: there is no brain to hand back, and a
   * store opened for nobody would only be a load spent.
   */
  const openings = new Map<SessionKey, Promise<BrainAgent | undefined>>();
  const openAny = (
    sessionKey: SessionKey,
    fork?: readonly WireRecord[],
  ): Promise<BrainAgent | undefined> => {
    const standing = conversations.get(sessionKey)?.host.current();
    if (standing && !closings.has(sessionKey)) return Promise.resolve(standing);
    const pending = openings.get(sessionKey);
    if (pending) return pending;
    const opening = (async () => {
      try {
        await closings.get(sessionKey);
        const model = liveModel();
        if (!model) return undefined;
        await ensureListed(sessionKey);
        const opened = openConversation(sessionKey);
        if (!opened.host.current()) await rebuildOne(sessionKey, opened, model, fork);
        return opened.host.current();
      } catch (error) {
        dependencies.report(
          `Conversation ${sessionKey} could not be opened: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      } finally {
        openings.delete(sessionKey);
      }
    })();
    openings.set(sessionKey, opening);
    return opening;
  };
  const openObserved = (identity: SessionIdentity): Promise<BrainAgent | undefined> =>
    openAny(observedSessionKey(identity));

  const wake = (events: readonly BrainWakeEvent[]): void => {
    if (!liveModel()) return;
    const bySession = new Map<
      SessionKey,
      { identity: SessionIdentity; events: BrainWakeEvent[] }
    >();
    for (const event of events) {
      const key = observedSessionKey(event.identity);
      const held = bySession.get(key) ?? { identity: event.identity, events: [] };
      held.events.push(event);
      bySession.set(key, held);
    }
    for (const { identity, events: own } of bySession.values()) {
      void openObserved(identity).then((agent) => agent?.wake(own));
    }
  };

  // A conversation is busy while any run of it is pending in History's view,
  // or while its brain has anything under way or owed: a turn running or
  // queued, a capture landing, an observation captured and not yet read, an
  // ask waiting. An unrecorded analysis is work too, and is never cut because
  // its session left the roster.
  const busy = (sessionKey: SessionKey) =>
    (latestRecords.get(sessionKey) ?? []).some(brainRequestPending) ||
    (conversations.get(sessionKey)?.host.current()?.busy() ?? false);

  const rosterLook = (): void => {
    if (!liveModel()) return;
    const roster = dependencies.roster();
    const present = new Set<SessionKey>();
    for (const session of roster.sessions ?? []) {
      const identity: SessionIdentity = {
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      };
      const sessionKey = observedSessionKey(identity);
      present.add(sessionKey);
      const live =
        session.status === SESSION_STATUS.WORKING || session.status === SESSION_STATUS.WAITING;
      const open = conversations.has(sessionKey);
      if (session.location !== SESSION_LOCATION.LOCAL || !(live || open)) continue;
      void openObserved(identity).then((agent) => agent?.rosterLook());
    }
    // A session the roster no longer holds has nothing left to observe: its
    // conversation stands down once no run is under way in it, and its
    // history stays in the store for the selector and for maintenance.
    for (const sessionKey of [...conversations.keys()]) {
      if (!observedSessionRefOf(sessionKey) || present.has(sessionKey) || busy(sessionKey))
        continue;
      void closeConversation(sessionKey);
    }
  };

  // A held briefing goes back to the conversation that decided it, because
  // that conversation is the one that knows the session it was about. An
  // observed conversation that has stood down meanwhile is reopened for it
  // rather than the briefing being re-decided in main, which never read that
  // session; only a source that cannot be reopened at all falls to main, and
  // says so.
  const releaseHeld = (held: readonly BrainDelivery[]): void => {
    const bySource = new Map<SessionKey, BrainDelivery[]>();
    for (const delivery of held) {
      const source = delivery.sessionKey ?? MAIN_SESSION_KEY;
      bySource.set(source, [...(bySource.get(source) ?? []), delivery]);
    }
    for (const [sessionKey, own] of bySource) {
      const observed = observedSessionRefOf(sessionKey);
      const opening = observed
        ? openObserved(observed)
        : Promise.resolve(current(sessionKey) ?? current(MAIN_SESSION_KEY));
      void opening.then((agent) => {
        if (agent) {
          agent.releaseHeld(own);
          return;
        }
        dependencies.report(
          `Held briefings of ${sessionKey} could not return to their conversation and are re-decided in main`,
        );
        current(MAIN_SESSION_KEY)?.releaseHeld(own);
      });
    }
  };

  const closeConversation = (sessionKey: SessionKey): Promise<void> => {
    const closing = closings.get(sessionKey);
    if (closing) return closing;
    const opened = conversations.get(sessionKey);
    if (!opened) return Promise.resolve();
    const work = (async () => {
      // The replacement with nothing awaits every retirement's drain, so the
      // follower has written its last interruption before the store is let
      // go. The entry stays in the directory until then: an open that lands
      // meanwhile waits on this closing rather than building a second store
      // on the same envelope.
      opened.host.retire();
      await opened.host.replace(() => undefined);
      opened.clock.stop();
      opened.unsubscribe();
      conversations.delete(sessionKey);
      latestRecords.delete(sessionKey);
      publications.delete(sessionKey);
      broadcast();
    })().finally(() => {
      closings.delete(sessionKey);
    });
    closings.set(sessionKey, work);
    return work;
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
    busyConversations: () => [...latestRecords.keys()].filter(busy),
    rebuild,
    retire,
    openConversation: async (sessionKey) => {
      // The same wait an observed opening keeps: a conversation still
      // standing down is let go of before it is opened again, so the reopen
      // never builds onto the host the close will discard.
      await closings.get(sessionKey);
      const opened = openConversation(sessionKey);
      if (!opened.host.current()) await rebuildOne(sessionKey, opened, liveModel());
    },
    closeConversation,
    lanes,
    wake,
    rosterLook,
    releaseHeld,
    heartbeat: (sessionKey = MAIN_SESSION_KEY) =>
      current(sessionKey)?.heartbeat() ?? Promise.resolve(),
    pendingNotices: () => notices,
    resetConversation: async (sessionKey) => {
      const cancelled = await children.service.cancelDescendantsOf(sessionKey);
      if (!cancelled.ok) {
        dependencies.report(
          `Start fresh refused: ${cancelled.remaining.length} child run(s) could not be cancelled first`,
        );
        return false;
      }
      // The capture reads a copy of the context the reset is about to let go
      // of and writes only today's note; whatever it answers, the reset goes
      // ahead, and a capture that did not complete is said so.
      const capture = dependencies.beforeReset;
      const agent = current(sessionKey);
      if (capture && agent) {
        const items = await agent.contextSnapshot().catch(() => undefined);
        if (items && items.length > 0) {
          const result = await capture(sessionKey, items).catch(
            (error: Error): MemoryHousekeepingResult => ({
              outcome: MEMORY_HOUSEKEEPING_OUTCOME.FAILED,
              writes: 0,
              reason: error.message,
            }),
          );
          if (!housekeepingCompleted(result.outcome)) {
            dependencies.report(
              `Reset capture did not complete (${result.outcome}${result.reason ? `: ${result.reason}` : ""}); ${result.writes} note write(s) stand and the reset proceeds`,
            );
          }
        }
      }
      return openConversation(sessionKey).store.reset();
    },
    children: children.service,
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
    createRuntime: () => {
      const model = liveModel();
      const snapshot = configurationStore?.snapshot();
      if (!model || !snapshot) return undefined;
      const runtimeDescriptor = registries.agentRuntimes.get(snapshot.configuration.agentRuntimeId);
      const engineDescriptor = registries.contextEngines.get(
        snapshot.configuration.contextEngineId,
      );
      if (!runtimeDescriptor || !engineDescriptor) return undefined;
      return runtimeDescriptor.create(model, engineDescriptor);
    },
  };
}
