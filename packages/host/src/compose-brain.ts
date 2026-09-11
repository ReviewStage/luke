import fs from "node:fs";
import { type BrainDelivery, workspaceProjectContextText } from "@sidecar/brain";
import type { BrainAppActionRequest } from "@sidecar/brain/requests-wire";
import { workerStoreTransport } from "@sidecar/brain/store";
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
import { CREDENTIAL_REFERENCE_KIND } from "@sidecar/runtime";
import {
  CONVERSATION_KIND,
  conversationKindOf,
  DEFAULT_AGENT_ID,
  isIdentifier,
  MAIN_SESSION_KEY,
  MEMORY_SCOPE_KIND,
  type SessionKey,
  sessionKey as toSessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  type ConversationEntry,
  conversationLinesText,
  recentConversationEntries,
  storedConversationEntry,
} from "@sidecar/session";
import { VOICE_SOURCE } from "@sidecar/settings";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  UNKNOWN_ACTION_STATUS,
  type WireRecord,
} from "@sidecar/wire";
import { wireBrain } from "./brain/wiring.js";
import type { AccountComposer } from "./compose-account.js";
import type { IssuesComposer } from "./compose-issues.js";
import type { ObservationComposer } from "./compose-observation.js";
import type { Composer, ComposerContext } from "./composer.js";
import { conversationOperations, startConversationMaintenance } from "./conversation-operations.js";
import { seedWorkspaceThenStartMemory } from "./lifecycle.js";
import { wireMemoryDefinitions } from "./memory-definition.js";
import { wireMemoryMaintenance } from "./memory-maintenance.js";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import {
  composeNotebookMemory,
  INERT_MEMORY_WIRING,
  type MemoryWiring,
} from "./notebook-memory.js";
import { agentRootPath } from "./store-path.js";
import { type StoreWiring, wireStore } from "./store-wiring.js";
import { reporterOf } from "./wire-helpers.js";

type BrainWiring = ReturnType<typeof wireBrain>;

export interface BrainComposer extends Composer {
  readonly wiring: BrainWiring;
  readonly store: StoreWiring;
  readonly conversations: ReturnType<typeof conversationOperations>;
  memoryMode: () => ReturnType<MemoryWiring["mode"]>;
  syncMemory: () => void;
}

export interface BrainDependencies extends ComposerContext {
  account: AccountComposer;
  issues: IssuesComposer;
  observation: ObservationComposer;
  /** Where a briefing goes, and where a generation's end drops the ones not yet said; the merge routes both to the live session. */
  announcements: {
    deliverBriefing: (delivery: BrainDelivery) => void | Promise<void>;
    dropBriefings: () => void;
  };
}

export function composeBrain(dependencies: BrainDependencies): BrainComposer {
  const { kernel, account, issues, observation, announcements } = dependencies;
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
    transport: workerStoreTransport(kernel.options.createWorker),
    agentRoot: () => agentRootPath(kernel.stateRoot),
    workspaceDirectory: kernel.agentWorkspacePath,
    ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true, mode: 0o700 }),
    now,
    createEventId: createId,
    onConversationChanged: (sessionKey, entries, except) =>
      kernel.service().conversationChanged(sessionKey, entries, except),
    onDirectoryChanged: () => undefined,
    report,
  });
  let appGuide: AppGuideSnapshot = EMPTY_APP_GUIDE;
  let stopConversationMaintenance: (() => void) | undefined;

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

  /**
   * The notebook as every conversation's memory provider, bound to this
   * Mac's one account: the one agent's workspace is its notebook, so the
   * agent's id is the scope's key.
   */
  const memoryDefinitions = wireMemoryDefinitions({
    scope: { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: DEFAULT_AGENT_ID },
    index: memory,
    maintenance: memoryMaintenance,
    facts: store.rememberedFacts,
    workspaceDirectory: kernel.agentWorkspacePath,
    now,
  });

  /**
   * What a conversation is handed beside the roster, by which conversation it
   * is. The recent exchange reaches every conversation, so an observed
   * session's knows what the developer was just told before it briefs; the
   * remembered facts reach every conversation too, recalled by the memory
   * provider rather than rendered here. The app guide and the projects a
   * workspace could be created in belong to the conversations the developer
   * actually holds; an observed session's conversation and a child's brief
   * one session or one task, and would pay for both on every call and every
   * iteration of their tool loops.
   */
  function standingContext(sessionKey: SessionKey): string {
    const sessions = observation.actableSessions();
    const kind = conversationKindOf(sessionKey);
    const developerHeld = kind === CONVERSATION_KIND.MAIN || kind === CONVERSATION_KIND.THREAD;
    const defaults = observation.heldWorkspaceDefaults();
    return [
      ...(developerHeld
        ? [
            workspaceProjectContextText(
              observation.workspaceProjects(),
              defaults.defaultProviderId,
              defaults.defaultProjectIds,
            ),
          ]
        : []),
      conversationLinesText(recentConversationEntries(store.thread().entries()), sessions),
      ...(developerHeld ? [appGuideContextText(appGuide)] : []),
    ]
      .filter((part): part is string => part !== undefined && part.trim().length > 0)
      .join("\n\n");
  }

  /**
   * Carries an app act only a renderer can perform to the native node, as the
   * validated action itself, serialized: the node hands it to the panel and
   * answers what became of it. No node connected, or one that answers in a
   * shape this build cannot read, is a refusal, and the action is left undone.
   */
  async function performAppAction(action: BrainAppActionRequest["action"]): Promise<WireRecord> {
    const result = await kernel.nodes.invoke(HOST_NODE_CAPABILITY.PANEL_APP_ACTION, {
      action: carried(action),
    });
    if (result.status === NODE_CAPABILITY_STATUS.OK && isRecord(result.value)) return result.value;
    if (result.status === NODE_CAPABILITY_STATUS.UNKNOWN) {
      return { status: UNKNOWN_ACTION_STATUS, reason: result.reason };
    }
    return {
      status: ACTION_RESULT_STATUS.REJECTED,
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
    conversationLines: (sessionKey) => store.thread(sessionKey).entries(),
    childStore: () => store.childStore(),
    createId,
    report,
    ...(account.agentTrace
      ? { traceTurn: (record) => account.agentTrace?.recordBrainTurn(record) }
      : undefined),
    broadcastRequests: (snapshots) => kernel.service().runsReported(snapshots),
    onGenerationReplaced: (sessionKey) => {
      if (sessionKey === MAIN_SESSION_KEY) announcements.dropBriefings();
    },
    actions: {
      sessionActions: observation.sessionActions,
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
      performAppAction: (action) => performAppAction(action),
      recordConversationEntry: store.recordConversationEntry,
    },
    roster: observation.roster,
    standingContext,
    pluginFor: observation.pluginFor,
    session: observation.session,
    deliver: announcements.deliverBriefing,
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
    dropBriefings: announcements.dropBriefings,
    memory: memoryDefinitions,
    flushMarker: (sessionKey) => memoryMaintenance.flushMarkerFor(sessionKey),
  });

  const conversations = conversationOperations({
    store,
    brain: wiring,
    now,
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
        if (!stored) return invalid("an entry is not the shape Conversation keeps");
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
      stopConversationMaintenance = startConversationMaintenance({ store, brain: wiring });
    },
    stop: async () => {
      stopConversationMaintenance?.();
      stopConversationMaintenance = undefined;
      wiring.retire();
      memory.stop();
      await store.close();
    },
  };
}
