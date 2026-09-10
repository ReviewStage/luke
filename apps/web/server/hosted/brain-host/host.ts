import { createHash } from "node:crypto";
import {
  ACTION_RESULT_STATUS,
  announcementConversationEntry,
  BRAIN_RECOVERY,
  BRAIN_TURN_KIND,
  BrainAgent,
  type BrainRoster,
  BrainStateStore,
  type BrainTurnTraceRecord,
  brainToolCatalog,
  type CloudAgentProviderId,
  type ConversationEntry,
  type ConversationLineRecorder,
  dispatchRead,
  GROUP_PREFIX,
  isCloudAgentProviderId,
  LOOK_SUBJECT,
  MAIN_CONVERSATION_NAME,
  type ModelAdapter,
  maximumRememberedFacts,
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  publishRuns,
  REALTIME_TOOL,
  type RememberedFact,
  rememberedFactText,
  resolveTurnToolPolicy,
  type SessionIdentity,
  type SessionKey,
  type SessionProviderPlugin,
  TOOL_GROUP,
  type ToolPolicyLayers,
  toolLoopRuntimeOver,
} from "../../core.js";
import { type CloudAdapterSeams, cloudSessionPluginFor } from "../cloud-adapters.js";
import type { HostedStore } from "../store/index.js";
import { BRAIN_HOST } from "./bounds.js";
import { type HostedWorkspaceDefaults, hostedStandingContext } from "./context.js";
import { type CloudActionExecutor, hostedActionPerformer } from "./performer.js";
import { brainRosterOf, type HostedRoster, readHostedRoster, sessionIsLive } from "./roster.js";
import {
  hostedPrompt,
  hostedWorkspaceAccess,
  recentHostedDailyNotes,
  seedHostedWorkspace,
} from "./workspace.js";

/**
 * The hosted brain: the same `BrainAgent` the desktop runs, composed for one
 * request over the account's rows in the Postgres store. Nothing about the
 * agent knows it runs in a function: the store it writes is the account's,
 * the roster it is shown is the stored snapshot, the prompt is built from
 * the workspace rows, and its tools reach the facts table, the workspace
 * rows, the briefing table, and the cloud action execution — and nothing on
 * any machine. It is opened for the work one request or one wake brings,
 * drained, and stopped; whatever it left unfinished the next one resumes.
 */

/**
 * What the service cannot perform is not offered: the tools that reach a
 * machine — an open, an app setting, the panel, the feedback composer, the
 * updater — and the issue tracker no grant is held for, and the groups
 * behind seams the service does not wire: delegation, the notebook index,
 * skills. Everything else in the catalog stands, and the turn's own layer
 * still withholds `announce` from an ask.
 */
export const HOSTED_TOOL_POLICY: ToolPolicyLayers = {
  agent: {
    deny: [
      `${GROUP_PREFIX}${TOOL_GROUP.SESSIONS}`,
      `${GROUP_PREFIX}${TOOL_GROUP.MEMORY}`,
      `${GROUP_PREFIX}${TOOL_GROUP.SKILLS}`,
      REALTIME_TOOL.OPEN_SESSION,
      REALTIME_TOOL.CHANGE_APP_SETTING,
      REALTIME_TOOL.SHOW_PANEL,
      REALTIME_TOOL.OPEN_FEEDBACK_COMPOSER,
      REALTIME_TOOL.RUN_UPDATE_ACTION,
      REALTIME_TOOL.UPDATE_ISSUE_STATE,
      REALTIME_TOOL.COMMENT_ON_ISSUE,
    ],
  },
};

export interface HostedBrainSeams {
  readonly store: HostedStore;
  readonly userId: string;
  readonly sessionKey: SessionKey;
  /** The model the runtime reaches, the meter already in front of it. */
  readonly model: ModelAdapter;
  readonly now: () => number;
  readonly createId: () => string;
  readonly report: (message: string) => void;
  /** The account's stored key for a cloud provider, decrypted; nothing where none is stored. */
  readonly apiKey: (providerId: CloudAgentProviderId) => Promise<string | undefined>;
  readonly executeAction: CloudActionExecutor;
  readonly workspaceDefaults: () => Promise<HostedWorkspaceDefaults>;
  /** The plugin a transcript read goes through; production builds the provider's own over the account's key. */
  readonly cloudPlugin?: (
    providerId: CloudAgentProviderId,
    seams: CloudAdapterSeams,
  ) => SessionProviderPlugin;
  readonly trace?: (record: BrainTurnTraceRecord) => void;
  /**
   * Whether this host may still write the conversation: true while it holds
   * the lease. A save asked for after the lease passed to another holder is
   * refused rather than landed over the successor's run.
   */
  readonly writable?: () => boolean;
}

export interface HostedBrain {
  readonly agent: BrainAgent;
  /** The roster as the brain currently holds it. */
  roster(): HostedRoster;
  /** Reads the snapshot again, for a turn opened after a pass may have moved it. */
  refreshRoster(): Promise<HostedRoster>;
  /** Writes into the Conversation the asks and ends of every run it has not yet taken. */
  publish(): Promise<void>;
  /** Cancels the runs the developer asked the service to cancel since the brain last looked. */
  applyCancels(): Promise<void>;
  /** Stands the agent down once its work is done; a run still going is left for the next holder. */
  stop(): Promise<void>;
}

/** The prefix cache the account's turns share: a digest of who and which conversation, never the ids. */
function promptCacheKeyFor(userId: string, sessionKey: SessionKey): string {
  return createHash("sha256").update(`${userId}\n${sessionKey}`).digest("hex");
}

const NOT_OBSERVED: ProviderTranscriptSinceResult & ProviderTranscriptResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "No observed session matches that identity.",
};

const NOT_CLOUD: ProviderTranscriptSinceResult & ProviderTranscriptResult = {
  status: ACTION_RESULT_STATUS.UNSUPPORTED,
  reason: "That session's provider is not one the service reads.",
};

const NOT_LIVE: ProviderTranscriptSinceResult = {
  status: ACTION_RESULT_STATUS.UNSUPPORTED,
  reason: "not read: the session is neither working nor waiting",
};

export async function openHostedBrain(seams: HostedBrainSeams): Promise<HostedBrain> {
  const { store, userId, sessionKey, now, createId, report } = seams;
  await store.conversations.create(userId, {
    sessionKey,
    name: MAIN_CONVERSATION_NAME,
    now: now(),
  });
  await seedHostedWorkspace(store, userId, now());

  let roster = await readHostedRoster(store, userId);
  let facts: readonly RememberedFact[] = await store.facts.list(userId);
  let lines: readonly ConversationEntry[] = await store.lines.list(userId, sessionKey, now());
  const defaults = await seams.workspaceDefaults();

  const refreshRoster = async () => {
    roster = await readHostedRoster(store, userId);
    return roster;
  };
  const refreshLines = async () => {
    lines = await store.lines.list(userId, sessionKey, now());
  };

  /** Appends one line the brain's own work produced, minted here, and answers whether the thread took it. */
  const recordLine: ConversationLineRecorder = async (entry, recordedAt) => {
    const appended = await store.lines.append(
      userId,
      sessionKey,
      [{ ...entry, recordedAt }],
      Math.max(now(), recordedAt),
    );
    lines = appended.entries;
    return (
      appended.changed ||
      (entry.requestId !== undefined &&
        appended.entries.some(
          (held) => held.requestId === entry.requestId && held.kind === entry.kind,
        ))
    );
  };

  const plugins = new Map<CloudAgentProviderId, SessionProviderPlugin>();
  const pluginFor = (providerId: CloudAgentProviderId): SessionProviderPlugin => {
    const held = plugins.get(providerId);
    if (held) return held;
    const build = seams.cloudPlugin ?? cloudSessionPluginFor;
    const plugin = build(providerId, {
      readApiKey: () => seams.apiKey(providerId),
      reported: () => roster.observations.get(providerId) ?? [],
    });
    plugins.set(providerId, plugin);
    return plugin;
  };
  const observed = (identity: SessionIdentity) =>
    roster.sessions.find(
      (session) =>
        session.providerId === identity.providerId &&
        session.providerSessionId === identity.providerSessionId,
    );

  const repository = store.brainStateRepository(userId, sessionKey);
  const writable = seams.writable ?? (() => true);
  const stateStore = new BrainStateStore({
    repository: {
      load: () => repository.load(),
      save: (state, transcript) => (writable() ? repository.save(state, transcript) : false),
    },
    createGenerationId: createId,
    report,
  });

  const performer = hostedActionPerformer({
    roster: refreshRoster,
    defaults: async () => defaults,
    facts: {
      list: async () => facts,
      remember: async (ask) => {
        const words = rememberedFactText(ask.words);
        if (!words) return false;
        const kept = facts.filter((fact) => fact.id !== ask.replaces);
        if (kept.some((fact) => fact.words === words)) return true;
        if (kept.length >= maximumRememberedFacts) return false;
        facts = await store.facts.replace(userId, [...kept, { id: ask.id, words }], now());
        return true;
      },
      forget: async (id) => {
        if (!facts.some((fact) => fact.id === id)) return false;
        facts = await store.facts.replace(
          userId,
          facts.filter((fact) => fact.id !== id),
          now(),
        );
        return true;
      },
    },
    apiKey: seams.apiKey,
    execute: seams.executeAction,
    recordLine: async (entry) => {
      await recordLine({ ...entry, eventId: createId() }, now(), sessionKey);
    },
  });

  const agent = new BrainAgent({
    runtime: toolLoopRuntimeOver(seams.model),
    actions: performer,
    roster: (): BrainRoster => brainRosterOf(roster, now()),
    standingContext: () => hostedStandingContext({ roster, defaults, facts, lines }),
    prepareTurn: async (turn) => {
      const catalog = brainToolCatalog();
      const policy = resolveTurnToolPolicy(
        catalog,
        HOSTED_TOOL_POLICY,
        turn.kind === BRAIN_TURN_KIND.TURN ? turn.trigger : undefined,
      );
      const built = await hostedPrompt(store, userId, {
        policy,
        ...(seams.model.model ? { model: seams.model.model } : undefined),
      });
      return { prompt: built.text, layers: HOSTED_TOOL_POLICY, catalog };
    },
    workspace: hostedWorkspaceAccess(store, userId, now),
    primeFreshContext: () => recentHostedDailyNotes(store, userId, now()),
    observes: { kind: LOOK_SUBJECT.NONE },
    readTranscriptSince: async (identity, cursor) => {
      const session = observed(identity);
      if (!session) return NOT_OBSERVED;
      if (!isCloudAgentProviderId(identity.providerId)) return NOT_CLOUD;
      if (!sessionIsLive(session)) return NOT_LIVE;
      return dispatchRead(
        pluginFor(identity.providerId),
        "transcriptSince",
        identity.providerSessionId,
        cursor,
      );
    },
    readTranscript: async (identity) => {
      if (!observed(identity)) return NOT_OBSERVED;
      if (!isCloudAgentProviderId(identity.providerId)) return NOT_CLOUD;
      return dispatchRead(pluginFor(identity.providerId), "transcript", identity.providerSessionId);
    },
    deliver: async (delivery) => {
      const id = createId();
      await store.briefings.insert(userId, {
        id,
        sessionKey,
        words: delivery.briefing,
        decidedAt: delivery.decidedAt,
        expiresAt: delivery.decidedAt + BRAIN_HOST.BRIEFING_EXPIRY_MS,
      });
      await recordLine(
        { ...announcementConversationEntry(delivery.briefing), eventId: id },
        delivery.decidedAt,
        sessionKey,
      );
    },
    store: stateStore,
    createRunId: createId,
    trace: (record) => {
      seams.trace?.(record);
      void store.runs
        .recordAbout(userId, record.runId, {
          trigger: record.trigger,
          origin: record.origin,
          ...(record.ending !== undefined ? { ending: record.ending } : undefined),
          ...(record.inputTokens !== undefined ? { inputTokens: record.inputTokens } : undefined),
          ...(record.outputTokens !== undefined
            ? { outputTokens: record.outputTokens }
            : undefined),
          transcriptBytes: record.transcriptBytes,
          elapsedMs: record.elapsedMs,
          toolNames: record.tools,
          compacted: record.compacted,
        })
        .catch((error: Error) => report(`Run about-fields could not be written: ${error.name}`));
    },
    report,
    now,
    executionDeadlineMs: BRAIN_HOST.RUN_DEADLINE_MS,
    promptCacheKey: promptCacheKeyFor(userId, sessionKey),
    recovery: BRAIN_RECOVERY.RESUME,
  });

  return {
    agent,
    roster: () => roster,
    refreshRoster,
    publish: async () => {
      await publishRuns(
        agent,
        agent.requests().map((record) => ({ runId: record.runId })),
        recordLine,
        () => true,
        undefined,
        sessionKey,
      );
      await refreshLines();
    },
    applyCancels: async () => {
      for (const runId of await store.runs.cancelRequested(userId, sessionKey)) {
        await agent.cancelAsk(runId);
      }
    },
    stop: () => agent.stop(),
  };
}
