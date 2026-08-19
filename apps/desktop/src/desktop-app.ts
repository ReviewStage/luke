import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ATTENTION_SPEECH_SOURCE,
  AttentionRequestRegistry,
  type AttentionSpeech,
  activeMeetingEnd,
  attentionSpeechFromReviews,
  CreatedWorkspaceOpenTracker,
  DEFAULT_PANEL_FORM_FACTOR,
  fixtureSnapshot,
  InMemorySessionRegistry,
  isProviderId,
  type MeetingInterval,
  type NormalizedSession,
  nextMeetingBoundary,
  normalizeObservedWorkspaceProjects,
  normalizeTrackedIssue,
  type ObservedWorkspaceProject,
  PROVIDER_ID_LIST,
  rosterRelevantSessions,
  SessionNoticeHold,
  SessionNoticeTracker,
  type SessionProviderAdapter,
  type TrackedIssue,
  type UnparsedWireValue,
  type WorkspaceAgentSelection,
  workspaceProjectSelectionId,
} from "@sidecar/core";

import {
  app,
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
} from "electron";
import { AccountClient } from "./account-client";
import { accountGateOpen } from "./account-gate";
import { AccountSessionManager } from "./account-session-manager";
import { buildCarriesDeveloperIdSigning, resolveAppName } from "./app-identity";
import { CodexCloudSessionAdapter } from "./codex-cloud-adapter";
import { DockPresence } from "./dock-presence";
import { feedbackDeliveryFromEnvironment } from "./feedback-delivery";
import { GoogleCalendarReader } from "./google-calendar";
import { GoogleCalendarSignIn } from "./google-calendar-oauth";
import { HOTKEY_RANK, HotkeyRegistrar } from "./hotkey-registrar";
import { registerAccountSessionIpc } from "./ipc/account-session";
import { registerCalendarConnectionIpc } from "./ipc/calendar-connection";
import { registerSessionActsIpc } from "./ipc/session-acts";
import { registerSettingsRowsIpc } from "./ipc/settings-rows";
import { registerTrackerConnectionIpc } from "./ipc/tracker-connection";
import { registerVoiceRuntimeIpc } from "./ipc/voice-runtime";
import { registerWindowSurfaceIpc } from "./ipc/window-surface";
import { LinearCredentials } from "./linear-credentials";
import { LinearSignIn } from "./linear-oauth";
import { LinearIssueTracker } from "./linear-tracker";
import { MediaDuckController } from "./media-duck";
import { MicrophoneRouteWatcher } from "./microphone-route";
import { ObservationHookRegistry } from "./observation-hook-registry";
import { ObservationLoop, ObservationSupervisor } from "./observation-loop";
import { OutputVolumeWatcher } from "./output-volume";
import { PanelManager } from "./panel-manager";
import { type ProviderRegistration, providerRegistrations } from "./provider-registrations";
import { runModeFor } from "./run-mode";
import { sessionNoticeSpeech } from "./session-notifications";
import { createSettingsHandler } from "./settings-handler";
import { SettingsStore } from "./settings-store";
import {
  ACCOUNT_STATUS,
  type AccountSnapshot,
  APP_SETTING_DEFAULTS,
  type AppBootstrap,
  channels,
  type MicrophoneRoute,
  type MicrophoneStatus,
  type ObservedAccountCalendars,
  type OutputAudioState,
  SUPERSET_SIGN_IN_STAGE,
  SUPERSET_WORKSPACE_PROVIDER_ID,
} from "./shared/contracts";
import { CREDENTIAL_PROVIDER_ID, type CredentialProviderId } from "./shared/credential-providers";
import { type FeedbackResult, feedbackSubmission } from "./shared/feedback";
import { APP_SETTING_SCHEMA } from "./shared/settings-schema";
import { SupersetCli, SupersetWorkspaceAdapter } from "./superset-cli";
import { SupersetSignIn } from "./superset-sign-in";
import { SupersetWorkspaceReader, SupersetWorkspaceSnapshot } from "./superset-workspaces";
import { UPDATE_ENDPOINT, UpdateService } from "./update-service";
import { VoiceCapabilityAssembler } from "./voice-capability-assembler";

// Which Luke this process is decides where its state lives and which Keychain
// entry protects its credentials; see app-identity.ts for why a development
// run must never share the release's. Applied before anything derives a path:
// the single-instance lock, the settings store, and the hook spools all live
// under this name.
const appName = resolveAppName({
  packaged: app.isPackaged,
  developerIdSigned: buildCarriesDeveloperIdSigning(),
});
app.setName(appName);
// `setName` renames the app, not the paths Electron already derived from the
// manifest name, so the state directory is pointed at the chosen name by
// hand — and session data alongside it, since its default only follows a
// `userData` that has not been resolved yet.
app.setPath("userData", path.join(app.getPath("appData"), appName));
app.setPath("sessionData", path.join(app.getPath("appData"), appName));

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
// Declared before the settings store because the store's snapshot asks it
// what the latest pass learned about the Codex CLI's login. It observes only
// inside the codex composite the provider registrations build; a fixture or
// evidence run never refreshes it, so there its answer stays the honest
// "unknown".
const codexCloudAdapter = new CodexCloudSessionAdapter();
const supersetHomeDirectory =
  process.env.SUPERSET_HOME_DIR ?? path.join(app.getPath("home"), ".superset");
const supersetWorkspaces = new SupersetWorkspaceReader({
  homeDirectory: supersetHomeDirectory,
});
const supersetCli = new SupersetCli({ homeDirectory: supersetHomeDirectory });
const supersetWorkspaceAdapter = new SupersetWorkspaceAdapter(supersetCli);
let observedSupersetWorkspaces = new SupersetWorkspaceSnapshot([]);
let observedSupersetActionsEnabled = false;
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
  codexCloudConnection: () => codexCloudAdapter.connection(),
});
const accountClient = new AccountClient({ baseUrl: ACCOUNT_BASE_URL, clientId: ACCOUNT_CLIENT_ID });
let account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
const accountSession = new AccountSessionManager({
  client: accountClient,
  store: settingsStore,
  hostedServiceBaseUrl: HOSTED_SERVICE_BASE_URL,
  requiresAccount: runMode.requiresAccount,
  openExternal: (url) => shell.openExternal(url),
  startCapabilities: () => startAccountCapabilities(),
  stopCapabilities: stopAccountCapabilities,
  onChange: (next) => {
    account = next;
    broadcastAccount();
    void broadcastVoiceAvailability();
  },
});
const observationHooks = new ObservationHookRegistry(() => app.getPath("userData"));
// Every provider this build observes, with the credential it reads and the
// observation hook it registers, described in one place rather than assembled
// from three parallel lists here.
const providerRegistry = providerRegistrations({
  readApiKey: (providerId) => settingsStore.readApiKey(providerId),
  claudeHookInstallation: () => observationHooks.claudeInstallation(),
  codexHookInstallation: () => observationHooks.codexInstallation(),
  codexCloudAdapter,
});
// The record enforces completeness; the shared list preserves provider order.
const orderedRegistrations: readonly ProviderRegistration[] = PROVIDER_ID_LIST.map(
  (providerId) => providerRegistry[providerId],
);
// The issue tracker is not a session provider: its issues feed the voice
// roster rather than the registry, so it stands beside the adapters rather
// than among them.
// What authorizes a read is minted rather than stored ready to send: Linear's
// access tokens last a day, so the grant behind the row is renewed here, and
// only Linear refusing that renewal disconnects anything.
const linearCredentials = new LinearCredentials({
  readGrant: () => settingsStore.readGrant(CREDENTIAL_PROVIDER_ID.LINEAR),
  writeGrant: async (grant) => {
    await settingsStore.setGrant(CREDENTIAL_PROVIDER_ID.LINEAR, grant);
  },
  forgetGrant: async () => {
    const cleared = await settingsStore.clearGrant(CREDENTIAL_PROVIDER_ID.LINEAR);
    // Nobody pressed anything to end this connection — Linear refused the
    // renewal — so no settings reply is on its way to say so. A row left
    // saying connected would be a row about a grant that no longer exists.
    panels.broadcast(channels.settingsChanged, cleared.settings);
  },
});
const linearTracker = new LinearIssueTracker({
  readAccessToken: () => linearCredentials.accessToken(),
});
// The sign-in behind the Linear row: it opens Linear's own consent page in the
// user's browser and hands back one grant, which the connect handler stores.
// Offered only when this build carries an OAuth client.
const linearSignIn = new LinearSignIn({
  openExternal: (url) => void shell.openExternal(url),
});
const issueTrackers = [linearTracker] as const;
/** A board changes at the pace of hands, not of models; a minute is current. */
const ISSUE_REFRESH_INTERVAL_MS = 60_000;
/** The latest roster, which is also what every spoken act is validated against. */
let trackedIssues: readonly TrackedIssue[] | undefined;
/**
 * Whether a pass was asked for while one was running. A key save or clear
 * must reach the roster on the very next pass, not be swallowed by an
 * interval tick that happened to be in flight — so the guard queues instead
 * of dropping.
 */
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
 * nothing. The boundary timer is what answers on time — this tick is the net
 * behind it, for the clocks a timer cannot promise to keep: a laptop asleep
 * through the boundary, or a system clock moved by hand.
 */
const HELD_NOTICE_RELEASE_INTERVAL_MS = 30_000;
/**
 // SAFETY: The preceding check establishes the asserted contract.
 * The meetings as last read; `undefined` says no calendar is connected, which
 * can never hold a notice. A failed pass keeps the meetings it has — a
 * calendar that cannot answer is not an empty diary.
 */
let calendarMeetings: readonly MeetingInterval[] | undefined;
/**
 * The timer standing at the next meeting edge — the instant the quiet can
 * begin or end. The interval ticks bound how *stale* the quiet's answer can
 * get; this is what makes its edges *punctual*, so a meeting's first second
 * is already held and its last is already released, rather than either
 * waiting on the next half-minute tick.
 */
let quietBoundaryTimer: NodeJS.Timeout | undefined;
/**
 // SAFETY: The preceding check establishes the asserted contract.
 * Each connected account's calendars as last observed — what the settings
 * rows draw their choices from, and what a spoken-of or clicked selection is
 * validated against before the store keeps it.
 */
let observedCalendars: readonly ObservedAccountCalendars[] = [];
let heldNoticeReleaseTimer: NodeJS.Timeout | undefined;
// Notices decided while a meeting is on wait here, in the main process: the
// hold has to outlive any renderer, and this is the one place notices are
// decided. What releases them is the clock against observed intervals —
// deterministic, like the edges that produced them.
const heldNotices = new SessionNoticeHold();
/**
 * The other kind of announcement, held on the same terms: speech an answered
 // SAFETY: The preceding check establishes the asserted contract.
 * standing ask produced, already worded. It waits out a meeting exactly as a
 * status edge does — both break silence, and the quiet holds everything that
 * does. Unbidden evaluator summaries are never held: during the quiet they
 * are dropped outright, because the evaluator supersedes its own decisions
 * and speaks from a fresh review once the meeting ends.
 */
const heldRequestSpeech = new SessionNoticeHold<AttentionSpeech>();
/**
 // SAFETY: The preceding check establishes the asserted contract.
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
const voiceCapabilities = new VoiceCapabilityAssembler({
  settings: settingsStore,
  credentialsUsable: () => runMode.sendsNetwork && accountCapabilitiesActive(),
  accountSignedIn: () => account.status === ACCOUNT_STATUS.SIGNED_IN,
  hostedServiceBaseUrl: HOSTED_SERVICE_BASE_URL,
  refreshAccount: accountSession.refreshOnce,
  currentSession: (identity) => sessionRegistry.get(identity),
  noticeRequestFor: (identity) => attentionRequests.get(identity),
});
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
 // SAFETY: The preceding check establishes the asserted contract.
 * The output's switches as last read, and the helper that reads them. The
 * state lives here rather than in the renderer so bootstrap can carry the
 * answer a push has already delivered; `undefined` is "cannot be read", which
 // SAFETY: The preceding check establishes the asserted contract.
 * the renderer must draw as audible.
 */
let outputAudio: OutputAudioState | undefined;
let outputVolumeWatcher: OutputVolumeWatcher | undefined;
/**
 // SAFETY: The preceding check establishes the asserted contract.
 * Where the developer's voice would be captured from, as last read, and the
 * helper that reads it. The state lives here so the renderer's ask can be
 * answered at once while a fresh probe rides behind it; `undefined` is
 // SAFETY: The preceding check establishes the asserted contract.
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
const supersetSignIn = new SupersetSignIn({
  cli: supersetCli,
  openExternal: (url) => shell.openExternal(url),
  onChange: (state) => {
    panels.broadcast(channels.supersetSignInChanged, state);
    if (state.stage === SUPERSET_SIGN_IN_STAGE.CONNECTED) void sessionObservationLoop.refresh();
  },
});
const hotkeys = new HotkeyRegistrar({
  registersGlobalKeys: runMode.registersGlobalKeys,
  hasCredentials: () => voiceCapabilities.realtimeCredentials !== undefined,
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
 // SAFETY: The preceding check establishes the asserted contract.
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

let unsubscribeSessions: (() => void) | undefined;
/**
 * The projects last announced to the renderer, serialized for comparison.
 * Undefined until the first announcement decides what there is to compare.
 */
let lastWorkspaceProjects: string | undefined;

/**
 * Announces where a workspace can be created whenever the offer changes. This
 * cannot ride the registry's own notifications alone: the registry only speaks
 * when the session snapshot changes, and a pass can change the project list
 // SAFETY: The preceding check establishes the asserted contract.
 * while leaving the sessions exactly as they were — a key just added with no
 * workspaces yet, a project connected but not yet worked in — so the check
 // SAFETY: The preceding check establishes the asserted contract.
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
  // SAFETY: The preceding check establishes the asserted contract.
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

/**
 * What the settings last told the panels about the Codex CLI login. The
 * connection is not a setting anyone writes, so no save ever announces it
 * moving: the observation loop is where it changes — the user ran codex
 * login or logout in their own terminal — and without this the panels keep
 * drawing the words of whatever snapshot they loaded.
 */
let announcedCodexCloudConnection = codexCloudAdapter.connection();

async function broadcastCodexCloudConnection(): Promise<void> {
  const connection = codexCloudAdapter.connection();
  if (connection === announcedCodexCloudConnection) return;
  announcedCodexCloudConnection = connection;
  panels.broadcast(channels.settingsChanged, await settingsStore.snapshot());
}

async function startAccountCapabilities(): Promise<void> {
  if (!accountCapabilitiesActive()) return;
  await applyVoiceCredential();
  await broadcastVoiceAvailability();
  if (!accountCapabilitiesActive()) return;
  await hotkeys.reapply(HOTKEY_RANK.TALK);
  if (!accountCapabilitiesActive()) return;
  startSessionObservation();
  startCalendarObservation();
  observationSupervisor.setEnabled(true);
}

async function stopAccountCapabilities(): Promise<void> {
  observationSupervisor.setEnabled(false);
  stopSessionObservation();
  stopIssueObservation();
  stopCalendarObservation();
  await applyVoiceCredential();
  await hotkeys.reapply(HOTKEY_RANK.TALK);
}

async function applyVoiceCredential(): Promise<void> {
  await voiceCapabilities.apply();
}

function adapterFor(providerId: string) {
  if (providerId === SUPERSET_WORKSPACE_PROVIDER_ID) return supersetWorkspaceAdapter;
  return isProviderId(providerId) ? providerRegistry[providerId].adapter : undefined;
}

function adapterForCredential(providerId: CredentialProviderId) {
  return orderedRegistrations.find((entry) => entry.credential?.id === providerId)?.adapter;
}

/** Whether a provider is currently offering the project a default would name. */
function workspaceProjectOffered(providerId: string, providerProjectId: string): boolean {
  const adapter = adapterFor(providerId);
  if (!adapter) return false;
  return adapter
    .workspaceProjects()
    .some((project) => workspaceProjectSelectionId(project) === providerProjectId);
}

/**
 * A renderer-supplied string that must survive its bound, or be refused.
 * Omitted stays omitted: the field was not offered.
 */
async function rememberWorkspaceDefaults(
  adapter: SessionProviderAdapter,
  providerProjectId: string,
  providerTargetId: string | undefined,
  namedSelection: WorkspaceAgentSelection | undefined,
  agent: string | undefined,
): Promise<void> {
  const providerId = adapter.provider.id;
  if (!isProviderId(providerId) && providerId !== SUPERSET_WORKSPACE_PROVIDER_ID) return;
  try {
    if (
      (await settingsStore.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field)) === undefined
    ) {
      const saved = await settingsStore.set(
        APP_SETTING_SCHEMA.defaultWorkspaceProvider.field,
        providerId,
      );
      panels.broadcast(channels.settingsChanged, saved.settings);
    }
    if (
      providerId === SUPERSET_WORKSPACE_PROVIDER_ID &&
      agent !== undefined &&
      (await settingsStore.get(APP_SETTING_SCHEMA.supersetAgentDefault.field)) === undefined
    ) {
      const saved = await settingsStore.set(APP_SETTING_SCHEMA.supersetAgentDefault.field, agent);
      panels.broadcast(channels.settingsChanged, saved.settings);
    }
    // The project the workspace landed in becomes that provider's default on
    // the same first-choice terms, read again for the same overlap reason as
    // the model below. The id was validated against the adapter's offered
    // projects before the creation ran, so what is remembered is one the
    // provider itself listed.
    if (
      (await settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field))?.[providerId] ===
      undefined
    ) {
      const saved = await settingsStore.setEntry(
        APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
        providerId,
        workspaceProjectSelectionId({
          providerProjectId,
          ...(providerTargetId ? { providerTargetId } : {}),
        }),
      );
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
    const [supersetInstalled, supersetConnected] = await Promise.all([
      supersetCli.installed(),
      supersetCli.connected(),
    ]);
    return {
      mode: displayId !== undefined ? panels.modeFor(displayId) : panels.initialMode,
      startPeeked,
      startInSlot,
      profile,
      fixture,
      captureMode,
      fixtureMode,
      supersetInstalled,
      supersetConnected,
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
      ...(hotkeys.talk ? { voiceHotkey: hotkeys.talk } : undefined),
      voiceHotkeyHeld: hotkeys.held,
      ...(hotkeys.ask ? { askHotkey: hotkeys.ask } : undefined),
      ...(hotkeys.stop ? { stopHotkey: hotkeys.stop } : undefined),
      ...(outputAudio ? { outputAudio } : undefined),
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
        : undefined),
      // The calendar is a capability like the rosters: nothing of it is
      // shown, or held quiet, before the account gate opens.
      calendars: accountCapabilitiesActive() ? observedCalendars : [],
      meetingQuiet: accountCapabilitiesActive() && meetingQuietActive,
      settings: await settingsStore.snapshot(),
    };
  });
  ipcMain.handle(channels.beginSupersetSignIn, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return supersetSignIn.begin();
  });
  ipcMain.handle(channels.submitSupersetSignInCode, (event, code: unknown) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    if (typeof code !== "string") throw new Error("Invalid Superset sign-in code");
    return supersetSignIn.submitCode(code);
  });
  ipcMain.handle(channels.chooseSupersetOrganization, async (event, slug: string) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    if (typeof slug !== "string") throw new Error("Invalid Superset organization");
    return supersetSignIn.chooseOrganization(slug);
  });
  ipcMain.on(channels.reopenSupersetSignIn, (event) => {
    if (trustedSender(event)) supersetSignIn.reopen();
  });
  ipcMain.on(channels.cancelSupersetSignIn, (event) => {
    if (trustedSender(event)) supersetSignIn.cancel();
  });

  registerAccountSessionIpc({ ipcMain, trustedSender, accountSession });

  registerWindowSurfaceIpc({
    ipcMain,
    trustedSender,
    panels,
    requestMicrophone,
    microphoneRoute: () => microphoneRoute,
    microphoneRouteWatcher: () => microphoneRouteWatcher,
  });

  registerSettingsRowsIpc({
    registerSettingHandler,
    settingsStore,
    adapterForCredential,
    refreshAdapter: async (adapter) => {
      await sessionRegistry.refresh(adapter);
    },
    refreshIssues: () => void issueObservationLoop.refresh(),
    applyVoiceCredential,
    hotkeys,
    dock,
    panels,
    realtimeCredentials: () => voiceCapabilities.realtimeCredentials,
    mediaDuck,
    workspaceProjectOffered,
    refreshMeetingQuiet: () => void refreshMeetingQuiet(),
    releaseHeldNotices: () => void releaseHeldNotices(),
  });

  registerCalendarConnectionIpc({
    ipcMain,
    trustedSender,
    registerSetting: registerSettingHandler,
    settingsStore,
    calendar: googleCalendar,
    signIn: googleCalendarSignIn,
    observedCalendars: () => observedCalendars,
    refresh: () => void calendarObservationLoop.refresh(),
  });

  registerTrackerConnectionIpc({
    ipcMain,
    trustedSender,
    registerSetting: registerSettingHandler,
    settingsStore,
    credentials: linearCredentials,
    signIn: linearSignIn,
    refresh: () => void issueObservationLoop.refresh(),
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

  registerVoiceRuntimeIpc({
    ipcMain,
    trustedSender,
    panels,
    openExternal: (url) => shell.openExternal(url),
    realtimeCredentials: () => voiceCapabilities.realtimeCredentials,
    unavailableDiagnostics: () => voiceCapabilities.unavailableDiagnostics,
    hostedUsageReader: () => voiceCapabilities.hostedUsageReader,
  });

  registerSessionActsIpc({
    ipcMain,
    trustedSender,
    sessionRegistry,
    openExternal: (url) => shell.openExternal(url),
    adapterFor,
    attentionReviewer: () => voiceCapabilities.attentionReviewer,
    attentionRequests,
    broadcastNoticeAsks,
    sendsNetwork: runMode.sendsNetwork,
    settingsStore,
    rememberWorkspaceDefaults,
    expectCreatedWorkspace: (identity, now) => createdWorkspaceOpens.expect(identity, now),
    openCreatedWorkspaces: () => openCreatedWorkspaces(sessionRegistry.list()),
    trackedIssues: () => trackedIssues,
    issueTrackers,
    refreshIssues: () => void issueObservationLoop.refresh(),
    supersetContext: (identity) =>
      observedSupersetActionsEnabled
        ? observedSupersetWorkspaces.context(identity.providerId, identity.providerSessionId)
        : undefined,
    supersetCli,
  });

  // A note to the founders travels one road: typed in the composer, validated
  // here as a whole, and handed to the courier whose destination is fixed by
  // this build. Only what the user wrote and attached crosses — no session
  // material, no identifiers, nothing observed — and a refusal comes back as an
  // answer for the composer rather than a throw, because sending is the user's
  // own act and its outcome belongs beside the field it left.
  ipcMain.handle(
    channels.sendFeedback,
    async (event, submission: UnparsedWireValue): Promise<FeedbackResult> => {
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
 // SAFETY: The preceding check establishes the asserted contract.
 * Where a workspace can be created right now, as the adapters offer it: each
 * capable adapter's latest project list, stamped with its provider and bounded
 * once here so the panel and the conversation are handed the same list. A
 * fixture run offers nothing, for the same reason it observes nothing.
 */
function observedWorkspaceProjects(): readonly ObservedWorkspaceProject[] {
  if (!runMode.observesProviders) return [];
  return normalizeObservedWorkspaceProjects(
    [...orderedRegistrations.map(({ adapter }) => adapter), supersetWorkspaceAdapter].flatMap(
      (adapter) =>
        adapter.workspaceProjects().map((project) => ({
          ...project,
          providerId: adapter.provider.id,
          providerName: adapter.provider.displayName,
        })),
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
  // Failures are logged under the provider they belong to and absorbed here:
  // one provider's broken configuration must neither reach the other's
  // registration nor the launch, and either costs only the sharper status.
  await Promise.all(
    orderedRegistrations.map(async ({ adapter, registerObservationHook }) => {
      if (!registerObservationHook) return;
      try {
        await registerObservationHook();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `${adapter.provider.displayName} hook registration failed: ${message}\n`,
        );
      }
    }),
  );
}

async function refreshProviderSessions(generation: number): Promise<void> {
  const actionsWereEnabled = observedSupersetActionsEnabled;
  let supersetSnapshot = new SupersetWorkspaceSnapshot([]);
  let supersetActionsEnabled = false;
  try {
    const supersetAgentDefault = await settingsStore.get(
      APP_SETTING_SCHEMA.supersetAgentDefault.field,
    );
    [supersetSnapshot, supersetActionsEnabled] = await Promise.all([
      supersetWorkspaces.read(),
      supersetCli.connected(),
    ]);
    await supersetWorkspaceAdapter.refresh(supersetAgentDefault, supersetActionsEnabled);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Superset observation failed: ${message}\n`);
  }
  observedSupersetWorkspaces = supersetSnapshot;
  observedSupersetActionsEnabled = supersetActionsEnabled;
  if (actionsWereEnabled !== supersetActionsEnabled) {
    if (supersetActionsEnabled) {
      panels.broadcast(channels.supersetSignInChanged, {
        stage: SUPERSET_SIGN_IN_STAGE.CONNECTED,
      });
    } else {
      // The CLI withdrawing its login is also what makes a later Connect a
      // new attempt. `cancel` returns the machine to idle and broadcasts that
      // same state to every renderer.
      supersetSignIn.cancel();
    }
  }
  // Providers are observed concurrently and reported independently: the
  // registry commits each provider atomically, so one that is slow or failing
  // can neither delay nor cancel the others. A network provider would
  // otherwise hold up the local ones for as long as its requests take.
  await Promise.all(
    orderedRegistrations.map(async ({ adapter }) => {
      try {
        await sessionRegistry.refresh(adapter, (providerId, observations) =>
          supersetSnapshot.enrich(providerId, observations, supersetActionsEnabled),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Session observation failed (${adapter.provider.id}): ${message}\n`);
      }
    }),
  );
  if (!sessionObservationLoop.isCurrent(generation)) return;
  // The registry only spoke if the sessions themselves changed, and a pass can
  // change the project list while leaving them exactly as they were.
  broadcastWorkspaceProjects();
  // Attention review runs outside the observation guard so a slow model call
  // never delays the next provider snapshot.
  void attentionObservationLoop.refresh();
}

async function reviewSessionAttention(generation: number): Promise<void> {
  const attentionReviewer = voiceCapabilities.attentionReviewer;
  if (!attentionReviewer) return;
  try {
    // Only sessions still worth a row are worth a model call: an attention
    // decision about a session with no row surfaces nowhere, and the registry
    // holds every conversation ever observed — reviewing all of it would send
    // an update about each one to OpenAI on every launch, hundreds of requests
    // rate-limiting the same key the voice opens calls with.
    const reviews = await attentionReviewer.review(
      rosterRelevantSessions(sessionRegistry.list(), Date.now()),
    );
    if (!attentionObservationLoop.isCurrent(generation)) return;
    for (const review of reviews) {
      sessionRegistry.setAttention(review, review.decision);
    }
    // `decision` says the session needs attention, which the panel shows;
    // `outcome` says whether to voice it now, which only these reviews do.
    const speech = attentionSpeechFromReviews(reviews);
    if (speech.length > 0) {
      // The quiet holds everything Luke would say unbidden. An answered
      // standing ask waits out the meeting the way a status edge does; an
      // unbidden evaluator summary is dropped rather than held — the
      // evaluator supersedes its own decisions, so after the meeting it
      // speaks from a fresh review, not a backlog. Neither rides even an
      // open conversation: a call lingering idle after a question is not a
      // conversation to interject into, and a reply to a turn the developer
      // opened is not an announcement and passes untouched elsewhere. The
      // pressable notice anchors to the spoken announcement, so it waits out
      // the quiet with it.
      let sendable: readonly AttentionSpeech[] = speech;
      if (await announcementsQuietNow(Date.now())) {
        const held = speech.filter((item) => item.source !== ATTENTION_SPEECH_SOURCE.EVALUATOR);
        heldRequestSpeech.hold(held);
        sendable = [];
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
  if (!voiceCapabilities.realtimeCredentials) return;
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
    shell.openExternal(link).catch((error: Error) => {
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
 *
 * Consulting it is also what keeps every window honest: the answer is
 * reconciled with the broadcast state on the way out, so speech can never be
 * decided against a fresher quiet than the one the face and the renderer's
 * own gate are holding. Without that, an edge landing just after a meeting's
 * end would speak over a face still drawn asleep until the next tick.
 */
async function announcementsQuietNow(now: number): Promise<boolean> {
  const inMeeting =
    calendarMeetings !== undefined && activeMeetingEnd(calendarMeetings, now) !== undefined;
  const holding =
    inMeeting && (await settingsStore.get(APP_SETTING_SCHEMA.quietDuringMeetings.field));
  if (holding !== meetingQuietActive) {
    meetingQuietActive = holding;
    panels.broadcast(channels.meetingQuietChanged, holding);
  }
  return holding;
}

/**
 * Recomputes whether the quiet is holding — the face sleeps beside the
 // SAFETY: The preceding check establishes the asserted contract.
 * housing for exactly as long as it is. The recompute itself broadcasts any
 * change; this name is for the callers with nothing to say and only the face
 * to keep current: the boundary timer, the ticks, and the setting's toggle.
 */
async function refreshMeetingQuiet(): Promise<void> {
  await announcementsQuietNow(Date.now());
}

/**
 * Stands the boundary timer at the next meeting edge, from the intervals
 * already in memory. On fire the quiet is recomputed and the backlog asked
 * after — the same pair every tick runs — and the timer re-arms for the edge
 * after that. Re-armed whole from every calendar pass because the pass may
 * have moved any edge; cleared with the meetings at sign-out. `unref`ed like
 * the ticks, so no meeting tomorrow holds the process open tonight.
 */
function armQuietBoundaryTimer(): void {
  if (quietBoundaryTimer) clearTimeout(quietBoundaryTimer);
  quietBoundaryTimer = undefined;
  if (!calendarMeetings) return;
  const now = Date.now();
  const boundary = nextMeetingBoundary(calendarMeetings, now);
  if (boundary === undefined) return;
  // The extra millisecond puts the firing strictly past the edge, so the
  // recompute reads the side of it the timer was armed for.
  quietBoundaryTimer = setTimeout(
    () => {
      quietBoundaryTimer = undefined;
      void refreshMeetingQuiet();
      void releaseHeldNotices();
      armQuietBoundaryTimer();
    },
    boundary - now + 1,
  );
  quietBoundaryTimer.unref();
}

/**
 * Says what was held once the meeting holding it has ended. Deciding to speak
 // SAFETY: The preceding check establishes the asserted contract.
 * is what happens here, so the sentences carry the release as `decidedAt` —
 // SAFETY: The preceding check establishes the asserted contract.
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
  if (!voiceCapabilities.realtimeCredentials) {
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
async function refreshCalendarMeetings(generation: number): Promise<void> {
  try {
    const observations = await googleCalendar.observe();
    // A pass that outlived its stop is no longer ours to report: the stop
    // cleared the meetings, the calendars, and the quiet, and letting a read
    // that was already in flight land would put the calendar — and a sleeping
    // face — back after a sign-out.
    if (!calendarObservationLoop.isCurrent(generation)) return;
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
  }
  if (!calendarObservationLoop.isCurrent(generation)) return;
  void refreshMeetingQuiet();
  void releaseHeldNotices();
  armQuietBoundaryTimer();
}

const observationGate = () => runMode.observesProviders && accountCapabilitiesActive();
const sessionObservationLoop = new ObservationLoop({
  gate: observationGate,
  intervalMs: SESSION_REFRESH_INTERVAL_MS,
  run: refreshProviderSessions,
  // A pass is also when the Codex CLI login can have changed hands, and no
  // settings save stands behind that to announce it.
  afterRun: () => {
    broadcastRelevantSessions();
    void broadcastCodexCloudConnection();
  },
});
const attentionObservationLoop = new ObservationLoop({
  gate: () => observationGate() && voiceCapabilities.attentionReviewer !== undefined,
  intervalMs: SESSION_REFRESH_INTERVAL_MS,
  run: reviewSessionAttention,
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
  attentionObservationLoop,
  issueObservationLoop,
  calendarObservationLoop,
]);

function startCalendarObservation(): void {
  if (heldNoticeReleaseTimer) return;
  heldNoticeReleaseTimer = setInterval(() => {
    // The boundary timer answers the meeting edges on time; this tick is the
    // net under it, re-asking on a cadence no missed timer can silence.
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
  if (heldNoticeReleaseTimer) clearInterval(heldNoticeReleaseTimer);
  heldNoticeReleaseTimer = undefined;
  if (quietBoundaryTimer) clearTimeout(quietBoundaryTimer);
  quietBoundaryTimer = undefined;
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
 // SAFETY: The preceding check establishes the asserted contract.
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
}

function stopSessionObservation(): void {
  unsubscribeSessions?.();
  unsubscribeSessions = undefined;
  for (const { adapter } of orderedRegistrations) {
    sessionRegistry.replaceProvider(adapter.provider, []);
  }
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
      panels.broadcast(channels.issuesChanged, trackedIssues);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Issue observation failed: ${message}\n`);
  }
}

function stopIssueObservation(): void {
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

function handleDisplayChange(): void {
  setTimeout(() => {
    panels.refreshGeometry();
    // The set of displays may have changed, not just their geometry: a chosen
    // display arriving raises its window, one leaving takes its window down.
    panels.reconcile();
  }, 100);
}

export function startDesktopApp(): void {
  if (!app.requestSingleInstanceLock()) {
    // Luke runs as an accessory app, so a second launch otherwise exits silently
    // and looks like the launcher did nothing.
    process.stderr.write(
      "Luke is already running; the existing panel was refreshed instead of starting a second copy.\n",
    );
    app.quit();
  } else {
    void app.whenReady().then(async () => {
      if (process.platform === "darwin") app.setActivationPolicy("accessory");
      Menu.setApplicationMenu(null);
      // A stored refresh token is the account gate. No network request stands
      // between an offline launch and Luke's local capabilities.
      account = runMode.requiresAccount
        ? await settingsStore.accountSnapshot()
        : { status: ACCOUNT_STATUS.SIGNED_OUT };
      accountSession.initialize(account);
      panels.refreshGeometry();
      registerIpc();
      // Resolving settings touches the filesystem, and the OS keychain only for a
      // provider that already has a stored key to decrypt. Starting it here keeps
      // that work off the renderer's first paint, which blocks on the bootstrap
      // reply.
      void settingsStore.snapshot();
      // The Dock wears Luke's own face from the start, and keeps wearing the
      // right one as the desktop changes mode — whether the icon is shown yet
      // is a separate question, answered by the setting below.
      dock.applyIcon();
      dock.watchTheme();
      // The Dock icon reads the same file under the opposite default: it is
      // opt-in, so a file that cannot be read leaves Luke out of the Dock — the
      // accessory app the launch just asserted. Nothing to do until it says so.
      void settingsStore.get(APP_SETTING_SCHEMA.showInDock.field).then(
        (show) => {
          if (show) dock.apply(true);
        },
        () => undefined,
      );
      // Armed from the settings file alone, like the status item, and for the
      // same reason. A file that cannot be read leaves the duck on, the same
      // answer a file that has never said gives.
      void settingsStore.get(APP_SETTING_SCHEMA.duckOtherMedia.field).then(
        (enabled) => mediaDuck.setEnabled(enabled === true),
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
        process.stderr.write(`Local session hook registration failed: ${message}\n`);
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
        (await settingsStore
          .get(APP_SETTING_SCHEMA.showOnAllDisplays.field)
          .catch(() => APP_SETTING_DEFAULTS.showOnAllDisplays)) === true,
      );
      panels.setFormFactor(
        (await settingsStore.get(APP_SETTING_SCHEMA.formFactor.field).catch(() => undefined)) ??
          DEFAULT_PANEL_FORM_FACTOR,
      );
      // Awaited for the same reason the voice is: the chosen chord has to be in
      // hand before the key is registered, or the first registration would take
      // the default away from the user who moved off it. A file that cannot be
      // read means no choice was kept, and the defaults answer.
      hotkeys.setChosen(
        HOTKEY_RANK.TALK,
        await settingsStore.get(APP_SETTING_SCHEMA.voiceHotkey.field).catch(() => undefined),
      );
      hotkeys.setChosen(
        HOTKEY_RANK.ASK,
        await settingsStore.get(APP_SETTING_SCHEMA.askHotkey.field).catch(() => undefined),
      );
      hotkeys.setChosen(
        HOTKEY_RANK.STOP,
        await settingsStore.get(APP_SETTING_SCHEMA.stopHotkey.field).catch(() => undefined),
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
      startCalendarObservation();
      observationSupervisor.setEnabled(true);
      // Reconcile in the background. Only an explicit invalid_grant removes the
      // stored account; network failures and service outages leave it active.
      void accountSession.refreshOnce();

      // A repeat launch is usually someone checking the notch capsule, so re-assert
      // the panel where it already is. Expanding hides the compact capsule, which is
      // the one thing the relaunch was meant to show. An explicit `--expanded` is a
      // stated intent rather than a side effect, so it is still honoured.
      // Registered only now, once the launch has built what a relaunch re-asserts:
      // the ping can arrive while this instance is still starting, where the screen
      // module cannot be read yet — the crash — and where a reconcile would raise
      // windows before the bootstrap handler exists to answer them. A ping that
      // early is dropped, because startup is about to assert the panel anyway.
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
    supersetSignIn.shutdown();
  });

  app.on("before-quit", () => {
    observationSupervisor.setEnabled(false);
    stopCalendarObservation();
    panels.clearCollapseTimers();
  });

  app.on("window-all-closed", () => app.quit());
}
