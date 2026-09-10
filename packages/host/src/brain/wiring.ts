import { createHash } from "node:crypto";
import {
  BRAIN_IDENTITY_LINE,
  BRAIN_INPUT_MARKER,
  BRAIN_PERSONA,
  BRAIN_TURN_KIND,
  BRAIN_TURN_TRIGGER,
  BRAIN_WORKSPACE_SEEDS,
  BrainAgent,
  type BrainFlushInput,
  type BrainFlushMarkerStore,
  BrainGenerationClock,
  type BrainMemoryAccess,
  type BrainRoster,
  type BrainStateRepository,
  BrainStateStore,
  type BrainTick,
  type BrainTickChange,
  type BrainTurnDescription,
  type BrainTurnPreparation,
  type BrainTurnTraceRecord,
  type BrainTurnTrigger,
  type BrainUtterance,
  type BrainWorkspaceAccess,
  brainToolCatalog,
  brainToolNotes,
  resolveTurnToolPolicy,
  runOriginOf,
  TICK_CHANGE_KIND,
  toolLoopRuntimeOver,
} from "@sidecar/brain";
import { type BrainRequestSnapshot, brainRequestPending } from "@sidecar/brain/requests-wire";
import {
  failedHousekeeping,
  housekeepingFellShort,
  type MemoryHousekeepingResult,
} from "@sidecar/memory";
import {
  BUILTIN_CONTEXT_ENGINE,
  BUILTIN_MODEL_ADAPTER,
  type BuiltPrompt,
  buildSystemPrompt,
  type ChildPolicyContext,
  type ChildRunService,
  CONFIGURATION_OUTCOME,
  ConfigurationStore,
  CREDENTIAL_REFERENCE_KIND,
  type CredentialReference,
  defaultAgentConfiguration,
  discoverSkills,
  eligibleSkills,
  gatherPromptFacts,
  LANE,
  type Lane,
  LaneScheduler,
  laneConfiguration,
  loadSkill,
  notebookMemoryProviderFor,
  type ResolvedConfiguration,
  readWorkspaceFile,
  recentDailyNotes,
  type SkillDescriptor,
  seedWorkspace,
  TOOL_LOOP_RUNTIME,
  type WorkspaceSeeding,
  writeWorkspaceFile,
} from "@sidecar/runtime";
import {
  type AgentRuntime,
  CONVERSATION_KIND,
  childIdOf,
  conversationKindOf,
  isReasoningEffort,
  MAIN_SESSION_KEY,
  type ModelAdapter,
  type ReasoningEffort,
  RUN_ORIGIN,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import {
  dispatchRead,
  type Session,
  type SessionIdentity,
  type SessionProviderPlugin,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord, type WireValue } from "@sidecar/wire";
import {
  type BrainActionPerformerDependencies,
  createBrainActionPerformer,
} from "./action-performer.js";
import { BrainHost } from "./host.js";
import { type BrainPublicationDependencies, followBrainRequests } from "./publication.js";
import {
  type ChildWiringDependencies,
  childName,
  childRecordOf,
  wireChildren,
} from "./wiring-children.js";

export interface BrainWiringDependencies extends ChildWiringDependencies {
  /** A conversation's envelope, read and written only through the store built here; a temporary thread's lives in memory alone. */
  repositoryFor: (sessionKey: SessionKey) => BrainStateRepository;
  /** The machine's parallelism, for the agent lane's width; absent means the host asks the OS. */
  parallelism?: () => number;
  traceTurn?: (record: BrainTurnTraceRecord) => void;
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt: number,
    sessionKey: SessionKey,
  ) => boolean | Promise<boolean>;
  broadcastRequests: (snapshots: readonly BrainRequestSnapshot[]) => void;
  /** A run's end stands in Conversation, written and marked: the moment its reply may be owed to the ear. */
  onEndPublished?: BrainPublicationDependencies["onEndPublished"];
  /** A conversation's generation ended — reset, expired, or replaced — and its unspoken announcements and replies go with it. */
  onGenerationReplaced: (sessionKey: SessionKey) => void;
  actions: BrainActionPerformerDependencies;
  roster: () => BrainRoster;
  /**
   * The standing context one conversation is handed, rebuilt every turn: the
   * key is passed because what belongs in it differs by conversation, and the
   * host decides that, not this wiring.
   */
  standingContext: (sessionKey: SessionKey) => string;
  pluginFor: (providerId: string) => SessionProviderPlugin | undefined;
  session: (identity: SessionIdentity) => Session | undefined;
  /** Hands words the brain decided to say to the speech arbiter. */
  deliver: (utterance: BrainUtterance) => Promise<void>;
  /**
   * Whether announcements are quiet right now — a meeting, or the developer's
   * own switch. A tick under quiet is not taken at all, so the first tick
   * after it diffs across the whole quiet and the brain decides afresh.
   */
  announcementsQuiet: () => Promise<boolean>;
  /** Which credential the policy would build an adapter under, by reference; the value never enters a configuration. */
  credential: () => CredentialReference;
  /** The agent's identity workspace: seeded once, edited by the developer or by the agent's own tools. */
  workspaceDirectory: () => string;
  /** The roots skills are discovered under. */
  skillRoots: () => readonly string[];
  /** Whether a brain may stand at all: observing, on the network, and past the account gate. */
  runnable: () => boolean;
  /** Withdraws every announcement not yet spoken: no brain stands to have meant it. */
  withdrawUtterances: () => void;
  /**
   * The notebook's search and read for one conversation's memory tools: a
   * search may reach past private conversations, never the asking one, whose
   * words are already its context. Absent, or answering nothing, the tools refuse.
   */
  memory?: (sessionKey: SessionKey) => BrainMemoryAccess | undefined;
  /**
   * The pre-compaction memory flush for one conversation: the host decides
   * which conversations flush (main and the developer's durable private
   * threads, never a temporary thread, an observed session, or a child) and
   * answers nothing for one that does not.
   */
  beforeCompaction?: (
    sessionKey: SessionKey,
  ) => ((input: BrainFlushInput) => Promise<MemoryHousekeepingResult>) | undefined;
  /** Where one conversation's flush marker outlives the process; nothing for one that never flushes. */
  flushMarker?: (sessionKey: SessionKey) => BrainFlushMarkerStore | undefined;
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

/** The configuration fields a client may set over the protocol; everything else is the build's or the credential policy's. */
export interface SettableConfigurationPatch {
  reasoningEffort?: string;
  maximumOutputTokens?: number;
}

/** The same fields once validated, as the next published configuration carries them. */
interface SettableConfiguration {
  reasoningEffort?: ReasoningEffort;
  maximumOutputTokens?: number;
}

export interface BrainWiring {
  /** Main's host. */
  readonly host: BrainHost;
  /** The lanes every conversation's turns run under. */
  readonly lanes: LaneScheduler;
  /**
   * One tick of the host's clock, after every observation pass and behind
   * every provider hook: a cheap deterministic diff of the roster against the
   * last tick, and one turn on main over it when anything moved and main is
   * free. Settles once the turn has ended, or at once when none opened.
   */
  tick: () => Promise<void>;
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
  /** Settles once every standing follower has published every report taken so far. */
  publicationSettled: () => Promise<void>;
  /** The standing configuration snapshot, republished whenever the credential policy chooses a source. */
  configuration: () => ResolvedConfiguration;
  /**
   * Republishes the configuration with the settable fields patched — the
   * reasoning effort and the output budget — atomically, or not at all:
   * answers the refusals, none when the snapshot now stands. A patch stands
   * until the credential policy next republishes, which reads it again.
   */
  updateConfiguration: (patch: SettableConfigurationPatch) => readonly string[];
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
   * a run outside any conversation — a housekeeping turn — or nothing when
   * no brain may stand. Its context is the caller's to open and dispose.
   */
  createRuntime: () => AgentRuntime | undefined;
}

interface OpenConversation {
  host: BrainHost;
  store: BrainStateStore;
  clock: BrainGenerationClock;
  unsubscribe: () => void;
}

/**
 * The prefix cache one conversation's turns ask for: a hash of its key, so
 * every turn of that conversation lands on the turns before it, across
 * launches, and no conversation on another's. The key itself never travels;
 * what is sent is the digest and nothing that could be read back into it.
 */
function promptCacheKeyFor(sessionKey: SessionKey): string {
  return createHash("sha256").update(sessionKey).digest("hex");
}

/** The lane a turn runs under, by what opened it: children on theirs, the rest the agent's. */
function laneFor(trigger: BrainTurnTrigger): Lane {
  return trigger === BRAIN_TURN_TRIGGER.CHILD_TASK ? LANE.CHILD : LANE.AGENT;
}

/**
 * What one tick remembers of a session, to tell the next tick what moved:
 * the roster fields worth waking a brain for, and where its transcript was
 * last measured to. In memory only, so the first tick after a launch finds
 * every live session new and says so once; nothing of it reaches disk.
 */
interface SessionFingerprint {
  fields: WireRecord;
  transcriptCursor?: string;
}

/**
 * The roster fields a tick compares. A title edit or a fresher timestamp is
 * the same session still standing; a status, a hold for the developer, a
 * completion's cause, an error line, or a workspace's lifecycle words moving
 * is news the brain should hear about.
 */
function fingerprintFields(session: Session): WireRecord {
  return {
    status: session.status,
    ...(session.holdingForDeveloper !== undefined
      ? { holding_for_developer: session.holdingForDeveloper }
      : undefined),
    ...(session.completionCause !== undefined
      ? { completion_cause: session.completionCause }
      : undefined),
    ...(session.detail.activity !== undefined ? { activity: session.detail.activity } : undefined),
    ...(session.detail.error !== undefined ? { error: session.detail.error } : undefined),
    ...(session.workspace?.name !== undefined ? { workspace: session.workspace.name } : undefined),
  };
}

/** The fields whose value moved, each with its new value; nothing when none did. */
function movedFields(previous: WireRecord, next: WireRecord): WireRecord | undefined {
  const moved: Record<string, WireValue> = {};
  for (const name of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (JSON.stringify(previous[name]) === JSON.stringify(next[name])) continue;
    moved[name] = next[name] ?? null;
  }
  return Object.keys(moved).length > 0 ? moved : undefined;
}

/**
 * The brains: one long-lived agent per open conversation. Main is the one
 * the host's clock ticks: after every observation pass, and behind every
 * provider hook, the roster is diffed against what the last tick showed, and
 * one turn opens over the difference when there is one and main is free.
 * The diff is deterministic and carries no transcript text — which sessions
 * moved, which fields, how much each transcript gained — so what it
 * amounts to, and whether to say anything, is the brain's to decide by
 * reading what it chooses. Every conversation's turns run under the shared
 * lanes, one execution per conversation at a time. Built by `rebuild` whenever the credential policy
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
    // unspoken announcements and replies with it, the one in the mouth's hand
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
   * The gauntlet every action the brain asks for runs, in this process: validated
   * against the roster, the issue board, the offered projects, the guide, or
   * the remembered facts as each stands at the moment of the action, then carried
   * by the performer. Only a turn the developer opened may act, and the
   * validators guard what it may act on.
   */
  const actions = createBrainActionPerformer(dependencies.actions);

  // The lanes are one scheduler over every conversation, each lane its own
  // budget and never one cap over Luke as a whole.
  const lanes = new LaneScheduler(laneConfiguration(dependencies.parallelism?.()));

  // The configuration names built-ins by id and is republished, atomically,
  // whenever the credential policy chooses a source. Every turn takes the
  // snapshot standing when it is prepared and reads nothing else.
  // The settable fields a client patched over the protocol, applied to every
  // configuration published after, so a credential change keeps them.
  let settable: SettableConfiguration = {};
  const configurationFor = (credential: CredentialReference) => ({
    ...defaultAgentConfiguration({
      agentRuntimeId: TOOL_LOOP_RUNTIME.ID,
      modelAdapterId:
        credential.kind === CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY
          ? BUILTIN_MODEL_ADAPTER.OPENAI
          : BUILTIN_MODEL_ADAPTER.HOSTED,
      contextEngineId: BUILTIN_CONTEXT_ENGINE.RESPONSES,
      memoryProviderId: notebookMemoryProviderFor(credential.kind),
      credential,
      workspaceDirectory: dependencies.workspaceDirectory(),
      skillRoots: dependencies.skillRoots(),
    }),
    ...settable,
  });
  const configurationStore = new ConfigurationStore(configurationFor(dependencies.credential()));
  const publishConfiguration = (credential: CredentialReference): ResolvedConfiguration => {
    const published = configurationStore.publish(configurationFor(credential));
    if (published.outcome === CONFIGURATION_OUTCOME.REFUSED) {
      dependencies.report(`Brain configuration refused: ${published.refusal}`);
    }
    return configurationStore.snapshot();
  };

  const flushFor = (sessionKey: SessionKey) => dependencies.beforeCompaction?.(sessionKey);
  const flushMarkerFor = (sessionKey: SessionKey) => dependencies.flushMarker?.(sessionKey);

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
    const catalog = brainToolCatalog();
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
      persona: BRAIN_PERSONA,
      tools: policy.allowed.map((tool) => ({ name: tool.schema.name, groups: tool.groups })),
      toolNotes: brainToolNotes(),
      runtimeContextMarker: BRAIN_INPUT_MARKER.STANDING_CONTEXT,
      runtimeId: TOOL_LOOP_RUNTIME.ID,
      skills: discovered,
      ...(model.model ? { model: model.model } : undefined),
    });
    const built = buildSystemPrompt(facts);
    return { prompt: built.text, layers, catalog, built };
  };

  // The runtime is composed here, once per agent: the tool loop over the
  // Responses context engine on whichever adapter the policy chose.
  const build = (
    model: ModelAdapter,
    snapshot: ResolvedConfiguration,
    store: BrainStateStore,
    sessionKey: SessionKey,
    fork: readonly WireRecord[] | undefined,
  ): BrainAgent => {
    const listed: ListedSkills = { skills: [] };
    const { reasoningEffort, maximumOutputTokens } = snapshot.configuration;
    // A child's conversation is prepared as a child's: the minimal profile,
    // the child restriction at its depth, the fork it inherited if any, and
    // its own deadline when the spawn set one.
    const childRecord = childRecordOf(children.service, sessionKey);
    // The memory tools reach the notebook through the host's one service,
    // bound once here; a host with none leaves the agent to refuse the tools
    // itself.
    const memory = dependencies.memory?.(sessionKey);
    return new BrainAgent({
      lane: (trigger, work) => lanes.run(laneFor(trigger), work),
      ...(childRecord ? { child: { depth: childRecord.depth } } : undefined),
      ...(fork ? { inheritedContext: fork } : undefined),
      ...(childRecord && childRecord.timeoutMs > 0
        ? { executionDeadlineMs: childRecord.timeoutMs }
        : undefined),
      children: children.accessFor(sessionKey),
      ...(memory ? { memory } : undefined),
      ...(flushFor(sessionKey) ? { beforeCompaction: flushFor(sessionKey) } : undefined),
      ...(flushMarkerFor(sessionKey) ? { flushMarker: flushMarkerFor(sessionKey) } : undefined),
      runtime: toolLoopRuntimeOver(model),
      actions,
      roster: dependencies.roster,
      standingContext: () => dependencies.standingContext(sessionKey),
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
      promptCacheKey: promptCacheKeyFor(sessionKey),
      ...(maximumOutputTokens !== undefined ? { maximumOutputTokens } : undefined),
      // Today's and yesterday's notes, primed once into a conversation that
      // just started fresh and read on no ordinary turn.
      primeFreshContext: async () => {
        const notes = await recentDailyNotes(snapshot.configuration.workspaceDirectory, Date.now());
        if (notes.length === 0) return undefined;
        return notes.map((note) => `## ${note.name}\n\n${note.content}`).join("\n\n");
      },
      readTranscript: (identity) => {
        const session = dependencies.session(identity);
        const plugin = dependencies.pluginFor(identity.providerId);
        if (!session || !plugin) {
          return Promise.resolve({
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: "No observed session matches that identity.",
          });
        }
        // Whether a session's transcript can be read is the provider's own
        // word: a local reader opens its file, Conductor reads its documented
        // messages endpoint, and a provider naming no handler refuses.
        return dispatchRead(plugin, "transcript", identity.providerSessionId);
      },
      deliver: dependencies.deliver,
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
        if (sessionKey === MAIN_SESSION_KEY) dependencies.withdrawUtterances();
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
   * built, by the kind its key says it is: a child's, named for its label;
   * main and a thread are listed by whoever created them and need nothing here.
   */
  const ensureListed = async (sessionKey: SessionKey): Promise<void> => {
    if (conversationKindOf(sessionKey) !== CONVERSATION_KIND.CHILD) return;
    const record = childRecordOf(children.service, sessionKey);
    await dependencies.ensureChildConversation(
      sessionKey,
      record ? childName(record) : `Child ${childIdOf(sessionKey)}`,
    );
  };

  /**
   * The one way a conversation of any kind is opened for a brain: its row in
   * the directory, its store, and — when a model stands — its brain, with a
   * child's inherited fork as its opening history. Openings of one key are
   * serialized so two completions landing together build one conversation,
   * not two; a conversation still
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
  // A conversation is busy while any run of it is pending in Conversation's
  // view, or while its brain has anything under way or owed: a turn running
  // or queued, an ask waiting. An unrecorded tick is work too.
  const busy = (sessionKey: SessionKey) =>
    (latestRecords.get(sessionKey) ?? []).some(brainRequestPending) ||
    (conversations.get(sessionKey)?.host.current()?.busy() ?? false);

  // What the last tick that opened a turn showed of each session, by
  // provider and then by the provider's own session id. Nothing here is
  // committed until the turn it opened has ended well, so a tick whose turn
  // failed diffs against the same picture again and the change surfaces once
  // more rather than being lost with the failure.
  let fingerprints = new Map<string, Map<string, SessionFingerprint>>();
  let tickInFlight = false;

  /**
   * How many bytes a session's transcript gained since the last committed
   * tick, read through the provider's own incremental reader and discarded
   * but for its length and the cursor it moved to. A provider that reads no
   * increments, or a read that failed, answers nothing and keeps the cursor.
   */
  const transcriptGained = async (
    identity: SessionIdentity,
    cursor: string | undefined,
  ): Promise<{ gained?: number; cursor?: string }> => {
    const plugin = dependencies.pluginFor(identity.providerId);
    if (!plugin?.reads?.transcriptSince)
      return { ...(cursor !== undefined ? { cursor } : undefined) };
    try {
      const read = await dispatchRead(
        plugin,
        "transcriptSince",
        identity.providerSessionId,
        cursor,
      );
      if (read.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        return { ...(cursor !== undefined ? { cursor } : undefined) };
      }
      const next = read.cursor ?? cursor;
      return { gained: read.text.length, ...(next !== undefined ? { cursor: next } : undefined) };
    } catch {
      return { ...(cursor !== undefined ? { cursor } : undefined) };
    }
  };

  const tick = async (): Promise<void> => {
    if (tickInFlight || !liveModel()) return;
    const agent = current(MAIN_SESSION_KEY);
    if (!agent || busy(MAIN_SESSION_KEY)) return;
    tickInFlight = true;
    try {
      if (await dependencies.announcementsQuiet()) return;
      const next = new Map<string, Map<string, SessionFingerprint>>();
      const changes: BrainTickChange[] = [];
      for (const session of dependencies.roster().sessions ?? []) {
        if (session.realtimeVoiceLive) continue;
        const identity: SessionIdentity = {
          providerId: session.providerId,
          providerSessionId: session.providerSessionId,
        };
        const previous = fingerprints.get(identity.providerId)?.get(identity.providerSessionId);
        const fields = fingerprintFields(session);
        const transcript = await transcriptGained(identity, previous?.transcriptCursor);
        const provider = next.get(identity.providerId) ?? new Map<string, SessionFingerprint>();
        provider.set(identity.providerSessionId, {
          fields,
          ...(transcript.cursor !== undefined
            ? { transcriptCursor: transcript.cursor }
            : undefined),
        });
        next.set(identity.providerId, provider);
        const gained =
          transcript.gained !== undefined && transcript.gained > 0
            ? { transcriptCharsGained: transcript.gained }
            : undefined;
        if (!previous) {
          changes.push({
            kind: TICK_CHANGE_KIND.APPEARED,
            identity,
            title: session.title,
            fields,
            ...gained,
          });
          continue;
        }
        const moved = movedFields(previous.fields, fields);
        if (!moved && !gained) continue;
        changes.push({
          kind: TICK_CHANGE_KIND.CHANGED,
          identity,
          title: session.title,
          ...(moved ? { fields: moved } : undefined),
          ...gained,
        });
      }
      for (const [providerId, sessions] of fingerprints) {
        for (const providerSessionId of sessions.keys()) {
          if (next.get(providerId)?.has(providerSessionId)) continue;
          changes.push({
            kind: TICK_CHANGE_KIND.VANISHED,
            identity: { providerId, providerSessionId },
          });
        }
      }
      if (changes.length === 0) return;
      const found: BrainTick = { changes };
      // The picture is committed only behind a turn that ran to its end: a
      // turn the model failed, or one the generation's replacement revoked,
      // leaves the last committed picture standing, so the same change is
      // found again at the next tick rather than lost.
      if (await agent.tick(found)) fingerprints = next;
    } finally {
      tickInFlight = false;
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

  const publicationSettled = async (): Promise<void> => {
    await Promise.all([...publications.values()].map((settled) => settled()));
  };

  const updateConfiguration = (patch: SettableConfigurationPatch): readonly string[] => {
    const next: SettableConfiguration = { ...settable };
    if (patch.reasoningEffort !== undefined) {
      if (!isReasoningEffort(patch.reasoningEffort)) {
        return [
          `reasoning effort ${JSON.stringify(patch.reasoningEffort)} is not one this build knows`,
        ];
      }
      next.reasoningEffort = patch.reasoningEffort;
    }
    if (patch.maximumOutputTokens !== undefined)
      next.maximumOutputTokens = patch.maximumOutputTokens;
    const previous = settable;
    settable = next;
    const published = configurationStore.publish(configurationFor(dependencies.credential()));
    if (published.outcome === CONFIGURATION_OUTCOME.REFUSED) {
      settable = previous;
      return [published.refusal];
    }
    return [];
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
    tick,
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
          const result = await capture(sessionKey, items).catch((error: Error) =>
            failedHousekeeping(error.message),
          );
          if (housekeepingFellShort(result.outcome)) {
            dependencies.report(
              `Reset capture did not complete (${result.outcome}${result.reason ? `: ${result.reason}` : ""}); ${result.writes} note write(s) stand and the reset proceeds`,
            );
          }
        }
      }
      return openConversation(sessionKey).store.reset();
    },
    children: children.service,
    publicationSettled,
    configuration: () => configurationStore.snapshot(),
    updateConfiguration,
    inspectPrompt: async (turn) => {
      const model = liveModel();
      if (!model) return undefined;
      const prepared = await prepare(configurationStore.snapshot(), model, turn, { skills: [] });
      return prepared.built;
    },
    seedWorkspace: () => seedWorkspace(dependencies.workspaceDirectory(), BRAIN_WORKSPACE_SEEDS),
    createRuntime: () => {
      const model = liveModel();
      if (!model) return undefined;
      return toolLoopRuntimeOver(model);
    },
  };
}
