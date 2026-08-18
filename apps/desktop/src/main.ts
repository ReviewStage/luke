import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ATTENTION_REQUEST_RESULT_STATUS,
  ATTENTION_SPEECH_SOURCE,
  AttentionRequestRegistry,
  type AttentionRequestResult,
  type AttentionSpeech,
  activeMeetingEnd,
  attentionRequestText,
  attentionSpeechFromReviews,
  CompositeSessionProviderAdapter,
  CreatedWorkspaceOpenTracker,
  DEFAULT_PANEL_FORM_FACTOR,
  fixtureSnapshot,
  HOSTED_SERVICE_PATH,
  InMemorySessionRegistry,
  ISSUE_ACTION_KIND,
  isControllableAdapter,
  isMessageCapableAdapter,
  isPanelFormFactor,
  isProviderId,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  issueCommentText,
  isWorkspaceAgentCapableAdapter,
  isWorkspaceCapableAdapter,
  type MeetingInterval,
  type NormalizedSession,
  normalizeObservedWorkspaceProjects,
  normalizeTrackedIssue,
  type ObservedWorkspaceProject,
  PROVIDER_ACT_RESULT_STATUS,
  PROVIDER_ID,
  type ProviderControlResult,
  type ProviderId,
  type ProviderMessageResult,
  type ProviderWorkspaceResult,
  realtimeMintExplanation,
  rosterRelevantSessions,
  SESSION_LOCATION,
  SessionAttentionReviewer,
  type SessionIdentity,
  SessionNoticeHold,
  SessionNoticeTracker,
  type SessionProviderAdapter,
  sessionMessageText,
  TRACKER_ACTION_RESULT_STATUS,
  type TrackedIssue,
  type TrackerActionResult,
  type WorkspaceAgentSelection,
  workspaceNameText,
} from "@sidecar/core";

import {
  app,
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { AccountClient, type AccountIdentity, type AccountTokens } from "./account-client";
import { deleteHostedAccount } from "./account-deletion";
import {
  ACCOUNT_FAILURE_ACTION,
  accessTokenNeedsRefresh,
  accountFailureAction,
  accountGateOpen,
} from "./account-gate";
import {
  isSignInCancellation,
  SIGN_IN_CANCELLED_MESSAGE,
  startAccountLoopback,
} from "./account-loopback";
import { singleFlight, withIssuedAccountTokens } from "./account-token-lifecycle";
import { CLAUDE_CODE_PROVIDER, ClaudeCodeSessionAdapter } from "./claude-code-adapter";
import {
  CLAUDE_HOOK_SCRIPT_NAME,
  CLAUDE_HOOK_SPOOL_MAXIMUM_AGE_MS,
  type ClaudeCodeHookInstallation,
  defaultClaudeHome,
  installClaudeCodeObservationHooks,
  pruneClaudeHookSpool,
} from "./claude-code-hooks";
import { readClaudeSessionTranscript } from "./claude-code-transcript";
import { CODEX_PROVIDER, CodexSessionAdapter, defaultCodexHome } from "./codex-adapter";
import {
  CODEX_HOOK_SCRIPT_NAME,
  CODEX_HOOK_SPOOL_MAXIMUM_AGE_MS,
  type CodexHookInstallation,
  installCodexObservationHooks,
  pruneCodexHookSpool,
} from "./codex-hooks";
import { readCodexSessionTranscript } from "./codex-transcript";
import { ConductorSessionAdapter } from "./conductor-adapter";
import { CopilotSessionAdapter } from "./copilot-adapter";
import { CURSOR_PROVIDER, CursorSessionAdapter } from "./cursor-adapter";
import { CursorLocalSessionAdapter } from "./cursor-local-adapter";
import { readCursorSessionTranscript } from "./cursor-transcript";
import { DevinSessionAdapter } from "./devin-adapter";
import { DockPresence } from "./dock-presence";
import { feedbackDeliveryFromEnvironment } from "./feedback-delivery";
import { GoogleCalendarReader } from "./google-calendar";
import { GoogleCalendarSignIn } from "./google-calendar-oauth";
import { HostedAttentionEvaluator } from "./hosted-attention-evaluator";
import { HostedRealtimeCredentialMinter } from "./hosted-realtime-credentials";
import { HostedUsageReader } from "./hosted-usage";
import { HOTKEY_RANK, HotkeyRegistrar } from "./hotkey-registrar";
import { JulesSessionAdapter } from "./jules-adapter";
import { LinearIssueTracker } from "./linear-tracker";
import { MediaDuckController } from "./media-duck";
import { MicrophoneRouteWatcher } from "./microphone-route";
import { openAiAttentionEvaluator } from "./openai-attention-evaluator";
import {
  openAiRealtimeCredentials,
  unavailableRealtimeDiagnostics,
} from "./openai-realtime-credentials";
import { OpenCodeSessionAdapter } from "./opencode-adapter";
import { readOpenCodeSessionTranscript } from "./opencode-transcript";
import { OutputVolumeWatcher } from "./output-volume";
import { PanelManager } from "./panel-manager";
import type { RealtimeCredentialMinter } from "./realtime-minter";
import { runModeFor } from "./run-mode";
import { sessionNoticeSpeech } from "./session-notifications";
import { createSettingsHandler, SettingsRefusal } from "./settings-handler";
import { SettingsStore, type StoredAccount } from "./settings-store";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
  APP_SETTING_DEFAULTS,
  type AppBootstrap,
  channels,
  isSettingsResetScope,
  isVoiceSource,
  type MicrophoneRoute,
  type MicrophoneStatus,
  type ObservedAccountCalendars,
  type OutputAudioState,
  SESSION_OPEN_RESULT_STATUS,
  SESSION_TRANSCRIPT_RESULT_STATUS,
  SETTINGS_RESET_SCOPE,
  type SessionOpenResult,
  type SessionTranscriptResult,
  VOICE_SOURCE,
} from "./shared/contracts";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  type CredentialProviderId,
  isCredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "./shared/credential-providers";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIFECYCLE_EVENT,
  type FeedbackResult,
  feedbackSubmission,
  isFeedbackKind,
} from "./shared/feedback";
import { parseVoiceHotkey } from "./shared/voice-hotkey";
import { isWorkspaceAgentSelection } from "./shared/workspace-agents";
import { UPDATE_ENDPOINT, UpdateService } from "./update-service";

const captureOutput = argumentValue("--capture-evidence");
const profile = argumentValue("--profile") ?? "idle";
const fixtureName = argumentValue("--fixture");
// Evidence only: the peek answers a pointer and the slot answers a press on a
// link, neither of which a capture run has any way to produce, so both can be
// asked for directly.
const startPeeked = process.argv.includes("--peek");
const startInSlot = process.argv.includes("--slot");
const fixture = fixtureSnapshot(fixtureName ?? "smoke");
const captureMode = captureOutput !== undefined;
// `--fixture` is enough on its own to make a run deterministic: the panel renders
// the fixture snapshot and no provider is observed. Capture runs always imply it.
const fixtureMode = captureMode || fixtureName !== undefined;
const runMode = runModeFor({ capture: captureMode, fixture: fixtureName !== undefined });
// A development build may be pointed at a local account service; a packaged one
// may not. The override redirects the whole sign-in — including the identity
// request that carries the access token — so it stops at the packaging boundary
// rather than shipping inside a signed binary.
const ACCOUNT_BASE_URL =
  (app.isPackaged ? undefined : process.env.LUKE_ACCOUNT_BASE_URL) ??
  "https://tryluke.dev/api/auth";
// The hosted voice and attention endpoints live on the same origin as the
// account service, so the one development override redirects both together —
// a build pointed at a local account service reviews and mints against it too.
const HOSTED_SERVICE_BASE_URL = ACCOUNT_BASE_URL.replace(/\/api\/auth\/?$/, "");
const ACCOUNT_CLIENT_ID = "luke-desktop";
const SESSION_REFRESH_INTERVAL_MS = 5_000;
const sessionRegistry = new InMemorySessionRegistry();
// `directory` and the cipher are read lazily so the store can be declared before
// the Electron app is ready.
const settingsStore = new SettingsStore({
  directory: () => app.getPath("userData"),
  // A fixture or evidence run refuses the credentials it resolves, so nothing is
  // reported as available that would not actually happen.
  credentialsUsable: runMode.observesProviders,
  cipher: {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plainText) => safeStorage.encryptString(plainText),
    decrypt: (cipherText) => safeStorage.decryptString(cipherText),
  },
});
const accountClient = new AccountClient({ baseUrl: ACCOUNT_BASE_URL, clientId: ACCOUNT_CLIENT_ID });
let account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
let signInRunning: Promise<AccountSnapshot> | undefined;
/**
 * Withdraws the sign-in currently waiting on the browser, when there is one.
 * Set for exactly the life of `signInRunning`: cancelling rejects the loopback
 * wait, and the attempt's own error path signs the account back out.
 */
let signInCancel: (() => void) | undefined;
let accountGeneration = 0;
let observationGeneration = 0;
const conductorAdapter = new ConductorSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.CONDUCTOR),
});
const copilotAdapter = new CopilotSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.COPILOT),
});
// Cursor runs sessions in two places: on this machine, which needs no
// credential and is observed from the transcripts Cursor writes for itself, and
// in its cloud, which needs a key. They are one provider wherever they ran, so
// they are observed as one adapter — a provider's sessions are replaced in a
// single commit, and two adapters sharing an id would retire each other's.
const cursorAdapter = new CompositeSessionProviderAdapter({
  provider: CURSOR_PROVIDER,
  adapters: [
    new CursorLocalSessionAdapter(),
    new CursorSessionAdapter({
      readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.CURSOR),
    }),
  ],
});
const devinAdapter = new DevinSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.DEVIN),
});
const julesAdapter = new JulesSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.JULES),
});
// Saving a key affects only the provider it belongs to, so this maps each
// credential to the one observer that reads it.
const adapterByCredentialProvider: ReadonlyMap<CredentialProviderId, SessionProviderAdapter> =
  new Map<CredentialProviderId, SessionProviderAdapter>([
    [CREDENTIAL_PROVIDER_ID.CONDUCTOR, conductorAdapter],
    [CREDENTIAL_PROVIDER_ID.COPILOT, copilotAdapter],
    [CREDENTIAL_PROVIDER_ID.CURSOR, cursorAdapter],
    [CREDENTIAL_PROVIDER_ID.DEVIN, devinAdapter],
    [CREDENTIAL_PROVIDER_ID.JULES, julesAdapter],
  ]);
// Luke's own corners of the application data, holding each provider's
// observation hook script and the spool it writes into. Resolved lazily like
// the settings store's directory, and reproduced by the installation
// functions whenever the registrations converge.
const CLAUDE_HOOKS_DIRECTORY_NAME = "claude-code-hooks";
const CODEX_HOOKS_DIRECTORY_NAME = "codex-hooks";
const HOOK_SPOOL_DIRECTORY_NAME = "events";
function claudeHookInstallation(): ClaudeCodeHookInstallation {
  const directory = path.join(app.getPath("userData"), CLAUDE_HOOKS_DIRECTORY_NAME);
  return {
    claudeHome: defaultClaudeHome(),
    hookScriptPath: path.join(directory, CLAUDE_HOOK_SCRIPT_NAME),
    spoolDirectory: path.join(directory, HOOK_SPOOL_DIRECTORY_NAME),
  };
}
function codexHookInstallation(): CodexHookInstallation {
  const directory = path.join(app.getPath("userData"), CODEX_HOOKS_DIRECTORY_NAME);
  return {
    codexHome: defaultCodexHome(),
    hookScriptPath: path.join(directory, CODEX_HOOK_SCRIPT_NAME),
    spoolDirectory: path.join(directory, HOOK_SPOOL_DIRECTORY_NAME),
  };
}
const sessionAdapters = [
  new ClaudeCodeSessionAdapter({
    hookEventsDirectory: () => claudeHookInstallation().spoolDirectory,
  }),
  new CodexSessionAdapter({
    hookEventsDirectory: () => codexHookInstallation().spoolDirectory,
  }),
  conductorAdapter,
  copilotAdapter,
  cursorAdapter,
  devinAdapter,
  julesAdapter,
  new OpenCodeSessionAdapter(),
] as const;
// The issue tracker is not a session provider: its issues feed the voice
// roster rather than the registry, so it stands beside the adapters rather
// than among them.
const linearTracker = new LinearIssueTracker({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.LINEAR),
});
const issueTrackers = [linearTracker] as const;
/** A board changes at the pace of hands, not of models; a minute is current. */
const ISSUE_REFRESH_INTERVAL_MS = 60_000;
/** The latest roster, which is also what every spoken act is validated against. */
let trackedIssues: readonly TrackedIssue[] | undefined;
let issueRefreshTimer: NodeJS.Timeout | undefined;
let issueRefreshRunning = false;
/**
 * Whether a pass was asked for while one was running. A key save or clear
 * must reach the roster on the very next pass, not be swallowed by an
 * interval tick that happened to be in flight — so the guard queues instead
 * of dropping.
 */
let issueRefreshQueued = false;
// The calendar is not a session provider either: it feeds nothing to the
// registry or the roster. Its meetings answer one question — is the user in a
// meeting now — and the answer gates only when announcements are spoken.
const googleCalendar = new GoogleCalendarReader({
  readAccounts: () => settingsStore.readCalendarAccounts(),
});
// The sign-in behind the calendar row: it opens Google's own consent page in
// the user's browser and hands back one grant, which the connect handler
// stores. Offered only when this build carries an OAuth client.
const googleCalendarSignIn = new GoogleCalendarSignIn({
  openExternal: (url) => void shell.openExternal(url),
});
/** A diary changes at the pace of hands too; five minutes is current. */
const CALENDAR_REFRESH_INTERVAL_MS = 5 * 60_000;
/**
 * How often held notices ask whether the meeting holding them has ended. The
 * question is answered from meetings already in memory, so asking often costs
 * nothing — and half a minute is how late after a meeting the backlog speaks.
 */
const HELD_NOTICE_RELEASE_INTERVAL_MS = 30_000;
/**
 * The meetings as last read; `undefined` says no calendar is connected, which
 * can never hold a notice. A failed pass keeps the meetings it has — a
 * calendar that cannot answer is not an empty diary.
 */
let calendarMeetings: readonly MeetingInterval[] | undefined;
/**
 * Each connected account's calendars as last observed — what the settings
 * rows draw their choices from, and what a spoken-of or clicked selection is
 * validated against before the store keeps it.
 */
let observedCalendars: readonly ObservedAccountCalendars[] = [];
let calendarRefreshTimer: NodeJS.Timeout | undefined;
let heldNoticeReleaseTimer: NodeJS.Timeout | undefined;
let calendarRefreshRunning = false;
/** A key save must reach the next pass, not be swallowed by one in flight. */
let calendarRefreshQueued = false;
// Notices decided while a meeting is on wait here, in the main process: the
// hold has to outlive any renderer, and this is the one place notices are
// decided. What releases them is the clock against observed intervals —
// deterministic, like the edges that produced them.
const heldNotices = new SessionNoticeHold();
/**
 * The other kind of announcement, held on the same terms: speech an answered
 * standing ask produced, already worded. It waits out a meeting exactly as a
 * status edge does — both break silence, and the quiet holds everything that
 * does. Unbidden evaluator summaries are never held: they only ever ride a
 * conversation the developer already has open, which is not silence to break.
 */
const heldRequestSpeech = new SessionNoticeHold<AttentionSpeech>();
/**
 * Whether the quiet is holding right now, as last computed — what the
 * renderer draws Luke's sleeping face from. Kept and broadcast on change so
 * every window agrees, and false the moment the meetings or the setting say
 * so.
 */
let meetingQuietActive = false;
// Notices come from status edges the registry observed, never from anything a
// model decided, so they work — and matter most — with no evaluator configured.
const sessionNoticeTracker = new SessionNoticeTracker();
// The workspaces Luke just created and has yet to open on screen. Entries come
// only from the validated creation act — nothing a model decided can add one —
// and each resolves against what observation itself reports.
const createdWorkspaceOpens = new CreatedWorkspaceOpenTracker();
/**
 * The standing asks the developer has made about sessions, in their words.
 * They outlive the reviewer — a key re-entered must not forget what was asked
 * — and are dropped only when withdrawn or when the session itself goes.
 */
const attentionRequests = new AttentionRequestRegistry();
/**
 * Everything the one OpenAI key buys, and nothing that outlives it: the review
 * that decides which sessions need a person, and the credential a spoken turn
 * runs on.
 *
 * Both are built from the stored credential rather than from the environment the
 * app was launched with, so both are rebuilt whenever that key changes — a key
 * entered in the panel turns them on, and a key deleted there takes them away
 * along with any ephemeral secret already minted under it. A fixture run stays
 * credential-free either way: evidence must be reproducible without a key and
 * without a network.
 */
let attentionReviewer: SessionAttentionReviewer | undefined;
let realtimeCredentials: RealtimeCredentialMinter | undefined;
/**
 * What the diagnostics ask answers while no minter exists. Kept current by
 * `applyVoiceCredential`, which is the only place that knows whether a key
 * failed to resolve or a run refuses credentials outright.
 */
let voiceUnavailableDiagnostics = unavailableRealtimeDiagnostics({
  fixtureMode: !runMode.sendsNetwork,
  apiKeyConfigured: false,
});
/** Reads the hosted allowance; exists exactly while the hosted minter does. */
let hostedUsageReader: HostedUsageReader | undefined;
// Quiets Music and Spotify while a spoken exchange is live. It lives here
// rather than in the renderer because letting the players back up must survive
// anything the renderer does — and only this process may run a helper.
const mediaDuck = new MediaDuckController();
const feedbackDelivery = feedbackDeliveryFromEnvironment();
// Learns whether a newer release exists, and nothing else. It lives here
// rather than in a renderer because the timer must survive every window, and
// what it learns reaches them all through the same broadcast settings use.
const updateService = new UpdateService({
  currentVersion: app.getVersion(),
  onChange: (update) => panels.broadcast(channels.updateChanged, update),
});
/**
 * The output's switches as last read, and the helper that reads them. The
 * state lives here rather than in the renderer so bootstrap can carry the
 * answer a push has already delivered; `undefined` is "cannot be read", which
 * the renderer must draw as audible.
 */
let outputAudio: OutputAudioState | undefined;
let outputVolumeWatcher: OutputVolumeWatcher | undefined;
/**
 * Where the developer's voice would be captured from, as last read, and the
 * helper that reads it. The state lives here so the renderer's ask can be
 * answered at once while a fresh probe rides behind it; `undefined` is
 * "cannot be read", which the renderer must take as the browser's default.
 */
let microphoneRoute: MicrophoneRoute | undefined;
let microphoneRouteWatcher: MicrophoneRouteWatcher | undefined;

function rendererUrl(): string {
  return pathToFileURL(path.join(__dirname, "renderer", "index.html")).href;
}

const panels = new PanelManager({
  runMode,
  mediaDuck,
  preloadPath: path.join(__dirname, "preload.js"),
  rendererHtmlPath: path.join(__dirname, "renderer", "index.html"),
  rendererUrl: rendererUrl(),
});
const hotkeys = new HotkeyRegistrar({
  registersGlobalKeys: runMode.registersGlobalKeys,
  hasCredentials: () => realtimeCredentials !== undefined,
  host: {
    voiceHost: () => panels.voiceHost(),
    displayIdFor: (sender) => panels.displayIdFor(sender),
    setMode: (displayId, mode, requestFocus) => {
      panels.setMode(displayId, mode, requestFocus);
    },
    broadcast: (channel, payload) => panels.broadcast(channel, payload),
  },
});
const dock = new DockPresence({
  focusExpanded: (displayId) => panels.focusExpanded(displayId),
  iconDirectory: path.join(__dirname, "icon"),
});

/**
 * Starts watching whether the Mac's output would let Luke be heard. Not in a
 * fixture or capture run: evidence must not read the machine it happens to
 * run on, and a fixture run has no voice to go unheard — the muted evidence
 * profile asks the renderer for the state directly instead.
 */
function startOutputVolumeWatch(): void {
  if (!runMode.observesProviders) return;
  const send = (state: OutputAudioState | undefined) => {
    outputAudio = state;
    // Every display's panel captions the same voice, so every one is told.
    panels.broadcast(channels.outputAudioChanged, state);
  };
  outputVolumeWatcher = new OutputVolumeWatcher({
    onState: send,
    onUnavailable: () => send(undefined),
  });
  if (!outputVolumeWatcher.start()) outputVolumeWatcher = undefined;
}

/**
 * Starts watching where the developer's voice would be captured from, under
 * the same rule as the output watch: read-only, and not in a fixture or
 * capture run. What it learns decides only which device the renderer asks the
 * browser to open when a press takes a turn.
 */
function startMicrophoneRouteWatch(): void {
  if (!runMode.observesProviders) return;
  microphoneRouteWatcher = new MicrophoneRouteWatcher({
    onRoute: (route) => {
      microphoneRoute = route;
    },
    onUnavailable: () => {
      microphoneRoute = undefined;
    },
  });
  if (!microphoneRouteWatcher.start()) microphoneRouteWatcher = undefined;
}

let tray: Tray | undefined;
let sessionRefreshTimer: NodeJS.Timeout | undefined;
let unsubscribeSessions: (() => void) | undefined;
let sessionRefreshGeneration: number | undefined;
let attentionReviewRunning = false;
/**
 * The projects last announced to the renderer, serialized for comparison.
 * Undefined until the first announcement decides what there is to compare.
 */
let lastWorkspaceProjects: string | undefined;

/**
 * Announces where a workspace can be created whenever the offer changes. This
 * cannot ride the registry's own notifications alone: the registry only speaks
 * when the session snapshot changes, and a pass can change the project list
 * while leaving the sessions exactly as they were — a key just added with no
 * workspaces yet, a project connected but not yet worked in — so the check
 * runs on the observation cadence as well as on every commit.
 */
function broadcastWorkspaceProjects(): void {
  const projects = observedWorkspaceProjects();
  const serialized = JSON.stringify(projects);
  if (serialized === lastWorkspaceProjects) return;
  lastWorkspaceProjects = serialized;
  panels.broadcast(channels.workspaceProjectsChanged, projects);
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function microphoneStatus(): MicrophoneStatus {
  if (process.platform !== "darwin") return "granted";
  return systemPreferences.getMediaAccessStatus("microphone") as MicrophoneStatus;
}

async function requestMicrophone(): Promise<MicrophoneStatus> {
  if (process.platform !== "darwin") return "granted";
  if (microphoneStatus() === "not-determined") {
    await systemPreferences.askForMediaAccess("microphone");
  }
  return microphoneStatus();
}

function trustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? event.sender.getURL();
  return url === rendererUrl();
}

function isAccountProvider(value: unknown): value is AccountProvider {
  return value === ACCOUNT_PROVIDER.GOOGLE || value === ACCOUNT_PROVIDER.GITHUB;
}

function accountCapabilitiesActive(): boolean {
  return accountGateOpen(runMode, account.status === ACCOUNT_STATUS.SIGNED_IN);
}

function broadcastAccount(): void {
  panels.broadcast(channels.accountChanged, account);
}

/**
 * Tells every panel what an account transition just did to the settings.
 * `voiceAvailable` rides the settings snapshot and moves with the account
 * — a sign-in carries the hosted allowance, a sign-out takes it — but the
 * transitions themselves only broadcast `accountChanged`, so without this the
 * renderer keeps drawing the voice state of the account it no longer has.
 */
async function broadcastVoiceAvailability(): Promise<void> {
  panels.broadcast(channels.settingsChanged, await settingsStore.snapshot());
}

async function startAccountCapabilities(generation = accountGeneration): Promise<void> {
  if (generation !== accountGeneration || !accountCapabilitiesActive()) return;
  await applyVoiceCredential();
  await broadcastVoiceAvailability();
  if (generation !== accountGeneration || !accountCapabilitiesActive()) return;
  await hotkeys.reapply(HOTKEY_RANK.TALK);
  if (generation !== accountGeneration || !accountCapabilitiesActive()) return;
  startSessionObservation();
  startIssueObservation();
  startCalendarObservation();
}

async function stopAccountCapabilities(): Promise<void> {
  stopSessionObservation();
  stopIssueObservation();
  stopCalendarObservation();
  await applyVoiceCredential();
  await hotkeys.reapply(HOTKEY_RANK.TALK);
}

async function signOutAccount(options: { revokeRemote?: boolean } = {}): Promise<AccountSnapshot> {
  accountGeneration += 1;
  observationGeneration += 1;
  // Close the gate synchronously, before the settings write yields. Otherwise
  // the observation timer can see the new generation with the old signed-in
  // account and start a pass that belongs to neither account lifecycle.
  account = { status: ACCOUNT_STATUS.SIGNED_OUT };
  const storedAccount = options.revokeRemote ? settingsStore.readAccount() : undefined;
  const clearingAccount = settingsStore.clearAccount();
  await stopAccountCapabilities();
  account = await clearingAccount;
  broadcastAccount();
  // Only after the clear has settled: a snapshot taken while it was in flight
  // could still see the account and say voice survives the sign-out.
  await broadcastVoiceAvailability();
  const refreshToken = (await storedAccount)?.refreshToken;
  if (refreshToken) {
    await accountClient.revoke(refreshToken).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Account token revocation failed: ${message}\n`);
    });
  }
  return account;
}

/**
 * Erases the account at the service, then signs this machine out of it. The
 * hosted delete runs first and any failure keeps the account signed in: a
 * sign-out ahead of a confirmed delete would read as deletion while the
 * service still holds everything.
 */
async function deleteAccountEverywhere(): Promise<AccountSnapshot> {
  const stored = await settingsStore.readAccount();
  // No stored credential is a refusal, not a sign-out: without one there is
  // no way to prove the ask to the service, and resolving here would read as
  // a finished delete while the service still holds the account.
  if (!stored) throw new Error("No stored account credential to delete with");
  try {
    await deleteHostedAccount({
      serviceBaseUrl: HOSTED_SERVICE_BASE_URL,
      accessToken: stored.accessToken,
    });
  } catch (error) {
    if (!accessTokenNeedsRefresh(error)) throw error;
    // Routine expiry of an hour-lived token. Refreshed directly rather than
    // through the shared single flight, because that flight answers a revoked
    // grant by signing the machine out — which here would dress a failed
    // delete as a finished one. The rotation is stored before the retry so a
    // retry that fails cannot strand the account on a spent token.
    const generation = accountGeneration;
    const tokens = await accountClient.refresh(stored.refreshToken);
    await storeCurrentAccount(generation, { ...stored, ...tokens });
    await deleteHostedAccount({
      serviceBaseUrl: HOSTED_SERVICE_BASE_URL,
      accessToken: tokens.accessToken,
    });
  }
  // The user's rows at the service died with the delete — tokens included —
  // so a remote revocation has nothing left to act on.
  return signOutAccount();
}

/** Stores credentials only while the account lifecycle that produced them is current. */
async function storeCurrentAccount(generation: number, stored: StoredAccount): Promise<boolean> {
  if (generation !== accountGeneration) return false;
  const next = await settingsStore.setAccount(stored);
  // The store serializes this write with clearAccount(), so a sign-out that
  // arrived during the await owns the final disk state. It must own memory too.
  if (generation !== accountGeneration) return false;
  account = next;
  return true;
}

async function refreshStoredAccount(): Promise<void> {
  const stored = await settingsStore.readAccount();
  if (!stored || !runMode.requiresAccount) return;
  const generation = accountGeneration;
  try {
    const identity = await accountClient.userInfo(stored.accessToken, stored.provider);
    if (
      identity.email !== stored.email ||
      identity.name !== stored.name ||
      identity.pictureUrl !== stored.pictureUrl ||
      identity.provider !== stored.provider
    ) {
      if (!(await storeCurrentAccount(generation, mergedAccountIdentity(stored, identity)))) {
        return;
      }
      broadcastAccount();
    }
    return;
  } catch (error) {
    if (!accessTokenNeedsRefresh(error)) return;
  }

  let tokens: AccountTokens;
  try {
    tokens = await accountClient.refresh(stored.refreshToken);
  } catch (error) {
    // Only the token endpoint can definitively revoke the account. User-info
    // failures below are identity refresh failures and never clear the stored
    // refresh token, regardless of what shape their response happens to take.
    if (accountFailureAction(error) === ACCOUNT_FAILURE_ACTION.SIGN_OUT) {
      if (generation !== accountGeneration) return;
      await signOutAccount();
    }
    return;
  }

  try {
    // A refresh token may rotate as soon as the token endpoint answers. Keep
    // that answer before asking for identity so a transient user-info failure
    // cannot strand the account with the now-revoked previous token.
    if (!(await storeCurrentAccount(generation, { ...stored, ...tokens }))) return;
    const identity = await accountClient.userInfo(tokens.accessToken, stored.provider);
    if (
      !(await storeCurrentAccount(
        generation,
        mergedAccountIdentity({ ...stored, ...tokens }, identity),
      ))
    ) {
      return;
    }
    broadcastAccount();
  } catch {}
}

/**
 * A fresh identity replaces the stored one outright: a name or picture the
 * provider no longer reports must fall away rather than surviving as a stale
 * spread-over field.
 */
function mergedAccountIdentity(stored: StoredAccount, identity: AccountIdentity): StoredAccount {
  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    ...identity,
  };
}

function beginAccountSignIn(provider: AccountProvider): Promise<AccountSnapshot> {
  if (account.status === ACCOUNT_STATUS.SIGNED_IN) return Promise.resolve(account);
  if (signInRunning) return signInRunning;
  account = { status: ACCOUNT_STATUS.SIGNING_IN };
  const generation = ++accountGeneration;
  broadcastAccount();
  // Cancellable from the first moment the renderer can ask: before the
  // loopback exists the cancel is remembered, and once it exists the cancel
  // rejects its wait — either way the attempt below ends as cancelled.
  let cancelled = false;
  signInCancel = () => {
    cancelled = true;
  };
  signInRunning = (async () => {
    let loopback: Awaited<ReturnType<typeof startAccountLoopback>> | undefined;
    try {
      const activeLoopback = await startAccountLoopback({ providerHint: provider });
      loopback = activeLoopback;
      signInCancel = () => activeLoopback.cancel();
      if (cancelled) activeLoopback.cancel();
      const authorizeUrl = accountClient.authorizeUrl({
        redirectUri: activeLoopback.redirectUri,
        state: activeLoopback.state,
        codeChallenge: activeLoopback.codeChallenge,
      });
      await shell.openExternal(authorizeUrl);
      const code = await loopback.waitForCode;
      await withIssuedAccountTokens({
        issue: () =>
          accountClient.exchangeCode({
            code,
            codeVerifier: activeLoopback.codeVerifier,
            redirectUri: activeLoopback.redirectUri,
          }),
        use: async (tokens) => {
          const identity = await accountClient.userInfo(tokens.accessToken, provider);
          if (!(await storeCurrentAccount(generation, { ...tokens, ...identity }))) {
            throw new Error(SIGN_IN_CANCELLED_MESSAGE);
          }
          await startAccountCapabilities(generation);
          if (generation !== accountGeneration) throw new Error(SIGN_IN_CANCELLED_MESSAGE);
        },
        revoke: (refreshToken) => accountClient.revoke(refreshToken),
        onRevokeFailure: (revokeError) => {
          const message = revokeError instanceof Error ? revokeError.message : String(revokeError);
          process.stderr.write(`Rejected account token revocation failed: ${message}\n`);
        },
      });
      broadcastAccount();
      return account;
    } catch (error) {
      if (generation === accountGeneration) await signOutAccount();
      // A withdrawn sign-in is a normal outcome, not a failure: it resolves
      // with the signed-out account rather than rejecting the renderer's
      // invoke, which Electron would otherwise report as a handler error.
      if (isSignInCancellation(error)) return account;
      throw error;
    } finally {
      signInCancel = undefined;
      await loopback?.close();
      signInRunning = undefined;
    }
  })();
  return signInRunning;
}

/**
 * Whether a renderer message names a session. Both halves are required to be
 * present here because the registry rejects an empty one by throwing, and a
 * malformed message is a broken request rather than something a user can act
 * on.
 */
function isSessionIdentity(value: unknown): value is SessionIdentity {
  if (value === null || typeof value !== "object") return false;
  const { providerId, providerSessionId } = value as Partial<SessionIdentity>;
  return (
    typeof providerId === "string" &&
    providerId.trim().length > 0 &&
    typeof providerSessionId === "string" &&
    providerSessionId.trim().length > 0
  );
}

/**
 * Whether a renderer message is a validated issue act. Like a session
 * identity, a malformed one is a broken request rather than something the
 * user can act on — and everything it names is re-resolved against the
 * latest observation before a tracker client sees any of it.
 */
function isIssueActionAsk(value: unknown): value is {
  kind: "issue-state" | "issue-comment";
  identity: { trackerId: string; identifier: string };
  transition?: { id: string; name: string };
  body?: string;
} {
  if (value === null || typeof value !== "object") return false;
  const { kind, identity } = value as {
    kind?: unknown;
    identity?: { trackerId?: unknown; identifier?: unknown };
  };
  if (kind !== "issue-state" && kind !== "issue-comment") return false;
  return (
    typeof identity?.trackerId === "string" &&
    identity.trackerId.trim().length > 0 &&
    typeof identity.identifier === "string" &&
    identity.identifier.trim().length > 0
  );
}

/**
 * States on startup whether voice is on, and why not when it is off. A packaged
 * app has no visible stderr, but the common case during local testing is a
 * terminal launch — where this is the difference between a one-line answer and
 * guessing at an empty panel.
 */
function reportVoiceAvailability(apiKeyConfigured: boolean): void {
  if (realtimeCredentials) {
    const report = realtimeCredentials.diagnostics();
    process.stderr.write(
      `Luke voice: enabled (${report.hosted ? "hosted, " : ""}${report.model})\n`,
    );
    return;
  }
  const report = unavailableRealtimeDiagnostics({
    fixtureMode: !runMode.sendsNetwork,
    apiKeyConfigured,
  });
  process.stderr.write(
    `Luke voice: unavailable — ${realtimeMintExplanation(report.lastOutcome)}\n`,
  );
}

/**
 * Pays the mint function's cold start before the first press needs it. The
 * hosted mint runs in a serverless function that unloads between uses, and a
 * cold one adds seconds to exactly the moment someone is already speaking —
 * a press released mid-connect abandons the attempt by design, so the first
 * exchange after launch was being lost to startup the developer never sees.
 * The GET carries nothing, authenticates nothing, and spends nothing: the
 * endpoint answers it 405 by design, and loading the module to say no is the
 * entire point.
 */
function warmHostedVoice(): void {
  fetch(`${HOSTED_SERVICE_BASE_URL}${HOSTED_SERVICE_PATH.VOICE_MINT}`, {
    method: "GET",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/**
 * The seams the hosted clients reach the account through. The token is read
 * fresh from the store on every use — the lifecycle owns rotation — and a 401
 * asks that same lifecycle for a refresh rather than growing a second one.
 * The refresh is single-flighted because its token rotates when spent: a mint
 * and a review both answering 401 at the hour mark must share one refresh, or
 * the loser's spent token reads as revocation and signs the account out.
 */
const refreshStoredAccountOnce = singleFlight(() => refreshStoredAccount());

function hostedServiceSeams() {
  return {
    serviceBaseUrl: HOSTED_SERVICE_BASE_URL,
    readAccessToken: async () => (await settingsStore.readAccount())?.accessToken,
    refreshAccount: refreshStoredAccountOnce,
  };
}

/**
 * Reads the OpenAI key and rebuilds everything that runs on it.
 *
 * This is the whole of turning voice on and off. It runs once at startup and
 * again on every change to that key, so a key pasted into the panel takes effect
 * where it was pasted rather than on the next launch — and a key deleted there
 * takes voice away just as immediately, ephemeral secret included. The talk key
 * is not moved here: only a change while the app is running needs that, and
 * `hotkeys.reapply` is what does it.
 */
async function applyVoiceCredential(): Promise<void> {
  // A fixture run does not ask for the key at all: reading a stored one means a
  // Keychain decrypt, which a run that would refuse to use it has no business
  // asking for. That is also why the report says no key resolved — for this run,
  // none did.
  // Which of the two the store resolved — the user's choice where it can be
  // honoured — decides whether the key is read at all, and it is asked last of
  // the three for the reason above: every gate a run can fail is checked
  // before anything reaches the Keychain.
  const apiKey =
    runMode.sendsNetwork &&
    accountCapabilitiesActive() &&
    (await settingsStore.readVoiceSource()) === VOICE_SOURCE.KEY
      ? await settingsStore.readApiKey(VOICE_CREDENTIAL_PROVIDER_ID)
      : undefined;
  // The hosted service stands in exactly where a key could have: a run that
  // sends network traffic, signed in, and not running on a key of the
  // developer's own — because none is stored, or because they chose the
  // allowance over the one that is.
  const hosted =
    apiKey === undefined && runMode.sendsNetwork && account.status === ACCOUNT_STATUS.SIGNED_IN;
  const evaluator = apiKey
    ? openAiAttentionEvaluator(apiKey)
    : hosted
      ? new HostedAttentionEvaluator(hostedServiceSeams())
      : undefined;
  attentionReviewer = evaluator
    ? new SessionAttentionReviewer({
        evaluator,
        currentSession: (identity) => sessionRegistry.get(identity),
        noticeRequestFor: (identity) => attentionRequests.get(identity),
      })
    : undefined;
  // The chosen voice and pace are what a credential is minted against, so they
  // are read here rather than set afterwards: a minter built without them would
  // speak in the default voice until the next time either changed. A file that
  // cannot be read means no choice was kept, and the environment or the defaults
  // answer inside the factory.
  const [voice, speed] = await Promise.all([
    settingsStore.readVoice().catch(() => undefined),
    settingsStore.readVoiceSpeed().catch(() => undefined),
  ]);
  realtimeCredentials = apiKey
    ? openAiRealtimeCredentials(apiKey, {
        ...(voice ? { voice } : {}),
        ...(speed ? { speed } : {}),
      })
    : hosted
      ? new HostedRealtimeCredentialMinter({
          ...hostedServiceSeams(),
          ...(voice ? { voice } : {}),
          ...(speed ? { speed } : {}),
        })
      : undefined;
  voiceUnavailableDiagnostics = unavailableRealtimeDiagnostics({
    fixtureMode: !runMode.sendsNetwork,
    apiKeyConfigured: apiKey !== undefined,
  });
  hostedUsageReader = hosted ? new HostedUsageReader(hostedServiceSeams()) : undefined;
  // Warm only when the next press would actually mint through the service.
  if (hosted) warmHostedVoice();
  reportVoiceAvailability(apiKey !== undefined);
}

/**
 * The renderer records chords through the same reader, so one that does
 * not parse is a malformed request rather than a choice to answer.
 */
function parsedVoiceHotkey(accelerator: unknown): string | undefined {
  if (accelerator !== undefined && typeof accelerator !== "string") {
    throw new Error("Invalid shortcut request");
  }
  const chosen = accelerator === undefined ? undefined : parseVoiceHotkey(accelerator);
  if (accelerator !== undefined && chosen === undefined) {
    throw new Error("Invalid shortcut request");
  }
  return chosen;
}

function adapterFor(providerId: string) {
  return sessionAdapters.find((candidate) => candidate.provider.id === providerId);
}

/**
 * A renderer-supplied string that must survive its bound, or be refused.
 * Omitted stays omitted: the field was not offered.
 */
function boundedField(
  raw: unknown,
  bound: (value: unknown) => string | undefined,
): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  const value = bound(raw);
  return value === undefined ? { ok: false } : { ok: true, value };
}

/**
 * The first workspace that lands chooses the default provider — and its
 * project, and a model named for that creation, the default agent — only
 * while nothing is chosen. A default the user holds is theirs to change,
 * never a creation's. Losing the save loses only the remembered default,
 * never the workspace that just landed.
 */
async function rememberWorkspaceDefaults(
  adapter: SessionProviderAdapter,
  providerProjectId: string,
  namedSelection: WorkspaceAgentSelection | undefined,
): Promise<void> {
  if (!isProviderId(adapter.provider.id)) return;
  const providerId = adapter.provider.id;
  try {
    if ((await settingsStore.readDefaultWorkspaceProvider()) === undefined) {
      const saved = await settingsStore.setDefaultWorkspaceProvider(providerId);
      panels.broadcast(channels.settingsChanged, saved.settings);
    }
    // The project the workspace landed in becomes that provider's default on
    // the same first-choice terms, read again for the same overlap reason as
    // the model below. The id was validated against the adapter's offered
    // projects before the creation ran, so what is remembered is one the
    // provider itself listed.
    if ((await settingsStore.readWorkspaceProjectDefault(providerId)) === undefined) {
      const saved = await settingsStore.setWorkspaceProjectDefault(providerId, providerProjectId);
      panels.broadcast(channels.settingsChanged, saved.settings);
    }
    // A model named for this creation becomes the default on the same
    // first-choice terms as the provider: only while nothing is chosen.
    // A default already held is the user's, changed by asking for the
    // setting itself — never as a side effect of one creation. Read
    // again here rather than trusting the pre-creation snapshot: a
    // choice made by hand while the provider was answering is already
    // held, and must not lose to the request it overlapped.
    if (
      namedSelection !== undefined &&
      (await settingsStore.readWorkspaceAgentDefault(providerId)) === undefined
    ) {
      const saved = await settingsStore.setWorkspaceAgentDefault(providerId, namedSelection);
      panels.broadcast(channels.settingsChanged, saved.settings);
    }
  } catch {
    // The reply is the creation's; a failed remember has no line in it.
  }
}

function registerIpc(): void {
  const registerSettingHandler = createSettingsHandler({
    trustedSender,
    snapshot: () => settingsStore.snapshot(),
    broadcast: (settings, except) => panels.broadcast(channels.settingsChanged, settings, except),
  });
  ipcMain.handle(channels.bootstrap, async (event): Promise<AppBootstrap> => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    // Each window bootstraps as itself: its own display, its own mode. The
    // roster and the settings are the same everywhere.
    const displayId = panels.displayIdFor(event.sender);
    const display =
      (displayId !== undefined ? panels.display(displayId) : undefined) ??
      screen.getPrimaryDisplay();
    return {
      mode: displayId !== undefined ? panels.modeFor(displayId) : panels.initialMode,
      startPeeked,
      startInSlot,
      profile,
      fixture,
      captureMode,
      fixtureMode,
      accountRequired: runMode.requiresAccount,
      account,
      packaged: app.isPackaged,
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      microphoneStatus: microphoneStatus(),
      // Both keys travel as accelerators rather than labels: the renderer needs
      // both spellings — the keycaps' ⌥ and L drawn apart, and aria's Alt+L —
      // and only the accelerator can produce the pair.
      ...(hotkeys.talk ? { voiceHotkey: hotkeys.talk } : {}),
      voiceHotkeyHeld: hotkeys.held,
      ...(hotkeys.ask ? { askHotkey: hotkeys.ask } : {}),
      ...(hotkeys.stop ? { stopHotkey: hotkeys.stop } : {}),
      ...(outputAudio ? { outputAudio } : {}),
      display: panels.diagnostic(display),
      update: updateService.snapshot(),
      // Bootstrapped through the same relevance gate every broadcast passes:
      // a panel that opens late must not learn of rows the roster has already
      // let go and then hold them past the next broadcast's dedupe.
      sessions:
        runMode.observesProviders && accountCapabilitiesActive()
          ? rosterRelevantSessions(sessionRegistry.snapshot().sessions, Date.now())
          : [],
      // Asks are about observed sessions, so they ride the same gate the
      // roster does: a panel shown no sessions is shown no asks about them.
      noticeAsks:
        runMode.observesProviders && accountCapabilitiesActive() ? attentionRequests.list() : [],
      workspaceProjects: accountCapabilitiesActive() ? observedWorkspaceProjects() : [],
      ...(trackedIssues && runMode.observesProviders && accountCapabilitiesActive()
        ? { issues: trackedIssues }
        : {}),
      // The calendar is a capability like the rosters: nothing of it is
      // shown, or held quiet, before the account gate opens.
      calendars: accountCapabilitiesActive() ? observedCalendars : [],
      meetingQuiet: accountCapabilitiesActive() && meetingQuietActive,
      settings: await settingsStore.snapshot(),
    };
  });

  ipcMain.handle(channels.beginSignIn, (event, provider: unknown) => {
    if (!trustedSender(event) || !isAccountProvider(provider)) {
      throw new Error("Invalid sign-in request");
    }
    return beginAccountSignIn(provider);
  });

  ipcMain.handle(channels.cancelSignIn, (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    // A cancel with nothing waiting is a no-op rather than an error: the
    // sign-in it meant to withdraw may have just finished or failed on its own.
    signInCancel?.();
  });

  ipcMain.handle(channels.signOut, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return signOutAccount({ revokeRemote: true });
  });

  ipcMain.handle(channels.deleteAccount, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return deleteAccountEverywhere();
  });

  ipcMain.handle(channels.setExpanded, (event, expanded: unknown, focus: unknown) => {
    if (!trustedSender(event) || typeof expanded !== "boolean") {
      throw new Error("Invalid window mode request");
    }
    // The ask is the sender's own window's: expanding a panel on one display
    // must not unfold one on every other.
    const displayId = panels.displayIdFor(event.sender);
    if (displayId === undefined) throw new Error("Invalid window mode request");
    return panels.setMode(displayId, expanded ? "expanded" : "compact", focus === true);
  });

  // The tray items' feedback gesture, asked for from a renderer — the spoken
  // open rides this so the ordering stays owned here for every caller: the
  // mode event the panel manager sends and the composer event that follows travel
  // the same lifecycle channel, so the shape that wins is always the
  // composer, never a panel racing it in from another channel. Opening is all
  // this does; a note still arrives only through channels.sendFeedback, from
  // the composer's own Send button.
  ipcMain.handle(channels.summonFeedback, (event, kind: unknown) => {
    if (!trustedSender(event) || !isFeedbackKind(kind)) {
      throw new Error("Invalid composer request");
    }
    const displayId = panels.displayIdFor(event.sender);
    if (displayId === undefined) throw new Error("Invalid composer request");
    panels.setMode(displayId, "expanded", true);
    event.sender.send(channels.lifecycle, FEEDBACK_LIFECYCLE_EVENT[kind]);
  });

  ipcMain.on(channels.setPointerInterception, (event, interceptsPointer: unknown) => {
    if (!trustedSender(event) || typeof interceptsPointer !== "boolean") {
      return;
    }
    // The pointer question is per window too: the hit regions the renderer
    // reported are its own.
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setIgnoreMouseEvents(!interceptsPointer, { forward: true });
  });

  ipcMain.handle(channels.requestMicrophone, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return requestMicrophone();
  });

  ipcMain.handle(channels.microphoneRoute, (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    // Answer with what is known and ask again behind the answer: the next
    // press then sees a lid that closed with no device change to announce it.
    microphoneRouteWatcher?.probe();
    return microphoneRoute;
  });

  // The renderer can replace or clear a provider's credential but never reads
  // it back; the reply reports only where each key now comes from.
  registerSettingHandler(channels.setProviderApiKey, {
    validate(providerId: unknown, apiKey: unknown) {
      // The provider list is fixed by this build, so an id outside it is a
      // malformed request rather than something the user can correct.
      if (!isCredentialProviderId(providerId)) throw new Error("Unknown credential provider");
      if (apiKey !== undefined && typeof apiKey !== "string") {
        throw new Error("Invalid API key request");
      }
      return { providerId, apiKey };
    },
    save: ({ providerId, apiKey }) => settingsStore.setApiKey(providerId, apiKey),
    async apply(result, { providerId }) {
      // Only the provider whose key changed is affected, so the local
      // observers are left alone rather than re-crawling the filesystem on
      // every save.
      const adapter = adapterByCredentialProvider.get(providerId);
      if (!result.reason && adapter) void sessionRegistry.refresh(adapter);
      // The tracker's key connects the tracker, not a session provider, so
      // its save refreshes the roster instead of the registry.
      if (!result.reason && providerId === CREDENTIAL_PROVIDER_ID.LINEAR) {
        void refreshTrackedIssues();
      }
      // The voice key connects neither: it is what the spoken conversation and
      // the attention review are built from, so a change to it rebuilds both
      // and then moves the talk key — claimed now that there is something to
      // talk to, or given back to the machine now that there is not. Awaited,
      // because a press right after the save has to find a minter.
      if (!result.reason && providerId === VOICE_CREDENTIAL_PROVIDER_ID) {
        await applyVoiceCredential();
        await hotkeys.reapply(HOTKEY_RANK.TALK);
      }
    },
    refusal: "Could not save that API key on this system.",
  });

  // The status item follows the stored answer at once: a setting that only
  // took effect on the next launch would read as a toggle that does nothing.
  registerSettingHandler(channels.setShowInMenuBar, {
    validate(show: unknown) {
      if (typeof show !== "boolean") throw new Error("Invalid menu bar request");
      return show;
    },
    save: (show) => settingsStore.setShowInMenuBar(show),
    apply: (result) => applyMenuBarVisibility(result.settings.showInMenuBar),
    refusal: "Could not save that setting on this system.",
  });

  // The Dock icon follows the stored answer at once, like the status item: a
  // setting that only took effect on the next launch would read as a toggle
  // that does nothing.
  registerSettingHandler(channels.setShowInDock, {
    validate(show: unknown) {
      if (typeof show !== "boolean") throw new Error("Invalid Dock request");
      return show;
    },
    save: (show) => settingsStore.setShowInDock(show),
    apply: (result, _show, event) =>
      dock.apply(result.settings.showInDock, panels.displayIdFor(event.sender)),
    refusal: "Could not save that setting on this system.",
  });

  // The windows follow the stored answer at once, like the status item: on
  // raises a panel on every connected display, off brings Luke back to the
  // main one alone.
  registerSettingHandler(channels.setShowOnAllDisplays, {
    validate(show: unknown) {
      if (typeof show !== "boolean") throw new Error("Invalid display request");
      return show;
    },
    save: (show) => settingsStore.setShowOnAllDisplays(show),
    apply(result) {
      panels.setShowOnAllDisplays(result.settings.showOnAllDisplays);
      panels.reconcile();
    },
    refusal: "Could not save that setting on this system.",
  });

  // The form follows the stored answer at once, for the same reason: every
  // window resizes around the housing the shape is about to draw or drop.
  registerSettingHandler(channels.setFormFactor, {
    validate(formFactor: unknown) {
      if (!isPanelFormFactor(formFactor)) throw new Error("Invalid form factor request");
      return formFactor;
    },
    save: (formFactor) => settingsStore.setFormFactor(formFactor),
    apply(result) {
      panels.setFormFactor(result.settings.formFactor);
      panels.positionAll();
    },
    refusal: "Could not save that setting on this system.",
  });

  // The default workspace provider is a preference about where a nameless
  // creation ask goes, never a wider write path: it steers which project list
  // the conversation is told to prefer, and every creation is still validated
  // against what the adapters actually offer.
  registerSettingHandler(channels.setDefaultWorkspaceProvider, {
    validate(providerId: unknown) {
      if (
        providerId !== undefined &&
        (typeof providerId !== "string" || !isProviderId(providerId))
      ) {
        throw new Error("Unknown workspace provider");
      }
      return typeof providerId === "string" ? providerId : undefined;
    },
    save: (providerId) => settingsStore.setDefaultWorkspaceProvider(providerId),
    refusal: "Could not save that setting on this system.",
  });

  // The agent and model new workspaces start with, per provider. The pairing
  // travels the form factor's road — a value from a set fixed by this build —
  // it is just a documented table per provider rather than one enum: anything
  // outside the table is refused here, so the store never holds a value no
  // endpoint takes.
  registerSettingHandler(channels.setWorkspaceAgentDefault, {
    validate(providerId: unknown, selection: unknown) {
      if (typeof providerId !== "string" || !isProviderId(providerId)) {
        throw new Error("Unknown workspace provider");
      }
      if (selection !== undefined && !isWorkspaceAgentSelection(providerId, selection)) {
        throw new Error("Unknown workspace agent");
      }
      return { providerId, selection };
    },
    save: ({ providerId, selection }) =>
      settingsStore.setWorkspaceAgentDefault(providerId, selection),
    refusal: "Could not save that setting on this system.",
  });

  // The project one provider creates nameless-ask workspaces in. Projects are
  // observed rather than build-fixed, so the value is held to the list the
  // provider's adapter currently offers — the same list every creation act is
  // validated against — and clearing needs no list at all.
  registerSettingHandler(channels.setWorkspaceProjectDefault, {
    validate(providerId: unknown, providerProjectId: unknown) {
      if (typeof providerId !== "string" || !isProviderId(providerId)) {
        throw new Error("Unknown workspace provider");
      }
      if (providerProjectId === undefined) {
        return { providerId, providerProjectId: undefined };
      }
      if (typeof providerProjectId !== "string" || !providerProjectId.trim()) {
        throw new Error("Invalid workspace project");
      }
      const adapter = adapterFor(providerId);
      const offered =
        adapter && isWorkspaceCapableAdapter(adapter)
          ? adapter
              .workspaceProjects()
              .some((project) => project.providerProjectId === providerProjectId)
          : false;
      if (!offered) throw new Error("Unknown workspace project");
      return { providerId, providerProjectId };
    },
    save: ({ providerId, providerProjectId }) =>
      settingsStore.setWorkspaceProjectDefault(providerId, providerProjectId),
    refusal: "Could not save that setting on this system.",
  });

  // The voice is a preference rather than a credential, but it travels the
  // same road: the renderer names a value from a set fixed by this build and
  // hears back the settings as they now stand.
  registerSettingHandler(channels.setVoice, {
    validate(voice: unknown) {
      if (!isRealtimeVoice(voice)) throw new Error("Unknown voice");
      return voice;
    },
    save: (voice) => settingsStore.setVoice(voice),
    apply(result, voice) {
      // The next credential is minted for the new voice; the renderer makes
      // the change heard now by reopening any conversation already up.
      if (!result.reason) realtimeCredentials?.setVoice(voice);
    },
    refusal: "Could not save that voice on this system.",
  });
  // The pace travels the voice's road: a value from the set fixed by this
  // build, stored, and handed to the minter for the next conversation.
  registerSettingHandler(channels.setVoiceSpeed, {
    validate(speed: unknown) {
      if (!isRealtimeVoiceSpeed(speed)) throw new Error("Unknown voice speed");
      return speed;
    },
    save: (speed) => settingsStore.setVoiceSpeed(speed),
    apply(result, speed) {
      // The next credential is minted for the new pace; the renderer
      // carries the change onto a conversation already open itself.
      if (!result.reason) realtimeCredentials?.setSpeed(speed);
    },
    refusal: "Could not save that speed on this system.",
  });
  // A plain preference, validated to a boolean the way every renderer value
  // is validated at this boundary. The reply reports what was actually
  // stored, so the switch redraws from the settings rather than the press.
  registerSettingHandler(channels.setVoiceCaptions, {
    validate(enabled: unknown) {
      if (typeof enabled !== "boolean") throw new Error("Invalid caption request");
      return enabled;
    },
    save: (enabled) => settingsStore.setVoiceCaptions(enabled),
    refusal: "Could not save that setting on this system.",
  });

  // The talk key is the user's to move — a chord another tool already holds,
  // or a hand that does not reach ⌥Space. What arrives is read through the
  // same gate the stored value passes, so only a chord the registrars can
  // actually take is ever stored; omitting one returns the defaults, making
  // reset the absence of a choice rather than a second stored value. The new
  // chord is registered at once — a shortcut that only moved on the next
  // launch would read as a control that does nothing.
  registerSettingHandler(channels.setVoiceHotkey, {
    validate: parsedVoiceHotkey,
    save: (chosen) => settingsStore.setVoiceHotkey(chosen),
    async apply(result, chosen) {
      if (!result.reason) {
        hotkeys.setChosen(HOTKEY_RANK.TALK, chosen);
        // Awaited so the renderer's controls stay at rest until the swap has
        // finished and the helper's own registration line can say the truth.
        await hotkeys.reapply(HOTKEY_RANK.TALK);
      }
    },
    refusal: "Could not save that shortcut on this system.",
  });

  // The ask key is the user's to move on the talk key's exact terms, read
  // through the same gate and registered at once. The one extra rule is the
  // standing one — the two Luke keys must never compete for a chord — so a
  // chord the talk key sits on is refused with words rather than stored and
  // silently outbid.
  registerSettingHandler<string | undefined>(channels.setAskHotkey, {
    async validate(accelerator: unknown) {
      const chosen = parsedVoiceHotkey(accelerator);
      // The talk key's whole candidate list is refused, not just the chord it
      // holds now: its helper may fall back to any of them on a later launch,
      // and an ask key stored on one would race it there.
      if (chosen && hotkeys.reserve(chosen, HOTKEY_RANK.ASK) === HOTKEY_RANK.TALK) {
        return new SettingsRefusal({
          settings: await settingsStore.snapshot(),
          reason: "That chord is reserved for the talk key.",
        });
      }
      return chosen;
    },
    save: (chosen) => settingsStore.setAskHotkey(chosen),
    apply(result, chosen) {
      if (!result.reason) {
        hotkeys.setChosen(HOTKEY_RANK.ASK, chosen);
        void hotkeys.reapply(HOTKEY_RANK.ASK);
      }
    },
    refusal: "Could not save that shortcut on this system.",
  });

  // The stop key is the user's to move on the other two keys' exact terms,
  // read through the same gate and registered at once. It sits at the bottom
  // of the pecking order, so both standing rules point up: a chord the talk
  // key or the ask key sits on — or could fall back to — is refused with
  // words rather than stored and silently outbid.
  registerSettingHandler<string | undefined>(channels.setStopHotkey, {
    async validate(accelerator: unknown) {
      const chosen = parsedVoiceHotkey(accelerator);
      const owner = chosen ? hotkeys.reserve(chosen, HOTKEY_RANK.STOP) : undefined;
      if (owner === HOTKEY_RANK.TALK) {
        return new SettingsRefusal({
          settings: await settingsStore.snapshot(),
          reason: "That chord is reserved for the talk key.",
        });
      }
      if (owner === HOTKEY_RANK.ASK) {
        return new SettingsRefusal({
          settings: await settingsStore.snapshot(),
          reason: "That chord is reserved for the ask key.",
        });
      }
      return chosen;
    },
    save: (chosen) => settingsStore.setStopHotkey(chosen),
    apply(result, chosen) {
      if (!result.reason) {
        hotkeys.setChosen(HOTKEY_RANK.STOP, chosen);
        void hotkeys.reapply(HOTKEY_RANK.STOP);
      }
    },
    refusal: "Could not save that shortcut on this system.",
  });

  // The duck follows the stored answer at once, like the menu bar item: off
  // must let a duck currently held go rather than waiting for the next launch.
  registerSettingHandler(channels.setPreferBuiltInMicrophone, {
    validate(enabled: unknown) {
      if (typeof enabled !== "boolean") throw new Error("Invalid microphone preference request");
      return enabled;
    },
    save: (enabled) => settingsStore.setPreferBuiltInMicrophone(enabled),
    refusal: "Could not save that setting on this system.",
  });

  registerSettingHandler(channels.setDuckOtherMedia, {
    validate(enabled: unknown) {
      if (typeof enabled !== "boolean") throw new Error("Invalid media duck request");
      return enabled;
    },
    save: (enabled) => settingsStore.setDuckOtherMedia(enabled),
    apply: (result) => mediaDuck.setEnabled(result.settings.duckOtherMedia),
    refusal: "Could not save that setting on this system.",
  });

  // Which credential Luke runs on, rebuilt at once rather than at the next
  // launch: the whole point of the choice is that the next thing said runs on
  // what was just chosen. The rebuild is the same one a key being saved or
  // deleted triggers, so the minter, the reviewer, and the usage reader can
  // never be left built for the source that was just switched away from.
  registerSettingHandler(channels.setVoiceSource, {
    validate(source: unknown) {
      if (!isVoiceSource(source)) throw new Error("Invalid voice source request");
      return source;
    },
    save: (source) => settingsStore.setVoiceSource(source),
    apply: () => void applyVoiceCredential(),
    refusal: "Could not save that setting on this system.",
  });

  // One group of preferences returned to its defaults in a single stored
  // write. The renderer names a scope from the set fixed by this build —
  // never a field list — and the store forgets the choices behind it, so
  // what stands afterwards is the default itself rather than a copy of it.
  // No scope reaches a credential or an account. The side effects each row's
  // own save runs are re-run here from the stored answer, so a reset takes
  // effect at once the way every other settings change does.
  registerSettingHandler(channels.resetSettings, {
    validate(scope: unknown) {
      if (!isSettingsResetScope(scope)) throw new Error("Invalid settings reset request");
      return scope;
    },
    save: (scope) => settingsStore.resetSettings(scope),
    async apply(result, scope, event) {
      if (result.reason) return;
      switch (scope) {
        case SETTINGS_RESET_SCOPE.VOICE:
          // The next credential is minted for the default voice and pace; the
          // renderer carries the change onto a conversation already open the
          // same way it does for the rows' own saves.
          realtimeCredentials?.setVoice(result.settings.voice);
          realtimeCredentials?.setSpeed(result.settings.voiceSpeed);
          mediaDuck.setEnabled(result.settings.duckOtherMedia);
          break;
        case SETTINGS_RESET_SCOPE.APPEARANCE:
          applyMenuBarVisibility(result.settings.showInMenuBar);
          dock.apply(result.settings.showInDock, panels.displayIdFor(event.sender));
          panels.setShowOnAllDisplays(result.settings.showOnAllDisplays);
          panels.reconcile();
          panels.setFormFactor(result.settings.formFactor);
          panels.positionAll();
          break;
        case SETTINGS_RESET_SCOPE.SHORTCUTS:
          // All three keys back to their defaults, re-registered in rank
          // order and awaited, so the renderer's controls stay at rest until
          // the keys the rows are about to show have actually answered.
          hotkeys.setChosen(HOTKEY_RANK.TALK, undefined);
          hotkeys.setChosen(HOTKEY_RANK.ASK, undefined);
          hotkeys.setChosen(HOTKEY_RANK.STOP, undefined);
          await hotkeys.reapply(HOTKEY_RANK.TALK);
          await hotkeys.reapply(HOTKEY_RANK.ASK);
          await hotkeys.reapply(HOTKEY_RANK.STOP);
          break;
        case SETTINGS_RESET_SCOPE.WORKSPACES:
          // Nothing to re-run: the workspace defaults only steer the next
          // creation ask, which reads the store when it happens.
          break;
      }
    },
    refusal: "Could not reset those settings on this system.",
  });

  // The sign-in runs whole inside `save`: the browser trip, the loopback
  // redirect, the exchange, and the one calendar-list read that names the
  // account all happen in the main process, and the renderer's reply is the
  // settings snapshot alone. A refusal or a closed browser tab comes back as
  // the reason the row shows.
  registerSettingHandler(channels.connectGoogleCalendar, {
    validate() {
      return undefined;
    },
    async save() {
      const outcome = await googleCalendarSignIn.signIn();
      if ("reason" in outcome) {
        return { settings: await settingsStore.snapshot(), reason: outcome.reason };
      }
      // The account is named by its primary calendar — its address — which is
      // also what starts out selected: the calendar meetings actually land on.
      let primaryId: string | undefined;
      try {
        const calendars = await googleCalendar.listCalendars(outcome.accessToken);
        primaryId = (calendars.find((calendar) => calendar.primary) ?? calendars[0])?.id;
      } catch {
        primaryId = undefined;
      }
      if (!primaryId) {
        return {
          settings: await settingsStore.snapshot(),
          reason: "Google did not answer with the account's calendars.",
        };
      }
      return settingsStore.addCalendarAccount(primaryId, outcome.refreshToken, [primaryId]);
    },
    apply(result) {
      if (!result.reason) void refreshCalendarMeetings();
    },
    refusal: "Could not connect Google Calendar on this system.",
  });

  // Cancelling is a statement, not a request: the loopback stops listening
  // and the pending connect answers with why. The browser tab stays where it
  // is — closing another app's window is not Luke's to do.
  ipcMain.on(channels.cancelGoogleCalendarSignIn, (event) => {
    if (!trustedSender(event)) return;
    googleCalendarSignIn.cancel();
  });

  // A lost consent tab reopened, on the key-page link's terms: the renderer
  // names the intent, and the only page that can open is the one the waiting
  // flow built and is already listening for.
  ipcMain.on(channels.reopenGoogleCalendarSignIn, (event) => {
    if (!trustedSender(event)) return;
    googleCalendarSignIn.reopen();
  });

  registerSettingHandler(channels.removeCalendarAccount, {
    validate(accountId: unknown) {
      if (typeof accountId !== "string" || !accountId) {
        throw new Error("Invalid calendar account request");
      }
      return accountId;
    },
    save: (accountId) => settingsStore.removeCalendarAccount(accountId),
    apply(result) {
      if (!result.reason) void refreshCalendarMeetings();
    },
    refusal: "Could not disconnect that account on this system.",
  });

  registerSettingHandler(channels.setCalendarSelected, {
    async validate(accountId: unknown, calendarId: unknown, selected: unknown) {
      if (typeof accountId !== "string" || !accountId) {
        throw new Error("Invalid calendar selection request");
      }
      if (typeof calendarId !== "string" || !calendarId) {
        throw new Error("Invalid calendar selection request");
      }
      if (typeof selected !== "boolean") throw new Error("Invalid calendar selection request");
      // A calendar being switched on must be one its account's latest
      // observation listed: the selection feeds the free/busy read document,
      // and nothing enters that document but identifiers a pass reported.
      // Switching one off needs no listing — a calendar Google stopped
      // offering must still be deselectable.
      if (selected) {
        const listed = observedCalendars
          .find((account) => account.accountId === accountId)
          ?.calendars.some((calendar) => calendar.id === calendarId);
        if (!listed) {
          return new SettingsRefusal({
            settings: await settingsStore.snapshot(),
            reason: "That calendar is not one Google listed for the account.",
          });
        }
      }
      return { accountId, calendarId, selected };
    },
    save: ({ accountId, calendarId, selected }) =>
      settingsStore.setCalendarSelected(accountId, calendarId, selected),
    apply(result) {
      if (!result.reason) void refreshCalendarMeetings();
    },
    refusal: "Could not save that calendar choice on this system.",
  });

  // Switching the quiet off mid-meeting is the meeting ending, as far as the
  // backlog is concerned: the face wakes and anything held is said now, not
  // on the next release tick — the user just asked to hear it.
  registerSettingHandler(channels.setQuietDuringMeetings, {
    validate(enabled: unknown) {
      if (typeof enabled !== "boolean") throw new Error("Invalid meeting quiet request");
      return enabled;
    },
    save: (enabled) => settingsStore.setQuietDuringMeetings(enabled),
    apply(result) {
      if (result.reason) return;
      void refreshMeetingQuiet();
      void releaseHeldNotices();
    },
    refusal: "Could not save that setting on this system.",
  });

  // The row's button. Answered rather than fire-and-forget so the row that
  // asked and the broadcast never disagree; a run that sends no network
  // answers with the standing snapshot rather than make a request it must not.
  ipcMain.handle(channels.checkForUpdates, (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    if (!runMode.sendsNetwork) return updateService.snapshot();
    return updateService.check();
  });

  // The newest release's page, in the browser. The address is fixed here like
  // the microphone pane's, so nothing an update check read can steer where a
  // press goes.
  ipcMain.on(channels.openLatestRelease, (event) => {
    if (!trustedSender(event)) return;
    void shell.openExternal(UPDATE_ENDPOINT.LATEST_RELEASE_PAGE_URL);
  });

  // A statement of state, not a request: the renderer says whether a spoken
  // exchange is live, and the duck holds every other decision — the setting,
  // the hangover after an exchange, which players are playing at all. Each
  // window states only its own exchange: a bystander window reporting idle —
  // one just raised on a plugged-in display, say — must never end the duck
  // the speaking window opened, so the duck follows the union of them all.
  ipcMain.on(channels.setVoiceExchange, (event, active: unknown) => {
    if (!trustedSender(event) || typeof active !== "boolean") return;
    const displayId = panels.displayIdFor(event.sender);
    if (displayId === undefined) return;
    panels.setVoiceExchange(displayId, active);
  });

  // The system's own answer is the user's to change, and this is where macOS
  // keeps it. The address is fixed here rather than passed in, so a renderer
  // names the intent and never an address.
  ipcMain.on(channels.openMicrophoneSettings, (event) => {
    if (!trustedSender(event)) return;
    void shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    );
  });

  // Where to get a key is a question the panel cannot answer itself, so it
  // hands the question to the browser. The renderer names a provider rather
  // than an address: the pages Luke can open are the ones in the provider
  // registry, and no URL crosses this boundary.
  ipcMain.on(channels.openProviderApiKeys, (event, providerId: unknown) => {
    if (!trustedSender(event) || !isCredentialProviderId(providerId)) return;
    void shell.openExternal(CREDENTIAL_PROVIDERS[providerId].apiKeysUrl);
  });

  // Pressing a session — on its row, or out loud — hands its provider's own
  // address to the system. Luke does not draw the chat, navigate it, or write
  // to it — the provider opens its own window and Luke has already stood
  // down — so this stays inside what a read-only sidecar may do.
  //
  // The renderer names a session rather than an address, so the set of places
  // Luke can send you is the set of sessions currently observed. The address is
  // read back out of the registry, which holds only normalized sessions: an
  // address a provider reported in a scheme outside `SESSION_LINK_SCHEME` never
  // reached one. A fixture run has an empty registry and so opens nothing,
  // which is what a deterministic capture needs. The answer says what became
  // of the press: a row ignores it, but a spoken ask has to say something, and
  // it must be what happened rather than what was hoped.
  ipcMain.handle(
    channels.openSession,
    async (event, identity: unknown): Promise<SessionOpenResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session open request");
      const link = sessionRegistry.get(identity)?.detail.link;
      if (!link) return { status: SESSION_OPEN_RESULT_STATUS.UNSUPPORTED };
      try {
        await shell.openExternal(link);
        return { status: SESSION_OPEN_RESULT_STATUS.OPENED };
      } catch {
        return {
          status: SESSION_OPEN_RESULT_STATUS.REJECTED,
          reason: "The system could not open that session.",
        };
      }
    },
  );

  // Opening a session's pull request is the same act one field over: the
  // renderer names a session it is already drawing, and the address handed to
  // the system is read back out of the registry, where normalization admitted
  // nothing but a bounded https address. Nothing reaches the provider.
  ipcMain.handle(
    channels.openSessionChange,
    async (event, identity: unknown): Promise<SessionOpenResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session open request");
      const change = sessionRegistry.get(identity)?.detail.change;
      if (!change) return { status: SESSION_OPEN_RESULT_STATUS.UNSUPPORTED };
      try {
        await shell.openExternal(change);
        return { status: SESSION_OPEN_RESULT_STATUS.OPENED };
      } catch {
        return {
          status: SESSION_OPEN_RESULT_STATUS.REJECTED,
          reason: "The system could not open that pull request.",
        };
      }
    },
  );

  // Reading a session's transcript is a conversational act that returns
  // session content instead of performing anything: the file its provider
  // wrote is read on this machine, rendered into a bounded conversation, and
  // discarded — nothing reaches a provider, and nothing is kept. The renderer
  // names a session rather than a path, validated here against the registry
  // like every session act, so the set of transcripts Luke can read is the
  // set of sessions currently observed. The readers below are the providers
  // whose local transcripts this build documents reading; everything else —
  // above all a cloud session, whose conversation lives with its provider —
  // answers honestly rather than guessing at files never documented.
  const transcriptReaders: ReadonlyMap<
    ProviderId,
    (providerSessionId: string) => Promise<string | undefined>
  > = new Map([
    [
      PROVIDER_ID.CLAUDE_CODE,
      (providerSessionId: string) =>
        readClaudeSessionTranscript({ claudeHome: defaultClaudeHome(), providerSessionId }),
    ],
    [
      PROVIDER_ID.CODEX,
      (providerSessionId: string) => readCodexSessionTranscript({ providerSessionId }),
    ],
    [
      PROVIDER_ID.CURSOR,
      (providerSessionId: string) => readCursorSessionTranscript({ providerSessionId }),
    ],
    [
      PROVIDER_ID.OPENCODE,
      (providerSessionId: string) => readOpenCodeSessionTranscript({ providerSessionId }),
    ],
  ]);
  ipcMain.handle(
    channels.readSessionTranscript,
    async (event, identity: unknown): Promise<SessionTranscriptResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid transcript request");
      const session = sessionRegistry.get(identity);
      if (!session) {
        return {
          status: SESSION_TRANSCRIPT_RESULT_STATUS.REJECTED,
          reason: "No observed session matches that identity.",
        };
      }
      // Checked here as well as in the reader's own lookup, because one
      // provider observes both halves: a cloud Cursor agent shares its
      // provider id with the sessions on this machine, and only the local
      // half has a file here to read.
      if (session.location !== SESSION_LOCATION.LOCAL) {
        return {
          status: SESSION_TRANSCRIPT_RESULT_STATUS.UNSUPPORTED,
          reason: "A cloud session's conversation lives with its provider, not on this machine.",
        };
      }
      const readTranscript = isProviderId(identity.providerId)
        ? transcriptReaders.get(identity.providerId)
        : undefined;
      if (!readTranscript) {
        return {
          status: SESSION_TRANSCRIPT_RESULT_STATUS.UNSUPPORTED,
          reason: "That session's provider keeps no transcript this build can read.",
        };
      }
      try {
        const transcript = await readTranscript(identity.providerSessionId);
        if (!transcript) {
          return {
            status: SESSION_TRANSCRIPT_RESULT_STATUS.REJECTED,
            reason: "That session's transcript could not be found.",
          };
        }
        return { status: SESSION_TRANSCRIPT_RESULT_STATUS.READ, transcript };
      } catch {
        return {
          status: SESSION_TRANSCRIPT_RESULT_STATUS.REJECTED,
          reason: "That session's transcript could not be read.",
        };
      }
    },
  );

  // A reply typed on a row is handed to the session's own provider, through
  // the adapter that observed it — the one component that knows the documented
  // way in. The renderer names a session it is already drawing, the text is
  // bounded before an adapter sees it, and only a session whose latest
  // observation advertised taking messages gets one. Refusals are answers for
  // the row, never thrown: a send is the user's own act, and what became of it
  // belongs beside the field it left.
  ipcMain.handle(
    channels.sendSessionMessage,
    async (event, identity: unknown, text: unknown): Promise<ProviderMessageResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session message request");
      const message = boundedField(text, sessionMessageText);
      if (!message.ok || message.value === undefined) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: "A message has to be shorter than a document and longer than nothing.",
        };
      }
      // A fixture run has an empty registry, so it refuses every send — a
      // deterministic capture must not reach any provider.
      const session = sessionRegistry.get(identity);
      if (!session?.canReceiveMessage) {
        return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      }
      const adapter = adapterFor(identity.providerId);
      if (!adapter || !isMessageCapableAdapter(adapter)) {
        return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      }
      const result = await adapter.sendMessage({
        providerSessionId: identity.providerSessionId,
        text: message.value,
      });
      // A message that landed changes what the session is doing, so the row
      // should catch up as soon as its provider will say.
      if (result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED) {
        void sessionRegistry.refresh(adapter);
      }
      return result;
    },
  );

  // A control runs the same gauntlet a message does, and one more: the id the
  // renderer names must be a control the session's latest observation actually
  // advertised. The registry is what advertised it, so the registry is what
  // answers whether it stands.
  ipcMain.handle(
    channels.executeSessionControl,
    async (event, identity: unknown, controlId: unknown): Promise<ProviderControlResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity) || typeof controlId !== "string" || !controlId.trim()) {
        throw new Error("Invalid session control request");
      }
      const session = sessionRegistry.get(identity);
      const control = session?.controls.find((candidate) => candidate.id === controlId);
      if (!control) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      const adapter = adapterFor(identity.providerId);
      if (!adapter || !isControllableAdapter(adapter)) {
        return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      }
      const result = await adapter.executeControl({
        providerSessionId: identity.providerSessionId,
        control,
      });
      if (result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED) {
        void sessionRegistry.refresh(adapter);
      }
      return result;
    },
  );

  // A standing ask runs the front half of the message gauntlet — a trusted
  // sender, a bounded text, a session the registry actually observes — and
  // then stops on this machine: it is kept for the attention evaluator to
  // weigh updates against, and no adapter or provider ever sees it. It is
  // refused while no evaluator is configured, because keeping an ask nothing
  // will ever read is a promise Luke cannot keep.
  ipcMain.handle(
    channels.requestSessionNotice,
    (event, identity: unknown, request: unknown): AttentionRequestResult => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session notice request");
      const ask = attentionRequestText(request);
      if (!ask) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "An ask has to be one short request and longer than nothing.",
        };
      }
      const session = sessionRegistry.get(identity);
      if (!session) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "No observed session matches that identity.",
        };
      }
      if (!attentionReviewer) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "No OpenAI key is connected, so nothing would ever read the ask.",
        };
      }
      attentionRequests.set(identity, ask);
      broadcastNoticeAsks();
      // The status rides the acceptance because the ask may already be
      // answered: a session asked about after it finished has no later finish
      // coming, and the reply should say so rather than promise one.
      return { status: ATTENTION_REQUEST_RESULT_STATUS.ACCEPTED, sessionStatus: session.status };
    },
  );

  ipcMain.handle(
    channels.withdrawSessionNotice,
    (event, identity: unknown): AttentionRequestResult => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session notice request");
      const session = sessionRegistry.get(identity);
      if (!session) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "No observed session matches that identity.",
        };
      }
      if (!attentionRequests.withdraw(identity)) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "No ask was standing for that session.",
        };
      }
      broadcastNoticeAsks();
      return { status: ATTENTION_REQUEST_RESULT_STATUS.ACCEPTED, sessionStatus: session.status };
    },
  );

  // A new workspace runs the same gauntlet a message does, against the list
  // that offered it: the renderer names a project rather than a repository, and
  // only a project an adapter reported on its latest pass — read back here from
  // the adapter itself, never from the request — reaches the provider's
  // documented creation endpoint. A fixture run offers no projects at all, so
  // it refuses every ask without touching a network.
  ipcMain.handle(
    channels.createSessionWorkspace,
    async (
      event,
      providerId: unknown,
      providerProjectId: unknown,
      name: unknown,
      task: unknown,
      namedSelection: unknown,
    ): Promise<ProviderWorkspaceResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (
        typeof providerId !== "string" ||
        !providerId.trim() ||
        typeof providerProjectId !== "string" ||
        !providerProjectId.trim() ||
        (name !== undefined && typeof name !== "string") ||
        (task !== undefined && typeof task !== "string")
      ) {
        throw new Error("Invalid workspace creation request");
      }
      // Its own statement so the guard's narrowing survives: past here the
      // named selection is a documented pairing or nothing at all.
      if (namedSelection !== undefined && !isWorkspaceAgentSelection(providerId, namedSelection)) {
        throw new Error("Invalid workspace creation request");
      }
      if (!runMode.sendsNetwork) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      const adapter = adapterFor(providerId);
      if (!adapter || !isWorkspaceCapableAdapter(adapter)) {
        return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      }
      const offered = adapter
        .workspaceProjects()
        .some((project) => project.providerProjectId === providerProjectId);
      if (!offered) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      const workspaceName = boundedField(name, workspaceNameText);
      if (!workspaceName.ok) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: "A workspace name has to be short enough to say and longer than nothing.",
        };
      }
      // The task's own bound, and its fit to the project, are answered by the
      // adapter, which validates both against the projects it actually offers.
      const openingTask = boundedField(task, sessionMessageText);
      if (!openingTask.ok) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: "A task has to be shorter than a document and longer than nothing.",
        };
      }
      // A model the user named for this one creation outranks the stored
      // choice for this act alone; the stored choice stands otherwise. Both
      // are held to the build's documented table — the named one just above,
      // the stored one when it was written — and the adapter holds whichever
      // rides to its own table again before anything reaches the network.
      const stored = isProviderId(providerId)
        ? await settingsStore.readWorkspaceAgentDefault(providerId)
        : undefined;
      const agentSelection = namedSelection ?? stored;
      const result = await adapter.createWorkspace({
        providerProjectId,
        ...(workspaceName.value ? { name: workspaceName.value } : {}),
        ...(openingTask.value ? { task: openingTask.value } : {}),
        ...(agentSelection ? { agentSelection } : {}),
      });
      // A workspace that landed is a session the panel should be showing, so
      // the next look must actually ask rather than serve the cache. A
      // rejection refreshes too: a workspace can stand with its opening task
      // undelivered, and the adapter answers a rejection that never reached
      // the network from its cache anyway.
      if (result.status !== PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED) {
        // A workspace that landed is also one the developer just asked to be
        // taken to, so the session the creation response named — an id the
        // adapter reported, never an address — waits here for observation to
        // report it, and is opened then like a pressed row. Noted before the
        // refresh, so the very pass that first sees the session resolves it.
        if (result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED && result.providerSessionId) {
          createdWorkspaceOpens.expect(
            { providerId: adapter.provider.id, providerSessionId: result.providerSessionId },
            Date.now(),
          );
          // An interval pass can commit the new session while the creation's
          // own follow-up write is still in flight — before the entry above
          // exists — and a registry already holding the session commits
          // nothing further to resolve it. So the current picture is claimed
          // against here, and future commits carry every later arrival.
          openCreatedWorkspaces(sessionRegistry.list());
        }
        void sessionRegistry.refresh(adapter);
      }
      // The first workspace that actually lands chooses the default provider,
      // so a later ask that names none has somewhere unsurprising to go. Only
      // while nothing is chosen: a default the user holds is theirs to change,
      // never a creation's. Deterministic on the validated act — nothing a
      // model composed decides this — and losing the save loses only the
      // remembered default, never the workspace that just landed.
      if (result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED) {
        await rememberWorkspaceDefaults(
          adapter,
          providerProjectId,
          namedSelection as WorkspaceAgentSelection | undefined,
        );
        // The named session was consumed above; the renderer's answer stays
        // what became of the ask, so nothing rides this boundary that the
        // roster will not report on its own.
        return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
      }
      return result;
    },
  );

  // A spoken issue act runs the same gauntlet a session act does, in the same
  // two halves: the renderer refused anything its roster did not advertise,
  // and here every named thing is resolved again from the latest observation —
  // the issue by its identity, the transition by the id the tracker itself
  // listed — so what reaches a tracker client is built from observed state,
  // never from what a model composed.
  ipcMain.handle(
    channels.executeIssueAction,
    async (event, action: unknown): Promise<TrackerActionResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isIssueActionAsk(action)) throw new Error("Invalid issue action request");
      // A fixture run observes no tracker, so it refuses every act — a
      // deterministic capture must not reach Linear.
      const issue = trackedIssues?.find(
        (candidate) =>
          candidate.trackerId === action.identity.trackerId &&
          candidate.identifier === action.identity.identifier,
      );
      if (!issue) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };
      const tracker = issueTrackers.find((candidate) => candidate.tracker.id === issue.trackerId);
      if (!tracker) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };

      let result: TrackerActionResult;
      if (action.kind === "issue-state") {
        const transition = issue.transitions.find(
          (candidate) => candidate.id === action.transition?.id,
        );
        if (!transition) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };
        result = await tracker.execute({
          kind: ISSUE_ACTION_KIND.SET_STATE,
          trackerIssueId: issue.trackerIssueId,
          transition,
        });
      } else {
        if (!issue.canComment) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };
        const body = boundedField(action.body, issueCommentText);
        if (!body.ok || body.value === undefined) {
          return {
            status: TRACKER_ACTION_RESULT_STATUS.REJECTED,
            reason: "A comment has to be shorter than a document and longer than nothing.",
          };
        }
        result = await tracker.execute({
          kind: ISSUE_ACTION_KIND.COMMENT,
          trackerIssueId: issue.trackerIssueId,
          body: body.value,
        });
      }
      // An act that landed changes the board, so the roster should catch up
      // as soon as Linear will say.
      if (result.status === TRACKER_ACTION_RESULT_STATUS.ACCEPTED) {
        void refreshTrackedIssues();
      }
      return result;
    },
  );

  // Another agent in an observed workspace runs the gauntlet a control does,
  // and one more: the agent kind the renderer names must be one the session's
  // latest observation actually listed. The registry is what advertised it, so
  // the registry is what answers whether it stands; the adapter then reads the
  // workspace back from its own last pass.
  ipcMain.handle(
    channels.addWorkspaceAgent,
    async (
      event,
      identity: unknown,
      agent: unknown,
      name: unknown,
      task: unknown,
      namedModel: unknown,
      namedEffort: unknown,
    ): Promise<ProviderWorkspaceResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (
        !isSessionIdentity(identity) ||
        typeof agent !== "string" ||
        !agent.trim() ||
        (name !== undefined && typeof name !== "string") ||
        (task !== undefined && typeof task !== "string") ||
        (namedModel !== undefined && typeof namedModel !== "string") ||
        (namedEffort !== undefined && (typeof namedEffort !== "string" || namedModel === undefined))
      ) {
        throw new Error("Invalid workspace agent request");
      }
      // A fixture run has an empty registry, so it refuses every ask.
      const session = sessionRegistry.get(identity);
      const advertised = session?.spawnableAgents.find((candidate) => candidate === agent.trim());
      if (!advertised) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      // A model named for this one agent must be a documented pairing of
      // exactly the asked-for kind: the user's chosen agent is never
      // re-decided by the model named beside it.
      if (
        namedModel !== undefined &&
        !isWorkspaceAgentSelection(identity.providerId, {
          agent: advertised,
          model: namedModel,
          ...(namedEffort !== undefined ? { effort: namedEffort } : {}),
        })
      ) {
        throw new Error("Invalid workspace agent request");
      }
      const adapter = adapterFor(identity.providerId);
      if (!adapter || !isWorkspaceAgentCapableAdapter(adapter)) {
        return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      }
      const sessionName = boundedField(name, workspaceNameText);
      if (!sessionName.ok) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: "A session name has to be short enough to say and longer than nothing.",
        };
      }
      const openingTask = boundedField(task, sessionMessageText);
      if (!openingTask.ok) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: "A task has to be shorter than a document and longer than nothing.",
        };
      }
      // A model named for this one agent outranks the stored choice for this
      // act alone and never touches it. The stored model and effort otherwise
      // ride along only when the asked-for agent kind is the very kind the
      // stored selection names: the user's ask always wins over their
      // preference, so "add a codex agent" is never quietly re-modelled by a
      // choice made about claude.
      const stored: WorkspaceAgentSelection | undefined = isProviderId(identity.providerId)
        ? await settingsStore.readWorkspaceAgentDefault(identity.providerId)
        : undefined;
      const fallback = stored?.agent === advertised ? stored : undefined;
      const model = namedModel ?? fallback?.model;
      const effort = namedModel !== undefined ? namedEffort : fallback?.effort;
      const result = await adapter.spawnWorkspaceAgent({
        providerSessionId: identity.providerSessionId,
        agent: advertised,
        ...(sessionName.value ? { name: sessionName.value } : {}),
        ...(openingTask.value ? { task: openingTask.value } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      });
      // A new agent is a session the panel should be showing, so the next
      // look must actually ask rather than serve the cache — on a rejection
      // too, for the same reason a partial workspace creation refreshes.
      if (result.status !== PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED) {
        void sessionRegistry.refresh(adapter);
      }
      return result;
    },
  );

  // A note to the founders travels one road: typed in the composer, validated
  // here as a whole, and handed to the courier whose destination is fixed by
  // this build. Only what the user wrote and attached crosses — no session
  // material, no identifiers, nothing observed — and a refusal comes back as an
  // answer for the composer rather than a throw, because sending is the user's
  // own act and its outcome belongs beside the field it left.
  ipcMain.handle(
    channels.sendFeedback,
    async (event, submission: unknown): Promise<FeedbackResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      const parsed = feedbackSubmission(submission);
      if (!parsed) throw new Error("Invalid feedback submission");
      // A fixture run must be reproducible without a network, so it refuses
      // rather than sending — and says so, because the composer still draws.
      if (!runMode.sendsNetwork) {
        return { delivered: false, reason: "A fixture run sends nothing." };
      }
      return feedbackDelivery.deliver(parsed);
    },
  );

  // The panel is normally shown without stealing focus. A text field cannot be
  // typed into that way, so the renderer asks for focus when it opens one —
  // for its own window, which is the one holding the field.
  ipcMain.on(channels.focusPanel, (event) => {
    if (!trustedSender(event)) return;
    const displayId = panels.displayIdFor(event.sender);
    if (displayId === undefined) return;
    panels.focusIfExpanded(displayId);
  });

  ipcMain.handle(channels.requestRealtimeCredential, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    // Returning nothing rather than throwing keeps "no credentials configured"
    // and "the mint failed" on the same explicit, non-fatal path.
    return realtimeCredentials?.mint();
  });

  ipcMain.handle(channels.requestRealtimeDiagnostics, (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return realtimeCredentials?.diagnostics() ?? voiceUnavailableDiagnostics;
  });

  ipcMain.handle(channels.requestHostedUsage, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    // Nothing rather than an error on a keyed or signed-out run: no allowance
    // is in play, and the page words itself without numbers.
    return hostedUsageReader?.read();
  });

  ipcMain.on(channels.quit, (event) => {
    if (trustedSender(event)) app.quit();
  });

  ipcMain.on(channels.rendererReady, async (event) => {
    if (!trustedSender(event) || !captureOutput) return;
    // A capture run holds a single window, and the ready message is its own.
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
    const image = await window.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    const destination = path.resolve(captureOutput);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, image.toPNG());
    process.stdout.write(`Electron evidence: ${destination}\n`);
    app.quit();
  });
}

/**
 * Where a workspace can be created right now, as the adapters offer it: each
 * capable adapter's latest project list, stamped with its provider and bounded
 * once here so the panel and the conversation are handed the same list. A
 * fixture run offers nothing, for the same reason it observes nothing.
 */
function observedWorkspaceProjects(): readonly ObservedWorkspaceProject[] {
  if (!runMode.observesProviders) return [];
  return normalizeObservedWorkspaceProjects(
    sessionAdapters.flatMap((adapter) =>
      isWorkspaceCapableAdapter(adapter)
        ? adapter.workspaceProjects().map((project) => ({
            ...project,
            providerId: adapter.provider.id,
            providerName: adapter.provider.displayName,
          }))
        : [],
    ),
  );
}

/**
 * Converges the local providers' hook registrations: each provider's script,
 * spool, and configuration entries are put in place, and spool files past the
 * observation window are dropped. Run once at every launch — the registration
 * is part of observing at all, like reading the transcripts, rather than a
 * preference — and never in a fixture or capture run: a deterministic run
 * must not touch the developer's real provider configuration. Failure costs
 * only the sharper status: the transcripts and state databases are observed
 * either way, and one provider's failure never reaches the other's — that is
 * the same independence the observation passes keep.
 */
async function applyLocalSessionHooks(): Promise<void> {
  if (fixtureMode) return;
  const registrations = [
    {
      providerName: CLAUDE_CODE_PROVIDER.displayName,
      register: async () => {
        const installation = claudeHookInstallation();
        await installClaudeCodeObservationHooks(installation);
        await pruneClaudeHookSpool(
          installation.spoolDirectory,
          CLAUDE_HOOK_SPOOL_MAXIMUM_AGE_MS,
          Date.now(),
        );
      },
    },
    {
      providerName: CODEX_PROVIDER.displayName,
      register: async () => {
        const installation = codexHookInstallation();
        await installCodexObservationHooks(installation);
        await pruneCodexHookSpool(
          installation.spoolDirectory,
          CODEX_HOOK_SPOOL_MAXIMUM_AGE_MS,
          Date.now(),
        );
      },
    },
  ];
  // Failures are logged under the provider they belong to and absorbed here:
  // one provider's broken configuration must neither reach the other's
  // registration nor the launch, and either costs only the sharper status.
  await Promise.all(
    registrations.map(async ({ providerName, register }) => {
      try {
        await register();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${providerName} hook registration failed: ${message}\n`);
      }
    }),
  );
}

async function refreshProviderSessions(): Promise<void> {
  const generation = observationGeneration;
  if (
    !runMode.observesProviders ||
    !accountCapabilitiesActive() ||
    sessionRefreshGeneration === generation
  ) {
    return;
  }
  sessionRefreshGeneration = generation;
  try {
    // Providers are observed concurrently and reported independently: the
    // registry commits each provider atomically, so one that is slow or failing
    // can neither delay nor cancel the others. A network provider would
    // otherwise hold up the local ones for as long as its requests take.
    await Promise.all(
      sessionAdapters.map(async (adapter) => {
        try {
          await sessionRegistry.refresh(adapter);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`Session observation failed (${adapter.provider.id}): ${message}\n`);
        }
      }),
    );
  } finally {
    if (sessionRefreshGeneration === generation) sessionRefreshGeneration = undefined;
  }
  if (generation !== observationGeneration || !accountCapabilitiesActive()) {
    // stopSessionObservation() already invalidated every old provider attempt
    // through the registry's mutation epochs. Do not clear a newer account's
    // pass when this orphan finishes; only make sure a current pass exists.
    if (accountCapabilitiesActive() && sessionRefreshGeneration === undefined) {
      void refreshProviderSessions();
    }
    return;
  }
  // The registry only spoke if the sessions themselves changed, and a pass can
  // change the project list while leaving them exactly as they were.
  broadcastWorkspaceProjects();
  // Attention review runs outside the observation guard so a slow model call
  // never delays the next provider snapshot.
  void reviewSessionAttention(generation);
}

async function reviewSessionAttention(generation = observationGeneration): Promise<void> {
  if (!attentionReviewer || attentionReviewRunning) return;
  attentionReviewRunning = true;
  try {
    // Only sessions still worth a row are worth a model call: an attention
    // decision about a session with no row surfaces nowhere, and the registry
    // holds every conversation ever observed — reviewing all of it would send
    // an update about each one to OpenAI on every launch, hundreds of requests
    // rate-limiting the same key the voice opens calls with.
    const reviews = await attentionReviewer.review(
      rosterRelevantSessions(sessionRegistry.list(), Date.now()),
    );
    if (generation !== observationGeneration || !accountCapabilitiesActive()) return;
    for (const review of reviews) {
      sessionRegistry.setAttention(review, review.decision);
    }
    // `decision` says the session needs attention, which the panel shows;
    // `outcome` says whether to voice it now, which only these reviews do.
    const speech = attentionSpeechFromReviews(reviews);
    if (speech.length > 0) {
      // An answered standing ask opens Luke's own call the way a status edge
      // does, so the meeting quiet holds it the same way; the summaries that
      // only ride an open conversation pass, because a developer mid-call is
      // already talking to Luke, meeting or not. The pressable notice
      // anchors to the spoken announcement, so it waits out the quiet with it.
      let sendable: readonly AttentionSpeech[] = speech;
      if (await announcementsQuietNow(Date.now())) {
        const held = speech.filter((item) => item.source !== ATTENTION_SPEECH_SOURCE.EVALUATOR);
        heldRequestSpeech.hold(held);
        sendable = speech.filter((item) => item.source === ATTENTION_SPEECH_SOURCE.EVALUATOR);
      }
      if (sendable.length > 0) {
        // Spoken once, by the one window that holds the voice: every display
        // already shows the same session as needing attention, and the surface
        // that speaks is the one that draws the announcement's pressable notice.
        panels.voiceHost()?.webContents.send(channels.attentionSpeech, sendable);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Attention review failed: ${message}\n`);
  } finally {
    attentionReviewRunning = false;
  }
}

/**
 * Speaks each session that just arrived somewhere the user may be waiting on —
 * an answer wanted, an error, a finish. The trigger is a status edge the
 * registry observed, a deterministic fact like the media duck's, so nothing
 * Luke read or decided can reach it. The update's bounded fields travel the
 * same channel the evaluator's readouts do, to the one window that holds the
 * voice, which words the announcement itself; the announcer there opens a
 * speak-only call when no conversation is up, so being heard needs no
 * talk-key press first.
 */
async function announceSessionNotices(sessions: readonly NormalizedSession[]): Promise<void> {
  // Asks about sessions no longer reported have nothing left to be about, and
  // this commit is the earliest that can be known. The rows marking asks are
  // told only when one was actually let go.
  if (attentionRequests.retain(sessions)) broadcastNoticeAsks();
  const now = Date.now();
  // A standing ask never quiets an edge. The ask licenses more speech about
  // its session, not less: an edge the ask did not name — an error under a
  // finish-only ask — would otherwise go unspoken, because the evaluator only
  // answers what was asked. When the evaluator answers the same edge the ask
  // named, the finish is said twice in a row — a cost worth the guarantee
  // that a deterministic alert is never traded away on a model's judgment.
  // Fed before anything is awaited, so passes reach the tracker in order —
  // the retain above included.
  const notices = sessionNoticeTracker.notices(sessions, now);
  if (notices.length === 0) return;
  // No voice, nothing to say it with: without a Realtime credential the
  // renderer cannot open a call, and the panel still shows every state. The
  // pressable notice is the spoken announcement's face, so it goes with the
  // speech rather than standing for news nobody is telling.
  if (!realtimeCredentials) return;
  // A meeting on the connected calendar holds the sentence rather than
  // dropping it; the release tick reads the backlog out once the meeting
  // ends. The panel has shown every state the whole time either way.
  if (await announcementsQuietNow(now)) {
    heldNotices.hold(notices);
    return;
  }
  const speech = notices.map((notice) => sessionNoticeSpeech(notice, now));
  panels.voiceHost()?.webContents.send(channels.attentionSpeech, speech);
}

/**
 * Opens each workspace Luke just created, the moment observation reports it
 * with an address. The entry behind it is the direct product of the
 * developer's own creation ask — the same turn that made the workspace asked
 * to be taken to it — and the address handed to the system is the one the
 * registry holds for that session, read the way a row press reads it: an
 * address in a scheme outside `SESSION_LINK_SCHEME` never reached the
 * registry at all. A created session that never reports an address inside
 * its window is left unopened, like any other row without one.
 */
function openCreatedWorkspaces(sessions: readonly NormalizedSession[]): void {
  for (const created of createdWorkspaceOpens.claim(sessions, Date.now())) {
    const link = created.detail.link;
    if (!link) continue;
    shell.openExternal(link).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Created workspace could not be opened: ${message}\n`);
    });
  }
}

/**
 * Whether announcements should wait right now: a meeting on the connected
 * calendar covers this instant, and the quiet is switched on. The meetings
 * are consulted before the store so the common case — no calendar — costs no
 * read at all; the store's answer comes from its cached file either way,
 * never the keychain.
 */
async function announcementsQuietNow(now: number): Promise<boolean> {
  if (!calendarMeetings || activeMeetingEnd(calendarMeetings, now) === undefined) return false;
  return settingsStore.quietDuringMeetings();
}

/**
 * Recomputes whether the quiet is holding and tells the renderer on change —
 * the face sleeps beside the housing for exactly as long as this is true.
 * Ridden by the same ticks that read the calendar and release the backlog,
 * and by the setting's own toggle, so the face never says a quiet that ended.
 */
async function refreshMeetingQuiet(): Promise<void> {
  const active = await announcementsQuietNow(Date.now());
  if (active === meetingQuietActive) return;
  meetingQuietActive = active;
  panels.broadcast(channels.meetingQuietChanged, active);
}

/**
 * Says what was held once the meeting holding it has ended. Deciding to speak
 * is what happens here, so the sentences carry the release as `decidedAt` —
 * a backlog re-stamped any earlier would be dropped as stale by the renderer
 * before a word of it was read. Each notice is checked against the registry
 * first: a session that moved on while the meeting ran is no longer news, and
 * announcing its old state would be worse than silence.
 */
async function releaseHeldNotices(): Promise<void> {
  if (heldNotices.count === 0 && heldRequestSpeech.count === 0) return;
  const now = Date.now();
  if (await announcementsQuietNow(now)) return;
  // Voice went away while the backlog waited; there is nothing to say it
  // with, and by the time a key returns the news is the panel's.
  if (!realtimeCredentials) {
    heldNotices.release();
    heldRequestSpeech.release();
    return;
  }
  const current = new Map<string, Map<string, string>>();
  for (const session of sessionRegistry.list()) {
    let provider = current.get(session.providerId);
    if (!provider) {
      provider = new Map();
      current.set(session.providerId, provider);
    }
    provider.set(session.providerSessionId, session.status);
  }
  const released = heldNotices.release().filter((notice) => {
    const status = current.get(notice.providerId)?.get(notice.providerSessionId);
    // A session the registry no longer lists settled where the notice said —
    // its parting words are still the answer to where the work stands.
    return status === undefined || status === notice.status;
  });
  // An answered ask was explicit, so it is always still worth its sentence;
  // like the notices it is re-stamped at release, because the decision to
  // speak is what is fresh — held any older it would be dropped unread.
  const releasedAsks = heldRequestSpeech.release().map((item) => ({ ...item, decidedAt: now }));
  const speech = [...releasedAsks, ...released.map((notice) => sessionNoticeSpeech(notice, now))];
  if (speech.length === 0) return;
  panels.voiceHost()?.webContents.send(channels.attentionSpeech, speech);
}

/**
 * Reads the meeting times from every connected account. An account that
 * cannot answer keeps standing what it last showed — the reader holds that,
 * per account, so one revoked grant never blinds the others — and a calendar
 * with no account stays absent, which is what makes the quiet impossible to
 * enter. Every pass ends by asking whether anything held can now be said: a
 * meeting deleted mid-way is over the moment the feed says so.
 */
async function refreshCalendarMeetings(): Promise<void> {
  if (!runMode.observesProviders || !accountCapabilitiesActive()) return;
  if (calendarRefreshRunning) {
    calendarRefreshQueued = true;
    return;
  }
  calendarRefreshRunning = true;
  try {
    const observations = await googleCalendar.observe();
    calendarMeetings = observations?.flatMap((account) => [...account.meetings]);
    observedCalendars = (observations ?? []).map(({ accountId, calendars }) => ({
      accountId,
      calendars,
    }));
    panels.broadcast(channels.calendarsChanged, observedCalendars);
    for (const account of observations ?? []) {
      if (account.failure) {
        process.stderr.write(`Calendar observation failed: ${account.failure}\n`);
      }
    }
  } catch (error) {
    // Nothing routine lands here — the reader answers a failing account with
    // its last observation — so what does is a programming error, reported.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Calendar observation failed: ${message}\n`);
  } finally {
    calendarRefreshRunning = false;
    if (calendarRefreshQueued) {
      calendarRefreshQueued = false;
      void refreshCalendarMeetings();
    }
  }
  void refreshMeetingQuiet();
  void releaseHeldNotices();
}

function startCalendarObservation(): void {
  if (!runMode.observesProviders || !accountCapabilitiesActive() || calendarRefreshTimer) return;
  void refreshCalendarMeetings();
  calendarRefreshTimer = setInterval(() => {
    void refreshCalendarMeetings();
  }, CALENDAR_REFRESH_INTERVAL_MS);
  calendarRefreshTimer.unref();
  heldNoticeReleaseTimer = setInterval(() => {
    // The quiet's edges move with the clock between calendar reads — a
    // meeting starts, a meeting ends — so the face's answer refreshes on the
    // release tick, not only when the feed is re-read.
    void refreshMeetingQuiet();
    void releaseHeldNotices();
  }, HELD_NOTICE_RELEASE_INTERVAL_MS);
  heldNoticeReleaseTimer.unref();
}

/**
 * The sign-out mirror of the start: the timers go, the meetings and the
 * backlog are forgotten, and the face wakes — a quiet cannot outlive the
 * account whose calendars declared it. The stored grants stay: signing back
 * in finds the same accounts connected, exactly like the provider keys.
 */
function stopCalendarObservation(): void {
  if (calendarRefreshTimer) clearInterval(calendarRefreshTimer);
  calendarRefreshTimer = undefined;
  if (heldNoticeReleaseTimer) clearInterval(heldNoticeReleaseTimer);
  heldNoticeReleaseTimer = undefined;
  calendarMeetings = undefined;
  observedCalendars = [];
  // The reader forgets what it held for failing accounts too: a pass after
  // signing back in starts from nothing, not from an era this stop ended.
  googleCalendar.forget();
  heldNotices.release();
  heldRequestSpeech.release();
  panels.broadcast(channels.calendarsChanged, observedCalendars);
  if (meetingQuietActive) {
    meetingQuietActive = false;
    panels.broadcast(channels.meetingQuietChanged, false);
  }
}

/**
 * What the last roster broadcast said, so a pass that changed nothing the
 * renderer can see costs no send. The registry's revision covers every field
 * of every session; the id line covers the one thing revision cannot — a
 * session leaving the roster because only the clock moved.
 */
let lastRosterRevision = -1;
let lastRosterIds = "";

/**
 * Hands every panel the standing asks as they now stand, so the rows marking
 * them never describe an ask already withdrawn or let go. The words are the
 * developer's own; nothing here reaches a provider or leaves the machine.
 */
function broadcastNoticeAsks(): void {
  panels.broadcast(channels.noticeAsksChanged, attentionRequests.list());
}

/**
 * Hands the renderer the sessions still worth a row. The registry keeps every
 * observation — announcements and attention read it whole — but the panel and
 * the voice roster it feeds see only what `isRosterRelevant` keeps: adapters
 * age out and cap nothing, so this one gate is where a session that settled
 * long ago stops being a row.
 */
function broadcastRelevantSessions(): void {
  const snapshot = sessionRegistry.snapshot();
  const roster = rosterRelevantSessions(snapshot.sessions, Date.now());
  const rosterIds = roster
    .map((session) => `${session.providerId} ${session.providerSessionId}`)
    .join("  ");
  if (snapshot.revision === lastRosterRevision && rosterIds === lastRosterIds) return;
  lastRosterRevision = snapshot.revision;
  lastRosterIds = rosterIds;
  panels.broadcast(channels.sessionsChanged, roster);
}

function startSessionObservation(): void {
  if (!runMode.observesProviders || !accountCapabilitiesActive() || unsubscribeSessions) return;
  unsubscribeSessions = sessionRegistry.subscribe((snapshot) => {
    broadcastRelevantSessions();
    // The registry only speaks on an effective change, which is exactly when
    // a status edge can exist to announce. The notices read the unfiltered
    // snapshot: an edge is an edge wherever the session ends up on the roster.
    void announceSessionNotices(snapshot.sessions);
    // A commit is also the earliest a created workspace can have arrived with
    // the address to open it by — whether on the refresh the creation itself
    // fired or on an ordinary pass catching up.
    openCreatedWorkspaces(snapshot.sessions);
    // A commit is the earliest a write-triggered refresh can have changed the
    // offer, so the announcement rides it rather than waiting for the timer.
    broadcastWorkspaceProjects();
  });
  void refreshProviderSessions();
  sessionRefreshTimer = setInterval(() => {
    void refreshProviderSessions();
    // Relevance moves with the clock as well as with observations: a session
    // can cross its retention horizon in a pass where nothing was observed to
    // change, and only this re-check makes that row leave.
    broadcastRelevantSessions();
  }, SESSION_REFRESH_INTERVAL_MS);
  sessionRefreshTimer.unref();
}

function stopSessionObservation(): void {
  if (sessionRefreshTimer) clearInterval(sessionRefreshTimer);
  sessionRefreshTimer = undefined;
  unsubscribeSessions?.();
  unsubscribeSessions = undefined;
  for (const adapter of sessionAdapters) sessionRegistry.replaceProvider(adapter.provider, []);
  panels.broadcast(channels.sessionsChanged, []);
  panels.broadcast(channels.workspaceProjectsChanged, []);
  lastWorkspaceProjects = undefined;
}

/**
 * Reads the issue roster from every connected tracker. A failing pass keeps
 * the roster it has rather than blanking it — a tracker that cannot answer is
 * not a board with nothing on it — and a tracker with no key stays absent,
 * which is how the renderer knows there is nothing to advertise.
 */
async function refreshTrackedIssues(): Promise<void> {
  if (!runMode.observesProviders || !accountCapabilitiesActive()) return;
  if (issueRefreshRunning) {
    issueRefreshQueued = true;
    return;
  }
  const generation = observationGeneration;
  issueRefreshRunning = true;
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
    if (generation === observationGeneration && accountCapabilitiesActive()) {
      trackedIssues = connected ? collected : undefined;
      panels.broadcast(channels.issuesChanged, trackedIssues);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Issue observation failed: ${message}\n`);
  } finally {
    issueRefreshRunning = false;
    if (issueRefreshQueued) {
      issueRefreshQueued = false;
      void refreshTrackedIssues();
    }
  }
}

function startIssueObservation(): void {
  if (!runMode.observesProviders || !accountCapabilitiesActive() || issueRefreshTimer) return;
  void refreshTrackedIssues();
  issueRefreshTimer = setInterval(() => {
    void refreshTrackedIssues();
  }, ISSUE_REFRESH_INTERVAL_MS);
  issueRefreshTimer.unref();
}

function stopIssueObservation(): void {
  if (issueRefreshTimer) clearInterval(issueRefreshTimer);
  issueRefreshTimer = undefined;
  trackedIssues = undefined;
  panels.broadcast(channels.issuesChanged, undefined);
}

function configurePermissions(): void {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, _origin, details) =>
      webContents !== null &&
      panels.owns(webContents) &&
      permission === "media" &&
      details.mediaType === "audio",
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      callback(
        panels.owns(webContents) &&
          permission === "media" &&
          mediaTypes.length > 0 &&
          mediaTypes.every((mediaType: string) => mediaType === "audio"),
      );
    },
  );
}

function trayMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      // The ellipsis is the macOS convention for an item that opens somewhere
      // rather than acting, and the accelerator is shown rather than registered:
      // Command-, belongs to whichever app is frontmost, so Luke claims it only
      // inside its own window, where the renderer handles it.
      //
      // No icon: a menu item takes a NativeImage sized in points, and the
      // system's named gear arrives at its natural size, which draws far too
      // large beside the text. Apple's own menu bar menus label these items
      // rather than picture them, so this follows them.
      label: "Settings…",
      accelerator: "CommandOrControl+,",
      registerAccelerator: false,
      click: () => {
        // The menu bar item lives on whichever display the user opened it
        // from, but the panel it opens is the voice host's: one Settings, on
        // the same window every other app-level ask lands in.
        const host = panels.voiceHost();
        const displayId = host ? panels.displayIdFor(host.webContents) : undefined;
        if (displayId === undefined) return;
        panels.setMode(displayId, "expanded", true);
        host?.webContents.send(channels.lifecycle, "tab:settings");
      },
    },
    { type: "separator" },
    {
      // The same door the bottom of the settings tab offers, for whoever lives
      // in the menu bar instead: the panel comes up on the composer, already
      // set to the kind that was asked for — on the voice host's window, the
      // same one every other app-level ask lands in.
      label: "Send Feedback…",
      click: () => {
        const host = panels.voiceHost();
        const displayId = host ? panels.displayIdFor(host.webContents) : undefined;
        if (displayId === undefined) return;
        panels.setMode(displayId, "expanded", true);
        host?.webContents.send(
          channels.lifecycle,
          FEEDBACK_LIFECYCLE_EVENT[FEEDBACK_KIND.FEEDBACK],
        );
      },
    },
    {
      label: "Submit a Prompt…",
      click: () => {
        const host = panels.voiceHost();
        const displayId = host ? panels.displayIdFor(host.webContents) : undefined;
        if (displayId === undefined) return;
        panels.setMode(displayId, "expanded", true);
        host?.webContents.send(channels.lifecycle, FEEDBACK_LIFECYCLE_EVENT[FEEDBACK_KIND.PROMPT]);
      },
    },
    { type: "separator" },
    { label: "Quit Luke", role: "quit" },
  ]);
}

/**
 * Luke's face, as macOS wants a status item drawn: a template image, which is
 * pure black plus alpha and is recoloured by the system rather than by us, so it
 * follows the menu bar through light, dark, and the inverted highlight a press
 * draws. The `@2x` file beside it is picked up from the same call, which is what
 * keeps the item sharp on a Retina display.
 */
function trayImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(path.join(__dirname, "menubar", "lukeTemplate.png"));
  image.setTemplateImage(true);
  return image;
}

function createTray(): void {
  if (process.platform !== "darwin") return;
  const image = trayImage();
  tray = new Tray(image);
  // A status item that draws nothing is a status item no one can find, and this
  // one is the quickest way to reach Settings or to quit. If the artwork is
  // ever missing from a build, the name it used to carry stands in for it.
  if (image.isEmpty()) tray.setTitle("Luke");
  tray.setToolTip("Luke");
  // Clicking opens the menu and nothing else. The capsule is how the panel is
  // opened; a menu bar item that also toggled it made one of them a surprise.
  tray.setContextMenu(trayMenu());
}

function destroyTray(): void {
  tray?.destroy();
  tray = undefined;
}

/**
 * Draws or removes the status item to match the setting. Hiding it loses no
 * capability — Settings and Quit are both in the panel — which is what makes
 * this the user's choice rather than Luke's.
 */
function applyMenuBarVisibility(show: boolean): void {
  if (show) {
    if (!tray) createTray();
    return;
  }
  destroyTray();
}

function handleDisplayChange(): void {
  setTimeout(() => {
    panels.refreshGeometry();
    // The set of displays may have changed, not just their geometry: a chosen
    // display arriving raises its window, one leaving takes its window down.
    panels.reconcile();
  }, 100);
}

if (!app.requestSingleInstanceLock()) {
  // Luke runs as an accessory app, so a second launch otherwise exits silently
  // and looks like the launcher did nothing.
  process.stderr.write(
    "Luke is already running; the existing panel was refreshed instead of starting a second copy.\n",
  );
  app.quit();
} else {
  // A repeat launch is usually someone checking the notch capsule, so re-assert
  // the panel where it already is. Expanding hides the compact capsule, which is
  // the one thing the relaunch was meant to show. An explicit `--expanded` is a
  // stated intent rather than a side effect, so it is still honoured.
  app.on("second-instance", (_event, argv) => {
    panels.refreshGeometry();
    if (argv.includes("--expanded")) {
      const host = panels.voiceHost();
      const displayId = host ? panels.displayIdFor(host.webContents) : undefined;
      if (displayId !== undefined) panels.setMode(displayId, "expanded", true);
      return;
    }
    panels.reconcile();
    panels.showInactiveAll();
  });
  void app.whenReady().then(async () => {
    if (process.platform === "darwin") app.setActivationPolicy("accessory");
    Menu.setApplicationMenu(null);
    // A stored refresh token is the account gate. No network request stands
    // between an offline launch and Luke's local capabilities.
    account = runMode.requiresAccount
      ? await settingsStore.accountSnapshot()
      : { status: ACCOUNT_STATUS.SIGNED_OUT };
    panels.refreshGeometry();
    registerIpc();
    // Resolving settings touches the filesystem, and the OS keychain only for a
    // provider that already has a stored key to decrypt. Starting it here keeps
    // that work off the renderer's first paint, which blocks on the bootstrap
    // reply.
    void settingsStore.snapshot();
    // The status item waits only for the settings file, never for the keychain
    // behind the stored keys: a locked or slow Keychain must not delay the one
    // fixed point Luke has outside the notch. A file that cannot be read
    // leaves the item shown, the same answer a file that has never said gives.
    void settingsStore.showInMenuBar().then(
      (show) => applyMenuBarVisibility(show),
      () => applyMenuBarVisibility(APP_SETTING_DEFAULTS.showInMenuBar),
    );
    // The Dock wears Luke's own face from the start, and keeps wearing the
    // right one as the desktop changes mode — whether the icon is shown yet
    // is a separate question, answered by the setting below.
    dock.applyIcon();
    dock.watchTheme();
    // The Dock icon reads the same file under the opposite default: it is
    // opt-in, so a file that cannot be read leaves Luke out of the Dock — the
    // accessory app the launch just asserted. Nothing to do until it says so.
    void settingsStore.showInDock().then(
      (show) => {
        if (show) dock.apply(true);
      },
      () => undefined,
    );
    // Armed from the settings file alone, like the status item, and for the
    // same reason. A file that cannot be read leaves the duck on, the same
    // answer a file that has never said gives.
    void settingsStore.duckOtherMedia().then(
      (enabled) => mediaDuck.setEnabled(enabled),
      () => mediaDuck.setEnabled(APP_SETTING_DEFAULTS.duckOtherMedia),
    );
    // Always on, like the announcements: the timed check answers to no
    // setting, only to the run — a fixture or capture run sends no network,
    // so it never asks GitHub anything.
    if (runMode.sendsNetwork) updateService.start();
    // The hook registrations converge at every launch. Each provider's
    // failure is logged under its own name and absorbed inside — a launch
    // must never hang on another app's configuration file — so this catch is
    // only the backstop for the arrangement itself failing.
    void applyLocalSessionHooks().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Local session hook registration failed: ${message}
`);
    });
    // Awaited, so the key and the voice it speaks with are both in hand before
    // the renderer exists to ask for a credential: the first conversation must
    // already have them. It is also what decides whether the talk key below is
    // claimed at all.
    await applyVoiceCredential();
    // Awaited so the panels are created on the chosen displays in their
    // chosen form, rather than appearing on the main display and jumping. A
    // file that cannot be read means no choice was kept — the main display,
    // the default form — and must not keep the panels from starting.
    panels.setShowOnAllDisplays(
      await settingsStore
        .readShowOnAllDisplays()
        .catch(() => APP_SETTING_DEFAULTS.showOnAllDisplays),
    );
    panels.setFormFactor(
      (await settingsStore.readFormFactor().catch(() => undefined)) ?? DEFAULT_PANEL_FORM_FACTOR,
    );
    // Awaited for the same reason the voice is: the chosen chord has to be in
    // hand before the key is registered, or the first registration would take
    // the default away from the user who moved off it. A file that cannot be
    // read means no choice was kept, and the defaults answer.
    hotkeys.setChosen(
      HOTKEY_RANK.TALK,
      await settingsStore.readVoiceHotkey().catch(() => undefined),
    );
    hotkeys.setChosen(HOTKEY_RANK.ASK, await settingsStore.readAskHotkey().catch(() => undefined));
    hotkeys.setChosen(
      HOTKEY_RANK.STOP,
      await settingsStore.readStopHotkey().catch(() => undefined),
    );
    // The report is not made here: the helper answers over its own stdout a
    // moment later, and a line printed now would state an absence that only
    // exists because nobody has answered yet.
    await hotkeys.reapply(HOTKEY_RANK.TALK);
    // Read-only, like everything else that watches: what it learns decides
    // what the renderer draws while Luke speaks unheard, and nothing more.
    startOutputVolumeWatch();
    startMicrophoneRouteWatch();
    panels.reconcile();
    configurePermissions();
    startSessionObservation();
    startIssueObservation();
    startCalendarObservation();
    // Reconcile in the background. Only an explicit invalid_grant removes the
    // stored account; network failures and service outages leave it active.
    void refreshStoredAccountOnce();

    screen.on("display-added", handleDisplayChange);
    screen.on("display-removed", handleDisplayChange);
    screen.on("display-metrics-changed", handleDisplayChange);
    for (const eventName of ["resume", "unlock-screen", "user-did-become-active"] as const) {
      const handlePowerEvent = () => {
        handleDisplayChange();
        panels.broadcast(channels.lifecycle, eventName);
      };
      if (eventName === "resume") powerMonitor.on("resume", handlePowerEvent);
      if (eventName === "unlock-screen") {
        powerMonitor.on("unlock-screen", handlePowerEvent);
      }
      if (eventName === "user-did-become-active") {
        powerMonitor.on("user-did-become-active", handlePowerEvent);
      }
    }
  });
}

app.on("will-quit", () => {
  // The helper is a process of Luke's own, so it does not outlive the app that
  // spawned it and leave a key registered against nothing. Nothing succeeds it
  // during quit, so its exit is not waited on.
  hotkeys.release();
  // The same rule: a process of Luke's own does not outlive the app.
  outputVolumeWatcher?.stop();
  outputVolumeWatcher = undefined;
  microphoneRouteWatcher?.stop();
  microphoneRouteWatcher = undefined;
  // The duck helper outlives this by one fade: closing its stdin is what asks
  // it to bring the players back up, so quitting mid-sentence costs the user
  // nothing.
  mediaDuck.stop();
});

app.on("before-quit", () => {
  if (sessionRefreshTimer) clearInterval(sessionRefreshTimer);
  if (issueRefreshTimer) clearInterval(issueRefreshTimer);
  panels.clearCollapseTimers();
});

app.on("window-all-closed", () => app.quit());
