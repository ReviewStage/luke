import fs from "node:fs";
import { rememberedFactsText } from "@sidecar/acts";
import { DeliveryLedger, workspaceProjectContextText } from "@sidecar/brain";
import type { BrainAppActRequest } from "@sidecar/brain/requests-wire";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials";
import {
  carried,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  gatewayOk,
  invalid,
  NODE_CAPABILITY_STATUS,
} from "@sidecar/gateway";
import {
  type AppGuideSnapshot,
  appGuideContextText,
  EMPTY_APP_GUIDE,
  isAppGuideSnapshot,
} from "@sidecar/guide";
import {
  CREDENTIAL_REFERENCE_KIND,
  CronScheduler,
  HEARTBEAT_DEFAULTS,
  heartbeatJob,
  LANE,
} from "@sidecar/runtime";
import {
  CONVERSATION_KIND,
  isIdentifier,
  MAIN_SESSION_KEY,
  sessionKey as toSessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  type ConversationEntry,
  conversationHistoryText,
  recentConversationEntries,
  storedConversationEntry,
} from "@sidecar/session";
import { VOICE_SOURCE } from "@sidecar/settings";
import { ACT_RESULT_STATUS, isRecord, UNKNOWN_ACT_STATUS, type WireRecord } from "@sidecar/wire";
import { wireBrain } from "./brain/wiring.js";
import type { AccountComposer } from "./compose-account.js";
import type { IssuesComposer } from "./compose-issues.js";
import type { ObservationComposer } from "./compose-observation.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { SpeechComposer } from "./compose-speech.js";
import type { Composer } from "./composer.js";
import { conversationOperations, startHistoryMaintenance } from "./conversation-operations.js";
import type { HostKernel } from "./host-kernel.js";
import { seedWorkspaceThenStartMemory } from "./lifecycle.js";
import { wireMemoryMaintenance } from "./memory-maintenance.js";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import {
  composeNotebookMemory,
  INERT_MEMORY_WIRING,
  type MemoryWiring,
} from "./notebook-memory.js";
import type { GrantedWords } from "./service.js";
import { agentRootPath } from "./store-path.js";
import { type StoreWiring, wireStore } from "./store-wiring.js";
import { reporterOf } from "./wire-helpers.js";

export type BrainWiring = ReturnType<typeof wireBrain>;

export interface BrainComposer extends Composer {
  readonly wiring: BrainWiring;
  readonly store: StoreWiring;
  readonly conversations: ReturnType<typeof conversationOperations>;
  readonly deliveries: DeliveryLedger<GrantedWords>;
  readonly cron: CronScheduler;
  memoryMode: () => ReturnType<MemoryWiring["mode"]>;
  syncMemory: () => void;
}

export interface BrainDependencies {
  kernel: HostKernel;
  settings: SettingsComposer;
  account: AccountComposer;
  issues: IssuesComposer;
  observation: ObservationComposer;
  speech: SpeechComposer;
}

export function composeBrain(dependencies: BrainDependencies): BrainComposer {
  const { kernel, account, issues, observation, speech } = dependencies;
  const { runMode, report, now, createId } = kernel;

  /**
   * The brain's store and the conversation it holds: one retained thread
   * shared by every panel window and persisted for the next launch. A window's
   * report is appended under an opaque reporter the client minted, so the
   * history event can skip echoing it to the window that reported it, and the
   * reporter names nothing about the window to anyone else.
   */
  const store = wireStore({
    persistent: runMode.observesProviders,
    createWorker: kernel.options.createWorker,
    agentRoot: () => agentRootPath(kernel.stateRoot),
    workspaceDirectory: kernel.agentWorkspacePath,
    ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true, mode: 0o700 }),
    now,
    createEventId: createId,
    onHistoryChanged: (sessionKey, entries, except) =>
      kernel.service().historyChanged(sessionKey, entries, except),
    onDirectoryChanged: () => undefined,
    report,
  });
  const deliveries = new DeliveryLedger<GrantedWords>({ nextDeliveryId: createId });
  let appGuide: AppGuideSnapshot = EMPTY_APP_GUIDE;
  let stopHistoryMaintenance: (() => void) | undefined;

  const memory: MemoryWiring = runMode.observesProviders
    ? composeNotebookMemory({
        client: store.client,
        embeddingAdapter: () => account.voiceCapabilities.embeddingAdapter,
        workspaceDirectory: kernel.agentWorkspacePath,
        conversationDirectory: () => store.directory(),
        isTemporary: store.isTemporary,
        now,
        report,
        onSynced: () => {
          void store.refreshNotebook();
        },
      })
    : INERT_MEMORY_WIRING;
  const memoryMaintenance = wireMemoryMaintenance({
    persistent: runMode.observesProviders,
    client: store.client,
    createRuntime: () => wiring.createRuntime(),
    workspaceDirectory: kernel.agentWorkspacePath,
    isTemporary: store.isTemporary,
    now,
    createId,
    report,
    onNotebookChanged: () => {
      void memory.sync();
    },
  });

  function standingContext(): string {
    const sessions = observation.actableSessions();
    const projects = observation.workspaceProjects();
    const defaults = observation.heldWorkspaceDefaults();
    return [
      workspaceProjectContextText(projects, defaults.defaultProviderId, defaults.defaultProjectIds),
      rememberedFactsText(store.rememberedFacts()),
      conversationHistoryText(recentConversationEntries(store.thread().entries()), sessions),
      appGuideContextText(appGuide),
    ]
      .filter((part): part is string => part !== undefined && part.trim().length > 0)
      .join("\n\n");
  }

  /**
   * Carries an app act only a renderer can perform to the native node, as the
   * validated act itself, serialized: the node hands it to the panel and
   * answers what became of it. No node connected, or one that answers in a
   * shape this build cannot read, is a refusal, and the act is left undone.
   */
  async function performAppAct(action: BrainAppActRequest["action"]): Promise<WireRecord> {
    const result = await kernel.nodes.invoke(HOST_NODE_CAPABILITY.PANEL_APP_ACT, {
      action: carried(action),
    });
    if (result.status === NODE_CAPABILITY_STATUS.OK && isRecord(result.value)) return result.value;
    if (result.status === NODE_CAPABILITY_STATUS.UNKNOWN) {
      return { status: UNKNOWN_ACT_STATUS, reason: result.reason };
    }
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason:
        result.status === NODE_CAPABILITY_STATUS.OK
          ? "The panel answered in a shape this build cannot read."
          : result.reason,
    };
  }

  const wiring = wireBrain({
    repositoryFor: (sessionKey) => store.brainStateRepository(sessionKey),
    ensureObservedConversation: async (sessionKey, name) => {
      await store.ensureConversation(sessionKey, CONVERSATION_KIND.OBSERVED, name);
    },
    ensureChildConversation: async (sessionKey, name) => {
      await store.ensureConversation(sessionKey, CONVERSATION_KIND.CHILD, name);
    },
    archiveConversation: (sessionKey) => store.archive(sessionKey),
    conversationDirectory: () => store.directory(),
    historyLines: (sessionKey) => store.thread(sessionKey).entries(),
    childStore: () => store.childStore(),
    createId,
    report,
    ...(account.agentTrace
      ? { traceTurn: (record) => account.agentTrace?.recordBrainTurn(record) }
      : undefined),
    recordConversationEntry: (entry, recordedAt, sessionKey) =>
      store.recordConversationEntry(entry, recordedAt, sessionKey),
    broadcastRequests: (snapshots) => kernel.service().runsReported(snapshots),
    onEndPublished: (record, sessionKey) => kernel.service().endPublished(record, sessionKey),
    onGenerationReplaced: (sessionKey) => {
      if (sessionKey === MAIN_SESSION_KEY) speech.withdrawBriefings();
      kernel.service().generationReplaced(sessionKey);
    },
    acts: {
      sessionActs: observation.sessionActs,
      sessions: observation.actableSessions,
      refreshSessions: () => observation.loop.refresh(),
      workspaceProjects: observation.workspaceProjects,
      workspaceDefaults: observation.workspaceDefaults,
      trackedIssues: () => issues.issues(),
      appGuide: () => appGuide,
      rememberedFacts: store.rememberedFacts,
      notebook: {
        remember: store.rememberNotebookEntry,
        forget: store.forgetNotebookEntry,
      },
      performAppAct: (action) => performAppAct(action),
      recordConversationEntry: store.recordConversationEntry,
    },
    roster: observation.roster,
    standingContext,
    pluginFor: observation.pluginFor,
    session: observation.session,
    deliver: speech.deliverBriefing,
    model: () => account.voiceCapabilities.brainModel,
    credential: () =>
      account.voiceCapabilities.voiceSource === VOICE_SOURCE.KEY
        ? {
            kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY,
            providerId: CREDENTIAL_PROVIDER_ID.OPENAI,
          }
        : { kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT },
    workspaceDirectory: kernel.agentWorkspacePath,
    skillRoots: () => [kernel.agentSkillsPath()],
    runnable: () =>
      runMode.observesProviders && runMode.sendsNetwork && account.capabilitiesActive(),
    dropBriefings: speech.dropBriefings,
    memory: (sessionKey) => memory.accessFor(sessionKey),
    beforeCompaction: (sessionKey) => memoryMaintenance.flushHookFor(sessionKey),
    flushMarker: (sessionKey) => memoryMaintenance.flushMarkerFor(sessionKey),
    beforeReset: (sessionKey, items) => memoryMaintenance.captureBeforeReset(sessionKey, items),
  });

  const conversations = conversationOperations({
    store,
    brain: wiring,
    now,
    report,
  });

  const cron = new CronScheduler({
    store: store.scheduledJobStore(),
    coordinate: (work) => wiring.lanes.run(LANE.CRON, work),
    // The heartbeat is the only job this build schedules. A row of any other
    // id is one a build before this one left behind — the nightly memory
    // consolidation, until now — and running it as a heartbeat would be a
    // turn nothing asked for, so it is removed instead.
    run: async (job) => {
      if (job.id !== HEARTBEAT_DEFAULTS.JOB_ID) {
        report(`A scheduled job this build does not run was removed: ${job.id}`);
        await cron.remove(job.id);
        return;
      }
      await wiring.heartbeat(job.sessionKey);
    },
    report,
  });

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.GUIDE_REPORT]: (params) => {
      if (!isAppGuideSnapshot(params.guide))
        return invalid("guide is not the shape a panel reports");
      appGuide = params.guide;
      return gatewayOk({});
    },
    [GATEWAY_METHOD.CONVERSATION_APPEND]: async (params) => {
      const sessionKey =
        params.sessionKey === undefined
          ? MAIN_SESSION_KEY
          : isIdentifier(params.sessionKey)
            ? toSessionKey(params.sessionKey)
            : undefined;
      if (!sessionKey) return invalid("sessionKey must be a non-empty string");
      if (!Array.isArray(params.entries)) return invalid("entries must be a list");
      const entries: ConversationEntry[] = [];
      for (const entry of params.entries) {
        const stored = storedConversationEntry(entry);
        if (!stored) return invalid("an entry is not the shape History keeps");
        entries.push(stored);
      }
      const accepted = await store.thread(sessionKey).append(entries, reporterOf(params));
      return gatewayOk({ accepted });
    },
  };

  return {
    methods,
    wiring,
    store,
    conversations,
    deliveries,
    cron,
    memoryMode: () => memory.mode(),
    syncMemory: () => {
      void memory.sync();
    },
    start: async () => {
      if (!runMode.observesProviders) return;
      await store.open();
      await seedWorkspaceThenStartMemory({
        seedWorkspace: async () => {
          await wiring.seedWorkspace();
        },
        startMemory: () => memory.start(),
        report,
      });
      await wiring.store().load();
      await store.restore();
      stopHistoryMaintenance = startHistoryMaintenance({ store, brain: wiring });
      await cron.start();
      await cron.ensure(heartbeatJob(now()));
    },
    stop: async () => {
      stopHistoryMaintenance?.();
      stopHistoryMaintenance = undefined;
      cron.stop();
      wiring.retire();
      memory.stop();
      await store.close();
    },
  };
}
