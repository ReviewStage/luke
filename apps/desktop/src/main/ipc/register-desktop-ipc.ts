import fs from "node:fs";
import path from "node:path";
import { PRODUCT_CREDENTIAL_SOURCE, PRODUCT_EVENT } from "@sidecar/analytics";
import type { FeedbackSubmission } from "@sidecar/feedback";
import type { AppGuideSnapshot } from "@sidecar/guide";
import { INTRODUCTION_PEEK_FRESH_MS } from "@sidecar/host";
import { peekLocalSessions } from "@sidecar/providers";
import type { SpeechOutcome } from "@sidecar/realtime/speech";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";
import { BrowserWindow, clipboard, ipcMain } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { type BridgeContext, registerBridge, registerBridgeEntry } from "../register-bridge";
import type { DesktopServices } from "../services/compose-desktop";
import { createSettingsHandler } from "../settings-handler";
import { registerAccountSessionIpc } from "./account-session";
import { registerBrainIpc } from "./brain";
import { registerSessionActsIpc } from "./session-acts";
import { registerSettingsRowsIpc } from "./settings-rows";
import { registerVoiceRuntimeIpc } from "./voice-runtime";
import { registerWindowSurfaceIpc } from "./window-surface";

/**
 * Every channel the sandboxed renderers reach this process through, attached
 * once between the composition and its start: a window that loaded before its
 * channels were registered would meet an unhandled invoke, and the windows
 * open in the window service's own start.
 */
export function registerDesktopIpc(services: DesktopServices): void {
  const { config, state, telemetry, native, updates, operator, windows } = services;
  const { runMode, launch } = config;
  const { panels, voiceWindow, introductionWindow, hotkeys, dock, introductionMinter } = windows;
  const trustedSender = windows.trustedSender;
  const recordProductEvent = telemetry.recordProductEvent;

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
    snapshot: async () => operator.settings() ?? (await operator.host.settingsSnapshot()),
  });

  /**
   * The document as one window stands, answered before anything is drawn over
   * it: the host read once so no window is handed a state it never told, and
   * the microphone taken afresh, because macOS's answer is its own to move
   * and moves while Luke runs. Every later reading of the same document
   * arrives on `app:state`.
   */
  registerContextHandler(
    BRIDGE.requestAppState,
    async (context: BridgeContext): Promise<AppStateSnapshot> => {
      await operator.readBootstrap();
      native.refreshMicrophoneStatus();
      return { ...state.snapshot(), window: windows.windowFactsFor(context.sender) };
    },
  );
  // The voice window's appends to the conversation, carried to the host's
  // store under this window's opaque reporter, and relayed back to every
  // other panel's History by the host's change event.
  registerBridge(
    BRIDGE,
    {
      appendConversationHistory(context, entries) {
        return operator.host.appendHistory(entries, windows.reporterOf(context));
      },
    },
    { ipcMain, trustedSender },
  );
  registerContextHandler(
    BRIDGE.settleSpeech,
    (context: BridgeContext, id: string, outcome: SpeechOutcome) => {
      if (!voiceWindow.owns(context.sender)) return;
      void operator.host.settleSpeech(id, outcome);
    },
  );
  registerHandler(BRIDGE.skipCalendarOnboarding, () => operator.host.skipCalendarOnboarding());
  registerHandler(BRIDGE.completeCalendarOnboarding, () =>
    operator.host.completeCalendarOnboarding(),
  );
  registerHandler(BRIDGE.beginSupersetSignIn, () => operator.host.beginSupersetSignIn());
  registerHandler(BRIDGE.submitSupersetSignInCode, (code: string) =>
    operator.host.submitSupersetSignInCode(code),
  );
  registerHandler(BRIDGE.chooseSupersetOrganization, (slug: string) =>
    operator.host.chooseSupersetOrganization(slug),
  );
  registerHandler(BRIDGE.reopenSupersetSignIn, () => operator.host.reopenSupersetSignIn());
  registerHandler(BRIDGE.cancelSupersetSignIn, () => operator.host.cancelSupersetSignIn());
  registerHandler(BRIDGE.disconnectSuperset, () => operator.host.disconnectSuperset());

  registerAccountSessionIpc({
    ipcMain,
    trustedSender,
    host: operator.host,
    haltSessionReplay: operator.haltSessionReplay,
    resumeSessionReplay: operator.resumeSessionReplay,
  });

  registerWindowSurfaceIpc({
    ipcMain,
    trustedSender,
    panels,
    requestMicrophone: () => native.requestMicrophone(),
    microphoneRoute: () => state.snapshot().audio.microphoneRoute,
    microphoneRouteWatcher: () => native.microphoneRouteWatcher(),
    recordProductEvent,
  });

  registerSettingsRowsIpc({
    ipcMain,
    trustedSender,
    registerSettingHandler,
    host: operator.host,
    reporterOf: windows.reporterOf,
    lastSettings: () => operator.settings(),
    hotkeys,
    dock,
    applyLoginItem: windows.applyLoginItem,
    panels,
    mediaDuck: native.mediaDuck,
    recordProductEvent,
    openExternal: (url) => void config.openExternal(url),
  });

  registerHandler(BRIDGE.checkForUpdates, () => updates.check());
  registerHandler(BRIDGE.installUpdate, () => updates.install());
  registerHandler(BRIDGE.openLatestRelease, () => updates.openLatestRelease());
  registerHandler(BRIDGE.openChangelog, () => updates.openChangelog());

  registerVoiceRuntimeIpc({
    ipcMain,
    trustedSender,
    panels,
    voiceWindow,
    receiver: { markReady: (epoch) => operator.host.readyReceiver(epoch) },
    state,
    // The History Clear is Delete history on main: the recoverable deletion,
    // reported to the panel as refused only when the store took nothing.
    clearConversation: () => operator.operator.deleteHistory(MAIN_SESSION_KEY),
    setShortcutCapturing: (capturing) => hotkeys.setShortcutCapturing(capturing),
    openExternal: config.openExternal,
    // While the takeover stands and no voice stands on the host yet, the
    // introduction's bounded mint answers; the moment the account lands, the
    // host's own credential wins even before the takeover has faded.
    mintRealtimeCredential: async () => {
      if (operator.voiceAvailable()) return operator.host.mintRealtimeCredential();
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
      if (!operator.voiceAvailable() && introductionWindow.active) {
        return introductionMinter.diagnostics();
      }
      return (await operator.host.realtimeDiagnostics()) ?? introductionMinter.diagnostics();
    },
    recordProductEvent,
    // The development trace is the host's: a tapped wire event crosses to its
    // writer, which alone knows whether this run records anything.
    recordAgentTrace: (trace) => operator.host.recordAgentTrace(trace),
  });

  registerSessionActsIpc({
    ipcMain,
    trustedSender,
    performer: {
      openSession: (identity) => operator.host.openSession(identity),
      openSessionApplication: (identity, applicationId) =>
        operator.host.openSessionApplication(identity, applicationId),
      openSessionChange: (identity) => operator.host.openSessionChange(identity),
    },
  });
  registerBrainIpc({
    ipcMain,
    trustedSender,
    submitters: {
      panel: (sender) => panels.owns(sender),
      voice: (sender) => voiceWindow.owns(sender),
    },
    operator: operator.operator,
  });
  registerHandler(BRIDGE.reportAppGuide, (snapshot: AppGuideSnapshot) =>
    operator.reportGuide(snapshot),
  );
  registerHandler(BRIDGE.answerBrainAppAct, (requestId: string, answer: WireRecord) =>
    native.answerAppAct(requestId, answer),
  );

  registerHandler(BRIDGE.sendFeedback, (submission: FeedbackSubmission) =>
    telemetry.deliverFeedback(submission),
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
      await windows.finishIntroduction(given === true);
    },
  );

  registerContextHandler(BRIDGE.abandonIntroduction, (context: BridgeContext, reason: string) => {
    if (!introductionWindow.owns(context.sender)) return;
    config.report(`Introduction abandoned: ${reason}`);
    void windows.abandonIntroduction();
  });

  registerContextHandler(BRIDGE.introductionMounted, (context: BridgeContext) => {
    if (!introductionWindow.owns(context.sender)) return;
    windows.introductionMounted();
  });

  registerHandler(BRIDGE.copyText, (words: string) => clipboard.writeText(words));

  registerHandler(BRIDGE.quit, () => config.quit());

  registerContextHandler(BRIDGE.notifyReady, async (context: BridgeContext) => {
    windows.notePanelReady(context);
    if (!launch.captureOutput) return;
    const window = BrowserWindow.fromWebContents(context.sender);
    if (!window || window.isDestroyed()) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
    const image = await window.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    const destination = path.resolve(launch.captureOutput);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, image.toPNG());
    process.stdout.write(`Electron evidence: ${destination}\n`);
    config.quit();
  });
}
