import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as Sentry from "@sentry/electron/main";
import {
  PRODUCT_CREDENTIAL_SOURCE,
  PRODUCT_EVENT,
  PRODUCT_UPDATE_ACT,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@sidecar/analytics";
import { type FeedbackSubmission, feedbackDeliveryFromEnvironment } from "@sidecar/feedback";
import { fixtureSnapshot } from "@sidecar/fixtures";
import { type AppGuideSnapshot, EMPTY_APP_GUIDE } from "@sidecar/guide";
import { peekLocalSessions } from "@sidecar/providers";
import { type GatewayTransport, InProcessTransport } from "@sidecar/runtime";
import { GATEWAY_CLIENT_ROLE, MAIN_SESSION_KEY } from "@sidecar/runtime-contracts";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { DEFAULT_PANEL_FORM_FACTOR } from "@sidecar/surface";
import { IntroductionRealtimeCredentialMinter } from "@sidecar/voice";
import { ACT_RESULT_STATUS, text, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import {
  app,
  BrowserWindow,
  clipboard,
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
  type WebContents,
} from "electron";
import { BRIDGE, channels } from "#shared/bridge";
import { ACCOUNT_STATUS, type AccountSnapshot } from "#shared/messages/account";
import {
  MICROPHONE_STATUS,
  type MicrophoneRoute,
  type MicrophoneStatus,
  type OutputAudioState,
} from "#shared/messages/audio";
import type { BrainAppActRequest } from "#shared/messages/brain";
import {
  type AppBootstrap,
  type SessionReplayBootstrap,
  type VoiceBootstrap,
  WINDOW_ROLE,
} from "#shared/messages/session";
import type { AppSettings } from "#shared/messages/settings";
import type { SpeechOutcome } from "#shared/messages/speech";
import { IDLE_VOICE_VIEW, type VoiceView } from "#shared/messages/voice-view";
import { buildCarriesDeveloperIdSigning, resolveAppName } from "./app-identity";
import { runAppleCalendarHelper } from "./apple-calendar";
import { registerBrainIpc } from "./brain/ipc";
import { followReattachments, retryAttachWhileFailed, waitForHost } from "./gateway/attachment";
import { DESKTOP_OPERATOR_CLIENT_ID } from "./gateway/desktop-node";
import { currentBuildIdentity } from "./gateway/gateway-process";
import type { HostBootstrap, HostSessionReplay } from "./gateway/host-operator";
import { createGatewayLauncher } from "./gateway/launcher";
import { gatewayStateRootArgument, registersProviderHooks } from "./gateway/process-mode";
import { wireGateway } from "./gateway/wiring";
import { composeRuntimeHost, type RuntimeHost } from "./host/runtime-host";
import {
  INTRODUCTION_FADE_MS,
  INTRODUCTION_HANDOFF_READY_MS,
  INTRODUCTION_PEEK_FRESH_MS,
  INTRODUCTION_RENDER_DEADLINE_MS,
  shouldRunIntroduction,
} from "./introduction-flow";
import { registerAccountSessionIpc } from "./ipc/account-session";
import { registerCalendarConnectionIpc } from "./ipc/calendar-connection";
import { registerSessionActsIpc } from "./ipc/session-acts";
import { registerSettingsRowsIpc } from "./ipc/settings-rows";
import { registerTrackerConnectionIpc } from "./ipc/tracker-connection";
import { registerVoiceRuntimeIpc } from "./ipc/voice-runtime";
import { registerWindowSurfaceIpc } from "./ipc/window-surface";
import { jsonStateFile } from "./json-state-file";
import { MediaDuckController } from "./native/media-duck";
import { MicrophoneRouteWatcher } from "./native/microphone-route";
import { OutputVolumeWatcher } from "./native/output-volume";
import { onboardingStateFile } from "./onboarding-state";
import { type BridgeContext, registerBridge, registerBridgeEntry } from "./register-bridge";
import { runModeFor, sentryReportingEnabled } from "./run-mode";
import { createSettingsHandler } from "./settings-handler";
import { createElectronUpdaterEngine } from "./update-installer";
import { UPDATE_ENDPOINT, type UpdaterEngine, UpdateService } from "./update-service";
import { DockPresence } from "./window/dock-presence";
import { HOTKEY_RANK, HotkeyRegistrar } from "./window/hotkey-registrar";
import { IntroductionWindow } from "./window/introduction-window";
import { PanelManager } from "./window/panel-manager";
import { VoiceWindow } from "./window/voice-window";

/**
 * The desktop client: the process that draws. It owns the windows, the keys,
 * the Dock, the native helpers this machine's devices answer through, the
 * updater that replaces this binary, and the one-time introduction; it
 * reaches everything else — the store, the brain, the credentials, the
 * observation, the accounts — through the Gateway protocol as one operator,
 * and offers this machine's native capabilities back to the host as one node.
 * A live run attaches to the Gateway process, or starts it; a fixture or
 * capture run composes the same host in this process, memory-only and
 * network-silent, over the in-process transport, so the client code path is
 * one either way.
 */

// Which Luke this process is decides where its state lives and which Keychain
// entry protects its credentials; see app-identity.ts for why a development
// run must never share the release's. Applied before anything derives a path.
const appName = resolveAppName({
  packaged: app.isPackaged,
  developerIdSigned: buildCarriesDeveloperIdSigning(),
});
app.setName(appName);
// The state root is Luke's application data under that name, or the one an
// explicit `--state-root=` names: the same argument the Gateway takes, so a
// validation run can stand a whole desktop and Gateway pair on a temporary
// root without touching the real one or repurposing the home directory.
const stateRoot =
  gatewayStateRootArgument(process.argv) ?? path.join(app.getPath("appData"), appName);
app.setPath("userData", stateRoot);
app.setPath("sessionData", stateRoot);

const captureOutput = argumentValue("--capture-evidence");
const profile = argumentValue("--profile") ?? "idle";
const fixtureName = argumentValue("--fixture");
const startPeeked = process.argv.includes("--peek");
const startInSlot = process.argv.includes("--slot");
const fixture = fixtureSnapshot(fixtureName ?? "smoke");
const captureMode = captureOutput !== undefined;
const fixtureMode = captureMode || fixtureName !== undefined;
const runMode = runModeFor({ capture: captureMode, fixture: fixtureName !== undefined });
declare const PACKAGED_SENTRY_DSN: string;
Sentry.init({
  dsn: PACKAGED_SENTRY_DSN,
  enabled: sentryReportingEnabled(runMode.sendsNetwork, PACKAGED_SENTRY_DSN),
});
// The introduction's mint lives on the same origin as the account service;
// the one development override redirects both, and stops at packaging.
const ACCOUNT_BASE_URL =
  (app.isPackaged ? undefined : process.env.LUKE_ACCOUNT_BASE_URL) ??
  "https://tryluke.dev/api/auth";
const HOSTED_SERVICE_BASE_URL = ACCOUNT_BASE_URL.replace(/\/api\/auth\/?$/, "");
const report = (message: string) => process.stderr.write(`${message}\n`);

/**
 * What this client last heard from the host, for the answers it must give
 * synchronously or when the host cannot be reached: the settings the rows
 * draw, the account the gate opens on, whether a voice stands, and the
 * recording state. Each moves only on a host event or a bootstrap.
 */
let latestSettings: AppSettings | undefined;
let account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };
let voiceAvailable = false;
let latestSessionReplay: HostSessionReplay = { permitted: runMode.sendsNetwork };
let sessionReplayHalted = false;

/**
 * The opaque names this process gives its windows on the host, minted per
 * WebContents and meaning nothing to anyone else: a report carries one, and
 * the host's change event echoes it so the reporting window is skipped.
 */
const reporters = new WeakMap<WebContents, string>();
const windowsByReporter = new Map<string, WebContents>();
function reporterOf(context: BridgeContext): string {
  const held = reporters.get(context.sender);
  if (held) return held;
  const minted = randomUUID();
  reporters.set(context.sender, minted);
  windowsByReporter.set(minted, context.sender);
  context.sender.once("destroyed", () => windowsByReporter.delete(minted));
  return minted;
}

let appGuide: AppGuideSnapshot = EMPTY_APP_GUIDE;
const pendingBrainAppActs = new Map<string, (answer: WireRecord) => void>();
const BRAIN_APP_ACT_TIMEOUT_MS = 10_000;

const mediaDuck = new MediaDuckController();
const feedbackDelivery = feedbackDeliveryFromEnvironment();
let outputAudio: OutputAudioState | undefined;
let outputVolumeWatcher: OutputVolumeWatcher | undefined;
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
  onAllClosed: () => app.quit(),
});
const introductionWindow = new IntroductionWindow({
  runMode,
  preloadPath: path.join(__dirname, "preload.js"),
  rendererHtmlPath: path.join(__dirname, "renderer", "index.html"),
  rendererUrl: rendererUrl(),
  onGone: (reason) => {
    report(`Introduction abandoned: ${reason}`);
    void abandonIntroduction();
  },
  onClosed: () => quitUnlessPanelStands(),
});
/**
 * The hidden window that holds the live conversation. Its receiver epochs are
 * the host's: each load asks the host to begin one, and a close or reload
 * ends it there, so a claim the renderer makes names an epoch the host issued.
 */
const voiceWindow = new VoiceWindow({
  runMode,
  receiver: {
    begin: () => void gateway.host.beginReceiver(),
    reset: () => void gateway.host.resetReceiver(),
  },
  preloadPath: path.join(__dirname, "preload.js"),
  rendererHtmlPath: path.join(__dirname, "renderer", "index.html"),
  rendererUrl: rendererUrl(),
  onGone: (reason) => {
    report(`Voice window replaced: ${reason}`);
    latestVoiceView = undefined;
    panels.setVoiceExchange(false);
    broadcast(channels.onVoiceViewChanged, IDLE_VOICE_VIEW);
  },
  onGaveUp: (reason) => {
    report(`Voice window abandoned: ${reason}`);
  },
});
const voiceWindowWanted = runMode.registersGlobalKeys || runMode.sendsNetwork;

function raiseVoiceWindow(): void {
  if (voiceWindowWanted && panels.standing > 0) voiceWindow.open();
}

function quitUnlessPanelStands(): void {
  if (panels.standing === 0) app.quit();
}

function broadcast<Payload>(channel: string, payload: Payload, except?: WebContents): void {
  panels.broadcast(channel, payload, except);
  const voice = voiceWindow.current();
  if (!voice || voice.webContents === except) return;
  // SAFETY: Main-process broadcasts carry structured-clone snapshots produced for channels fixed by this build.
  voice.webContents.send(channel, payload as UnparsedWireValue);
}

function sendToVoice<Payload>(channel: string, payload: Payload): void {
  // SAFETY: as above; the voice window is one of the same windows.
  voiceWindow.current()?.webContents.send(channel, payload as UnparsedWireValue);
}

let latestVoiceView: VoiceView | undefined;
let introductionRendererReady = false;
let resolveIntroductionPanelReady: (() => void) | undefined;
const introductionMinter = new IntroductionRealtimeCredentialMinter({
  serviceBaseUrl: HOSTED_SERVICE_BASE_URL,
});
const onboarding = onboardingStateFile(() => app.getPath("userData"), report);

async function finishIntroduction(given: boolean): Promise<void> {
  if (!introductionWindow.active) return;
  if (given) {
    onboarding.update((current) => ({
      ...current,
      introductionCompletedAt: new Date().toISOString(),
    }));
    recordProductEvent(PRODUCT_EVENT.INTRODUCTION_COMPLETE, {});
  }
  introductionWindow.retire();
  const panelReady = new Promise<void>((resolve) => {
    resolveIntroductionPanelReady = resolve;
  });
  panels.reconcile();
  raiseVoiceWindow();
  await Promise.race([
    panelReady,
    new Promise((resolve) => setTimeout(resolve, INTRODUCTION_HANDOFF_READY_MS)),
  ]);
  resolveIntroductionPanelReady = undefined;
  setTimeout(() => {
    introductionWindow.close();
    void hotkeys.reapply(HOTKEY_RANK.TALK);
  }, INTRODUCTION_FADE_MS);
}

async function abandonIntroduction(): Promise<void> {
  if (!introductionWindow.active) return;
  introductionWindow.retire();
  panels.reconcile();
  raiseVoiceWindow();
  panels.showInactiveAll();
  introductionWindow.close();
  await hotkeys.reapply(HOTKEY_RANK.TALK);
}

const hotkeys = new HotkeyRegistrar({
  registersGlobalKeys: runMode.registersGlobalKeys,
  // The introduction's practice beat is the one time the talk key is claimed
  // with no account credential behind it; otherwise a voice stands only when
  // the host says one does.
  hasCredentials: (rank) =>
    voiceAvailable || (rank === HOTKEY_RANK.TALK && introductionWindow.active),
  recordProductEvent: (name, properties) => recordProductEvent(name, properties),
  host: {
    voiceHost: () => introductionWindow.current() ?? voiceWindow.current(),
    primaryPanel: () => panels.primaryPanel(),
    displayIdFor: (sender) => panels.displayIdFor(sender),
    modeFor: (displayId) => panels.modeFor(displayId),
    setMode: (displayId, mode, requestFocus) => {
      panels.setMode(displayId, mode, requestFocus);
    },
    broadcast: (channel, payload) => broadcast(channel, payload),
  },
});
const dock = new DockPresence({
  focusExpanded: (displayId) => panels.focusExpanded(displayId),
  iconDirectory: path.join(__dirname, "icon"),
});

function applyLoginItem(openAtLogin: boolean): void {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin });
}

function startOutputVolumeWatch(): void {
  if (!runMode.observesProviders) return;
  const send = (state: OutputAudioState | undefined) => {
    outputAudio = state;
    broadcast(channels.onOutputAudioChanged, state);
  };
  outputVolumeWatcher = new OutputVolumeWatcher({
    onState: send,
    onUnavailable: () => send(undefined),
  });
  if (!outputVolumeWatcher.start()) outputVolumeWatcher = undefined;
}

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

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function microphoneStatus(): MicrophoneStatus {
  if (process.platform !== "darwin") return MICROPHONE_STATUS.GRANTED;
  // SAFETY: MicrophoneStatus mirrors Electron's documented media-access status union.
  return systemPreferences.getMediaAccessStatus("microphone") as MicrophoneStatus;
}

async function requestMicrophone(): Promise<MicrophoneStatus> {
  if (process.platform !== "darwin") return MICROPHONE_STATUS.GRANTED;
  if (microphoneStatus() === MICROPHONE_STATUS.NOT_DETERMINED) {
    await systemPreferences.askForMediaAccess("microphone");
  }
  const status = microphoneStatus();
  broadcast(channels.onMicrophoneStatusChanged, status);
  return status;
}

function trustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? event.sender.getURL();
  return url === rendererUrl();
}

/**
 * Carries an app act only a renderer can perform — a settings change, the
 * panel shown, the feedback composer, the Updates row's button — to the
 * primary panel and waits for its answer. A panel that does not answer
 * within the round trip refuses the act on a clock rather than holding the
 * brain's turn open in the host.
 */
function performBrainAppAct(action: BrainAppActRequest["action"]): Promise<WireRecord> {
  const host = panels.primaryPanel();
  if (!host) {
    return Promise.resolve({
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "No panel is open to carry that.",
    });
  }
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingBrainAppActs.delete(requestId);
      resolve({ status: ACT_RESULT_STATUS.REJECTED, reason: "The panel did not answer in time." });
    }, BRAIN_APP_ACT_TIMEOUT_MS);
    pendingBrainAppActs.set(requestId, (answer) => {
      clearTimeout(timer);
      pendingBrainAppActs.delete(requestId);
      resolve(answer);
    });
    const request: BrainAppActRequest = { requestId, action };
    host.webContents.send(channels.onBrainAppAct, request);
  });
}

/**
 * The Gateway. A live run attaches to the Gateway process, which owns the
 * runtime, or starts it; a fixture or capture run composes the same host in
 * this process, memory-only and network-silent, and speaks to it in-process.
 * Either way this process is one operator over one transport, and one node.
 */
const gatewayLauncher = runMode.observesProviders
  ? createGatewayLauncher({
      stateRoot: app.getPath("userData"),
      build: currentBuildIdentity(appName),
      registerProviderHooks: registersProviderHooks(process.argv),
      report,
    })
  : undefined;
let localRuntime: RuntimeHost | undefined;
const transport: GatewayTransport = gatewayLauncher
  ? gatewayLauncher.transport
  : (() => {
      localRuntime = composeRuntimeHost({
        stateRoot: app.getPath("userData"),
        runMode,
        appVersion: app.getVersion(),
        packaged: app.isPackaged,
        homeDirectory: app.getPath("home"),
        environment: process.env,
        cipher: {
          isAvailable: () => safeStorage.isEncryptionAvailable(),
          encrypt: (plainText) => safeStorage.encryptString(plainText),
          decrypt: (cipherText) => safeStorage.decryptString(cipherText),
        },
        createWorker: () => {
          throw new Error("a fixture run keeps nothing on disk and starts no store worker");
        },
        registerProviderHooks: false,
        now: Date.now,
        createId: () => randomUUID(),
        report,
      });
      return new InProcessTransport(localRuntime.service.server, {
        clientId: DESKTOP_OPERATOR_CLIENT_ID,
        role: GATEWAY_CLIENT_ROLE.OPERATOR,
      });
    })();
const gateway = wireGateway({
  transport,
  createId: () => randomUUID(),
  report,
  broadcast,
  sendToVoice,
  webContentsByReporter: (reporter) => windowsByReporter.get(reporter),
  lastSettings: () => latestSettings,
  node: {
    openExternal: (url) => shell.openExternal(url),
    performAppAct: performBrainAppAct,
    runAppleCalendarHelper,
  },
});
const recordProductEvent: RecordProductEvent = (name, properties) =>
  gateway.host.recordEvent(name, properties);

// What the host tells its clients, relayed to the windows by the one client
// that owns them, and remembered where a synchronous answer needs it.
gateway.host.onSettingsChanged((change) => {
  const stoodVoice = voiceAvailable;
  latestSettings = change.settings;
  voiceAvailable = change.settings.status.voiceAvailable;
  broadcast(
    channels.onSettingsChanged,
    change.settings,
    change.reporter === undefined ? undefined : windowsByReporter.get(change.reporter),
  );
  // A voice that came or went moves the talk key: claimed now that there is
  // something to talk to, or given back to the machine now that there is not.
  if (stoodVoice !== voiceAvailable) void hotkeys.reapply(HOTKEY_RANK.TALK);
});
gateway.host.onAccountChanged((next) => {
  account = next;
  broadcast(channels.onAccountChanged, account);
});
gateway.host.onSessionsChanged((roster) =>
  broadcast(channels.onSessionsChanged, { sessions: roster.sessions }),
);
gateway.host.onWorkspaceProjectsChanged((projects) =>
  broadcast(channels.onWorkspaceProjectsChanged, projects),
);
gateway.host.onCalendarsChanged((calendars) => broadcast(channels.onCalendarsChanged, calendars));
gateway.host.onAnnouncementsHeldChanged((held) =>
  broadcast(channels.onAnnouncementsHeldChanged, held),
);
gateway.host.onSupersetSignInChanged((state) => broadcast(channels.onSupersetSignInChanged, state));
gateway.host.onCalendarOnboardingChanged((owed) =>
  broadcast(channels.onCalendarOnboardingChanged, owed),
);
gateway.host.onSpeechOffered((offer) => sendToVoice(channels.onSpeechOffered, offer));
gateway.host.onSpeechWithdrawn((id) => sendToVoice(channels.onSpeechWithdrawn, { id }));
gateway.host.onSessionReplayChanged((replay) => {
  latestSessionReplay = replay;
  sessionReplayHalted = false;
  broadcast(channels.onSessionReplayChanged, sessionReplayBootstrap());
});

function sessionReplayBootstrap(): SessionReplayBootstrap {
  return {
    permitted: latestSessionReplay.permitted && !sessionReplayHalted,
    appVersion: app.getVersion(),
    ...(latestSessionReplay.accountId ? { accountId: latestSessionReplay.accountId } : undefined),
  };
}

/** Stops recording now, ahead of an act that ends the account it is filed under; the host's next replay event re-answers. */
function haltSessionReplay(): void {
  sessionReplayHalted = true;
  broadcast(channels.onSessionReplayChanged, sessionReplayBootstrap());
}

function resumeSessionReplay(): void {
  sessionReplayHalted = false;
  broadcast(channels.onSessionReplayChanged, sessionReplayBootstrap());
}

/** Adopts one host bootstrap into the caches the synchronous answers read. */
function adoptBootstrap(boot: HostBootstrap): void {
  latestSettings = boot.settings;
  account = boot.account;
  voiceAvailable = boot.voiceAvailable;
  latestSessionReplay = boot.sessionReplay;
}

/**
 * What every attachment owes the host: its stream adopted and this process's
 * node registered on the connection that now stands, the guide the panel last
 * reported, and a bootstrap read. A reattachment after the Gateway went away
 * also recycles the voice window, because the epoch its renderer holds was the
 * old host's, and tells every window what the host now holds.
 */
let attachments = 0;
async function onAttached(): Promise<void> {
  attachments += 1;
  await gateway.attached();
  if (appGuide !== EMPTY_APP_GUIDE) void gateway.host.reportGuide(appGuide);
  const boot = await gateway.host.bootstrap();
  if (!boot) throw new Error("the host answered no bootstrap");
  adoptBootstrap(boot);
  if (attachments > 1) {
    broadcast(channels.onSettingsChanged, boot.settings);
    broadcast(channels.onAccountChanged, boot.account);
    broadcast(channels.onSessionsChanged, { sessions: boot.sessions });
    broadcast(channels.onWorkspaceProjectsChanged, boot.workspaceProjects);
    broadcast(channels.onCalendarsChanged, boot.calendars);
    broadcast(channels.onAnnouncementsHeldChanged, boot.announcementsHeld);
    broadcast(channels.onCalendarOnboardingChanged, boot.calendarOnboardingOwed);
    broadcast(channels.onSessionReplayChanged, sessionReplayBootstrap());
    void hotkeys.reapply(HOTKEY_RANK.TALK);
  }
  if (attachments > 1 && voiceWindow.current()) {
    voiceWindow.close();
    raiseVoiceWindow();
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
    snapshot: async () => latestSettings ?? (await gateway.host.settingsSnapshot()),
  });

  const unreachableSettings = async (): Promise<AppSettings> => {
    const settings = await gateway.host.settingsSnapshot();
    if (!settings) throw new Error("Luke's runtime is not reachable right now.");
    return settings;
  };

  /**
   * The fields the hidden voice window reads, assembled from one host
   * bootstrap and this process's own facts: the microphone, the output, the
   * keys, the trace gate, and — for the voice window itself — the receiver
   * epoch the host minted for this load.
   */
  const voiceBootstrapFields = async (
    context: BridgeContext,
    boot: HostBootstrap | undefined,
  ): Promise<VoiceBootstrap> => ({
    agentTraceEnabled: boot?.agentTraceEnabled ?? false,
    microphoneStatus: microphoneStatus(),
    ...(voiceWindow.owns(context.sender) && boot ? { voiceEpoch: boot.receiverEpoch } : undefined),
    ...(hotkeys.talk ? { voiceHotkey: hotkeys.talk } : undefined),
    ...(outputAudio ? { outputAudio } : undefined),
    sessionRoster: { sessions: boot?.sessions ?? [] },
    announcementsHeld: boot?.announcementsHeld ?? false,
    conversationHistory: boot?.conversationHistory ?? [],
    settings: boot?.settings ?? latestSettings ?? (await unreachableSettings()),
  });
  registerContextHandler(BRIDGE.getVoiceBootstrap, async (context: BridgeContext) => {
    const boot = await gateway.host.bootstrap();
    if (boot) adoptBootstrap(boot);
    return voiceBootstrapFields(context, boot);
  });
  registerContextHandler(
    BRIDGE.getBootstrap,
    async (context: BridgeContext): Promise<AppBootstrap> => {
      const displayId = panels.displayIdFor(context.sender);
      const display = voiceWindow.owns(context.sender)
        ? undefined
        : ((displayId !== undefined ? panels.display(displayId) : undefined) ??
          screen.getPrimaryDisplay());
      const boot = await gateway.host.bootstrap();
      if (boot) adoptBootstrap(boot);
      const voiceFields = await voiceBootstrapFields(context, boot);
      return {
        ...voiceFields,
        mode: displayId !== undefined ? panels.modeFor(displayId) : panels.initialMode,
        startPeeked,
        startInSlot,
        profile,
        fixture,
        captureMode,
        fixtureMode,
        supersetInstalled: boot?.supersetInstalled ?? false,
        supersetConnected: boot?.supersetConnected ?? false,
        accountRequired: runMode.requiresAccount,
        account,
        packaged: app.isPackaged,
        platform: process.platform,
        voiceHotkeyHeld: hotkeys.held,
        ...(hotkeys.ask ? { askHotkey: hotkeys.ask } : undefined),
        ...(hotkeys.stop ? { stopHotkey: hotkeys.stop } : undefined),
        display: display ? panels.diagnostic(display) : undefined,
        update: updateService.snapshot(),
        // A fixture run never observes and its sessions travel in the fixture
        // itself, so it is settled from the start; a live run settles once
        // the host has read the roster at all.
        sessionsSettled: !runMode.observesProviders || (boot?.sessionsSettled ?? false),
        workspaceProjects: boot?.workspaceProjects ?? [],
        calendars: boot?.calendars ?? [],
        voiceView: latestVoiceView,
        calendarOnboardingOwed: boot?.calendarOnboardingOwed ?? false,
        sessionReplay: sessionReplayBootstrap(),
      };
    },
  );
  // The voice window's appends to the conversation, carried to the host's
  // store under this window's opaque reporter, and relayed back to every
  // other panel's History by the host's change event.
  registerBridge(
    BRIDGE,
    {
      appendConversationHistory(context, entries) {
        return gateway.host.appendHistory(entries, reporterOf(context));
      },
    },
    { ipcMain, trustedSender },
  );
  registerContextHandler(
    BRIDGE.settleSpeech,
    (context: BridgeContext, id: string, outcome: SpeechOutcome) => {
      if (!voiceWindow.owns(context.sender)) return;
      void gateway.host.settleSpeech(id, outcome);
    },
  );
  registerHandler(BRIDGE.skipCalendarOnboarding, () => gateway.host.skipCalendarOnboarding());
  registerHandler(BRIDGE.completeCalendarOnboarding, () =>
    gateway.host.completeCalendarOnboarding(),
  );
  registerHandler(BRIDGE.beginSupersetSignIn, () => gateway.host.beginSupersetSignIn());
  registerHandler(BRIDGE.submitSupersetSignInCode, (code: string) =>
    gateway.host.submitSupersetSignInCode(code),
  );
  registerHandler(BRIDGE.chooseSupersetOrganization, (slug: string) =>
    gateway.host.chooseSupersetOrganization(slug),
  );
  registerHandler(BRIDGE.reopenSupersetSignIn, () => gateway.host.reopenSupersetSignIn());
  registerHandler(BRIDGE.cancelSupersetSignIn, () => gateway.host.cancelSupersetSignIn());
  registerHandler(BRIDGE.disconnectSuperset, () => gateway.host.disconnectSuperset());

  registerAccountSessionIpc({
    ipcMain,
    trustedSender,
    host: gateway.host,
    haltSessionReplay,
    resumeSessionReplay,
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
    host: gateway.host,
    reporterOf,
    lastSettings: () => latestSettings,
    hotkeys,
    dock,
    applyLoginItem,
    panels,
    mediaDuck,
    recordProductEvent,
  });

  registerCalendarConnectionIpc({
    ipcMain,
    trustedSender,
    registerSetting: registerSettingHandler,
    host: gateway.host,
    reporterOf,
    openExternal: (url) => void shell.openExternal(url),
  });

  registerTrackerConnectionIpc({
    ipcMain,
    trustedSender,
    registerSetting: registerSettingHandler,
    host: gateway.host,
    reporterOf,
  });

  registerHandler(BRIDGE.checkForUpdates, () => {
    recordProductEvent(PRODUCT_EVENT.UPDATE_ACT, { update_act: PRODUCT_UPDATE_ACT.CHECK });
    return updateService.check();
  });
  registerHandler(BRIDGE.installUpdate, () => {
    recordProductEvent(PRODUCT_EVENT.UPDATE_ACT, { update_act: PRODUCT_UPDATE_ACT.INSTALL });
    updateService.install();
  });
  registerHandler(BRIDGE.openLatestRelease, () => {
    recordProductEvent(PRODUCT_EVENT.UPDATE_ACT, { update_act: PRODUCT_UPDATE_ACT.RELEASE_OPEN });
    void shell.openExternal(UPDATE_ENDPOINT.LATEST_RELEASE_PAGE_URL);
  });
  registerHandler(BRIDGE.openChangelog, () => {
    recordProductEvent(PRODUCT_EVENT.UPDATE_ACT, { update_act: PRODUCT_UPDATE_ACT.CHANGELOG_OPEN });
    void shell.openExternal(UPDATE_ENDPOINT.CHANGELOG_PAGE_URL);
  });

  registerVoiceRuntimeIpc({
    ipcMain,
    trustedSender,
    panels,
    voiceWindow,
    receiver: { markReady: (epoch) => gateway.host.readyReceiver(epoch) },
    broadcast,
    storeVoiceView: (view) => {
      latestVoiceView = view;
    },
    // The History Clear is Delete history on main: the recoverable deletion,
    // reported to the panel as refused only when the store took nothing.
    clearConversation: () => gateway.operator.deleteHistory(MAIN_SESSION_KEY),
    setShortcutCapturing: (capturing) => hotkeys.setShortcutCapturing(capturing),
    openExternal: (url) => shell.openExternal(url),
    // While the takeover stands and no voice stands on the host yet, the
    // introduction's bounded mint answers; the moment the account lands, the
    // host's own credential wins even before the takeover has faded.
    mintRealtimeCredential: async () => {
      if (voiceAvailable) return gateway.host.mintRealtimeCredential();
      if (!introductionWindow.active) return undefined;
      const credential = await introductionMinter.mint();
      if (credential) {
        recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
          credential_source: PRODUCT_CREDENTIAL_SOURCE.INTRODUCTION,
        });
      }
      return credential;
    },
    realtimeDiagnostics: async () => {
      if (!voiceAvailable && introductionWindow.active) return introductionMinter.diagnostics();
      return (await gateway.host.realtimeDiagnostics()) ?? introductionMinter.diagnostics();
    },
    recordProductEvent,
    // The development trace is the host's: a tapped wire event crosses to its
    // writer, which alone knows whether this run records anything.
    recordAgentTrace: (trace) => gateway.host.recordAgentTrace(trace),
  });

  registerSessionActsIpc({
    ipcMain,
    trustedSender,
    performer: {
      openSession: (identity) => gateway.host.openSession(identity),
      openSessionApplication: (identity, applicationId) =>
        gateway.host.openSessionApplication(identity, applicationId),
      openSessionChange: (identity) => gateway.host.openSessionChange(identity),
    },
  });
  registerBrainIpc({
    ipcMain,
    trustedSender,
    submitters: {
      panel: (sender) => panels.owns(sender),
      voice: (sender) => voiceWindow.owns(sender),
    },
    operator: gateway.operator,
  });
  registerHandler(BRIDGE.reportAppGuide, (snapshot: AppGuideSnapshot) => {
    appGuide = snapshot;
    void gateway.host.reportGuide(snapshot);
  });
  registerHandler(BRIDGE.answerBrainAppAct, (requestId: string, answer: WireRecord) => {
    pendingBrainAppActs.get(requestId)?.(answer);
  });

  registerHandler(BRIDGE.sendFeedback, async (submission: FeedbackSubmission) => {
    if (!runMode.sendsNetwork) {
      return { delivered: false, reason: "A fixture run sends nothing." };
    }
    const result = await feedbackDelivery.deliver(submission);
    if (result.delivered) {
      recordProductEvent(PRODUCT_EVENT.FEEDBACK_SEND, {
        image_count: productSessionCountBucket(submission.images.length),
      });
    }
    return result;
  });

  registerContextHandler(BRIDGE.getWindowRole, (context: BridgeContext) =>
    introductionWindow.owns(context.sender)
      ? WINDOW_ROLE.INTRODUCTION
      : voiceWindow.owns(context.sender)
        ? WINDOW_ROLE.VOICE
        : WINDOW_ROLE.PANEL,
  );

  // The introduction's one-shot keyless read of this machine's local
  // sessions: the same read-only observe every pass runs, once, with no hook
  // registration and no credential, answered only to the takeover window.
  registerContextHandler(BRIDGE.peekIntroductionSessions, async (context: BridgeContext) => {
    if (!introductionWindow.owns(context.sender) || !runMode.observesProviders) return [];
    const now = Date.now();
    const sessions = await peekLocalSessions();
    return sessions.filter((session) => now - session.lastActivityAt <= INTRODUCTION_PEEK_FRESH_MS);
  });

  registerContextHandler(
    BRIDGE.completeIntroduction,
    async (context: BridgeContext, given: boolean) => {
      if (!introductionWindow.owns(context.sender)) return;
      await finishIntroduction(given === true);
    },
  );

  registerContextHandler(BRIDGE.abandonIntroduction, (context: BridgeContext, reason: string) => {
    if (!introductionWindow.owns(context.sender)) return;
    report(`Introduction abandoned: ${reason}`);
    void abandonIntroduction();
  });

  registerContextHandler(BRIDGE.introductionMounted, (context: BridgeContext) => {
    if (!introductionWindow.owns(context.sender)) return;
    introductionRendererReady = true;
  });

  registerHandler(BRIDGE.copyText, (words: string) => clipboard.writeText(words));

  registerHandler(BRIDGE.quit, app.quit.bind(app));

  registerContextHandler(BRIDGE.notifyReady, async (context: BridgeContext) => {
    if (resolveIntroductionPanelReady && panels.owns(context.sender)) {
      resolveIntroductionPanelReady();
      resolveIntroductionPanelReady = undefined;
    }
    if (!captureOutput) return;
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

function configurePermissions(): void {
  const ownWindow = (webContents: Electron.WebContents) =>
    panels.owns(webContents) ||
    introductionWindow.owns(webContents) ||
    voiceWindow.owns(webContents);
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, _origin, details) =>
      webContents !== null &&
      ownWindow(webContents) &&
      permission === "media" &&
      details.mediaType === "audio",
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      callback(
        ownWindow(webContents) &&
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
        if (introductionWindow.active) {
          introductionWindow.reposition();
          return;
        }
        panels.reconcile();
      })(),
    100,
  );
}

/**
 * The explicit quit's stop of the Gateway, made once whichever path asks for
 * it: Quit itself, or the updater's restart into a downloaded build. Squirrel
 * swaps the executable at quit, and a Gateway of the old build left standing
 * would otherwise have to be found and drained by the new build at its next
 * launch; asking it to leave first, and waiting, is the drain.
 */
let gatewayStopped = gatewayLauncher === undefined;
function stopGatewayOnce(): Promise<void> {
  if (gatewayStopped || !gatewayLauncher) return Promise.resolve();
  gatewayStopped = true;
  return gatewayLauncher.stop();
}
function drainingEngine(engine: UpdaterEngine): UpdaterEngine {
  return {
    ...engine,
    quitAndInstall: () => {
      void stopGatewayOnce().finally(() => engine.quitAndInstall());
    },
  };
}
const lastRunVersionFile = jsonStateFile<{ version: string }>({
  directory: () => app.getPath("userData"),
  fileName: "last-run-version.json",
  read: (record) => {
    const version = text(record.version);
    return version === undefined ? undefined : { version };
  },
  write: (state) => state,
  report,
});
const updateService = new UpdateService({
  currentVersion: app.getVersion(),
  onChange: (update) => broadcast(channels.onUpdateChanged, update),
  engine:
    app.isPackaged && runMode.sendsNetwork && process.platform === "darwin"
      ? drainingEngine(createElectronUpdaterEngine())
      : undefined,
  lastRunVersion: {
    read: () => lastRunVersionFile.read()?.version,
    write: (version) => {
      lastRunVersionFile.update(() => ({ version }));
    },
  },
});

export function startDesktopApp(): void {
  if (!app.requestSingleInstanceLock()) {
    process.stderr.write(
      "Luke is already running; the existing panel was refreshed instead of starting a second copy.\n",
    );
    app.quit();
  } else {
    void app.whenReady().then(async () => {
      if (process.platform === "darwin") app.setActivationPolicy("accessory");
      Menu.setApplicationMenu(null);
      // The host stands first: attached, or started, or composed here, and
      // its first bootstrap read before anything is decided from it. The
      // introduction plays only on a host actually reached: a launch that
      // cannot reach its runtime knows nothing of the account and must not
      // greet a signed-in developer as a stranger.
      if (gatewayLauncher) {
        const onStateChanged = (listener: Parameters<typeof gatewayLauncher.onStateChanged>[0]) =>
          gatewayLauncher.onStateChanged(listener);
        // The retries begin the moment an attach fails, and the launch waits
        // on whichever attachment first reads a bootstrap; its tail below
        // runs once, over that bootstrap, and a reattachment after it runs
        // only the attachment work.
        retryAttachWhileFailed({
          onStateChanged,
          attach: () => gatewayLauncher.attach(),
          report,
        });
        const first = await waitForHost({
          onStateChanged,
          attach: () => gatewayLauncher.attach(),
          onAttached,
          report,
        });
        report(
          first.result.outcome === "failed"
            ? `Gateway attached after a failed first attempt (${first.result.failure})`
            : `Gateway ${first.result.outcome} (pid ${first.result.pid})`,
        );
        followReattachments({ onStateChanged, onAttached, report });
      } else if (localRuntime) {
        await localRuntime.start();
        await onAttached();
      }
      const giveIntroduction = shouldRunIntroduction({
        requiresAccount: runMode.requiresAccount,
        signedIn: account.status === ACCOUNT_STATUS.SIGNED_IN,
        completed: onboarding.read()?.introductionCompletedAt !== undefined,
      });
      await panels.refreshGeometry();
      registerIpc();
      dock.applyIcon();
      dock.watchTheme();
      const settings = latestSettings ?? (await gateway.host.settingsSnapshot());
      latestSettings = settings;
      if (settings?.stored.showInDock) dock.apply(true);
      applyLoginItem(settings?.stored.openAtLogin ?? APP_SETTING_SCHEMA.openAtLogin.default);
      if (runMode.observesProviders) {
        mediaDuck.setEnabled(
          settings?.stored.duckOtherMedia ?? APP_SETTING_SCHEMA.duckOtherMedia.default,
        );
      }
      if (runMode.sendsNetwork) updateService.start();
      if (giveIntroduction) {
        introductionWindow.open();
        setTimeout(() => {
          if (!introductionWindow.active || introductionRendererReady) return;
          report("Introduction abandoned: the takeover never reported mounting.");
          void abandonIntroduction();
        }, INTRODUCTION_RENDER_DEADLINE_MS);
      }
      panels.setShowOnAllDisplays(settings?.stored.showOnAllDisplays === true);
      panels.setFormFactor(settings?.stored.formFactor ?? DEFAULT_PANEL_FORM_FACTOR);
      hotkeys.setChosen(HOTKEY_RANK.TALK, settings?.stored.voiceHotkey);
      hotkeys.setChosen(HOTKEY_RANK.ASK, settings?.stored.askHotkey);
      hotkeys.setChosen(HOTKEY_RANK.STOP, settings?.stored.stopHotkey);
      await hotkeys.reapply(HOTKEY_RANK.TALK);
      startOutputVolumeWatch();
      startMicrophoneRouteWatch();
      if (!introductionWindow.active) panels.reconcile();
      raiseVoiceWindow();
      configurePermissions();

      app.on("second-instance", (_event, argv) => {
        void panels.refreshGeometry().then(() => {
          if (introductionWindow.active) {
            introductionWindow.reposition();
            return;
          }
          if (argv.includes("--expanded")) {
            const host = panels.primaryPanel();
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
          broadcast(channels.onLifecycle, eventName);
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
    hotkeys.release();
    outputVolumeWatcher?.stop();
    outputVolumeWatcher = undefined;
    microphoneRouteWatcher?.stop();
    microphoneRouteWatcher = undefined;
    mediaDuck.stop();
  });

  app.on("before-quit", (event) => {
    // The explicit Quit is the one thing that stops the Gateway: it is asked
    // to shut down and waited for, bounded, before this process leaves, so
    // no runtime work of Luke's continues after an intentional quit.
    if (!gatewayStopped && gatewayLauncher) {
      event.preventDefault();
      void stopGatewayOnce().finally(() => app.quit());
      return;
    }
    voiceWindow.closeForGood();
    if (localRuntime) void localRuntime.close();
    panels.clearCollapseTimers();
  });

  app.on("window-all-closed", () => app.quit());
}
