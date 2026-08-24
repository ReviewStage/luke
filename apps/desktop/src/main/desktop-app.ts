import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AccountClient, AccountSessionManager, accountGateOpen } from "@sidecar/account";
import {
  PRODUCT_EVENT,
  PRODUCT_SUPERSET_ACT,
  PRODUCT_UPDATE_ACT,
  ProductEventSender,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@sidecar/analytics";
import { AttentionRequestRegistry } from "@sidecar/attention";
import {
  activeMeetingEnd,
  GoogleCalendarReader,
  GoogleCalendarSignIn,
  type MeetingInterval,
  nextMeetingBoundary,
} from "@sidecar/calendar";
import { CREDENTIAL_PROVIDER_ID, type CredentialProviderId } from "@sidecar/credentials";
import { type FeedbackSubmission, feedbackDeliveryFromEnvironment } from "@sidecar/feedback";
import { fixtureSnapshot } from "@sidecar/fixtures";
import { normalizeTrackedIssue, type TrackedIssue } from "@sidecar/issues";
import {
  CmuxSessionApplicationReader,
  CodexCloudSessionAdapter,
  ConductorLocalWorkspaceAdapter,
  ConductorSessionApplicationReader,
  defaultOrcaDataDirectory,
  ObservationHookRegistry,
  OrcaWorkspaceReader,
  type ProviderRegistration,
  providerRegistrations,
  type WorkspaceHostEnrichment,
  type WorkspaceHostRegistration,
  workspaceHostRegistrations,
} from "@sidecar/providers";
import {
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  attentionSpeechFromReviews,
} from "@sidecar/realtime";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  CreatedWorkspaceOpenTracker,
  InMemorySessionRegistry,
  isProviderId,
  isWorkspaceProviderId,
  normalizeObservedWorkspaceProjects,
  ObservationLoop,
  ObservationSupervisor,
  type ObservedWorkspaceProject,
  PROVIDER_ID_LIST,
  rosterRelevantSessions,
  SESSION_NOTICE_STATUS,
  SESSION_STATUS,
  type Session,
  type SessionNotice,
  SessionNoticeHold,
  SessionNoticeTracker,
  type SessionProviderAdapter,
  type SessionRegistrySnapshot,
  staleWorkspaceProjectDefaults,
  type WorkspaceAgentSelection,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import {
  SupersetCli,
  SupersetSignIn,
  SupersetWorkspaceAdapter,
  SupersetWorkspaceReader,
  SupersetWorkspaceSnapshot,
  supersetPressedLink,
} from "@sidecar/superset";
import { DEFAULT_PANEL_FORM_FACTOR } from "@sidecar/surface";
import { LinearCredentials, LinearIssueTracker, LinearSignIn } from "@sidecar/trackers";
import { sessionNoticeSpeech, VoiceCapabilityAssembler } from "@sidecar/voice";
import { ACT_RESULT_STATUS, isRecord, text, type UnparsedWireValue } from "@sidecar/wire";
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
import { APPLE_CALENDAR_ACCESS, APPLE_CALENDAR_ID } from "#shared/apple-calendar";
import { BRIDGE, channels } from "#shared/bridge";
import {
  ACCOUNT_STATUS,
  type AccountSnapshot,
  type AppBootstrap,
  type MicrophoneRoute,
  type MicrophoneStatus,
  type ObservedAccountCalendars,
  type OutputAudioState,
  type SessionReplayBootstrap,
  type SessionRosterPayload,
  SUPERSET_SIGN_IN_STAGE,
  SUPERSET_WORKSPACE_PROVIDER_ID,
} from "#shared/contracts";
import { buildCarriesDeveloperIdSigning, resolveAppName } from "./app-identity";
import { AppleCalendarReader } from "./apple-calendar";
import { registerAccountSessionIpc } from "./ipc/account-session";
import { registerCalendarConnectionIpc } from "./ipc/calendar-connection";
import { registerSessionActsIpc } from "./ipc/session-acts";
import { registerSettingsRowsIpc } from "./ipc/settings-rows";
import { registerTrackerConnectionIpc } from "./ipc/tracker-connection";
import { registerVoiceRuntimeIpc } from "./ipc/voice-runtime";
import { registerWindowSurfaceIpc } from "./ipc/window-surface";
import { MediaDuckController } from "./native/media-duck";
import { MicrophoneRouteWatcher } from "./native/microphone-route";
import { OutputVolumeWatcher } from "./native/output-volume";
import { type BridgeContext, registerBridgeEntry } from "./register-bridge";
import { runModeFor } from "./run-mode";
import { createSettingsHandler } from "./settings-handler";
import { SettingsStore } from "./settings-store";
import { createElectronUpdaterEngine } from "./update-installer";
import { UPDATE_ENDPOINT, UpdateService } from "./update-service";
import { DockPresence } from "./window/dock-presence";
import { HOTKEY_RANK, HotkeyRegistrar } from "./window/hotkey-registrar";
import { PanelManager } from "./window/panel-manager";

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
const conductorSessionApplications = new ConductorSessionApplicationReader();
// The local counterpart of the cloud Conductor adapter's creation path: it
// reads the repositories Conductor holds and creates a workspace in one by
// handing Conductor's own creation deep link to the operating system. It
// observes no sessions of its own, so it joins the workspace-project offer and
// the act router rather than the observation registry.
const conductorLocalWorkspaceAdapter = new ConductorLocalWorkspaceAdapter({
  openExternal: (url) => shell.openExternal(url),
});
const orcaWorkspaces = new OrcaWorkspaceReader({
  dataDirectory: process.env.ORCA_USER_DATA_PATH ?? defaultOrcaDataDirectory(),
});
// cmux's CLI honors the same variable for its own state directory, so a
// developer pointing cmux elsewhere points Luke's observation with it.
const cmuxSessionApplications = new CmuxSessionApplicationReader({
  ...(process.env.CMUX_AGENT_HOOK_STATE_DIR
    ? { stateDirectory: process.env.CMUX_AGENT_HOOK_STATE_DIR }
    : undefined),
});
const supersetHomeDirectory =
  process.env.SUPERSET_HOME_DIR ?? path.join(app.getPath("home"), ".superset");
const supersetWorkspaces = new SupersetWorkspaceReader({
  homeDirectory: supersetHomeDirectory,
});
const supersetCli = new SupersetCli({ homeDirectory: supersetHomeDirectory });
const supersetWorkspaceAdapter = new SupersetWorkspaceAdapter(supersetCli);
let observedSupersetWorkspaces = new SupersetWorkspaceSnapshot([]);
let observedSupersetOrganization: string | undefined;
const supersetWorkspaceHost: WorkspaceHostRegistration = {
  observationFailureLabel: "Superset observation",
  read: readSupersetWorkspaceHost,
  // The read absorbs its own failures into an empty snapshot so the act
  // contexts and the workspace rows move with it; a rejection would be a
  // bug, and it costs only the enrichment rather than the pass.
  emptyEnrichment: (_providerId, observations) => observations,
};
const workspaceHosts = workspaceHostRegistrations({
  superset: supersetWorkspaceHost,
  conductorApplications: conductorSessionApplications,
  orcaWorkspaces,
  cmuxApplications: cmuxSessionApplications,
});
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
    const signedIn = next.status === ACCOUNT_STATUS.SIGNED_IN;
    const wasSignedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
    account = next;
    broadcastAccount();
    void broadcastVoiceAvailability();
    void broadcastSessionReplay();
    // The transition alone: which provider signed in is already on the person
    // from the browser's own sign-in, so nothing about it needs to travel again.
    if (signedIn && !wasSignedIn) productEvents.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  },
});
const observationHooks = new ObservationHookRegistry(() => app.getPath("userData"));
// Every provider this build observes, with the credential it reads and the
// observation hook it registers, described in one place rather than assembled
// from three parallel lists here.
const providerRegistry = providerRegistrations({
  readApiKey: (providerId) => settingsStore.readApiKey(providerId),
  observationHookInstallation: (providerId) => observationHooks.installation(providerId),
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
    panels.broadcast(channels.onSettingsChanged, cleared.settings);
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
// This Mac's own Calendar, read beside the Google accounts through the
// EventKit helper. Not connected means the helper is never run at all.
const appleCalendar = new AppleCalendarReader({
  readConnection: () => settingsStore.readAppleCalendarConnection(),
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
 * Each connected account's calendars as last observed — what the settings
 * rows draw their choices from, and what a spoken-of or clicked selection is
 * validated against before the store keeps it.
 */
let observedCalendars: readonly ObservedAccountCalendars[] = [];
let heldNoticeReleaseTimer: NodeJS.Timeout | undefined;
/**
 * How often the System Settings switch is asked about between passes. Each
 * probe is a fresh helper process on purpose: EventKit answers a running
 * process's authorization from state it read at launch, so only a fresh
 * process can be trusted about where the switch stands now. Ten seconds is
 * the longest consent taken back keeps holding anything.
 */
const APPLE_ACCESS_POLL_INTERVAL_MS = 10_000;
let appleAccessPollTimer: NodeJS.Timeout | undefined;
/** Whether the last access probe failed, so only the edges reach the log. */
let appleAccessProbeFailing = false;
// Notices decided while a meeting is on wait here, in the main process: the
// hold has to outlive any renderer, and this is the one place notices are
// decided. What releases them is the clock against observed intervals —
// deterministic, like the edges that produced them.
const heldNotices = new SessionNoticeHold();
/**
 * The other kind of announcement, held on the same terms: speech an answered
 * standing ask produced, already worded. It waits out a meeting exactly as a
 * status edge does — both break silence, and the quiet holds everything that
 * does. Unbidden evaluator summaries are never held: during the quiet they
 * are dropped outright, because the evaluator supersedes its own decisions
 * and speaks from a fresh review once the meeting ends.
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

// TEMPORARY (launch-test harness, remove before merge): `--trace-announcements`
// writes every stage of the announcement path to stderr and to
// `announce-trace.log` under the app's own data directory, so a launch that
// stays silent can say exactly which stage went dark. The renderer's half of
// the trace arrives through the window manager's console mirror.
// `--test-announcement` implies it, so a harness run is always explained.
const announceTraceArmed =
  process.argv.includes("--trace-announcements") || process.argv.includes("--test-announcement");
function traceAnnounce(line: string): void {
  if (!announceTraceArmed) return;
  const stamped = `${new Date().toISOString()} main: ${line}\n`;
  process.stderr.write(stamped);
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "announce-trace.log"), stamped);
  } catch {
    // The trace must never take the app down with it.
  }
}
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
// Keeps the running build current: a timed check reads the release manifest,
// a newer build downloads at once, and the install lands at the quit the
// user asks for. It lives here rather than in a renderer because the timer
// must survive every window, only this process may run the updater, and what
// it learns reaches them all through the same broadcast settings use.
// Squirrel can only replace a signed, packaged build, and a fixture or
// evidence run must not fetch, so every other run carries no engine and its
// row offers the browser instead. The last-run version lives in its own file
// so the first launch after an install can say what just happened.
const lastRunVersionPath = () => path.join(app.getPath("userData"), "last-run-version.json");
const updateService = new UpdateService({
  currentVersion: app.getVersion(),
  onChange: (update) => panels.broadcast(channels.onUpdateChanged, update),
  engine:
    app.isPackaged && runMode.sendsNetwork && process.platform === "darwin"
      ? createElectronUpdaterEngine()
      : undefined,
  lastRunVersion: {
    read: () => {
      try {
        const stored: UnparsedWireValue = JSON.parse(fs.readFileSync(lastRunVersionPath(), "utf8"));
        return isRecord(stored) ? text(stored.version) : undefined;
      } catch {
        // A missing or unreadable file is the first launch: nothing to confirm.
        return undefined;
      }
    },
    write: (version) => {
      try {
        fs.writeFileSync(lastRunVersionPath(), `${JSON.stringify({ version })}\n`);
      } catch (error) {
        process.stderr.write(
          `Could not persist the last-run version: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    },
  },
});
// Counts how Luke's own features are used. It lives here rather than in a
// renderer because every emit site is already in this process and the timer
// must survive every window; what it may say is fixed by the vocabulary in
// core, and a fixture or evidence run switches it off entirely.
const productEvents = new ProductEventSender({
  serviceBaseUrl: HOSTED_SERVICE_BASE_URL,
  appVersion: app.getVersion(),
  sends: runMode.sendsNetwork,
  readAccessToken: async () => (await settingsStore.readAccount())?.accessToken,
  refreshAccount: accountSession.refreshOnce,
});
// One narrow function rather than the service itself, so an IPC module can
// count an act without being handed anything it could flush, stop, or read.
const recordProductEvent: RecordProductEvent = (name, properties) =>
  productEvents.record(name, properties);
/**
 * What this run can tell the renderer about recording: whether it is the kind
 * of run that may record at all, which build it is, and whom a recording
 * would belong to. The two switches are the renderer's own to read, because it
 * is told when they move; this is re-answered whenever the account moves,
 * which is the other half of the same question.
 *
 * `sendsNetwork` is the same suppression the event sender takes — recording
 * must be off wherever counting is — and an account is required because a
 * recording under no person could neither join the counts nor be erased with
 * them.
 */
async function sessionReplayBootstrap(): Promise<SessionReplayBootstrap> {
  // The in-memory snapshot leads the stored account, and this reads the
  // snapshot first because of it: a sign-out reports its transition before it
  // clears the store, so a bootstrap that asked the store alone would answer
  // with the id of the person who has just left — and `applySessionReplay`
  // would see nothing change and leave the recording running.
  const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
  const accountId = signedIn ? (await settingsStore.readAccount())?.id : undefined;
  return {
    permitted: runMode.sendsNetwork && accountId !== undefined,
    appVersion: app.getVersion(),
    ...(accountId ? { accountId } : undefined),
  };
}

/**
 * Stops recording now, ahead of an act that ends the account it is filed
 * under. Both acts need it and neither can wait for their own transition:
 * a sign-out reports itself before the store clears, and a deletion awaits
 * the hosted erasure first — so a broadcast that arrived afterwards would
 * leave the renderer free to flush recordings under a person who has left,
 * or one whose erasure is already queued, recreating what was just deleted.
 *
 * The generation moves with it, so a read already in flight cannot land
 * behind this and re-arm what it just stopped.
 */
function haltSessionReplay(): void {
  sessionReplayBroadcastGeneration += 1;
  panels.broadcast(channels.onSessionReplayChanged, {
    permitted: false,
    appVersion: app.getVersion(),
  });
}
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
const supersetSignIn = new SupersetSignIn({
  cli: supersetCli,
  openExternal: (url) => shell.openExternal(url),
  onChange: (state) => {
    panels.broadcast(channels.onSupersetSignInChanged, state);
    if (state.stage !== SUPERSET_SIGN_IN_STAGE.CONNECTED) return;
    void sessionObservationLoop.refresh();
    // The edge into connected, which is where a sign-in actually lands: the
    // code submission only reaches `exchanging`, and the CLI answers on its
    // own time. Counted here so a sign-in that failed after the code counts
    // nothing at all.
    recordProductEvent(PRODUCT_EVENT.SUPERSET_ACT, {
      superset_act: PRODUCT_SUPERSET_ACT.SIGN_IN_COMPLETE,
    });
  },
});
const hotkeys = new HotkeyRegistrar({
  registersGlobalKeys: runMode.registersGlobalKeys,
  hasCredentials: () => voiceCapabilities.realtimeCredentials !== undefined,
  recordProductEvent,
  host: {
    voiceHost: () => panels.voiceHost(),
    displayIdFor: (sender) => panels.displayIdFor(sender),
    modeFor: (displayId) => panels.modeFor(displayId),
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
    panels.broadcast(channels.onOutputAudioChanged, state);
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

let unsubscribeSessions: (() => void) | undefined;
/**
 * The projects last announced to the renderer, serialized for comparison.
 * Undefined until the first announcement decides what there is to compare.
 */
let lastWorkspaceProjects: string | undefined;
/** Invalidates an older async broadcast whenever a newer pass or stop wins. */
let workspaceProjectsBroadcastGeneration = 0;

/**
 * Announces where a workspace can be created whenever the offer changes. This
 * cannot ride the registry's own notifications alone: the registry only speaks
 * when the session snapshot changes, and a pass can change the project list
 * while leaving the sessions exactly as they were — a key just added with no
 * workspaces yet, a project connected but not yet worked in — so the check
 * runs on the observation cadence as well as on every commit.
 */
async function broadcastWorkspaceProjects(): Promise<void> {
  const generation = ++workspaceProjectsBroadcastGeneration;
  const offeredProjects = offeredWorkspaceProjects();
  const defaults = await settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field);
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
  panels.broadcast(channels.onWorkspaceProjectsChanged, projects);
}

/**
 * Forgets a stored default project its provider has stopped offering. Every
 * path that reads one matches it against the offered list, so an unmatched
 * default steers nothing while the settings row still shows a choice; the
 * write is what makes the row and the behaviour agree again. A failed write
 * costs only the stale entry, which the next pass tries again.
 */
async function pruneWorkspaceProjectDefaults(
  projects: readonly ObservedWorkspaceProject[],
  defaults: Readonly<Partial<Record<string, string>>> | undefined,
  isCurrent: () => boolean,
): Promise<void> {
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
      panels.broadcast(channels.onSettingsChanged, saved.settings);
    }
  } catch {
    return;
  }
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function microphoneStatus(): MicrophoneStatus {
  if (process.platform !== "darwin") return "granted";
  // SAFETY: MicrophoneStatus mirrors Electron's documented media-access status union.
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
  panels.broadcast(channels.onAccountChanged, account);
}

/**
 * Tells every panel what an account transition just did to the settings.
 * `voiceAvailable` rides the settings snapshot and moves with the account
 * — a sign-in carries the hosted allowance, a sign-out takes it — but the
 * transitions themselves only broadcast `accountChanged`, so without this the
 * renderer keeps drawing the voice state of the account it no longer has.
 */
async function broadcastVoiceAvailability(): Promise<void> {
  panels.broadcast(channels.onSettingsChanged, await settingsStore.snapshot());
}

/**
 * Tells every panel what an account transition just did to recording, for the
 * reason directly above and one more.
 *
 * A recording belongs to an account: it is filed under the id the counted
 * events resolve to, and that is what makes deleting the account erase the
 * recordings with it. So a sign-out must end the recording rather than leave
 * it running under the account the developer just left, and a sign-in must be
 * able to start one without waiting for a relaunch — the bootstrap answer was
 * true only of the account that was signed in when the panel loaded.
 */
let sessionReplayBroadcastGeneration = 0;

async function broadcastSessionReplay(): Promise<void> {
  // Guarded like the workspace projects' broadcast, and for a sharper reason.
  // The account is read asynchronously, and a sign-out reports the transition
  // before it clears the stored account — so an in-flight read can still see
  // the old id, and a late reply would restart recording under the person who
  // just left, after a newer answer had already stopped it.
  const generation = ++sessionReplayBroadcastGeneration;
  const replay = await sessionReplayBootstrap();
  if (generation !== sessionReplayBroadcastGeneration) return;
  panels.broadcast(channels.onSessionReplayChanged, replay);
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
  panels.broadcast(channels.onSettingsChanged, await settingsStore.snapshot());
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
  if (providerId === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID) return conductorLocalWorkspaceAdapter;
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
  if (!isWorkspaceProviderId(providerId)) {
    return;
  }
  try {
    if (
      (await settingsStore.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field)) === undefined
    ) {
      const saved = await settingsStore.set(
        APP_SETTING_SCHEMA.defaultWorkspaceProvider.field,
        providerId,
      );
      panels.broadcast(channels.onSettingsChanged, saved.settings);
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
      panels.broadcast(channels.onSettingsChanged, saved.settings);
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
        workspaceProjectSelectionId(
          providerTargetId ? { providerProjectId, providerTargetId } : { providerProjectId },
        ),
      );
      panels.broadcast(channels.onSettingsChanged, saved.settings);
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
      panels.broadcast(channels.onSettingsChanged, saved.settings);
    }
  } catch {
    // The reply is the creation's; a failed remember has no line in it.
  }
}

function registerIpc(): void {
  const registerHandler = (
    definition: Parameters<typeof registerBridgeEntry>[1],
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- The manifest parses this erased domain result before it crosses Electron.
    handler: (...args: never[]) => unknown,
  ) =>
    registerBridgeEntry(BRIDGE, definition, (_context, ...args) => handler(...args), {
      ipcMain,
      trustedSender,
    });
  const registerContextHandler = (
    definition: Parameters<typeof registerBridgeEntry>[1],
    handler: Parameters<typeof registerBridgeEntry>[2],
  ) => registerBridgeEntry(BRIDGE, definition, handler, { ipcMain, trustedSender });
  const registerSettingHandler = createSettingsHandler({
    ipcMain,
    trustedSender,
    snapshot: () => settingsStore.snapshot(),
    broadcast: (settings, except) => panels.broadcast(channels.onSettingsChanged, settings, except),
  });
  registerContextHandler(
    BRIDGE.getBootstrap,
    async (context: BridgeContext): Promise<AppBootstrap> => {
      // Each window bootstraps as itself: its own display, its own mode. The
      // roster and the settings are the same everywhere.
      const displayId = panels.displayIdFor(context.sender);
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
        sessionRoster:
          runMode.observesProviders && accountCapabilitiesActive()
            ? relevantSessionRoster(sessionRegistry.snapshot(), Date.now())
            : { sessions: [], attention: [] },
        // A live run's roster has settled once it has been broadcast at all —
        // the first pass publishes even an empty reading — so before that, the
        // empty list above means "not looked yet" and the face must not sleep
        // on it. A fixture run never broadcasts and its sessions travel in the
        // fixture itself, so it is settled from the start.
        sessionsSettled: !runMode.observesProviders || lastRosterRevision !== -1,
        // Asks are about observed sessions, so they ride the same gate the
        // roster does: a panel shown no sessions is shown no asks about them.
        noticeAsks:
          runMode.observesProviders && accountCapabilitiesActive() ? attentionRequests.list() : [],
        workspaceProjects: accountCapabilitiesActive()
          ? normalizeObservedWorkspaceProjects(
              offeredWorkspaceProjects(),
              await settingsStore.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
            )
          : [],
        ...(trackedIssues && runMode.observesProviders && accountCapabilitiesActive()
          ? { issues: trackedIssues }
          : undefined),
        // The calendar is a capability like the rosters: nothing of it is
        // shown, or held quiet, before the account gate opens.
        calendars: accountCapabilitiesActive() ? observedCalendars : [],
        meetingQuiet: accountCapabilitiesActive() && meetingQuietActive,
        sessionReplay: await sessionReplayBootstrap(),
        settings: await settingsStore.snapshot(),
      };
    },
  );
  registerHandler(BRIDGE.beginSupersetSignIn, async () => {
    recordProductEvent(PRODUCT_EVENT.SUPERSET_ACT, {
      superset_act: PRODUCT_SUPERSET_ACT.SIGN_IN_START,
    });
    return supersetSignIn.begin();
  });
  registerHandler(BRIDGE.submitSupersetSignInCode, (code: string) => {
    return supersetSignIn.submitCode(code);
  });
  registerHandler(BRIDGE.chooseSupersetOrganization, async (slug: string) => {
    return supersetSignIn.chooseOrganization(slug);
  });
  registerHandler(BRIDGE.reopenSupersetSignIn, supersetSignIn.reopen.bind(supersetSignIn));
  registerHandler(BRIDGE.cancelSupersetSignIn, () => {
    supersetSignIn.cancel();
    recordProductEvent(PRODUCT_EVENT.SUPERSET_ACT, {
      superset_act: PRODUCT_SUPERSET_ACT.SIGN_IN_CANCEL,
    });
  });
  registerHandler(BRIDGE.disconnectSuperset, async () => {
    if (!(await supersetCli.signOut())) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "Superset could not sign out." };
    }
    // The sign-in machine returning to idle is what tells every renderer the
    // login is gone; the refreshed pass retires the rows the login was buying.
    supersetSignIn.cancel();
    void sessionObservationLoop.refresh();
    recordProductEvent(PRODUCT_EVENT.SUPERSET_ACT, {
      superset_act: PRODUCT_SUPERSET_ACT.DISCONNECT,
    });
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  });

  registerAccountSessionIpc({
    ipcMain,
    trustedSender,
    accountSession,
    recordProductEvent,
    flushProductEvents: () => productEvents.flush(),
    haltSessionReplay,
    resumeSessionReplay: () => void broadcastSessionReplay(),
  });

  registerWindowSurfaceIpc({
    ipcMain,
    trustedSender,
    panels,
    requestMicrophone,
    microphoneRoute: () => microphoneRoute,
    microphoneRouteWatcher: () => microphoneRouteWatcher,
    recordProductEvent,
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
    setUsageSharing: (enabled) => productEvents.setSharing(enabled),
    recordProductEvent,
  });

  registerCalendarConnectionIpc({
    ipcMain,
    trustedSender,
    registerSetting: registerSettingHandler,
    settingsStore,
    calendar: googleCalendar,
    signIn: googleCalendarSignIn,
    appleCalendar,
    observedCalendars: () => observedCalendars,
    refresh: () => calendarObservationLoop.refresh(),
    openExternal: (url) => void shell.openExternal(url),
    recordProductEvent,
  });

  registerTrackerConnectionIpc({
    ipcMain,
    trustedSender,
    registerSetting: registerSettingHandler,
    settingsStore,
    credentials: linearCredentials,
    signIn: linearSignIn,
    refresh: () => void issueObservationLoop.refresh(),
    recordProductEvent,
  });

  // The row's button. Answered rather than fire-and-forget so the row that
  // asked and the broadcast never disagree; a run without an engine answers
  // with the standing snapshot rather than make a request it must not.
  registerHandler(BRIDGE.checkForUpdates, () => {
    recordProductEvent(PRODUCT_EVENT.UPDATE_ACT, { update_act: PRODUCT_UPDATE_ACT.CHECK });
    return updateService.check();
  });

  // The restart into a downloaded build. The service ignores the ask unless
  // its own snapshot says one is ready — and ignores a repeat while Squirrel
  // stages the swap — so a stray send installs nothing.
  registerHandler(BRIDGE.installUpdate, () => {
    // Counted before the install is asked for, and flushed with it: the act
    // schedules a restart, and a count queued behind that would be dropped by
    // the quit rather than sent.
    recordProductEvent(PRODUCT_EVENT.UPDATE_ACT, { update_act: PRODUCT_UPDATE_ACT.INSTALL });
    void productEvents.flush();
    updateService.install();
  });

  // The newest release's page, in the browser — the way to a build where
  // installing in place is impossible or has failed. The address is fixed
  // here like the microphone pane's, so nothing an update check read can
  // steer where a press goes.
  registerHandler(BRIDGE.openLatestRelease, () => {
    recordProductEvent(PRODUCT_EVENT.UPDATE_ACT, { update_act: PRODUCT_UPDATE_ACT.RELEASE_OPEN });
    void shell.openExternal(UPDATE_ENDPOINT.LATEST_RELEASE_PAGE_URL);
  });

  // The changelog, in the browser — the Changelog row's press. The address
  // is fixed here on the releases page's terms.
  registerHandler(BRIDGE.openChangelog, () => {
    recordProductEvent(PRODUCT_EVENT.UPDATE_ACT, { update_act: PRODUCT_UPDATE_ACT.CHANGELOG_OPEN });
    void shell.openExternal(UPDATE_ENDPOINT.CHANGELOG_PAGE_URL);
  });

  registerVoiceRuntimeIpc({
    ipcMain,
    trustedSender,
    panels,
    openExternal: (url) => shell.openExternal(url),
    realtimeCredentials: () => voiceCapabilities.realtimeCredentials,
    unavailableDiagnostics: () => voiceCapabilities.unavailableDiagnostics,
    hostedUsageReader: () => voiceCapabilities.hostedUsageReader,
    voiceSource: () => voiceCapabilities.voiceSource,
    recordProductEvent,
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
      observedSupersetWorkspaces.actableContext(
        identity.providerId,
        identity.providerSessionId,
        observedSupersetOrganization,
      ),
    supersetCli,
    recordProductEvent,
  });

  // A note to the founders travels one road: typed in the composer, validated
  // here as a whole, and handed to the courier whose destination is fixed by
  // this build. Only what the user wrote and attached crosses — no session
  // material, no identifiers, nothing observed — and a refusal comes back as an
  // answer for the composer rather than a throw, because sending is the user's
  // own act and its outcome belongs beside the field it left.
  registerHandler(BRIDGE.sendFeedback, async (submission: FeedbackSubmission) => {
    // A fixture run must be reproducible without a network, so it refuses
    // rather than sending — and says so, because the composer still draws.
    if (!runMode.sendsNetwork) {
      return { delivered: false, reason: "A fixture run sends nothing." };
    }
    const result = await feedbackDelivery.deliver(submission);
    // The count is of notes that actually reached the founders, and it says
    // how many images rode along as a rung of the same ladder session counts
    // travel on — never a filename, a caption, or a word of the note.
    if (result.delivered) {
      recordProductEvent(PRODUCT_EVENT.FEEDBACK_SEND, {
        image_count: productSessionCountBucket(submission.images.length),
      });
    }
    return result;
  });

  registerHandler(BRIDGE.quit, app.quit.bind(app));

  registerContextHandler(BRIDGE.notifyReady, async (context: BridgeContext) => {
    if (!captureOutput) return;
    // A capture run holds a single window, and the ready message is its own.
    const window = BrowserWindow.fromWebContents(context.sender);
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
 * capable adapter's latest project list, stamped with its provider. This full
 * list is the source of truth for validating and pruning saved choices; the
 * renderer and conversation receive its separately bounded projection. A
 * fixture run offers nothing, for the same reason it observes nothing.
 */
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

/**
 * The Superset entry of the workspace-host registry carries the whole
 * Superset pass, not only the enrichment: the acts a drawn row still
 * advertises resolve against this module's latest snapshot, and the chatless
 * workspace rows ride the same read, so all of it moves together.
 */
async function readSupersetWorkspaceHost(): Promise<WorkspaceHostEnrichment> {
  let supersetSnapshot = new SupersetWorkspaceSnapshot([]);
  let supersetOrganization: string | undefined;
  let supersetAgentDefault: string | undefined;
  try {
    supersetAgentDefault = (
      await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field)
    )?.[SUPERSET_WORKSPACE_PROVIDER_ID]?.agent;
    [supersetSnapshot, supersetOrganization] = await Promise.all([
      supersetWorkspaces.read(),
      supersetCli.activeOrganization(),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Superset observation failed: ${message}\n`);
  }
  // The fresh snapshot answers acts the drawn rows still advertise from
  // before this pass's enrichment runs, so the directory matches enrichment
  // made carry over, re-anchored to the worktrees just read.
  supersetSnapshot.adoptDirectoryMatches(observedSupersetWorkspaces);
  observedSupersetWorkspaces = supersetSnapshot;
  observedSupersetOrganization = supersetOrganization;
  // Refreshed outside the read's own try so a failed pass hands the adapter
  // the same emptiness the act contexts just took: rows the router would
  // refuse to act on must not keep standing on a snapshot that is gone.
  try {
    await supersetWorkspaceAdapter.refresh(
      supersetAgentDefault,
      supersetOrganization !== undefined,
      supersetSnapshot.workspaceRowObservations(supersetOrganization),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Superset observation failed: ${message}\n`);
  }
  return (providerId, observations) =>
    supersetSnapshot.enrich(providerId, observations, supersetOrganization);
}

async function refreshProviderSessions(generation: number): Promise<void> {
  const actionsWereEnabled = observedSupersetOrganization !== undefined;
  // Re-reads the repositories Conductor holds so the local create offer tracks
  // its index. A failed read empties the offer inside the adapter, so a create
  // is never validated against repositories a later read could no longer see.
  const conductorRepositoriesPromise = conductorLocalWorkspaceAdapter.refresh().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Conductor repository observation failed: ${message}\n`);
  });
  const hostEnrichments = await Promise.all(
    workspaceHosts.map((host) =>
      host.read().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${host.observationFailureLabel} failed: ${message}\n`);
        return host.emptyEnrichment;
      }),
    ),
  );
  await conductorRepositoriesPromise;
  const supersetActionsEnabled = observedSupersetOrganization !== undefined;
  if (actionsWereEnabled !== supersetActionsEnabled) {
    if (supersetActionsEnabled) {
      panels.broadcast(channels.onSupersetSignInChanged, {
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
  await Promise.all([
    ...orderedRegistrations.map(async ({ adapter }) => {
      try {
        // The fold applies the managers in registry order, which is what
        // makes the registry's declared claim order the enrichment
        // precedence: the first registration annotates first, and each later
        // one sees what the earlier ones already claimed.
        await sessionRegistry.refresh(adapter, (providerId, observations) =>
          hostEnrichments.reduce(
            (enriched, enrichment) => enrichment(providerId, enriched),
            observations,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Session observation failed (${adapter.provider.id}): ${message}\n`);
      }
    }),
    // The chatless Superset workspaces, as rows of the workspace provider.
    // No transform rides this refresh: the snapshot decorated them already,
    // so an act path's plain refresh commits exactly this shape.
    (async () => {
      try {
        await sessionRegistry.refresh(supersetWorkspaceAdapter);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `Session observation failed (${supersetWorkspaceAdapter.provider.id}): ${message}\n`,
        );
      }
    })(),
  ]);
  if (!sessionObservationLoop.isCurrent(generation)) return;
  // The registry only spoke if the sessions themselves changed, and a pass can
  // change the project list while leaving them exactly as they were.
  void broadcastWorkspaceProjects();
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
    // A session inside a live realtime voice conversation sends the evaluator
    // nothing while it holds: its updates would only ever decide to speak over
    // the very exchange the developer is already in, and the conversation
    // closing puts the session back under review with the next pass.
    const reviews = await attentionReviewer.review(
      rosterRelevantSessions(sessionRegistry.list(), Date.now()).filter(
        (session) => session.realtimeVoice !== true && session.realtimeVoiceLive !== true,
      ),
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
        traceAnnounce(`evaluator speech sent: ${sendable.length}`);
        panels.voiceHost()?.webContents.send(channels.onAttentionSpeech, sendable);
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
async function announceSessionNotices(sessions: readonly Session[]): Promise<void> {
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
  const notices = sessionNoticeTracker.notices(
    sessions.filter((session) => session.realtimeVoice !== true),
    now,
  );
  if (notices.length === 0) return;
  traceAnnounce(
    `edges: ${notices.map((notice) => `"${notice.title}"=${notice.status}`).join(", ")}`,
  );
  // No voice, nothing to say it with: without a Realtime credential the
  // renderer cannot open a call, and the panel still shows every state. The
  // pressable notice is the spoken announcement's face, so it goes with the
  // speech rather than standing for news nobody is telling.
  if (!voiceCapabilities.realtimeCredentials) {
    traceAnnounce("edges dropped: no realtime credentials");
    return;
  }
  // A meeting on the connected calendar holds the sentence rather than
  // dropping it; the release tick reads the backlog out once the meeting
  // ends. The panel has shown every state the whole time either way.
  if (await announcementsQuietNow(now)) {
    traceAnnounce("edges held: meeting quiet");
    heldNotices.hold(notices);
    return;
  }
  const speech = notices.map((notice) => sessionNoticeSpeech(notice, now));
  countSpokenAnnouncements(notices);
  const host = panels.voiceHost();
  traceAnnounce(`status-edge speech sent: ${speech.length} voiceHost=${host !== undefined}`);
  host?.webContents.send(channels.onAttentionSpeech, speech);
}

/**
 * Counts the announcements about to be spoken. It sits beside the send rather
 * than inside the notice tracker because a notice held through a meeting is
 * spoken later or not at all, and only the two paths that actually hand
 * speech to the voice host know which happened.
 */
function countSpokenAnnouncements(notices: readonly SessionNotice[]): void {
  for (const notice of notices) {
    if (!isProviderId(notice.providerId)) continue;
    productEvents.record(PRODUCT_EVENT.VOICE_ANNOUNCEMENT_SPEAK, {
      provider_id: notice.providerId,
      session_status: notice.status,
    });
  }
}

/**
 * Opens each workspace Luke just created, the moment observation reports it
 * with an address. The entry behind it is the direct product of the
 * developer's own creation ask — the same turn that made the workspace asked
 * to be taken to it — and the address handed to the system is the one the
 * registry holds for that session, read the way a row press reads it: an
 * address in a scheme outside `SESSION_LINK_SCHEME` never reached the
 * registry at all. A created session that never reports an address inside
 * its window is left unopened, like any other row without one. The one thing
 * added to the address is the same per-press focus nonce a row press adds,
 * because Superset's own `workspaces open` follow-through usually has the
 * workspace on screen already before this open fires.
 */
function openCreatedWorkspaces(sessions: readonly Session[]): void {
  for (const created of createdWorkspaceOpens.claim(sessions, Date.now())) {
    const link = created.detail.link;
    if (!link) continue;
    shell.openExternal(supersetPressedLink(link, randomUUID())).catch((error: Error) => {
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
    panels.broadcast(channels.onMeetingQuietChanged, holding);
  }
  return holding;
}

/**
 * Recomputes whether the quiet is holding — the face sleeps beside the
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
  countSpokenAnnouncements(released);
  traceAnnounce(`held speech released: ${speech.length}`);
  panels.voiceHost()?.webContents.send(channels.onAttentionSpeech, speech);
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
    // The two sources answer side by side and neither waits on the other's
    // failure: each already stands its own last-good observation.
    const [observations, appleObservation] = await Promise.all([
      googleCalendar.observe(),
      appleCalendar.observe(),
    ]);
    // A pass that outlived its stop is no longer ours to report: the stop
    // cleared the meetings, the calendars, and the quiet, and letting a read
    // that was already in flight land would put the calendar — and a sleeping
    // face — back after a sign-out.
    if (!calendarObservationLoop.isCurrent(generation)) return;
    const accounts = [...(observations ?? []), ...(appleObservation ? [appleObservation] : [])];
    // Undefined only while nothing is connected at all — one connected source
    // is already a calendar, and a quiet it can declare.
    calendarMeetings =
      observations === undefined && appleObservation === undefined
        ? undefined
        : accounts.flatMap((account) => [...account.meetings]);
    observedCalendars = accounts.map(({ accountId, calendars, failure, revoked }) => ({
      accountId,
      calendars,
      ...(failure ? { failure } : undefined),
      ...(revoked ? { revoked } : undefined),
    }));
    panels.broadcast(channels.onCalendarsChanged, observedCalendars);
    for (const account of accounts) {
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

/**
 * Notices the System Settings switch moving between passes: macOS posts no
 * notification for a consent change, so the poll is the whole mechanism — a
 * status probe that reads nothing but the access word, and a full pass run
 * whenever that word disagrees with the state the panel is drawn from. The
 * comparison is against the latest pass's own answer rather than a private
 * baseline on purpose: a baseline can start wrong and stay wrong silently,
 * where a disagreement with the drawn state is re-found every ten seconds
 * until a pass has reconciled it.
 */
async function pollAppleCalendarAccess(): Promise<void> {
  // Not connected, no probe — the same silence the observation keeps.
  if (!(await settingsStore.readAppleCalendarConnection())) return;
  let access: string | undefined;
  try {
    access = await appleCalendar.status();
  } catch (error) {
    // A probe that failed says nothing about the switch — but must say so
    // once, or a watch that stopped watching is indistinguishable from a
    // switch that never moved.
    if (!appleAccessProbeFailing) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Calendar access probe failed: ${message}\n`);
    }
  }
  appleAccessProbeFailing = access === undefined;
  if (access === undefined) return;
  const drawnRevoked =
    observedCalendars.find((account) => account.accountId === APPLE_CALENDAR_ID)?.revoked === true;
  const probeRevoked = access !== APPLE_CALENDAR_ACCESS.FULL;
  if (probeRevoked !== drawnRevoked) {
    process.stderr.write(`Calendar access now reads ${access}; running a pass.\n`);
    void calendarObservationLoop.refresh();
  }
}

function startCalendarObservation(): void {
  if (heldNoticeReleaseTimer) return;
  heldNoticeReleaseTimer = setInterval(() => {
    // The boundary timer answers the meeting edges on time; this tick is the
    // net under it, re-asking on a cadence no missed timer can silence.
    void refreshMeetingQuiet();
    void releaseHeldNotices();
  }, HELD_NOTICE_RELEASE_INTERVAL_MS);
  heldNoticeReleaseTimer.unref();
  if (process.platform === "darwin" && runMode.observesProviders) {
    appleAccessPollTimer = setInterval(() => {
      void pollAppleCalendarAccess();
    }, APPLE_ACCESS_POLL_INTERVAL_MS);
    appleAccessPollTimer.unref();
  }
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
  if (appleAccessPollTimer) clearInterval(appleAccessPollTimer);
  appleAccessPollTimer = undefined;
  appleAccessProbeFailing = false;
  if (quietBoundaryTimer) clearTimeout(quietBoundaryTimer);
  quietBoundaryTimer = undefined;
  calendarMeetings = undefined;
  observedCalendars = [];
  // The readers forget what they held for failing accounts too: a pass after
  // signing back in starts from nothing, not from an era this stop ended.
  googleCalendar.forget();
  appleCalendar.forget();
  heldNotices.release();
  heldRequestSpeech.release();
  panels.broadcast(channels.onCalendarsChanged, observedCalendars);
  if (meetingQuietActive) {
    meetingQuietActive = false;
    panels.broadcast(channels.onMeetingQuietChanged, false);
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
  panels.broadcast(channels.onNoticeAsksChanged, attentionRequests.list());
}

function relevantSessionRoster(
  snapshot: SessionRegistrySnapshot,
  now: number,
): SessionRosterPayload {
  const sessions = rosterRelevantSessions(snapshot.sessions, now);
  const identities = new Map<string, Set<string>>();
  for (const session of sessions) {
    const providerSessions = identities.get(session.providerId) ?? new Set<string>();
    providerSessions.add(session.providerSessionId);
    identities.set(session.providerId, providerSessions);
  }
  return {
    sessions,
    attention: snapshot.attention.filter((entry) =>
      identities.get(entry.providerId)?.has(entry.providerSessionId),
    ),
  } satisfies SessionRosterPayload;
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
  const roster = relevantSessionRoster(snapshot, Date.now());
  const rosterIds = roster.sessions
    .map((session) => `${session.providerId}\0${session.providerSessionId}`)
    .join("\0\0");
  if (snapshot.revision === lastRosterRevision && rosterIds === lastRosterIds) return;
  lastRosterRevision = snapshot.revision;
  lastRosterIds = rosterIds;
  panels.broadcast(channels.onSessionsChanged, roster);
}

function startSessionObservation(): void {
  if (!runMode.observesProviders || !accountCapabilitiesActive() || unsubscribeSessions) {
    traceAnnounce(
      `session observation not (re)started: observes=${runMode.observesProviders} accountActive=${accountCapabilitiesActive()} alreadySubscribed=${unsubscribeSessions !== undefined}`,
    );
    return;
  }
  traceAnnounce("session observation started");
  unsubscribeSessions = sessionRegistry.subscribe((snapshot) => {
    traceAnnounce(`registry commit: ${snapshot.sessions.length} sessions`);
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
    void broadcastWorkspaceProjects();
    countObservedSessions(snapshot.sessions);
  });
}

/**
 * Counts what each provider is observing, once per provider per day. The
 * registry commits on every effective change, so counting each commit would
 * measure registry churn rather than use; and the count itself is a rung of
 * the shared ladder rather than a number, because "137 sessions" identifies a
 * machine where "a crowd" does not.
 */
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
  panels.broadcast(channels.onSessionsChanged, { sessions: [], attention: [] });
  panels.broadcast(channels.onWorkspaceProjectsChanged, []);
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
      panels.broadcast(channels.onIssuesChanged, trackedIssues);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Issue observation failed: ${message}\n`);
  }
}

function stopIssueObservation(): void {
  trackedIssues = undefined;
  panels.broadcast(channels.onIssuesChanged, undefined);
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
  setTimeout(
    () =>
      void (async () => {
        await panels.refreshGeometry();
        // The set of displays may have changed, not just their geometry: a chosen
        // display arriving raises its window, one leaving takes its window down.
        panels.reconcile();
      })(),
    100,
  );
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
      await panels.refreshGeometry();
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
      void settingsStore.get(APP_SETTING_SCHEMA.showInDock.field).then((show) => {
        if (show) dock.apply(true);
      });
      // Armed from the settings file alone, like the status item, and for the
      // same reason. A file that cannot be read leaves the duck on, the same
      // answer a file that has never said gives.
      void settingsStore
        .get(APP_SETTING_SCHEMA.duckOtherMedia.field)
        .then((enabled) => mediaDuck.setEnabled(enabled === true));
      // Armed from the settings file alone, like the duck above, and on the
      // same terms: a file that cannot be read leaves counting on, the answer
      // a file that has never said gives.
      void settingsStore.get(APP_SETTING_SCHEMA.shareUsageData.field).then((share) => {
        productEvents.setSharing(share);
        // Recorded behind the read, because nothing may be counted before
        // the file has said whether counting is wanted at all.
        productEvents.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: app.getVersion() });
        // Luke can run for a week on one launch, so launches alone would
        // undercount the days he was actually used.
        productEvents.markDayActive();
      });
      // Always on, like the announcements: the timed check answers to no
      // setting, only to the run — a fixture or capture run sends no network,
      // so it never asks GitHub anything.
      if (runMode.sendsNetwork) {
        updateService.start();
        productEvents.start();
      }
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
      traceAnnounce(
        `launch armed: credentials=${voiceCapabilities.realtimeCredentials !== undefined} reviewer=${voiceCapabilities.attentionReviewer !== undefined} accountActive=${accountCapabilitiesActive()} observes=${runMode.observesProviders}`,
      );
      // Awaited so the panels are created on the chosen displays in their
      // chosen form, rather than appearing on the main display and jumping. A
      // file that cannot be read means no choice was kept — the main display,
      // the default form — and must not keep the panels from starting.
      panels.setShowOnAllDisplays(
        (await settingsStore.get(APP_SETTING_SCHEMA.showOnAllDisplays.field)) === true,
      );
      panels.setFormFactor(
        (await settingsStore.get(APP_SETTING_SCHEMA.formFactor.field)) ?? DEFAULT_PANEL_FORM_FACTOR,
      );
      // Awaited for the same reason the voice is: the chosen chord has to be in
      // hand before the key is registered, or the first registration would take
      // the default away from the user who moved off it. A file that cannot be
      // read means no choice was kept, and the defaults answer.
      hotkeys.setChosen(
        HOTKEY_RANK.TALK,
        await settingsStore.get(APP_SETTING_SCHEMA.voiceHotkey.field),
      );
      hotkeys.setChosen(
        HOTKEY_RANK.ASK,
        await settingsStore.get(APP_SETTING_SCHEMA.askHotkey.field),
      );
      hotkeys.setChosen(
        HOTKEY_RANK.STOP,
        await settingsStore.get(APP_SETTING_SCHEMA.stopHotkey.field),
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

      // TEMPORARY (launch-test harness, remove before merge): `--test-announcement`
      // speaks a synthetic session notice 15 seconds after launch and again every
      // minute, through the exact channel a real status edge uses, so the
      // first-launch fix can be heard with hands kept off the machine.
      if (process.argv.includes("--test-announcement")) {
        const speakLaunchTest = () => {
          const now = Date.now();
          const speech = sessionNoticeSpeech(
            {
              providerId: "claude-code",
              providerSessionId: `launch-test-${now}`,
              providerName: "Launch Test",
              title: "First-launch announcement test",
              status: SESSION_NOTICE_STATUS.COMPLETE,
              previousStatus: SESSION_STATUS.WORKING,
              recap:
                "This is the launch-test announcement. If you can hear this, remote audio is playing without any interaction.",
              canReceiveMessage: false,
              observedAt: now,
            },
            now,
          );
          const host = panels.voiceHost();
          process.stderr.write(
            `Launch-test announcement ${host ? "sent" : "dropped: no voice host"}\n`,
          );
          host?.webContents.send(channels.onAttentionSpeech, [speech]);
        };
        setTimeout(speakLaunchTest, 15_000);
        setInterval(speakLaunchTest, 60_000).unref();
      }

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
        void panels.refreshGeometry().then(() => {
          if (argv.includes("--expanded")) {
            const host = panels.voiceHost();
            const displayId = host ? panels.displayIdFor(host.webContents) : undefined;
            if (displayId !== undefined) panels.setMode(displayId, "expanded", true);
            return;
          }
          panels.reconcile();
          panels.showInactiveAll();
        });
      });

      screen.on("display-added", handleDisplayChange);
      screen.on("display-removed", handleDisplayChange);
      screen.on("display-metrics-changed", handleDisplayChange);
      for (const eventName of ["resume", "unlock-screen", "user-did-become-active"] as const) {
        const handlePowerEvent = () => {
          handleDisplayChange();
          panels.broadcast(channels.onLifecycle, eventName);
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
    // Deliberately not a flush: a request here either delays the quit or is
    // killed mid-flight, and an instant quit is worth the last minute of
    // counts.
    productEvents.stop();
    panels.clearCollapseTimers();
  });

  app.on("window-all-closed", () => app.quit());
}
