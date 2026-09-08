import {
  BRAIN_IDENTITY_LINE,
  BRAIN_INPUT_MARKER,
  BRAIN_TURN_KIND,
  BRAIN_TURN_TRIGGER,
  BRAIN_WORKSPACE_SEEDS,
  BrainAgent,
  type BrainChildAccess,
  type BrainDelivery,
  BrainGenerationClock,
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
  CHILD_SPAWN_REFUSAL,
  type ChildEnd,
  type ChildPolicyContext,
  ChildRunService,
  type ChildStore,
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
  type ScheduledTimer,
  type SkillDescriptor,
  seedWorkspace,
  type WorkspaceSeeding,
  writeWorkspaceFile,
} from "@sidecar/runtime";
import type { ModelAdapter } from "@sidecar/runtime-contracts";
import {
  CHILD_RUN_STATUS,
  type ChildCompletionRecord,
  type ChildRunRecord,
  type ConversationRecord,
  childIdOf,
  DEFAULT_AGENT_ID,
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
  /** Lists an observed session's conversation in the store, creating its row when none stands; absent, the row is not kept. */
  ensureObservedConversation?: (sessionKey: SessionKey, name: string) => Promise<void>;
  /** Lists a child's conversation in the directory, creating its row when none stands. */
  ensureChildConversation: (sessionKey: SessionKey, name: string) => Promise<void>;
  /** Archives a conversation in the directory, its history kept; a completed child's, on its clock. */
  archiveConversation: (sessionKey: SessionKey) => Promise<boolean>;
  /** The directory as it stands, for `sessions_list`. */
  conversationDirectory: () => readonly ConversationRecord[];
  /** One conversation's thread as it stands, for `sessions_history` over a child. */
  historyLines: (sessionKey: SessionKey) => readonly ConversationEntry[];
  /** Where child records and completions stand between launches. */
  childStore: () => ChildStore;
  /** The clock the child service's delivery retries and archive delays run on; absent means the process's own timers. */
  childTimers?: {
    schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
    cancel: (timer: ScheduledTimer) => void;
  };
  /** The machine's parallelism, for the agent lane's width; absent means the host asks the OS. */
  parallelism?: () => number;
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

/** A spawn refusal in the words the model reads. */
function spawnRefusalWords(
  reason: (typeof CHILD_SPAWN_REFUSAL)[keyof typeof CHILD_SPAWN_REFUSAL],
): string {
  switch (reason) {
    case CHILD_SPAWN_REFUSAL.EMPTY_TASK:
      return "a task needs words";
    case CHILD_SPAWN_REFUSAL.DEPTH_CAP:
      return "not run: the delegation depth cap is reached";
    case CHILD_SPAWN_REFUSAL.REQUESTER_LIMIT:
      return "not run: this conversation already has its limit of active children";
    case CHILD_SPAWN_REFUSAL.GLOBAL_LIMIT:
      return "not run: every child execution slot is taken";
    case CHILD_SPAWN_REFUSAL.BLOCKED_COMPLETIONS:
      return "not run: too many completions are blocked awaiting delivery";
    case CHILD_SPAWN_REFUSAL.FORK_OTHER_AGENT:
      return "not run: a fork must stay within the same agent";
    case CHILD_SPAWN_REFUSAL.PERSISTENCE:
      return "not run: the child's record could not be written";
    case CHILD_SPAWN_REFUSAL.STOPPED:
      return "not run: delegation is stopped";
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
    const childRecord = childRecordOf(sessionKey);
    const fork = pendingForks.get(sessionKey);
    pendingForks.delete(sessionKey);
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
      children: childAccessFor(sessionKey),
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

  /**
   * Delegation. The service owns the records and the completion schedule;
   * this wiring runs a child as one more conversation of the same agent, on
   * the child lane, and hands each completion to the conversation that asked,
   * whichever kind it is — steered into its run under way or opened as a turn
   * of its own — so no conversation ever polls for a result.
   */
  const pendingForks = new Map<SessionKey, readonly WireRecord[]>();
  const childRecordOf = (sessionKey: SessionKey): ChildRunRecord | undefined => {
    const childId = childIdOf(sessionKey);
    return childId === undefined ? undefined : children.child(childId);
  };
  const childName = (record: ChildRunRecord) => record.label ?? `Child ${record.childId}`;
  const openChild = async (record: ChildRunRecord): Promise<BrainAgent | undefined> => {
    const model = liveModel();
    if (!model) return undefined;
    await dependencies.ensureChildConversation(record.childSessionKey, childName(record));
    const opened = openConversation(record.childSessionKey);
    if (!opened.host.current()) await rebuildOne(record.childSessionKey, opened, model);
    return opened.host.current();
  };
  const childEnd = (end: Awaited<ReturnType<BrainAgent["runChildTask"]>>): ChildEnd =>
    end?.done
      ? { status: CHILD_RUN_STATUS.UNKNOWN, failureDetail: "the child's run did not end" }
      : { status: CHILD_RUN_STATUS.UNKNOWN, failureDetail: "the child's run was not accepted" };
  const children = new ChildRunService({
    store: dependencies.childStore(),
    createId: dependencies.createId,
    report: dependencies.report,
    ...(dependencies.childTimers ?? undefined),
    executor: {
      start: async (record, fork) => {
        if (fork) pendingForks.set(record.childSessionKey, fork);
        const agent = await openChild(record);
        pendingForks.delete(record.childSessionKey);
        if (!agent) return { started: false, reason: "no model stands to run the child" };
        const run = await agent.runChildTask(record.task, record.childRunId);
        if (!run) return { started: false, reason: "the child's run was refused" };
        return { started: true, done: run.done.then((end) => end ?? childEnd(run)) };
      },
      resume: async (record) => {
        const agent = await openChild(record);
        if (!agent) return { started: false, reason: "no model stands to recover the child" };
        // Nothing is run again: the child's own record, marked interrupted
        // at its conversation's load, is the end the runtime can vouch for;
        // a child whose run was never recorded ends unknown on the strength
        // of its requester's receipt alone.
        const adopted = await agent.adoptChildRun(record.childRunId);
        return {
          started: true,
          done: Promise.resolve(
            adopted ?? {
              status: CHILD_RUN_STATUS.UNKNOWN,
              failureDetail: "the child's run was never recorded before the relaunch",
            },
          ),
        };
      },
      cancel: async (record) => {
        const agent = conversations.get(record.childSessionKey)?.host.current();
        if (!agent) return true;
        return agent.cancelChildRun(record.childRunId);
      },
      archive: async (record) => {
        await closeConversation(record.childSessionKey);
        return dependencies.archiveConversation(record.childSessionKey);
      },
      history: async (record, limit) =>
        dependencies
          .historyLines(record.childSessionKey)
          .slice(-limit)
          .map((entry) => `${entry.kind}: ${entry.words}`),
    },
    deliverer: {
      deliver: async (completion, record) => {
        const agent = await openDestination(completion.destination);
        if (!agent) return { delivered: false, reason: "no brain stands for the requester" };
        return agent.deliverChildCompletion({
          completionId: completion.completionId,
          childId: completion.childId,
          ...(record.label !== undefined ? { label: record.label } : undefined),
          status: completion.status,
          ...(completion.resultText !== undefined
            ? { resultText: completion.resultText }
            : undefined),
          ...(completion.failureDetail !== undefined
            ? { failureDetail: completion.failureDetail }
            : undefined),
          ...(record.performedActs !== undefined
            ? { performedActs: record.performedActs }
            : undefined),
          ...(record.unknownActs !== undefined ? { unknownActs: record.unknownActs } : undefined),
        });
      },
    },
  });

  /**
   * The conversation a completion is for, opened again if it was stood down:
   * an observed session's conversation whose session left the roster, a
   * child requester already archived, or a thread with no brain yet. The
   * completion is owed to that conversation and no other, so main is never
   * handed a sibling's result.
   */
  const openDestination = async (destination: SessionKey): Promise<BrainAgent | undefined> => {
    const standing = conversations.get(destination)?.host.current();
    if (standing) return standing;
    const model = liveModel();
    if (!model) return undefined;
    const observed = observedSessionRefOf(destination);
    if (observed) return openObserved(observed);
    const child = childRecordOf(destination);
    if (child) return openChild(child);
    const opened = openConversation(destination);
    if (!opened.host.current()) await rebuildOne(destination, opened, model);
    return opened.host.current();
  };

  const childSummary = (record: ChildRunRecord): WireRecord => ({
    child_id: record.childId,
    ...(record.label !== undefined ? { label: record.label } : undefined),
    status: record.status,
    depth: record.depth,
    context: record.context,
    accepted_at: new Date(record.acceptedAt).toISOString(),
    ...(record.settledAt !== undefined
      ? { settled_at: new Date(record.settledAt).toISOString() }
      : undefined),
    ...(record.resultText !== undefined ? { has_result: true } : undefined),
  });
  const completionSummary = (completion: ChildCompletionRecord | undefined) =>
    completion ? { delivery: completion.delivery, attempts: completion.attempts } : undefined;

  const notOwnChild = (): WireRecord => ({
    status: ACT_RESULT_STATUS.REJECTED,
    reason: "no child of this conversation has that id",
  });

  /** The session tools of one conversation: a child named here must be its own. */
  const childAccessFor = (sessionKey: SessionKey): BrainChildAccess => {
    const own = (childId: string): ChildRunRecord | undefined => {
      const record = children.child(childId);
      return record && record.requesterSessionKey === sessionKey ? record : undefined;
    };
    return {
      spawn: async (ask) => {
        const outcome = await children.spawn({
          agentId: DEFAULT_AGENT_ID,
          requesterSessionKey: sessionKey,
          requesterRunId: ask.requesterRunId,
          requesterDepth: childRecordOf(sessionKey)?.depth ?? 0,
          task: ask.task,
          ...(ask.label !== undefined ? { label: ask.label } : undefined),
          ...(dependencies.model()?.model ? { model: dependencies.model()?.model } : undefined),
          ...(ask.context !== undefined ? { context: ask.context } : undefined),
          ...(ask.cleanup !== undefined ? { cleanup: ask.cleanup } : undefined),
          ...(ask.timeoutMs !== undefined ? { timeoutMs: ask.timeoutMs } : undefined),
          ...(ask.expectsCompletion !== undefined
            ? { expectsCompletion: ask.expectsCompletion }
            : undefined),
          policy: ask.policy,
          sameAgent: true,
          fork: ask.fork,
        });
        if (!outcome.accepted) {
          const refused: WireRecord = {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: outcome.detail
              ? `${spawnRefusalWords(outcome.reason)}: ${outcome.detail}`
              : spawnRefusalWords(outcome.reason),
          };
          return refused;
        }
        const receipt: WireRecord = {
          status: ACT_RESULT_STATUS.ACCEPTED,
          accepted: true,
          completed: false,
          child_id: outcome.receipt.childId,
          child_session_key: outcome.receipt.childSessionKey,
          child_run_id: outcome.receipt.childRunId,
          ...(outcome.receipt.model ? { model: outcome.receipt.model } : undefined),
          context: outcome.receipt.context,
          ...(outcome.receipt.contextNote
            ? { context_note: outcome.receipt.contextNote }
            : undefined),
          depth: outcome.receipt.depth,
          completion:
            "arrives in this conversation as its own item when the child ends; do not poll for it",
        };
        return receipt;
      },
      list: async () => ({
        status: ACT_RESULT_STATUS.ACCEPTED,
        children: children.childrenOf(sessionKey).map((record) => ({
          ...childSummary(record),
          ...completionSummary(children.completion(record.childId)),
        })),
      }),
      cancel: async (childId): Promise<WireRecord> => {
        if (!own(childId)) return notOwnChild();
        const cancelled = await children.cancel(childId);
        if (cancelled.ok) return { status: ACT_RESULT_STATUS.ACCEPTED, cancelled: [childId] };
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: `not every child could be cancelled: ${cancelled.remaining.join(", ")}`,
        };
      },
      conversations: async () => ({
        status: ACT_RESULT_STATUS.ACCEPTED,
        conversations: dependencies
          .conversationDirectory()
          .filter((record) => record.archivedAt === undefined)
          .map((record) => ({
            session_key: record.sessionKey,
            kind: record.kind,
            name: record.name,
            last_activity_at: new Date(record.lastActivityAt).toISOString(),
            ...(record.sessionKey === sessionKey ? { current: true } : undefined),
          })),
      }),
      history: async (childId, limit): Promise<WireRecord> => {
        if (!own(childId)) return notOwnChild();
        const lines = (await children.history(childId, limit)) ?? [];
        return { status: ACT_RESULT_STATUS.ACCEPTED, lines: [...lines] };
      },
    };
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
      return build(
        model,
        publishConfiguration(dependencies.credential()),
        opened.store,
        sessionKey,
      );
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
    // Recovery of what the last launch left waits for a model to stand: a
    // launch with none has nothing to run a child on, and a child marked
    // unknown for that alone would be a budget spent on nothing.
    if (model) await children.start();
  };

  const retire = (): void => {
    for (const opened of conversations.values()) opened.host.retire();
  };

  /**
   * The conversation of one observed session, opened on first use: its row
   * in the directory, its store, and — when a model stands — its brain.
   * Openings of one key are serialized so two hooks landing together build
   * one conversation, not two.
   */
  const observedOpenings = new Map<SessionKey, Promise<BrainAgent | undefined>>();
  // Conversations standing down, until their store is let go.
  const closings = new Map<SessionKey, Promise<void>>();
  const openObserved = (identity: SessionIdentity): Promise<BrainAgent | undefined> => {
    const sessionKey = observedSessionKey(identity);
    const standing = conversations.get(sessionKey)?.host.current();
    if (standing && !closings.has(sessionKey)) return Promise.resolve(standing);
    const pending = observedOpenings.get(sessionKey);
    if (pending) return pending;
    const opening = (async () => {
      try {
        // A conversation still standing down finishes first: its store is
        // let go of before another is built on the same envelope, so two
        // writers never hold one repository.
        await closings.get(sessionKey);
        await dependencies.ensureObservedConversation?.(
          sessionKey,
          observedName(dependencies.session(identity), identity),
        );
        const opened = openConversation(sessionKey);
        if (!opened.host.current()) await rebuildOne(sessionKey, opened, liveModel());
        return opened.host.current();
      } catch (error) {
        dependencies.report(
          `Observed conversation could not be opened: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      } finally {
        observedOpenings.delete(sessionKey);
      }
    })();
    observedOpenings.set(sessionKey, opening);
    return opening;
  };

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
      const cancelled = await children.cancelDescendantsOf(sessionKey);
      if (!cancelled.ok) {
        dependencies.report(
          `Start fresh refused: ${cancelled.remaining.length} child run(s) could not be cancelled first`,
        );
        return false;
      }
      return openConversation(sessionKey).store.reset();
    },
    children,
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
