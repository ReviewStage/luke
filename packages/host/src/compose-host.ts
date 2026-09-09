import fs from "node:fs";
import path from "node:path";
import {
  AccountClient,
  AccountPreferencesClient,
  AccountSessionManager,
  accountGateOpen,
  HostedVaultClient,
} from "@sidecar/account";
import { ACCOUNT_STATUS, type AccountSnapshot, isAccountProvider } from "@sidecar/account/snapshot";
import { rememberedFactsText } from "@sidecar/acts";
import {
  PRODUCT_ACCOUNT_ACT,
  PRODUCT_CALENDAR_SOURCE,
  PRODUCT_DIAGNOSTIC_KIND,
  PRODUCT_EVENT,
  PRODUCT_SETTING_VALUE,
  PRODUCT_SUPERSET_ACT,
  type ProductDiagnosticKind,
  type ProductEventPropertiesFor,
  ProductEventSender,
  productEventFromWire,
  productSessionCountBucket,
  productSignInAge,
  type RecordProductEvent,
} from "@sidecar/analytics";
import {
  type BrainDelivery,
  type BrainMemoryAccess,
  DeliveryLedger,
  EMBEDDING_BATCH_SIZE,
} from "@sidecar/brain";
import { BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import type { BrainAppActRequest } from "@sidecar/brain/requests-wire";
import {
  activeMeetingEnd,
  GoogleCalendarReader,
  GoogleCalendarSignIn,
  type MeetingInterval,
  nextMeetingBoundary,
} from "@sidecar/calendar";
import {
  APPLE_CALENDAR_ACCESS,
  APPLE_CALENDAR_ID,
  CALENDAR_PRIVACY_PANE_URL,
} from "@sidecar/calendar/vocabulary";
import {
  CREDENTIAL_PROVIDER_ID,
  type CredentialProviderId,
  isCredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "@sidecar/credentials";
import { AgentTraceWriter, tracedModelAdapter } from "@sidecar/devtrace";
import { isAgentWireTrace } from "@sidecar/devtrace/vocabulary";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  type GatewayServer,
  type GatewayShutdownOptions,
  type GatewayShutdownSteps,
  gatewayOk,
  invalid,
  NODE_CAPABILITY_STATUS,
  NodeRegistry,
  shutdownGateway,
} from "@sidecar/gateway";
import {
  APP_SETTING_ID,
  type AppGuideSnapshot,
  appGuideContextText,
  EMPTY_APP_GUIDE,
  isAppGuideSnapshot,
} from "@sidecar/guide";
import { ISSUE_TRACKER_ID, normalizeTrackedIssue, type TrackedIssue } from "@sidecar/issues";
import {
  type MemorySyncReport,
  NotebookMemory,
  RETRIEVAL_MODE,
  type RetrievalMode,
} from "@sidecar/memory";
import {
  ADAPTER_DIAGNOSTIC_KIND,
  type AdapterDiagnosticKind,
  ConductorLocalWorkspaceAdapter,
  ConductorSessionApplicationReader,
  claudeDesktopApplications,
  codexCloudPlugin,
  ObservationHookRegistry,
  type ObservationSpoolWatcher,
  type ProviderRegistration,
  providerRegistrations,
  type WorkspaceHostEnrichment,
  type WorkspaceHostRegistration,
  watchObservationSpool,
  workspaceHostRegistrations,
} from "@sidecar/providers";
import {
  ARRIVAL_SPEECH_KIND,
  BRIEFING_SPEECH_KIND,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  type ConversationEntry,
  conversationHistoryText,
  recentConversationEntries,
  sessionContextText,
  storedConversationEntry,
  workspaceProjectContextText,
} from "@sidecar/realtime";
import { isSpeechOutcome, SPEECH_OUTCOME, type SpeechOutcome } from "@sidecar/realtime/speech";
import {
  CREDENTIAL_REFERENCE_KIND,
  CronScheduler,
  HEARTBEAT_DEFAULTS,
  heartbeatJob,
  LANE,
  ObservationLoop,
  ObservationSupervisor,
} from "@sidecar/runtime";
import {
  CONVERSATION_KIND,
  type ConversationRecord,
  type EmbeddingAdapter,
  isIdentifier,
  isTerminalChildRunStatus,
  MAIN_SESSION_KEY,
  type SessionKey,
  sessionKey as toSessionKey,
} from "@sidecar/runtime-contracts";
import type { RuntimeStoreClient, RuntimeStorePort } from "@sidecar/runtime-store";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  CreatedWorkspaceOpenTracker,
  isProviderId,
  isSessionApplicationId,
  isWorkspaceProviderId,
  normalizeObservedWorkspaceProjects,
  type ObservedWorkspaceProject,
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  type ProviderId,
  pluginAsAdapter,
  type Session,
  type SessionIdentity,
  type SessionProviderAdapter,
  SessionRoster,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  staleWorkspaceProjectDefaults,
  type WorkspaceAgentSelection,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  type AccountPreferenceField,
  type AccountPreferences,
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  isAppSettingField,
  isKeyedAppSettingField,
  isSettingEntryKey,
  isSettingsResetScope,
  SETTING_SIDE_EFFECT,
  type SettingEntryValue,
  settingAnalytics,
  settingEntryGuard,
  VOICE_SOURCE,
  VOICE_SOURCE_COUNTED_AS,
} from "@sidecar/settings";
import type { ObservedAccountCalendars, SettingsUpdateResult } from "@sidecar/settings/wire";
import {
  SUPERSET_SIGN_IN_STAGE,
  SupersetSignIn,
  supersetPlugin,
  supersetPressedLink,
} from "@sidecar/superset";
import { LinearCredentials, LinearIssueTracker, LinearSignIn } from "@sidecar/trackers";
import { type VoiceCapabilityApplication, VoiceCapabilityAssembler } from "@sidecar/voice";
import {
  ACT_RESULT_STATUS,
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  UNKNOWN_ACT_STATUS,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import {
  APPLE_CALENDAR_ACCESS_REFUSAL,
  type AppleCalendarHelperRun,
  AppleCalendarReader,
} from "./apple-calendar.js";
import { arrivalBeatOwed, countsFirstAnnouncement } from "./arrival-flow.js";
import type { WorkspaceCreationDefaults } from "./brain/act-performer.js";
import { wakeEventsFromHooks, wireBrain } from "./brain/wiring.js";
import { calendarOnboardingOwed } from "./calendar-onboarding-flow.js";
import { conversationOperations, startHistoryMaintenance } from "./conversation-operations.js";
import { seedWorkspaceThenStartMemory, shutdownStepsFlushingEvents } from "./lifecycle.js";
import { wireMemoryMaintenance } from "./memory-maintenance.js";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";
import { type OnboardingState, onboardingStateFile } from "./onboarding-state.js";
import { ProviderKeyVaultSync, type VaultSyncAccount } from "./provider-key-vault-sync.js";
import type { RunMode } from "./run-mode.js";
import { createGatewayService, type GatewayService, type GrantedWords } from "./service.js";
import { createSessionActPerformer, NodeAnswerLostError } from "./session-act-performer.js";
import { type SecretCipher, SettingsStore } from "./settings-store.js";
import { agentRootPath } from "./store-path.js";
import { wireRuntimeStore } from "./store-wiring.js";
import { type OnboardingBeatKind, SpeechArbiter } from "./voice/speech-arbiter.js";
import { VoiceReceiver } from "./voice-receiver.js";

/**
 * Luke's runtime as one host: everything that executes, persists, schedules,
 * observes, or holds an account, composed once over an explicit state root
 * and reached only through the Gateway server it returns. It draws nothing
 * and touches no window: what a window must learn leaves as a host event,
 * and what only this machine's desktop can do — open an address, carry an
 * act to a panel, run the EventKit helper — is asked of the native node by
 * name and answers a typed unavailable when no node is connected. The same
 * composition runs in the Gateway process for a live run and in the desktop
 * process, memory-only and network-silent, for a fixture or capture run; the
 * client code path is one either way.
 */
export interface HostSeams {
  /** Luke's own application-state root, given explicitly: never derived from the hosting process's profile. */
  stateRoot: string;
  runMode: RunMode;
  appVersion: string;
  packaged: boolean;
  /** The user's home, for the Superset CLI's own directory. */
  homeDirectory: string;
  /** The environment the host reads its development overrides from. */
  environment: NodeJS.ProcessEnv;
  cipher: SecretCipher;
  createWorker: () => RuntimeStorePort;
  /**
   * Whether the observation hooks are registered with the providers' own
   * user-level configurations at start. A validation run on a temporary
   * state root says no, so nothing of the developer's real provider
   * configuration moves; the transcripts are observed either way.
   */
  registerProviderHooks?: boolean;
  now: () => number;
  createId: () => string;
  report: (message: string) => void;
  /**
   * Hears the protocol's shutdown method: the client's explicit Quit, or a
   * newer build draining this one. The process hosting the runtime leaves in
   * the coordinator's order; a host with no process to leave (a fixture run)
   * hears nothing.
   */
  onShutdownRequested?: () => void;
}

export interface Host {
  /** The one boundary a client reaches this host through. */
  readonly server: GatewayServer;
  /** Opens the store, seeds the workspace, starts maintenance, scheduling, hooks, and observation. */
  start: () => Promise<void>;
  /**
   * The whole quit, in the coordinator's fixed order: admissions closed,
   * everything under way cancelled, a bounded wait for it to settle,
   * whatever did not settle written down as unresolved for the next launch's
   * recovery, and only then the store closed. A caller that ran the steps
   * itself would be a second order for the same quit, so there is none to
   * run: what became of it is reported, never answered, because nothing a
   * client could do with the answer is left to do.
   */
  stop: (options?: GatewayShutdownOptions) => Promise<void>;
}

const ACCOUNT_CLIENT_ID = "luke-desktop";
const SESSION_REFRESH_INTERVAL_MS = 60_000;
/** A board changes at the pace of hands, not of models; a minute is current. */
const ISSUE_REFRESH_INTERVAL_MS = 60_000;
/** A diary changes at the pace of hands too; five minutes is current. */
const CALENDAR_REFRESH_INTERVAL_MS = 5 * 60_000;
/**
 * How often held notices ask whether the meeting holding them has ended. The
 * question is answered from meetings already in memory, so asking often costs
 * nothing. The boundary timer is what answers on time — this tick is the net
 * behind it, for the clocks a timer cannot promise to keep: a laptop asleep
 * through the boundary, or a system clock moved by hand.
 */
const HELD_NOTICE_RELEASE_INTERVAL_MS = 30_000;
/**
 * How often the System Settings switch is asked about between passes. Each
 * probe is a fresh helper process on purpose: EventKit answers a running
 * process's authorization from state it read at launch, so only a fresh
 * process can be trusted about where the switch stands now. Ten seconds is
 * the longest consent taken back keeps holding anything.
 */
const APPLE_ACCESS_POLL_INTERVAL_MS = 10_000;

/** The agent's identity workspace and the skills beside it, under the agent's own directory. */
const AGENT_WORKSPACE_DIRECTORY = "workspace";

/**
 * How long the quit waits for the store to close after the drain has
 * settled. A close that hangs on a disk must not hold the process open past
 * its quit: what it could not write is what the next launch marks
 * interrupted, which is the same answer an unsettled drain leaves.
 */
const HOST_CLOSE_WAIT_MS = 5_000;
const AGENT_SKILLS_DIRECTORY = "skills";

const DIAGNOSTIC_COUNTED_AS = {
  [ADAPTER_DIAGNOSTIC_KIND.PASS_FAILURE]: PRODUCT_DIAGNOSTIC_KIND.PASS_FAILURE,
  [ADAPTER_DIAGNOSTIC_KIND.ACCIDENTAL_WAKE]: PRODUCT_DIAGNOSTIC_KIND.ACCIDENTAL_WAKE,
} satisfies Record<AdapterDiagnosticKind, ProductDiagnosticKind>;

function isSessionIdentity(value: UnparsedWireValue): value is SessionIdentity & WireRecord {
  return (
    isRecord(value) &&
    isWireString(value.providerId) &&
    isWireString(value.providerSessionId) &&
    value.providerSessionId.length > 0
  );
}

/**
 * One credential transition, from the seams this host owns: the brain
 * wiring's synchronous retire, the assembler's application, and the rebuild
 * that installs what the applied capability allows. The retire is immediate,
 * so no run keeps the old source's authority past the transition's first
 * await. The rebuild belongs to the current application alone, asked at the
 * moment of use rather than read off the answer: a newer transition can begin
 * between the assembler's publication and this continuation, and it has
 * already retired the wiring, so a rebuild on the older one's behalf would be
 * the newest thing the host was asked for and would install the retired
 * source over the selection still being read. An overtaken transition builds
 * nothing and leaves the host empty for the newer one to fill. Answers
 * whether this transition was the one that installed.
 */
interface VoiceCredentialTransitionSeams {
  retire: () => void;
  apply: () => Promise<VoiceCapabilityApplication>;
  rebuild: () => Promise<void>;
}

export async function transitionVoiceCredential(
  seams: VoiceCredentialTransitionSeams,
): Promise<boolean> {
  seams.retire();
  const applied = await seams.apply();
  if (!applied.latest || !applied.isCurrent()) return false;
  await seams.rebuild();
  return true;
}

/** The notebook's index as the host holds it, and what a run without one still answers. */
interface MemoryWiring {
  /** Syncs once and starts watching; a run with nothing on disk does neither. */
  start: () => Promise<void>;
  stop: () => void;
  /** One reconcile of the index against the files; a call during a pass earns one follow-on pass under the adapter standing then. */
  sync: () => Promise<MemorySyncReport | undefined>;
  /** The brain's memory tools for one conversation. */
  accessFor: (sessionKey: SessionKey) => BrainMemoryAccess | undefined;
  /** The retrieval mode the last sync settled on. */
  mode: () => RetrievalMode;
}

/** A run without a notebook: nothing on disk to index, so nothing to search. */
const INERT_MEMORY_WIRING: MemoryWiring = {
  start: async () => undefined,
  stop: () => undefined,
  sync: async () => undefined,
  accessFor: () => undefined,
  mode: () => RETRIEVAL_MODE.KEYWORD_ONLY,
};

export interface NotebookMemoryDependencies {
  client: () => RuntimeStoreClient;
  /** The embedding adapter the credential policy built, or nothing when no credential stands. */
  embeddingAdapter: () => EmbeddingAdapter | undefined;
  /** Hears every credential change that may have replaced the adapter; the index is synced again so keyword-only chunks gain their vectors. */
  onEmbeddingAdapterChanged?: (listener: () => void) => void;
  /** The agent's identity workspace, watched for the notebook's files. */
  workspaceDirectory: () => string;
  conversationDirectory: () => readonly ConversationRecord[];
  isTemporary: (sessionKey: SessionKey) => boolean;
  now: () => number;
  report: (message: string) => void;
  /** Hears every completed sync, so the notebook's cached entries can be read again after a hand edit. */
  onSynced?: () => void;
}

/**
 * The notebook's index as the host wires it: the memory package's host over
 * the store's worker and the embedding adapter the credential policy built.
 * This composes only; the sync and the search live in `NotebookMemory`.
 */
export function composeNotebookMemory(dependencies: NotebookMemoryDependencies): NotebookMemory {
  const memory = new NotebookMemory({
    store: dependencies.client,
    embeddingAdapter: dependencies.embeddingAdapter,
    embeddingBatchSize: EMBEDDING_BATCH_SIZE,
    workspaceDirectory: dependencies.workspaceDirectory,
    conversationDirectory: dependencies.conversationDirectory,
    isTemporary: dependencies.isTemporary,
    now: dependencies.now,
    report: dependencies.report,
    ...(dependencies.onSynced ? { onSynced: dependencies.onSynced } : undefined),
  });
  dependencies.onEmbeddingAdapterChanged?.(() => {
    void memory.sync();
  });
  return memory;
}

export function composeHost(options: HostSeams): Host {
  const { stateRoot, runMode, report, now, createId } = options;
  const userData = () => stateRoot;

  // A development build may be pointed at a local account service; a packaged one
  // may not. The override redirects the whole sign-in — including the identity
  // request that carries the access token — so it stops at the packaging boundary
  // rather than shipping inside a signed binary.
  const ACCOUNT_BASE_URL =
    (options.packaged ? undefined : options.environment.LUKE_ACCOUNT_BASE_URL) ??
    "https://tryluke.dev/api/auth";
  // The hosted voice endpoints live on the same origin as the account service,
  // so the one development override redirects both together.
  const HOSTED_SERVICE_BASE_URL = ACCOUNT_BASE_URL.replace(/\/api\/auth\/?$/, "");

  const nodes = new NodeRegistry();
  let service: GatewayService;

  /** One host event, numbered into the log every client follows. */
  const emit = (kind: (typeof GATEWAY_EVENT)[keyof typeof GATEWAY_EVENT], payload: WireValue) => {
    service.server.emit(kind, payload);
  };

  /**
   * An address a host-owned flow needs opened: the native node's. No node
   * connected is a refusal the act reports as not done; a node that took the
   * ask and vanished before answering is the lost-answer error, which every
   * caller that journals an act records as unknown rather than failed.
   */
  const openExternalThroughNode = async (url: string): Promise<void> => {
    const result = await nodes.invoke(HOST_NODE_CAPABILITY.OPEN_EXTERNAL, { url });
    if (result.status === NODE_CAPABILITY_STATUS.OK) return;
    if (result.status === NODE_CAPABILITY_STATUS.UNKNOWN) {
      throw new NodeAnswerLostError(result.reason);
    }
    throw new Error(result.reason);
  };

  const sessionRegistry = new SessionRoster();
  const codexCloud = codexCloudPlugin({
    onDiagnostic: (kind, error) => reportAdapterDiagnostic(PROVIDER_ID.CODEX, kind, error),
  });
  const conductorSessionApplications = new ConductorSessionApplicationReader();
  const claudeDesktopSessionApplications = claudeDesktopApplications();
  // The local counterpart of the cloud Conductor adapter's creation path: it
  // reads the repositories Conductor holds and creates a workspace in one by
  // handing Conductor's own creation deep link to the operating system, through
  // the native node.
  const conductorLocalWorkspaceAdapter = new ConductorLocalWorkspaceAdapter({
    openExternal: (url) => openExternalThroughNode(url),
  });
  const supersetHomeDirectory =
    options.environment.SUPERSET_HOME_DIR ?? path.join(options.homeDirectory, ".superset");
  const superset = supersetPlugin({ homeDirectory: supersetHomeDirectory });
  const supersetCli = superset.cli;
  const supersetWorkspaceAdapter = pluginAsAdapter(superset);
  const supersetWorkspaceHost: WorkspaceHostRegistration = {
    observationFailureLabel: "Superset observation",
    read: readSupersetWorkspaceHost,
    emptyEnrichment: (_providerId, observations) => observations,
  };
  const workspaceHosts = workspaceHostRegistrations({
    superset: supersetWorkspaceHost,
    conductorApplications: conductorSessionApplications,
    claudeDesktopApplications: claudeDesktopSessionApplications,
  });
  const settingsStore = new SettingsStore({
    directory: userData,
    // A fixture or evidence run refuses the credentials it resolves, so nothing is
    // reported as available that would not actually happen.
    credentialsUsable: runMode.observesProviders,
    cipher: options.cipher,
    environment: options.environment,
    codexCloudConnection: () => codexCloud.connection(),
  });
  const accountClient = new AccountClient({
    baseUrl: ACCOUNT_BASE_URL,
    clientId: ACCOUNT_CLIENT_ID,
  });
  let account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
  let accountPreferencesHydratedAccount: string | undefined;
  const accountSession = new AccountSessionManager({
    client: accountClient,
    store: settingsStore,
    hostedServiceBaseUrl: HOSTED_SERVICE_BASE_URL,
    requiresAccount: runMode.requiresAccount,
    openExternal: (url) => openExternalThroughNode(url),
    startCapabilities: () => startAccountCapabilities(),
    stopCapabilities: stopAccountCapabilities,
    onChange: (next) => {
      const signedIn = next.status === ACCOUNT_STATUS.SIGNED_IN;
      const wasSignedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
      const previousAccountKey =
        account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
      const nextAccountKey = signedIn ? next.email : undefined;
      account = next;
      if (previousAccountKey !== nextAccountKey) {
        accountPreferencesHydratedAccount = undefined;
      }
      // The first sign-in ever observed is also where the calendar step of
      // onboarding goes up: recorded on disk rather than derived, so quitting
      // at the gate and relaunching finds it standing. Written before the
      // account event below, so the gate is already standing when the
      // renderer learns it is signed in.
      if (signedIn && !wasSignedIn && onboardingState?.calendarOnboardingRequiredAt === undefined) {
        writeOnboardingState({ calendarOnboardingRequiredAt: new Date(now()).toISOString() });
        void settleCalendarOnboardingIfConnected();
      }
      emit(GATEWAY_EVENT.ACCOUNT_CHANGED, carried(account));
      void emitSettings();
      void emitSessionReplay();
      if (signedIn && !wasSignedIn) productEvents.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
      if (signedIn && !wasSignedIn && onboardingState?.arrivalSignedInAt === undefined) {
        writeOnboardingState({ arrivalSignedInAt: new Date(now()).toISOString() });
      }
    },
  });
  // The hook spool and every provider script live under the explicit state
  // root, the same directory the desktop always kept them in.
  const observationHooks = new ObservationHookRegistry(userData);
  const providerRegistry = providerRegistrations({
    readApiKey: (providerId) => settingsStore.readApiKey(providerId),
    observationHookInstallation: (providerId) => observationHooks.installation(providerId),
    codexCloud,
    onDiagnostic: reportAdapterDiagnostic,
  });
  const orderedRegistrations: readonly ProviderRegistration[] = PROVIDER_ID_LIST.map(
    (providerId) => providerRegistry[providerId],
  );
  const linearCredentials = new LinearCredentials({
    readGrant: () => settingsStore.readGrant(CREDENTIAL_PROVIDER_ID.LINEAR),
    writeGrant: async (grant) => {
      await settingsStore.setGrant(CREDENTIAL_PROVIDER_ID.LINEAR, grant);
    },
    forgetGrant: async () => {
      const cleared = await settingsStore.clearGrant(CREDENTIAL_PROVIDER_ID.LINEAR);
      // Nobody pressed anything to end this connection — Linear refused the
      // renewal — so no settings reply is on its way to say so.
      emitSettingsSnapshot(cleared.settings);
    },
  });
  const linearTracker = new LinearIssueTracker({
    readAccessToken: () => linearCredentials.accessToken(),
  });
  const linearSignIn = new LinearSignIn({
    openExternal: (url) => void openExternalThroughNode(url).catch(reportOpenFailure),
  });
  const issueTrackers = [linearTracker] as const;
  let trackedIssues: readonly TrackedIssue[] | undefined;
  const googleCalendar = new GoogleCalendarReader({
    readAccounts: () => settingsStore.readCalendarAccounts(),
  });
  const googleCalendarSignIn = new GoogleCalendarSignIn({
    openExternal: (url) => void openExternalThroughNode(url).catch(reportOpenFailure),
  });
  /**
   * The EventKit helper runs on the desktop, where the device is: each
   * invocation the reader composes — a command fixed by the build, the
   * window's instants, the chosen calendar ids — crosses to the native node
   * and its stdout comes back. No node connected is a failed read, which
   * the reader answers by standing what it last showed, never by emptying
   * a calendar on the strength of an absent desktop.
   */
  const runAppleCalendarHelper: AppleCalendarHelperRun = async (helperArguments, timeoutMs) => {
    const result = await nodes.invoke(HOST_NODE_CAPABILITY.APPLE_CALENDAR_HELPER, {
      arguments: [...helperArguments],
      timeoutMs,
    });
    if (result.status !== NODE_CAPABILITY_STATUS.OK) throw new Error(result.reason);
    if (!isWireString(result.value)) throw new Error("the helper answered no text");
    return result.value;
  };
  const appleCalendar = new AppleCalendarReader({
    readConnection: () => settingsStore.readAppleCalendarConnection(),
    runHelper: runAppleCalendarHelper,
    now,
  });
  let calendarMeetings: readonly MeetingInterval[] | undefined;
  let quietBoundaryTimer: NodeJS.Timeout | undefined;
  let observedCalendars: readonly ObservedAccountCalendars[] = [];
  let heldNoticeReleaseTimer: NodeJS.Timeout | undefined;
  let appleAccessPollTimer: NodeJS.Timeout | undefined;
  let appleAccessProbeFailing = false;
  let announcementsHeld = false;

  /**
   * The runtime store and the conversation it holds: one retained thread
   * shared by every panel window and persisted for the next launch. A window's
   * report is appended under an opaque reporter the client minted, so the
   * history event can skip echoing it to the window that reported it, and the
   * reporter names nothing about the window to anyone else.
   */
  const runtimeStoreWiring = wireRuntimeStore({
    persistent: runMode.observesProviders,
    createWorker: options.createWorker,
    agentRoot: () => agentRootPath(stateRoot),
    workspaceDirectory: () => agentWorkspacePath(),
    ensureDirectory: (directory) => fs.mkdirSync(directory, { recursive: true, mode: 0o700 }),
    now,
    createEventId: createId,
    onHistoryChanged: (sessionKey, entries, except) =>
      service.historyChanged(sessionKey, entries, except),
    onDirectoryChanged: () => undefined,
    report,
  });
  const brainReplyDeliveries = new DeliveryLedger<GrantedWords>({ nextDeliveryId: createId });
  /**
   * The one voice receiver, as the client that owns the voice window reports
   * it: the host mints the epochs, so a claim names an epoch this host issued,
   * and a client's connection closing ends the epoch as its renderer going
   * away would.
   */
  const voiceReceiver = new VoiceReceiver();
  let spoolWatchers: readonly ObservationSpoolWatcher[] = [];
  let appGuide: AppGuideSnapshot = EMPTY_APP_GUIDE;
  const createdWorkspaceOpens = new CreatedWorkspaceOpenTracker();
  /**
   * The development trace, gated so it cannot exist for a user: a packaged
   * build never reads the variable, a fixture or evidence run has no traffic to
   * tap and constructs no writer.
   */
  const agentTraceDirectory =
    options.packaged || !runMode.sendsNetwork ? undefined : options.environment.LUKE_TRACE_DIR;
  const agentTrace = agentTraceDirectory
    ? new AgentTraceWriter({ directory: agentTraceDirectory })
    : undefined;
  if (agentTrace) report(`Agent trace: ${agentTrace.file}`);
  const speechArbiter = new SpeechArbiter({
    now,
    nextId: createId,
    ...(agentTrace ? { trace: (record) => agentTrace.recordSpeechDecision(record) } : undefined),
  });
  const voiceCapabilities = new VoiceCapabilityAssembler({
    settings: settingsStore,
    credentialsUsable: () => runMode.sendsNetwork && accountCapabilitiesActive(),
    fixtureRun: () => !runMode.sendsNetwork,
    accountSignedIn: () => account.status === ACCOUNT_STATUS.SIGNED_IN,
    hostedServiceBaseUrl: HOSTED_SERVICE_BASE_URL,
    refreshAccount: accountSession.refreshOnce,
    ...(agentTrace
      ? {
          wrapBrainModel: (model) =>
            tracedModelAdapter(model, (record) => agentTrace.recordBrainRequest(record)),
        }
      : undefined),
  });
  const productEvents = new ProductEventSender({
    serviceBaseUrl: HOSTED_SERVICE_BASE_URL,
    appVersion: options.appVersion,
    sends: runMode.sendsNetwork,
    readAccessToken: async () => (await settingsStore.readAccount())?.accessToken,
    refreshAccount: accountSession.refreshOnce,
  });
  const hostedVault = new HostedVaultClient({
    serviceBaseUrl: HOSTED_SERVICE_BASE_URL,
    readAccessToken: async () =>
      runMode.sendsNetwork ? (await settingsStore.readAccount())?.accessToken : undefined,
    refreshAccount: accountSession.refreshOnce,
    readAccountKey: async () => (await settingsStore.readAccount())?.email,
  });
  const accountPreferencesClient = new AccountPreferencesClient({
    serviceBaseUrl: HOSTED_SERVICE_BASE_URL,
    readAccessToken: async () =>
      runMode.sendsNetwork ? (await settingsStore.readAccount())?.accessToken : undefined,
    refreshAccount: accountSession.refreshOnce,
    readAccountKey: readAccountPreferenceAccountKey,
  });
  const providerKeyVaultSync = new ProviderKeyVaultSync({
    vault: hostedVault,
    readStoredApiKey: (providerId) => settingsStore.readStoredApiKey(providerId),
    account: async () => {
      const held = await settingsStore.readAccount();
      if (!held) return undefined;
      const vaultAccount: VaultSyncAccount = { email: held.email };
      if (held.id) vaultAccount.id = held.id;
      return vaultAccount;
    },
    tenant: {
      read: () => settingsStore.readVaultSyncAccount(),
      write: (accountKey) => settingsStore.setVaultSyncAccount(accountKey),
    },
  });
  let accountPreferencesSync: Promise<void> = Promise.resolve();
  function reconcileProviderKeyVault(): void {
    void settingsStore
      .snapshot()
      .then((settings) =>
        settings.stored.syncProviderKeys
          ? providerKeyVaultSync.apply(true, { claim: false })
          : undefined,
      );
  }

  async function readAccountPreferenceAccountKey(): Promise<string | undefined> {
    return (await settingsStore.readAccount())?.email;
  }

  function queueAccountPreferencesSync(label: string, work: () => Promise<void>): Promise<void> {
    const queued = accountPreferencesSync.then(work, work).catch((error) => {
      report(
        `Account preferences ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    accountPreferencesSync = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  function accountPreferencesEmpty(preferences: AccountPreferences): boolean {
    return Object.keys(preferences).length === 0;
  }

  function accountPreferencesSame(left: AccountPreferences, right: AccountPreferences): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  async function accountPreferenceHydrationBaseline(
    accountEmail: string,
  ): Promise<AccountPreferences> {
    const baseline = await settingsStore.accountPreferencesSyncBaseline(accountEmail);
    if (baseline !== undefined) return baseline;
    const preferences = await settingsStore.accountPreferences();
    await settingsStore.setAccountPreferencesSyncBaseline(accountEmail, preferences);
    return preferences;
  }

  function isAccountPreferenceField(field: AppSettingField): field is AccountPreferenceField {
    return ACCOUNT_PREFERENCE_FIELDS.some((candidate) => candidate === field);
  }

  function resetTouchesAccountPreferences(scope: UnparsedWireValue): boolean {
    return ACCOUNT_PREFERENCE_FIELDS.some((field) => {
      const definition = APP_SETTING_SCHEMA[field];
      return "resetScope" in definition && definition.resetScope === scope;
    });
  }

  async function reconcileAccountPreferences(): Promise<void> {
    return queueAccountPreferencesSync("reconcile", async () => {
      const accountKey = await readAccountPreferenceAccountKey();
      if (!accountKey) return;
      await hydrateAccountPreferences(accountKey);
    });
  }

  async function hydrateAccountPreferences(accountKey: string): Promise<boolean> {
    const baseline = await accountPreferenceHydrationBaseline(accountKey);
    if ((await readAccountPreferenceAccountKey()) !== accountKey) return false;
    const remote = await accountPreferencesClient.readPreferences();
    if (!remote || (await readAccountPreferenceAccountKey()) !== accountKey) return false;

    if (!remote.hasStoredSnapshot) {
      const preferences = await settingsStore.accountPreferences();
      if ((await readAccountPreferenceAccountKey()) !== accountKey) return false;
      if (!accountPreferencesEmpty(preferences)) {
        const written = await accountPreferencesClient.writePreferences(preferences);
        if (!written || (await readAccountPreferenceAccountKey()) !== accountKey) return false;
      }
      if (!(await settingsStore.setAccountPreferencesSyncBaseline(accountKey, preferences))) {
        return false;
      }
      accountPreferencesHydratedAccount = accountKey;
      return true;
    }

    const saved = await settingsStore.applyAccountPreferences(remote.preferences, {
      accountEmail: accountKey,
      preferences: baseline,
    });
    if ((await readAccountPreferenceAccountKey()) !== accountKey) return false;
    accountPreferencesHydratedAccount = accountKey;
    const preferences = await settingsStore.accountPreferences();
    if ((await readAccountPreferenceAccountKey()) !== accountKey) return false;
    if (saved.changed.length > 0) {
      await applyAccountPreferenceSideEffects(saved, saved.changed);
    }
    if (!accountPreferencesSame(preferences, remote.preferences)) {
      const written = await accountPreferencesClient.writePreferences(preferences);
      if (!written || (await readAccountPreferenceAccountKey()) !== accountKey) return true;
    }
    await settingsStore.setAccountPreferencesSyncBaseline(accountKey, preferences);
    return true;
  }

  function pushAccountPreferences(): void {
    void queueAccountPreferencesSync("write", async () => {
      const accountKey = await readAccountPreferenceAccountKey();
      if (!accountKey) return;
      if (
        accountPreferencesHydratedAccount !== accountKey &&
        !(await hydrateAccountPreferences(accountKey))
      ) {
        return;
      }
      const preferences = await settingsStore.accountPreferences();
      if (
        (await readAccountPreferenceAccountKey()) !== accountKey ||
        accountPreferencesHydratedAccount !== accountKey
      ) {
        return;
      }
      const written = await accountPreferencesClient.writePreferences(preferences);
      if (!written || (await readAccountPreferenceAccountKey()) !== accountKey) return;
      await settingsStore.setAccountPreferencesSyncBaseline(accountKey, preferences);
    });
  }

  const recordProductEvent: RecordProductEvent = (name, properties) =>
    productEvents.record(name, properties);

  function reportOpenFailure(error: Error): void {
    report(`An address could not be opened: ${error.message}`);
  }

  function reportAdapterDiagnostic(
    providerId: ProviderId,
    kind: AdapterDiagnosticKind,
    error: Error,
  ): void {
    report(`Observation diagnostic (${providerId}, ${kind}): ${error.message}`);
    const counted = DIAGNOSTIC_COUNTED_AS[kind];
    if (!counted) return;
    productEvents.record(PRODUCT_EVENT.SESSION_DIAGNOSTIC, {
      provider_id: providerId,
      diagnostic_kind: counted,
    });
  }

  /**
   * Whether an account was deleted in this run, which stands recording down
   * for the rest of it; the client relays the answer to its renderers.
   */
  let sessionReplayEndedByDeletion = false;

  async function sessionReplayState(): Promise<{ permitted: boolean; accountId?: string }> {
    const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
    const accountId = signedIn ? (await settingsStore.readAccount())?.id : undefined;
    return {
      permitted: runMode.sendsNetwork && !sessionReplayEndedByDeletion,
      ...(accountId ? { accountId } : undefined),
    };
  }

  let sessionReplayGeneration = 0;
  async function emitSessionReplay(): Promise<void> {
    // The account is read asynchronously, and a sign-out reports the transition
    // before it clears the stored account, so a late answer must not restart
    // recording under the person who just left.
    const generation = ++sessionReplayGeneration;
    const replay = await sessionReplayState();
    if (generation !== sessionReplayGeneration) return;
    emit(GATEWAY_EVENT.SESSION_REPLAY_CHANGED, carried(replay));
  }

  function emitSettingsSnapshot(
    settings: SettingsUpdateResult["settings"],
    reporter?: string,
  ): void {
    emit(GATEWAY_EVENT.SETTINGS_CHANGED, {
      settings: carried(settings),
      ...(reporter !== undefined ? { reporter } : undefined),
    });
  }

  async function emitSettings(): Promise<void> {
    emitSettingsSnapshot(await settingsStore.snapshot());
  }

  let announcedCodexCloudConnection = codexCloud.connection();
  async function emitCodexCloudConnection(): Promise<void> {
    const connection = codexCloud.connection();
    if (connection === announcedCodexCloudConnection) return;
    announcedCodexCloudConnection = connection;
    await emitSettings();
  }

  const onboarding = onboardingStateFile(() => stateRoot, report);
  let onboardingState: OnboardingState | undefined;
  let announcedCalendarGateOwed: boolean | undefined;
  function calendarOnboardingGateOwed(): boolean {
    return runMode.requiresAccount && calendarOnboardingOwed(onboardingState);
  }
  /**
   * The one onboarding write, taking the moment it records and merging it over
   * the record as it stands on disk — the desktop process writes the
   * introduction's own moment into the same file. Every moment lives in one
   * record, so each write reconciles both beats; the gate event stays fenced
   * on a changed answer, so writing an arrival moment cannot tell the renderer
   * about a gate that did not move.
   */
  function writeOnboardingState(moment: OnboardingState): void {
    onboardingState = onboarding.update((current) => ({ ...current, ...moment }));
    if (moment.arrivalSpokenAt !== undefined) withdrawBeat(ARRIVAL_SPEECH_KIND);
    const owed = calendarOnboardingGateOwed();
    if (!owed) withdrawBeat(CALENDAR_ONBOARDING_SPEECH_KIND);
    if (owed === announcedCalendarGateOwed) return;
    announcedCalendarGateOwed = owed;
    emit(GATEWAY_EVENT.CALENDAR_ONBOARDING_CHANGED, { owed });
  }
  async function settleCalendarOnboardingIfConnected(): Promise<void> {
    if (!calendarOnboardingOwed(onboardingState)) return;
    const connected = await settingsStore.calendarConnectionStored();
    if (!connected || !calendarOnboardingOwed(onboardingState)) return;
    writeOnboardingState({ calendarOnboardingSettledAt: new Date(now()).toISOString() });
  }
  async function calendarGateOfferable(): Promise<boolean> {
    if (!calendarOnboardingGateOwed()) return false;
    const settings = await settingsStore.snapshot();
    if (!calendarOnboardingGateOwed()) return false;
    return settings.status.appleCalendarAvailable || settings.status.calendarSignInAvailable;
  }
  async function requestOnboardingBeat(): Promise<void> {
    if (!runMode.requiresAccount || account.status !== ACCOUNT_STATUS.SIGNED_IN) return;
    if (!voiceCapabilities.realtimeCredentials) return;
    if (await calendarGateOfferable()) {
      speechArbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
      void reconcileSpeech();
      return;
    }
    if (!arrivalBeatOwed(onboardingState)) return;
    await sessionObservationLoop.refresh().catch(() => undefined);
    if (account.status !== ACCOUNT_STATUS.SIGNED_IN || !arrivalBeatOwed(onboardingState)) return;
    speechArbiter.request({ kind: ARRIVAL_SPEECH_KIND });
    void reconcileSpeech();
  }
  function markFirstAnnouncementSpoken(): void {
    if (!countsFirstAnnouncement(onboardingState)) return;
    const signedInAt = onboardingState?.arrivalSignedInAt;
    const at = now();
    const signedInAtMs = signedInAt !== undefined ? Date.parse(signedInAt) : Number.NaN;
    if (Number.isFinite(signedInAtMs)) {
      productEvents.record(PRODUCT_EVENT.VOICE_FIRST_ANNOUNCEMENT, {
        sign_in_age: productSignInAge(at - signedInAtMs),
      });
    }
    writeOnboardingState({ arrivalFirstAnnouncementAt: new Date(at).toISOString() });
  }

  const supersetSignIn = new SupersetSignIn({
    cli: supersetCli,
    openExternal: (url) => openExternalThroughNode(url),
    onChange: (state) => {
      emit(GATEWAY_EVENT.SUPERSET_SIGN_IN_CHANGED, carried(state));
      if (state.stage !== SUPERSET_SIGN_IN_STAGE.CONNECTED) return;
      void sessionObservationLoop.refresh();
      recordProductEvent(PRODUCT_EVENT.SUPERSET_ACT, {
        superset_act: PRODUCT_SUPERSET_ACT.SIGN_IN_COMPLETE,
      });
    },
  });

  let unsubscribeSessions: (() => void) | undefined;
  let lastWorkspaceProjects: string | undefined;
  let workspaceProjectsBroadcastGeneration = 0;

  async function broadcastWorkspaceProjects(): Promise<void> {
    const generation = ++workspaceProjectsBroadcastGeneration;
    const offeredProjects = offeredWorkspaceProjects();
    const defaults = (await readWorkspaceDefaults()).defaultProjectIds;
    if (generation !== workspaceProjectsBroadcastGeneration) return;
    await pruneWorkspaceProjectDefaults(
      offeredProjects,
      defaults,
      () => generation === workspaceProjectsBroadcastGeneration,
    );
    if (generation !== workspaceProjectsBroadcastGeneration) return;
    const projects = normalizeObservedWorkspaceProjects(offeredProjects, defaults);
    const serialized = JSON.stringify(projects);
    if (serialized === lastWorkspaceProjects) return;
    lastWorkspaceProjects = serialized;
    emit(GATEWAY_EVENT.WORKSPACE_PROJECTS_CHANGED, { projects: carried(projects) });
  }

  async function pruneWorkspaceProjectDefaults(
    projects: readonly ObservedWorkspaceProject[],
    defaults: Readonly<Partial<Record<string, string>>> | undefined,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (account.status === ACCOUNT_STATUS.SIGNED_IN) return;
    try {
      for (const providerId of staleWorkspaceProjectDefaults(projects, defaults)) {
        if (!isCurrent()) return;
        const expected = defaults?.[providerId];
        if (expected === undefined) continue;
        const saved = await settingsStore.clearEntryIfUnchanged(
          APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
          providerId,
          expected,
        );
        if (!saved.cleared) continue;
        if (!isCurrent()) return;
        emitSettingsSnapshot(saved.settings);
      }
    } catch {
      return;
    }
  }

  function accountCapabilitiesActive(): boolean {
    return accountGateOpen(runMode, account.status === ACCOUNT_STATUS.SIGNED_IN);
  }

  async function startAccountCapabilities(): Promise<void> {
    if (!accountCapabilitiesActive()) return;
    void reconcileAccountPreferences();
    await applyVoiceCredential();
    await emitSettings();
    if (!accountCapabilitiesActive()) return;
    startSessionObservation();
    startCalendarObservation();
    observationSupervisor.setEnabled(true);
    void requestOnboardingBeat();
    reconcileProviderKeyVault();
  }

  async function stopAccountCapabilities(): Promise<void> {
    observationSupervisor.setEnabled(false);
    stopSessionObservation();
    stopIssueObservation();
    stopCalendarObservation();
    withdrawBeat(ARRIVAL_SPEECH_KIND);
    withdrawBeat(CALENDAR_ONBOARDING_SPEECH_KIND);
    await applyVoiceCredential();
    await emitSettings();
  }

  async function applyVoiceCredential(): Promise<void> {
    await transitionVoiceCredential({
      retire: () => brainWiring.retire(),
      apply: () => voiceCapabilities.apply(),
      rebuild: async () => {
        await brainWiring.rebuild();
        void memoryWiring.sync();
      },
    });
  }

  function withdrawBriefings(): void {
    const offered = speechArbiter.withdrawBriefings();
    if (offered) emit(GATEWAY_EVENT.SPEECH_WITHDRAWN, { id: offered });
    offerNextSpeech();
  }

  function brainRoster() {
    const at = now();
    const sessions = sessionRegistry.list().filter((session) => session.realtimeVoice !== true);
    return {
      text: sessionContextText(sessions, at),
      identities: sessions.map((session) => ({
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      })),
      sessions,
    };
  }

  function brainActableSessions(): readonly Session[] {
    return sessionRegistry.list().filter((session) => session.realtimeVoice !== true);
  }

  let brainWorkspaceDefaults: WorkspaceCreationDefaults = {};

  async function readWorkspaceDefaults(): Promise<WorkspaceCreationDefaults> {
    const [defaultProviderId, defaultProjectIds] = await Promise.all([
      settingsStore.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
      settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
    ]);
    const defaults: WorkspaceCreationDefaults = {};
    if (defaultProviderId) defaults.defaultProviderId = defaultProviderId;
    if (defaultProjectIds) defaults.defaultProjectIds = defaultProjectIds;
    brainWorkspaceDefaults = defaults;
    return defaults;
  }

  function brainWorkspaceProjects(): readonly ObservedWorkspaceProject[] {
    return normalizeObservedWorkspaceProjects(
      offeredWorkspaceProjects(),
      brainWorkspaceDefaults.defaultProjectIds,
    );
  }

  function brainStandingContext(): string {
    const sessions = brainActableSessions();
    const projects = brainWorkspaceProjects();
    return [
      workspaceProjectContextText(
        projects,
        brainWorkspaceDefaults.defaultProviderId,
        brainWorkspaceDefaults.defaultProjectIds,
      ),
      rememberedFactsText(runtimeStoreWiring.rememberedFacts()),
      conversationHistoryText(
        recentConversationEntries(runtimeStoreWiring.thread().entries()),
        sessions,
      ),
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
  async function performBrainAppAct(action: BrainAppActRequest["action"]): Promise<WireRecord> {
    const result = await nodes.invoke(HOST_NODE_CAPABILITY.PANEL_APP_ACT, {
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

  async function deliverBriefing(delivery: BrainDelivery): Promise<void> {
    if (!voiceCapabilities.realtimeCredentials) return;
    speechArbiter.request({ kind: BRIEFING_SPEECH_KIND, delivery });
    await reconcileSpeech();
  }

  const sessionActPerformer = createSessionActPerformer({
    sessionRegistry,
    openExternal: (url) => openExternalThroughNode(url),
    adapterFor,
    sendsNetwork: runMode.sendsNetwork,
    settingsStore,
    rememberWorkspaceDefaults,
    expectCreatedWorkspace: (identity, at) => createdWorkspaceOpens.expect(identity, at),
    openCreatedWorkspaces: () => openCreatedWorkspaces(sessionRegistry.list()),
    trackedIssues: () => trackedIssues,
    issueTrackers,
    refreshIssues: () => void issueObservationLoop.refresh(),
    supersetContext: (identity) =>
      superset.actableContext(identity.providerId, identity.providerSessionId),
    supersetCli,
    recordProductEvent,
  });

  const agentWorkspacePath = () => path.join(agentRootPath(stateRoot), AGENT_WORKSPACE_DIRECTORY);

  const memoryWiring: MemoryWiring = runMode.observesProviders
    ? composeNotebookMemory({
        client: runtimeStoreWiring.client,
        embeddingAdapter: () => voiceCapabilities.embeddingAdapter,
        workspaceDirectory: agentWorkspacePath,
        conversationDirectory: () => runtimeStoreWiring.directory(),
        isTemporary: runtimeStoreWiring.isTemporary,
        now,
        report,
        onSynced: () => {
          void runtimeStoreWiring.refreshNotebook();
        },
      })
    : INERT_MEMORY_WIRING;
  const memoryMaintenance = wireMemoryMaintenance({
    persistent: runMode.observesProviders,
    client: runtimeStoreWiring.client,
    createRuntime: () => brainWiring.createRuntime(),
    workspaceDirectory: agentWorkspacePath,
    isTemporary: runtimeStoreWiring.isTemporary,
    now,
    createId,
    report,
    onNotebookChanged: () => {
      void memoryWiring.sync();
    },
  });
  const brainWiring = wireBrain({
    repositoryFor: (sessionKey) => runtimeStoreWiring.brainStateRepository(sessionKey),
    ensureObservedConversation: async (sessionKey, name) => {
      await runtimeStoreWiring.ensureConversation(sessionKey, CONVERSATION_KIND.OBSERVED, name);
    },
    ensureChildConversation: async (sessionKey, name) => {
      await runtimeStoreWiring.ensureConversation(sessionKey, CONVERSATION_KIND.CHILD, name);
    },
    archiveConversation: (sessionKey) => runtimeStoreWiring.archive(sessionKey),
    conversationDirectory: () => runtimeStoreWiring.directory(),
    historyLines: (sessionKey) => runtimeStoreWiring.thread(sessionKey).entries(),
    childStore: () => runtimeStoreWiring.childStore(),
    createId,
    report,
    ...(agentTrace ? { traceTurn: (record) => agentTrace.recordBrainTurn(record) } : undefined),
    recordConversationEntry: (entry, recordedAt, sessionKey) =>
      runtimeStoreWiring.recordConversationEntry(entry, recordedAt, sessionKey),
    broadcastRequests: (snapshots) => service.runsReported(snapshots),
    onEndPublished: (record, sessionKey) => service.endPublished(record, sessionKey),
    onGenerationReplaced: (sessionKey) => {
      if (sessionKey === MAIN_SESSION_KEY) withdrawBriefings();
      service.generationReplaced(sessionKey);
    },
    acts: {
      sessionActs: sessionActPerformer,
      sessions: brainActableSessions,
      refreshSessions: () => sessionObservationLoop.refresh(),
      workspaceProjects: brainWorkspaceProjects,
      workspaceDefaults: readWorkspaceDefaults,
      trackedIssues: () => trackedIssues,
      appGuide: () => appGuide,
      rememberedFacts: runtimeStoreWiring.rememberedFacts,
      notebook: {
        remember: runtimeStoreWiring.rememberNotebookEntry,
        forget: runtimeStoreWiring.forgetNotebookEntry,
      },
      performAppAct: (action) => performBrainAppAct(action),
      recordConversationEntry: runtimeStoreWiring.recordConversationEntry,
    },
    roster: brainRoster,
    standingContext: brainStandingContext,
    adapterFor,
    session: (identity) => sessionRegistry.get(identity),
    deliver: deliverBriefing,
    model: () => voiceCapabilities.brainModel,
    credential: () =>
      voiceCapabilities.voiceSource === VOICE_SOURCE.KEY
        ? {
            kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY,
            providerId: CREDENTIAL_PROVIDER_ID.OPENAI,
          }
        : { kind: CREDENTIAL_REFERENCE_KIND.HOSTED_ACCOUNT },
    workspaceDirectory: agentWorkspacePath,
    skillRoots: () => [path.join(agentWorkspacePath(), AGENT_SKILLS_DIRECTORY)],
    runnable: () =>
      runMode.observesProviders && runMode.sendsNetwork && accountCapabilitiesActive(),
    dropBriefings: () => speechArbiter.dropBriefings(),
    memory: (sessionKey) => memoryWiring.accessFor(sessionKey),
    beforeCompaction: (sessionKey) => memoryMaintenance.flushHookFor(sessionKey),
    flushMarker: (sessionKey) => memoryMaintenance.flushMarkerFor(sessionKey),
    beforeReset: (sessionKey, items) => memoryMaintenance.captureBeforeReset(sessionKey, items),
  });

  const conversationControls = conversationOperations({
    store: runtimeStoreWiring,
    brain: brainWiring,
    now,
    report,
  });
  let stopHistoryMaintenance: (() => void) | undefined;

  const cronScheduler = new CronScheduler({
    store: runtimeStoreWiring.scheduledJobStore(),
    coordinate: (work) => brainWiring.lanes.run(LANE.CRON, work),
    // The heartbeat is the only job this build schedules. A row of any other
    // id is one a build before this one left behind — the nightly memory
    // consolidation, until now — and running it as a heartbeat would be a
    // turn nothing asked for, so it is removed instead.
    run: async (job) => {
      if (job.id !== HEARTBEAT_DEFAULTS.JOB_ID) {
        report(`A scheduled job this build does not run was removed: ${job.id}`);
        await cronScheduler.remove(job.id);
        return;
      }
      await brainWiring.heartbeat(job.sessionKey);
    },
    report,
  });

  function adapterFor(providerId: string) {
    if (providerId === SUPERSET_WORKSPACE_PROVIDER_ID) return supersetWorkspaceAdapter;
    if (providerId === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID) return conductorLocalWorkspaceAdapter;
    return isProviderId(providerId) ? providerRegistry[providerId].adapter : undefined;
  }

  function adapterForCredential(providerId: CredentialProviderId) {
    return orderedRegistrations.find((entry) => entry.credential?.id === providerId)?.adapter;
  }

  function workspaceProjectOffered(providerId: string, providerProjectId: string): boolean {
    const adapter = adapterFor(providerId);
    if (!adapter) return false;
    return adapter
      .workspaceProjects()
      .some((project) => workspaceProjectSelectionId(project) === providerProjectId);
  }

  async function rememberWorkspaceDefaults(
    adapter: SessionProviderAdapter,
    providerProjectId: string,
    providerTargetId: string | undefined,
    namedSelection: WorkspaceAgentSelection | undefined,
    agent: string | undefined,
  ): Promise<void> {
    const providerId = adapter.provider.id;
    if (!isWorkspaceProviderId(providerId)) return;
    try {
      let accountPreferencesTouched = false;
      if (
        (await settingsStore.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field)) === undefined
      ) {
        const saved = await settingsStore.set(
          APP_SETTING_SCHEMA.defaultWorkspaceProvider.field,
          providerId,
        );
        emitSettingsSnapshot(saved.settings);
        accountPreferencesTouched = true;
      }
      if (
        providerId === SUPERSET_WORKSPACE_PROVIDER_ID &&
        agent !== undefined &&
        (await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[
          SUPERSET_WORKSPACE_PROVIDER_ID
        ] === undefined
      ) {
        const saved = await settingsStore.setEntry(
          APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
          SUPERSET_WORKSPACE_PROVIDER_ID,
          { agent },
        );
        emitSettingsSnapshot(saved.settings);
        accountPreferencesTouched = true;
      }
      if (
        (await settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field))?.[
          providerId
        ] === undefined
      ) {
        const saved = await settingsStore.setEntry(
          APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
          providerId,
          workspaceProjectSelectionId(
            providerTargetId ? { providerProjectId, providerTargetId } : { providerProjectId },
          ),
        );
        emitSettingsSnapshot(saved.settings);
        accountPreferencesTouched = true;
      }
      if (
        isProviderId(providerId) &&
        namedSelection !== undefined &&
        (await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[providerId] ===
          undefined
      ) {
        const saved = await settingsStore.setEntry(
          APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
          providerId,
          namedSelection,
        );
        emitSettingsSnapshot(saved.settings);
        accountPreferencesTouched = true;
      }
      if (accountPreferencesTouched) pushAccountPreferences();
    } catch {
      // The reply is the creation's; a failed remember has no line in it.
    }
  }

  function offeredWorkspaceProjects(): readonly ObservedWorkspaceProject[] {
    if (!runMode.observesProviders) return [];
    return [
      ...orderedRegistrations.map(({ adapter }) => adapter),
      supersetWorkspaceAdapter,
      conductorLocalWorkspaceAdapter,
    ].flatMap((adapter) =>
      adapter.workspaceProjects().map((project) => ({
        ...project,
        providerId: adapter.provider.id,
        providerName: adapter.provider.displayName,
      })),
    );
  }

  async function applyLocalSessionHooks(): Promise<void> {
    if (!runMode.observesProviders || options.registerProviderHooks === false) return;
    await Promise.all(
      orderedRegistrations.map(async ({ adapter, registerObservationHook }) => {
        if (!registerObservationHook) return;
        try {
          await registerObservationHook();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report(`${adapter.provider.displayName} hook registration failed: ${message}`);
        }
      }),
    );
    watchObservationSpools();
  }

  function watchObservationSpools(): void {
    if (spoolWatchers.length > 0) return;
    spoolWatchers = orderedRegistrations.flatMap(({ adapter, observationSpool }) => {
      if (!observationSpool) return [];
      const providerId = adapter.provider.id;
      return [
        watchObservationSpool({
          spoolDirectory: observationSpool.directory(),
          events: observationSpool.events,
          onEvents: (events) => {
            void (async () => {
              await sessionObservationLoop.refresh().catch(() => undefined);
              brainWiring.wake(wakeEventsFromHooks(providerId, events, sessionRegistry, now()));
            })();
          },
        }),
      ];
    });
  }

  async function readSupersetWorkspaceHost(): Promise<WorkspaceHostEnrichment> {
    try {
      const agentDefault = (
        await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field)
      )?.[SUPERSET_WORKSPACE_PROVIDER_ID]?.agent;
      return await superset.refresh(agentDefault);
    } catch (error) {
      report(
        `Superset observation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return superset.emptyEnrichment;
    }
  }

  async function refreshProviderSessions(generation: number): Promise<void> {
    const actionsWereEnabled = superset.activeOrganization() !== undefined;
    const conductorRepositoriesPromise = conductorLocalWorkspaceAdapter.refresh().catch((error) => {
      report(
        `Conductor repository observation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    const hostEnrichments = await Promise.all(
      workspaceHosts.map((host) =>
        host.read().catch((error) => {
          report(
            `${host.observationFailureLabel} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return host.emptyEnrichment;
        }),
      ),
    );
    await conductorRepositoriesPromise;
    const supersetActionsEnabled = superset.activeOrganization() !== undefined;
    if (actionsWereEnabled !== supersetActionsEnabled) {
      if (supersetActionsEnabled) {
        emit(GATEWAY_EVENT.SUPERSET_SIGN_IN_CHANGED, {
          stage: SUPERSET_SIGN_IN_STAGE.CONNECTED,
          organizations: [],
        });
      } else {
        supersetSignIn.cancel();
      }
    }
    await Promise.all([
      ...orderedRegistrations.map(async ({ adapter }) => {
        try {
          await sessionRegistry.refresh(adapter, (providerId, observations) =>
            hostEnrichments.reduce(
              (enriched, enrichment) => enrichment(providerId, enriched),
              observations,
            ),
          );
        } catch (error) {
          report(
            `Session observation failed (${adapter.provider.id}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
      (async () => {
        try {
          await sessionRegistry.refresh(supersetWorkspaceAdapter);
        } catch (error) {
          report(
            `Session observation failed (${supersetWorkspaceAdapter.provider.id}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })(),
    ]);
    if (!sessionObservationLoop.isCurrent(generation)) return;
    void broadcastWorkspaceProjects();
  }

  function openCreatedWorkspaces(sessions: readonly Session[]): void {
    for (const created of createdWorkspaceOpens.claim(sessions, now())) {
      const link = created.detail.link;
      if (!link) continue;
      openExternalThroughNode(supersetPressedLink(link, createId())).catch((error: Error) => {
        report(`Created workspace could not be opened: ${error.message}`);
      });
    }
  }

  async function announcementsQuietNow(at: number): Promise<boolean> {
    const paused = !(await settingsStore.get(APP_SETTING_SCHEMA.announceSessions.field));
    const inMeeting =
      !paused &&
      calendarMeetings !== undefined &&
      activeMeetingEnd(calendarMeetings, at) !== undefined;
    const holding =
      paused ||
      (inMeeting && (await settingsStore.get(APP_SETTING_SCHEMA.quietDuringMeetings.field)));
    if (holding !== announcementsHeld) {
      announcementsHeld = holding;
      emit(GATEWAY_EVENT.ANNOUNCEMENTS_HELD_CHANGED, { held: holding });
    }
    return holding;
  }

  async function refreshAnnouncementHold(): Promise<void> {
    await announcementsQuietNow(now());
  }

  function armQuietBoundaryTimer(): void {
    if (quietBoundaryTimer) clearTimeout(quietBoundaryTimer);
    quietBoundaryTimer = undefined;
    if (!calendarMeetings) return;
    const at = now();
    const boundary = nextMeetingBoundary(calendarMeetings, at);
    if (boundary === undefined) return;
    quietBoundaryTimer = setTimeout(
      () => {
        quietBoundaryTimer = undefined;
        void reconcileSpeech();
        armQuietBoundaryTimer();
      },
      boundary - at + 1,
    );
    quietBoundaryTimer.unref();
  }

  async function reconcileSpeech(): Promise<void> {
    const quiet = await announcementsQuietNow(now());
    speechArbiter.setQuiet(quiet);
    if (!quiet && speechArbiter.heldBriefingCount > 0) {
      if (brainWiring.current() && voiceCapabilities.realtimeCredentials) {
        brainWiring.releaseHeld(speechArbiter.takeHeldBriefings());
      } else if (!voiceCapabilities.realtimeCredentials) {
        speechArbiter.dropBriefings();
      }
    }
    offerNextSpeech();
  }

  function settleSpeech(id: string, outcome: SpeechOutcome): void {
    const settled = speechArbiter.settle(id, outcome);
    if (!settled) return;
    if (settled.outcome === SPEECH_OUTCOME.SPOKEN) {
      if (settled.kind === BRIEFING_SPEECH_KIND) {
        productEvents.record(PRODUCT_EVENT.VOICE_ANNOUNCEMENT_SPEAK, {});
        markFirstAnnouncementSpoken();
      }
      if (settled.kind === ARRIVAL_SPEECH_KIND && arrivalBeatOwed(onboardingState)) {
        writeOnboardingState({ arrivalSpokenAt: new Date(now()).toISOString() });
      }
    }
    void reconcileSpeech();
  }

  /**
   * Hands the mouth the arbiter's head request, if one may be offered now:
   * a ready receiver stands, and a voice to say it with. Synchronous past the
   * quiet's await, so two reconciles landing together cannot each offer.
   */
  function offerNextSpeech(): void {
    if (!voiceReceiver.isReady() || !voiceCapabilities.realtimeCredentials) return;
    const offer = speechArbiter.next();
    if (offer) emit(GATEWAY_EVENT.SPEECH_OFFERED, carried(offer));
  }

  voiceReceiver.onReady(() => {
    offerNextSpeech();
    service.receiverReady();
  });
  voiceReceiver.onReset(() => speechArbiter.reclaimOffer());

  function withdrawBeat(kind: OnboardingBeatKind): void {
    const id = speechArbiter.retract(kind);
    if (id) emit(GATEWAY_EVENT.SPEECH_WITHDRAWN, { id });
  }

  async function refreshCalendarMeetings(generation: number): Promise<void> {
    try {
      const [observations, appleObservation] = await Promise.all([
        googleCalendar.observe(),
        appleCalendar.observe(),
      ]);
      if (!calendarObservationLoop.isCurrent(generation)) return;
      const accounts = [...(observations ?? []), ...(appleObservation ? [appleObservation] : [])];
      calendarMeetings =
        observations === undefined && appleObservation === undefined
          ? undefined
          : accounts.flatMap((held) => [...held.meetings]);
      observedCalendars = accounts.map(({ accountId, calendars, failure, revoked }) => ({
        accountId,
        calendars,
        ...(failure ? { failure } : undefined),
        ...(revoked ? { revoked } : undefined),
      }));
      emit(GATEWAY_EVENT.CALENDARS_CHANGED, { calendars: carried(observedCalendars) });
      for (const held of accounts) {
        if (held.failure) report(`Calendar observation failed: ${held.failure}`);
      }
    } catch (error) {
      report(
        `Calendar observation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!calendarObservationLoop.isCurrent(generation)) return;
    void reconcileSpeech();
    armQuietBoundaryTimer();
  }

  const observationGate = () => runMode.observesProviders && accountCapabilitiesActive();
  const sessionObservationLoop = new ObservationLoop({
    gate: observationGate,
    intervalMs: SESSION_REFRESH_INTERVAL_MS,
    run: refreshProviderSessions,
    afterRun: () => {
      void emitCodexCloudConnection();
      brainWiring.rosterLook();
    },
  });
  const issueObservationLoop = new ObservationLoop({
    gate: observationGate,
    intervalMs: ISSUE_REFRESH_INTERVAL_MS,
    run: refreshTrackedIssues,
  });
  const calendarObservationLoop = new ObservationLoop({
    gate: observationGate,
    intervalMs: CALENDAR_REFRESH_INTERVAL_MS,
    run: refreshCalendarMeetings,
  });
  const observationSupervisor = new ObservationSupervisor([
    sessionObservationLoop,
    issueObservationLoop,
    calendarObservationLoop,
  ]);

  async function pollAppleCalendarAccess(): Promise<void> {
    if (!(await settingsStore.readAppleCalendarConnection())) return;
    let access: string | undefined;
    try {
      access = await appleCalendar.status();
    } catch (error) {
      if (!appleAccessProbeFailing) {
        report(
          `Calendar access probe failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    appleAccessProbeFailing = access === undefined;
    if (access === undefined) return;
    const drawnRevoked =
      observedCalendars.find((held) => held.accountId === APPLE_CALENDAR_ID)?.revoked === true;
    const probeRevoked = access !== APPLE_CALENDAR_ACCESS.FULL;
    if (probeRevoked !== drawnRevoked) {
      report(`Calendar access now reads ${access}; running a pass.`);
      void calendarObservationLoop.refresh();
    }
  }

  function startCalendarObservation(): void {
    if (heldNoticeReleaseTimer) return;
    heldNoticeReleaseTimer = setInterval(() => {
      void reconcileSpeech();
    }, HELD_NOTICE_RELEASE_INTERVAL_MS);
    heldNoticeReleaseTimer.unref();
    if (process.platform === "darwin" && runMode.observesProviders) {
      appleAccessPollTimer = setInterval(() => {
        void pollAppleCalendarAccess();
      }, APPLE_ACCESS_POLL_INTERVAL_MS);
      appleAccessPollTimer.unref();
    }
  }

  function stopCalendarObservation(): void {
    if (heldNoticeReleaseTimer) clearInterval(heldNoticeReleaseTimer);
    heldNoticeReleaseTimer = undefined;
    if (appleAccessPollTimer) clearInterval(appleAccessPollTimer);
    appleAccessPollTimer = undefined;
    appleAccessProbeFailing = false;
    if (quietBoundaryTimer) clearTimeout(quietBoundaryTimer);
    quietBoundaryTimer = undefined;
    calendarMeetings = undefined;
    observedCalendars = [];
    googleCalendar.forget();
    appleCalendar.forget();
    speechArbiter.dropBriefings();
    emit(GATEWAY_EVENT.CALENDARS_CHANGED, { calendars: [] });
    void refreshAnnouncementHold();
  }

  let rosterBroadcast = false;

  function broadcastSessions(sessions: readonly Session[]): void {
    rosterBroadcast = true;
    emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: carried(sessions), settled: true });
  }

  function startSessionObservation(): void {
    if (!runMode.observesProviders || !accountCapabilitiesActive() || unsubscribeSessions) return;
    unsubscribeSessions = sessionRegistry.subscribe((sessions) => {
      broadcastSessions(sessions);
      openCreatedWorkspaces(sessions);
      void broadcastWorkspaceProjects();
      countObservedSessions(sessions);
    });
  }

  function countObservedSessions(sessions: readonly Session[]): void {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      counts.set(session.providerId, (counts.get(session.providerId) ?? 0) + 1);
    }
    for (const [providerId, count] of counts) {
      if (!isProviderId(providerId)) continue;
      productEvents.recordOncePerDay(PRODUCT_EVENT.SESSION_OBSERVE, providerId, {
        provider_id: providerId,
        session_count: productSessionCountBucket(count),
      });
    }
  }

  function stopSessionObservation(): void {
    workspaceProjectsBroadcastGeneration += 1;
    unsubscribeSessions?.();
    unsubscribeSessions = undefined;
    for (const { adapter } of orderedRegistrations) {
      sessionRegistry.replaceProvider(adapter.provider, []);
    }
    emit(GATEWAY_EVENT.SESSIONS_CHANGED, { sessions: [], settled: true });
    emit(GATEWAY_EVENT.WORKSPACE_PROJECTS_CHANGED, { projects: [] });
    lastWorkspaceProjects = undefined;
  }

  async function refreshTrackedIssues(generation: number): Promise<void> {
    try {
      const collected: TrackedIssue[] = [];
      let connected = false;
      for (const tracker of issueTrackers) {
        const observations = await tracker.observe();
        if (!observations) continue;
        connected = true;
        for (const observation of observations) {
          const issue = normalizeTrackedIssue(tracker.tracker, observation);
          if (issue) collected.push(issue);
        }
      }
      if (issueObservationLoop.isCurrent(generation)) {
        trackedIssues = connected ? collected : undefined;
      }
    } catch (error) {
      report(`Issue observation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function stopIssueObservation(): void {
    trackedIssues = undefined;
  }

  /** The roster a client draws: the same relevance gate every broadcast passes. */
  function rosterForClients(): readonly Session[] {
    return runMode.observesProviders && accountCapabilitiesActive() ? sessionRegistry.list() : [];
  }

  // ---- The settings writes, with the host's own side effects -------------

  function recordSettingUpdate(field: AppSettingField, settings: SettingsUpdateResult["settings"]) {
    const analytics = settingAnalytics(field, settings.stored);
    if (!analytics) return;
    recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
      setting_id: analytics.id,
      setting_value: analytics.value,
    });
  }

  /**
   * The side effects a setting has in the host. The client applies its own —
   * the login item, the Dock, the displays, the form factor, the keys, the
   * duck — from the same answered snapshot; nothing here reaches a window.
   */
  async function applyHostSettingSideEffect(
    field: AppSettingField,
    settings: SettingsUpdateResult["settings"],
  ): Promise<void> {
    switch (APP_SETTING_SCHEMA[field].mainProcessSideEffect) {
      case SETTING_SIDE_EFFECT.VOICE:
        voiceCapabilities.realtimeCredentials?.setVoice(settings.stored.voice);
        break;
      case SETTING_SIDE_EFFECT.VOICE_SPEED:
        voiceCapabilities.realtimeCredentials?.setSpeed(settings.stored.voiceSpeed);
        break;
      case SETTING_SIDE_EFFECT.VOICE_SOURCE:
        await applyVoiceCredential();
        await emitSettings();
        break;
      case SETTING_SIDE_EFFECT.ANNOUNCEMENT_HOLD:
        void reconcileSpeech();
        break;
      case SETTING_SIDE_EFFECT.VAULT_SYNC:
        void providerKeyVaultSync.apply(settings.stored.syncProviderKeys, { claim: true });
        break;
      default:
        break;
    }
  }

  async function applyAccountPreferenceSideEffects(
    result: SettingsUpdateResult,
    changed: readonly AccountPreferenceField[],
  ): Promise<void> {
    for (const field of changed) {
      await applyHostSettingSideEffect(field, result.settings);
    }
    const workspaceAgentDefaultsChanged = changed.includes(
      APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
    );
    if (workspaceAgentDefaultsChanged) {
      await readSupersetWorkspaceHost();
    }
    if (
      workspaceAgentDefaultsChanged ||
      changed.includes(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field) ||
      changed.includes(APP_SETTING_SCHEMA.workspaceProjectDefaults.field)
    ) {
      await broadcastWorkspaceProjects();
    }
    emitSettingsSnapshot(result.settings);
  }

  const refusedSettings = async (reason: string): Promise<SettingsUpdateResult> => ({
    status: ACT_RESULT_STATUS.REJECTED,
    settings: await settingsStore.snapshot(),
    reason,
  });

  /** Runs one settings write and, when it landed, its host side effects and the change event. */
  async function settingsWrite(
    save: () => Promise<SettingsUpdateResult>,
    apply: (result: SettingsUpdateResult) => Promise<void> | void,
    refusal: string,
    reporter: string | undefined,
  ): Promise<SettingsUpdateResult> {
    let saved: SettingsUpdateResult;
    try {
      saved = await save();
      await apply(saved);
    } catch {
      return refusedSettings(refusal);
    }
    emitSettingsSnapshot(saved.settings, reporter);
    return saved;
  }

  const reporterOf = (params: WireRecord): string | undefined =>
    isWireString(params.reporter) ? params.reporter : undefined;

  // ---- The Apple connect's generation, as the client's cancel moves it ----
  let appleConnectGeneration = 0;

  /** The methods the client reaches this host's ownership through, beside the protocol's own. */
  const hostMethods: GatewayMethodTable = {
    [GATEWAY_METHOD.SHUTDOWN]: () => {
      options.onShutdownRequested?.();
      return gatewayOk({ accepted: true });
    },
    [GATEWAY_METHOD.CLIENT_BOOTSTRAP]: async () => {
      const [settings, supersetInstalled, supersetConnected, quiet, replay] = await Promise.all([
        settingsStore.snapshot(),
        supersetCli.installed(),
        supersetCli.connected(),
        accountCapabilitiesActive() ? announcementsQuietNow(now()) : Promise.resolve(false),
        sessionReplayState(),
      ]);
      return gatewayOk({
        settings: carried(settings),
        account: carried(account),
        sessions: carried(rosterForClients()),
        sessionsSettled: !runMode.observesProviders || rosterBroadcast,
        announcementsHeld: quiet,
        conversationHistory: carried(runtimeStoreWiring.thread().entries()),
        workspaceProjects: carried(
          accountCapabilitiesActive()
            ? normalizeObservedWorkspaceProjects(
                offeredWorkspaceProjects(),
                await settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
              )
            : [],
        ),
        calendars: carried(accountCapabilitiesActive() ? observedCalendars : []),
        calendarOnboardingOwed: calendarOnboardingGateOwed(),
        supersetInstalled,
        supersetConnected,
        sessionReplay: carried(replay),
        receiverEpoch: voiceReceiver.epoch(),
        voiceAvailable: voiceCapabilities.realtimeCredentials !== undefined,
        agentTraceEnabled: agentTrace !== undefined,
      });
    },
    [GATEWAY_METHOD.SETTINGS_SNAPSHOT]: async () =>
      gatewayOk({ settings: carried(await settingsStore.snapshot()) }),
    [GATEWAY_METHOD.SETTINGS_UPDATE]: async (params) => {
      const field = params.field;
      if (!isAppSettingField(field) || isKeyedAppSettingField(field)) {
        return invalid("field must name a plain setting");
      }
      const parsed = APP_SETTING_SCHEMA[field].guard(params.value);
      if (!parsed.valid) return invalid("value is not the shape that setting takes");
      const result = await settingsWrite(
        () => settingsStore.set(field, parsed.value),
        async (saved) => {
          if (saved.reason) return;
          recordSettingUpdate(field, saved.settings);
          await applyHostSettingSideEffect(field, saved.settings);
        },
        "Could not save that setting on this system.",
        reporterOf(params),
      );
      if (!result.reason && isAccountPreferenceField(field)) pushAccountPreferences();
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.SETTINGS_UPDATE_ENTRY]: async (params) => {
      const field = params.field;
      if (!isKeyedAppSettingField(field)) return invalid("field must name a keyed setting");
      const key = params.key;
      if (!isSettingEntryKey(field, key)) return invalid("key is not one that setting takes");
      // SAFETY: the guard is the parser; a wire value is one it reads.
      const parsed = settingEntryGuard(field, key, params.value as UnparsedWireValue);
      if (!parsed.valid) return invalid("value is not the shape that entry takes");
      // SAFETY: settingEntryGuard validated workspace project defaults as a wire string.
      const projectWire = parsed.value as UnparsedWireValue;
      if (
        field === APP_SETTING_SCHEMA.workspaceProjectDefaults.field &&
        isWireString(projectWire) &&
        !workspaceProjectOffered(key, projectWire)
      ) {
        return invalid("that project is not one a provider offers");
      }
      const result = await settingsWrite(
        // SAFETY: settingEntryGuard validated the entry before it reaches the store.
        () => settingsStore.setEntry(field, key, parsed.value as SettingEntryValue<typeof field>),
        async (saved) => {
          if (saved.reason) return;
          recordSettingUpdate(field, saved.settings);
          await applyHostSettingSideEffect(field, saved.settings);
        },
        "Could not save that setting on this system.",
        reporterOf(params),
      );
      if (!result.reason && isAccountPreferenceField(field)) pushAccountPreferences();
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.SETTINGS_RESET]: async (params) => {
      const scope = params.scope;
      if (!isSettingsResetScope(scope)) return invalid("scope is not one this build knows");
      const result = await settingsWrite(
        () => settingsStore.resetSettings(scope),
        async (saved) => {
          if (saved.reason) return;
          recordProductEvent(PRODUCT_EVENT.SETTINGS_RESET, {});
          for (const field of APP_SETTING_FIELDS) {
            const definition = APP_SETTING_SCHEMA[field];
            if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
            await applyHostSettingSideEffect(field, saved.settings);
          }
        },
        "Could not reset those settings on this system.",
        reporterOf(params),
      );
      if (!result.reason && resetTouchesAccountPreferences(scope)) pushAccountPreferences();
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.CREDENTIAL_SET_API_KEY]: async (params) => {
      const providerId = params.providerId;
      if (!isCredentialProviderId(providerId))
        return invalid("providerId is not one this build knows");
      if (params.apiKey !== undefined && !isWireString(params.apiKey)) {
        return invalid("apiKey must be a string");
      }
      const apiKey = params.apiKey;
      const result = await settingsWrite(
        () => settingsStore.setApiKey(providerId, apiKey),
        async (saved) => {
          if (saved.reason) return;
          const adapter = adapterForCredential(providerId);
          if (adapter) void sessionRegistry.refresh(adapter);
          if (providerId === CREDENTIAL_PROVIDER_ID.LINEAR) void issueObservationLoop.refresh();
          if (providerId === VOICE_CREDENTIAL_PROVIDER_ID) {
            await applyVoiceCredential();
            await emitSettings();
          }
          void providerKeyVaultSync.keySaved(
            providerId,
            apiKey,
            saved.settings.stored.syncProviderKeys,
          );
          recordProductEvent(
            apiKey?.trim() ? PRODUCT_EVENT.PROVIDER_CONNECT : PRODUCT_EVENT.PROVIDER_DISCONNECT,
            { connection_id: providerId },
          );
        },
        "Could not save that API key on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.ACCOUNT_SNAPSHOT]: () => gatewayOk({ account: carried(account) }),
    [GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN]: async (params) => {
      if (!isAccountProvider(params.provider))
        return invalid("provider is not one this build knows");
      recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, {
        account_act: PRODUCT_ACCOUNT_ACT.SIGN_IN_START,
      });
      const snapshot = await accountSession.beginSignIn(params.provider);
      return gatewayOk({ account: carried(snapshot) });
    },
    [GATEWAY_METHOD.ACCOUNT_CANCEL_SIGN_IN]: () => {
      recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, {
        account_act: PRODUCT_ACCOUNT_ACT.SIGN_IN_CANCEL,
      });
      accountSession.cancelSignIn();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.ACCOUNT_SIGN_OUT]: async () => {
      recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, { account_act: PRODUCT_ACCOUNT_ACT.SIGN_OUT });
      // The count of the act leaves before the act ends the account it is
      // authenticated with; queued behind the sign-out it would wait for the
      // next sign-in.
      await productEvents.flush();
      const snapshot = await accountSession.signOut({ revokeRemote: true });
      return gatewayOk({ account: carried(snapshot) });
    },
    [GATEWAY_METHOD.ACCOUNT_DELETE]: async () => {
      recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACT, { account_act: PRODUCT_ACCOUNT_ACT.DELETE });
      await productEvents.flush();
      const snapshot = await accountSession.deleteEverywhere();
      // Only a deletion that landed stands recording down for the run.
      sessionReplayEndedByDeletion = true;
      void emitSessionReplay();
      return gatewayOk({ account: carried(snapshot) });
    },
    [GATEWAY_METHOD.CALENDAR_CONNECT_GOOGLE]: async (params) => {
      const result = await settingsWrite(
        async () => {
          const outcome = await googleCalendarSignIn.signIn();
          if ("reason" in outcome) return refusedSettings(outcome.reason);
          let primaryId: string | undefined;
          try {
            const calendars = await googleCalendar.listCalendars(outcome.accessToken);
            primaryId = (calendars.find((candidate) => candidate.primary) ?? calendars[0])?.id;
          } catch {
            primaryId = undefined;
          }
          if (!primaryId) {
            return refusedSettings("Google did not answer with the account's calendars.");
          }
          return settingsStore.addCalendarAccount(primaryId, outcome.refreshToken, [primaryId]);
        },
        (saved) => {
          if (saved.reason) return;
          void calendarObservationLoop.refresh();
          recordProductEvent(PRODUCT_EVENT.CALENDAR_CONNECT, {
            calendar_source: PRODUCT_CALENDAR_SOURCE.GOOGLE,
          });
        },
        "Could not connect Google Calendar on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.CALENDAR_CANCEL_GOOGLE_SIGN_IN]: () => {
      googleCalendarSignIn.cancel();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.CALENDAR_REOPEN_GOOGLE_SIGN_IN]: () => {
      googleCalendarSignIn.reopen();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.CALENDAR_REMOVE_ACCOUNT]: async (params) => {
      if (!isWireString(params.accountId)) return invalid("accountId must be a string");
      const accountId = params.accountId;
      const result = await settingsWrite(
        () => settingsStore.removeCalendarAccount(accountId),
        (saved) => {
          if (saved.reason) return;
          void calendarObservationLoop.refresh();
          recordProductEvent(PRODUCT_EVENT.CALENDAR_DISCONNECT, {
            calendar_source: PRODUCT_CALENDAR_SOURCE.GOOGLE,
          });
        },
        "Could not disconnect that account on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.CALENDAR_CONNECT_APPLE]: async (params) => {
      const generation = ++appleConnectGeneration;
      let stored = false;
      const result = await settingsWrite(
        async () => {
          // The system's own consent is the whole connect flow, raised by the
          // helper on the desktop at this press and nowhere else.
          const outcome = await appleCalendar.obtainAccess({
            openSystemSettings: () =>
              void openExternalThroughNode(CALENDAR_PRIVACY_PANE_URL).catch(reportOpenFailure),
            superseded: () => appleConnectGeneration !== generation,
          });
          if (appleConnectGeneration !== generation) {
            return { status: ACT_RESULT_STATUS.ACCEPTED, settings: await settingsStore.snapshot() };
          }
          if (outcome.access !== APPLE_CALENDAR_ACCESS.FULL) {
            return refusedSettings(
              outcome.failure ?? APPLE_CALENDAR_ACCESS_REFUSAL[outcome.access],
            );
          }
          const seed = outcome.defaultCalendarId ?? outcome.calendars[0]?.id;
          stored = true;
          return settingsStore.connectAppleCalendar(seed ? [seed] : []);
        },
        (saved) => {
          if (saved.reason) return;
          void calendarObservationLoop.refresh();
          if (stored) {
            recordProductEvent(PRODUCT_EVENT.CALENDAR_CONNECT, {
              calendar_source: PRODUCT_CALENDAR_SOURCE.APPLE,
            });
          }
        },
        "Could not connect Apple Calendar on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.CALENDAR_DISCONNECT_APPLE]: async (params) => {
      const result = await settingsWrite(
        () => settingsStore.disconnectAppleCalendar(),
        (saved) => {
          if (saved.reason) return;
          void calendarObservationLoop.refresh();
          recordProductEvent(PRODUCT_EVENT.CALENDAR_DISCONNECT, {
            calendar_source: PRODUCT_CALENDAR_SOURCE.APPLE,
          });
        },
        "Could not disconnect Apple Calendar on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.CALENDAR_APPLE_ACCESS_STATUS]: async () => {
      try {
        return gatewayOk({ access: await appleCalendar.status() });
      } catch {
        return gatewayOk({ access: APPLE_CALENDAR_ACCESS.NOT_DETERMINED });
      }
    },
    [GATEWAY_METHOD.CALENDAR_CANCEL_APPLE_CONNECT]: () => {
      appleConnectGeneration += 1;
      return gatewayOk({});
    },
    [GATEWAY_METHOD.CALENDAR_REFRESH]: async () => {
      await calendarObservationLoop.refresh();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.CALENDAR_SET_SELECTED]: async (params) => {
      if (!isWireString(params.accountId) || !isWireString(params.calendarId)) {
        return invalid("accountId and calendarId must be strings");
      }
      if (!isWireBoolean(params.selected)) return invalid("selected must be a boolean");
      const { accountId, calendarId, selected } = params;
      if (
        selected &&
        !observedCalendars
          .find((held) => held.accountId === accountId)
          ?.calendars.some((candidate) => candidate.id === calendarId)
      ) {
        return gatewayOk(
          carried(
            await refusedSettings("That calendar is not one the account's latest list offered."),
          ),
        );
      }
      const result = await settingsWrite(
        () => settingsStore.setCalendarSelected(accountId, calendarId, selected),
        (saved) => {
          if (saved.reason) return;
          void calendarObservationLoop.refresh();
          recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
            setting_id: APP_SETTING_ID.CALENDAR_SELECTED,
            setting_value: selected ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF,
          });
        },
        "Could not save that calendar choice on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.TRACKER_CONNECT]: async (params) => {
      const result = await settingsWrite(
        async () => {
          const outcome = await linearSignIn.signIn();
          if ("reason" in outcome) return refusedSettings(outcome.reason);
          return settingsStore.setGrant(CREDENTIAL_PROVIDER_ID.LINEAR, outcome);
        },
        (saved) => {
          if (saved.reason) return;
          void issueObservationLoop.refresh();
          recordProductEvent(PRODUCT_EVENT.TRACKER_CONNECT, {
            tracker_id: ISSUE_TRACKER_ID.LINEAR,
          });
        },
        "Could not connect Linear on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.TRACKER_CANCEL_SIGN_IN]: () => {
      linearSignIn.cancel();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.TRACKER_REOPEN_SIGN_IN]: () => {
      linearSignIn.reopen();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.TRACKER_DISCONNECT]: async (params) => {
      const result = await settingsWrite(
        async () => {
          await linearCredentials.disconnect();
          return { status: ACT_RESULT_STATUS.ACCEPTED, settings: await settingsStore.snapshot() };
        },
        (saved) => {
          if (saved.reason) return;
          void issueObservationLoop.refresh();
          recordProductEvent(PRODUCT_EVENT.TRACKER_DISCONNECT, {
            tracker_id: ISSUE_TRACKER_ID.LINEAR,
          });
        },
        "Could not disconnect Linear on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.SUPERSET_STATUS]: async () => {
      const [installed, connected] = await Promise.all([
        supersetCli.installed(),
        supersetCli.connected(),
      ]);
      return gatewayOk({ installed, connected });
    },
    [GATEWAY_METHOD.SUPERSET_BEGIN_SIGN_IN]: async () => {
      recordProductEvent(PRODUCT_EVENT.SUPERSET_ACT, {
        superset_act: PRODUCT_SUPERSET_ACT.SIGN_IN_START,
      });
      return gatewayOk({ state: carried(await supersetSignIn.begin()) });
    },
    [GATEWAY_METHOD.SUPERSET_SUBMIT_CODE]: async (params) => {
      if (!isWireString(params.code)) return invalid("code must be a string");
      return gatewayOk({ state: carried(await supersetSignIn.submitCode(params.code)) });
    },
    [GATEWAY_METHOD.SUPERSET_CHOOSE_ORGANIZATION]: async (params) => {
      if (!isWireString(params.slug)) return invalid("slug must be a string");
      return gatewayOk({ state: carried(await supersetSignIn.chooseOrganization(params.slug)) });
    },
    [GATEWAY_METHOD.SUPERSET_REOPEN_SIGN_IN]: () => {
      supersetSignIn.reopen();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.SUPERSET_CANCEL_SIGN_IN]: () => {
      supersetSignIn.cancel();
      recordProductEvent(PRODUCT_EVENT.SUPERSET_ACT, {
        superset_act: PRODUCT_SUPERSET_ACT.SIGN_IN_CANCEL,
      });
      return gatewayOk({});
    },
    [GATEWAY_METHOD.SUPERSET_DISCONNECT]: async () => {
      if (!(await supersetCli.signOut())) {
        return gatewayOk({
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "Superset could not sign out.",
        });
      }
      supersetSignIn.cancel();
      void sessionObservationLoop.refresh();
      recordProductEvent(PRODUCT_EVENT.SUPERSET_ACT, {
        superset_act: PRODUCT_SUPERSET_ACT.DISCONNECT,
      });
      return gatewayOk({ status: ACT_RESULT_STATUS.ACCEPTED });
    },
    [GATEWAY_METHOD.SESSION_ROSTER]: () =>
      gatewayOk({
        sessions: carried(rosterForClients()),
        settled: !runMode.observesProviders || rosterBroadcast,
      }),
    [GATEWAY_METHOD.SESSION_OPEN]: async (params) => {
      if (!isSessionIdentity(params.identity)) return invalid("identity must name a session");
      return gatewayOk(carried(await sessionActPerformer.openSession(params.identity)));
    },
    [GATEWAY_METHOD.SESSION_OPEN_APPLICATION]: async (params) => {
      if (!isSessionIdentity(params.identity)) return invalid("identity must name a session");
      if (!isWireString(params.applicationId) || !isSessionApplicationId(params.applicationId)) {
        return invalid("applicationId is not one this build knows");
      }
      return gatewayOk(
        carried(
          await sessionActPerformer.openSessionApplication(params.identity, params.applicationId),
        ),
      );
    },
    [GATEWAY_METHOD.SESSION_OPEN_CHANGE]: async (params) => {
      if (!isSessionIdentity(params.identity)) return invalid("identity must name a session");
      return gatewayOk(carried(await sessionActPerformer.openSessionChange(params.identity)));
    },
    [GATEWAY_METHOD.WORKSPACE_PROJECTS]: async () =>
      gatewayOk({
        projects: carried(
          accountCapabilitiesActive()
            ? normalizeObservedWorkspaceProjects(
                offeredWorkspaceProjects(),
                await settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
              )
            : [],
        ),
      }),
    [GATEWAY_METHOD.SPEECH_SETTLE]: (params) => {
      if (!isIdentifier(params.id)) return invalid("id must be a non-empty string");
      if (!isSpeechOutcome(params.outcome)) return invalid("outcome is not one this build knows");
      settleSpeech(params.id, params.outcome);
      return gatewayOk({});
    },
    // The one voice receiver's lifecycle, as the client that owns its window
    // reports it. Begin mints an epoch here and answers it; ready counts only
    // for the epoch it names; reset ends the epoch. The client's connection
    // closing ends it too, below, so nothing is offered to a renderer nobody
    // can reach.
    [GATEWAY_METHOD.RECEIVER_REPORT]: (params) => {
      switch (params.kind) {
        case RECEIVER_REPORT_KIND.BEGIN:
          return gatewayOk({ epoch: voiceReceiver.begin() });
        case RECEIVER_REPORT_KIND.READY:
          if (!isWireNumber(params.epoch)) return invalid("epoch must be a number");
          return gatewayOk({ ready: voiceReceiver.markReady(params.epoch) });
        case RECEIVER_REPORT_KIND.RESET:
          voiceReceiver.reset();
          return gatewayOk({ epoch: voiceReceiver.epoch() });
        default:
          return invalid("kind is not one this build knows");
      }
    },
    // The one credential that crosses to the voice client: the short-lived
    // realtime secret the account minter issues, never the key or the token
    // behind it. Counted here, under the source it actually came from.
    [GATEWAY_METHOD.VOICE_MINT_REALTIME_CREDENTIAL]: async () => {
      const minter = voiceCapabilities.realtimeCredentials;
      if (!minter) return gatewayOk({});
      const credential = await minter.mint();
      if (credential) {
        recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
          credential_source: VOICE_SOURCE_COUNTED_AS[voiceCapabilities.voiceSource],
        });
      }
      return gatewayOk(credential ? { credential: carried(credential) } : {});
    },
    [GATEWAY_METHOD.VOICE_DIAGNOSTICS]: () =>
      gatewayOk({
        diagnostics: carried(
          voiceCapabilities.realtimeCredentials?.diagnostics() ??
            voiceCapabilities.unavailableDiagnostics,
        ),
      }),
    // One realtime event the renderer's tap saw cross the data channel, into
    // the development trace. Read again here for the shape the tap sends; on
    // a run without a writer — packaged, fixture, or simply untraced — it
    // lands here and stops.
    [GATEWAY_METHOD.VOICE_RECORD_TRACE]: (params) => {
      if (!isAgentWireTrace(params.trace)) return invalid("trace is not one tapped wire event");
      agentTrace?.recordWire(params.trace);
      return gatewayOk({});
    },
    [GATEWAY_METHOD.GUIDE_REPORT]: (params) => {
      if (!isAppGuideSnapshot(params.guide))
        return invalid("guide is not the shape a panel reports");
      appGuide = params.guide;
      return gatewayOk({});
    },
    // A count the client's own surfaces made: read against the allowlist
    // again here, and queued only when it reads. Nothing observed can travel
    // in one, because the reader builds the event from the allowlist rather
    // than from what arrived.
    [GATEWAY_METHOD.ANALYTICS_RECORD]: (params) => {
      const event = productEventFromWire(params.event);
      if (!event) return invalid("event is not one the allowlist names");
      // SAFETY: the reader built these properties from the allowlist for this very name.
      productEvents.record(
        event.name,
        event.properties as ProductEventPropertiesFor<typeof event.name>,
      );
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
      const accepted = await runtimeStoreWiring
        .thread(sessionKey)
        .append(entries, reporterOf(params));
      return gatewayOk({ accepted });
    },
    [GATEWAY_METHOD.ONBOARDING_STATE]: () =>
      gatewayOk({ calendarOnboardingOwed: calendarOnboardingGateOwed() }),
    [GATEWAY_METHOD.ONBOARDING_SKIP_CALENDAR]: () => {
      if (calendarOnboardingOwed(onboardingState)) {
        writeOnboardingState({ calendarOnboardingSkippedAt: new Date(now()).toISOString() });
        void requestOnboardingBeat();
      }
      return gatewayOk({});
    },
    [GATEWAY_METHOD.ONBOARDING_COMPLETE_CALENDAR]: () => {
      if (calendarOnboardingOwed(onboardingState)) {
        writeOnboardingState({ calendarOnboardingSettledAt: new Date(now()).toISOString() });
        void requestOnboardingBeat();
      }
      return gatewayOk({});
    },
  };

  service = createGatewayService({
    brain: {
      current: (sessionKey) => brainWiring.current(sessionKey),
      agentForRun: (runId) => brainWiring.agentForRun(runId),
      conversationForRun: (runId) => brainWiring.conversationForRun(runId),
      allRequests: () => brainWiring.allRequests(),
      generationId: (sessionKey) => brainWiring.store(sessionKey).generationId(),
      holdsGeneration: (generationId) => brainWiring.holdsGeneration(generationId),
      publicationSettled: () => brainWiring.publicationSettled(),
      children: brainWiring.children,
      configuration: () => brainWiring.configuration(),
      updateConfiguration: (patch) => brainWiring.updateConfiguration(patch),
    },
    conversations: conversationControls,
    memory: {
      status: () => ({
        mode: memoryWiring.mode(),
        entries: runtimeStoreWiring.rememberedFacts().length,
      }),
    },
    observedSessionCount: () =>
      sessionRegistry.list().filter((session) => session.realtimeVoice !== true).length,
    deliveries: brainReplyDeliveries,
    receiver: voiceReceiver,
    nodes,
    recordConversationEntry: (entry, recordedAt, sessionKey) =>
      runtimeStoreWiring.recordConversationEntry(entry, recordedAt, sessionKey),
    now,
    createId,
    methods: hostMethods,
    // A client whose connection closed can reach no renderer: its receiver
    // epoch ends here as its window going away would, so replies and
    // briefings wait for the next epoch rather than being offered into a gap.
    onOperatorDisconnected: () => voiceReceiver.reset(),
  });

  const start = async (): Promise<void> => {
    account = runMode.requiresAccount
      ? await settingsStore.accountSnapshot()
      : { status: ACCOUNT_STATUS.SIGNED_OUT };
    accountSession.initialize(account);
    onboardingState = onboarding.read();
    if (runMode.observesProviders) {
      await runtimeStoreWiring.open();
      await seedWorkspaceThenStartMemory({
        seedWorkspace: async () => {
          await brainWiring.seedWorkspace();
        },
        startMemory: () => memoryWiring.start(),
        report,
      });
      await brainWiring.store().load();
      await runtimeStoreWiring.restore();
      stopHistoryMaintenance = startHistoryMaintenance({
        store: runtimeStoreWiring,
        brain: brainWiring,
      });
      await cronScheduler.start();
      await cronScheduler.ensure(heartbeatJob(now()));
    }
    void settleCalendarOnboardingIfConnected();
    void settingsStore.snapshot();
    productEvents.arm();
    productEvents.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: options.appVersion });
    productEvents.markDayActive();
    if (runMode.sendsNetwork) productEvents.start();
    void applyLocalSessionHooks().catch((error) => {
      report(
        `Local session hook registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (account.status === ACCOUNT_STATUS.SIGNED_IN) void reconcileAccountPreferences();
    await applyVoiceCredential();
    startSessionObservation();
    startCalendarObservation();
    observationSupervisor.setEnabled(true);
    if (account.status === ACCOUNT_STATUS.SIGNED_IN) reconcileProviderKeyVault();
    void requestOnboardingBeat();
    void accountSession.refreshOnce();
  };

  /**
   * The explicit quit's steps. Admissions close at the server; every run and
   * child under way is cancelled; the followers' publication is let finish,
   * so an end already reached stands in History; and what did not settle is
   * counted rather than finished: the store's load at the next start marks
   * an unsettled run interrupted and replays nothing.
   */
  const shutdownSteps: GatewayShutdownSteps = shutdownStepsFlushingEvents(
    {
      closeAdmissions: () => service.server.closeAdmissions(),
      cancelActive: async () => {
        observationSupervisor.setEnabled(false);
        cronScheduler.stop();
        const cancelled: string[] = [];
        for (const record of brainWiring.allRequests()) {
          if (
            record.status !== BRAIN_REQUEST_STATUS.QUEUED &&
            record.status !== BRAIN_REQUEST_STATUS.RUNNING
          ) {
            continue;
          }
          const agent = brainWiring.agentForRun(record.runId);
          if (!agent) continue;
          cancelled.push(record.runId);
          await agent.cancelAsk(record.runId).catch(() => undefined);
        }
        for (const child of brainWiring.children.children()) {
          if (isTerminalChildRunStatus(child.status)) continue;
          await brainWiring.children.cancel(child.childId).catch(() => undefined);
        }
        return cancelled;
      },
      awaitSettled: async (signal) => {
        if (signal.aborted) return;
        await brainWiring.publicationSettled();
      },
      persistUnresolved: async () => {
        // What the next launch will find: the records as the stores last
        // persisted them, read from the envelopes rather than from memory. A
        // cancellation whose write did not land leaves its run queued or
        // running on disk, and that is what the load marks interrupted and
        // never replays, so it is counted here as unresolved.
        const keys = new Set<SessionKey>([
          MAIN_SESSION_KEY,
          ...runtimeStoreWiring.directory().map((entry) => entry.sessionKey),
        ]);
        let unresolved = 0;
        for (const key of keys) {
          const persisted = brainWiring.store(key).current();
          if (!persisted) continue;
          unresolved += persisted.requests.filter(
            (record) =>
              record.status === BRAIN_REQUEST_STATUS.QUEUED ||
              record.status === BRAIN_REQUEST_STATUS.RUNNING,
          ).length;
        }
        return unresolved;
      },
    },
    () => productEvents.flush(),
  );

  const close = async (): Promise<void> => {
    observationSupervisor.setEnabled(false);
    stopCalendarObservation();
    for (const watcher of spoolWatchers) watcher.close();
    spoolWatchers = [];
    stopHistoryMaintenance?.();
    cronScheduler.stop();
    brainWiring.retire();
    memoryWiring.stop();
    supersetSignIn.shutdown();
    productEvents.stop();
    await runtimeStoreWiring.close();
  };

  const stop = async (shutdown: GatewayShutdownOptions = {}): Promise<void> => {
    // A drain that cannot finish still says so and still closes the store:
    // what it could not settle is what the next launch marks interrupted, and
    // a quit must leave either way rather than on an unhandled failure.
    try {
      const outcome = await shutdownGateway(shutdownSteps, shutdown);
      report(
        `shutting down: ${outcome.settled ? "settled" : "unsettled"}, ${outcome.cancelled.length} cancelled, ${outcome.unresolved} unresolved`,
      );
    } catch (error) {
      report(`the drain did not finish: ${error instanceof Error ? error.message : String(error)}`);
    }
    const closed = close().catch((error: Error) => {
      report(`the runtime did not close cleanly: ${error.message}`);
    });
    const closedInTime = await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), HOST_CLOSE_WAIT_MS);
      }),
    ]);
    if (!closedInTime) report("the runtime did not close in time; leaving it to the exit");
  };

  return { server: service.server, start, stop };
}

/** How a receiver report names the moment it reports. */
export const RECEIVER_REPORT_KIND = {
  BEGIN: "begin",
  READY: "ready",
  RESET: "reset",
} as const;
