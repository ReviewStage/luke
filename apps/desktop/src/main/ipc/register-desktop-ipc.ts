import fs from "node:fs";
import path from "node:path";
import { INTRODUCTION_PEEK_FRESH_MS } from "@sidecar/host";
import { peekLocalSessions } from "@sidecar/providers";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { BrowserWindow, clipboard, ipcMain } from "electron";
import { ACT_KIND } from "#shared/messages/acts";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { type ActRows, createActRouter } from "../act-router";
import { type ReportHandlers, registerBridgeHost } from "../bridge-host";
import type { DesktopServices } from "../services/compose-desktop";
import { accountActRows } from "./account-session";
import { brainActRows, brainReports } from "./brain";
import { sessionActRows } from "./session-acts";
import { settingsActRows } from "./settings-rows";
import { voiceRuntimeActRows, voiceRuntimeReports } from "./voice-runtime";
import { windowSurfaceActRows, windowSurfaceReports } from "./window-surface";

/**
 * Every channel the sandboxed renderers reach this process through, composed
 * once and attached between the composition and its start: a window that
 * loaded before its channels were registered would meet an unhandled invoke,
 * and the windows open in the window service's own start.
 *
 * What is composed here is the act table — one row per kind, gathered from the
 * files that own each concern and total by its type — and the reports beside
 * it. Nothing else registers IPC.
 */
export function registerDesktopIpc(services: DesktopServices): void {
  const { config, state, telemetry, native, updates, operator, windows } = services;
  const { runMode, launch } = config;
  const { panels, voiceWindow, hotkeys, dock, introductionSession } = windows;
  const recordProductEvent = telemetry.recordProductEvent;

  /**
   * The voice window's own dependencies, built once: the act rows and the
   * reports below are two readings of the same collaborators, and two objects
   * carrying the same closures would only invite them to drift.
   */
  const voiceRuntime = {
    panels,
    voiceWindow,
    receiver: { markReady: (epoch: number) => operator.host.readyReceiver(epoch) },
    state,
    // The Conversation Clear is Delete conversation on main: the recoverable
    // reported to the panel as refused only when the store took nothing.
    clearConversation: () => operator.operator.deleteConversation(MAIN_SESSION_KEY),
    setShortcutCapturing: (capturing: boolean) => hotkeys.setShortcutCapturing(capturing),
    openExternal: config.openExternal,
    liveDiagnostics: () => operator.host.liveDiagnostics(),
    liveSession: operator.host,
    recordProductEvent,
    recordAgentTrace: (trace: Parameters<typeof operator.host.recordAgentTrace>[0]) =>
      operator.host.recordAgentTrace(trace),
  };

  const rows: ActRows = {
    ...accountActRows({
      host: operator.host,
      haltSessionReplay: operator.haltSessionReplay,
      resumeSessionReplay: operator.resumeSessionReplay,
    }),
    ...settingsActRows({
      host: operator.host,
      reporterOf: windows.reporterOf,
      lastSettings: () => operator.settings(),
      hotkeys,
      dock,
      applyLoginItem: windows.applyLoginItem,
      panels,
      mediaDuck: native.mediaDuck,
      openExternal: (url) => void config.openExternal(url),
    }),
    ...sessionActRows({
      performer: {
        openSession: (identity) => operator.host.openSession(identity),
        openSessionApplication: (identity, applicationId) =>
          operator.host.openSessionApplication(identity, applicationId),
        openSessionChange: (identity) => operator.host.openSessionChange(identity),
      },
      writes: {
        sendMessage: (identity, text) => operator.host.sendSessionMessage(identity, text),
        executeControl: (identity, controlId) =>
          operator.host.executeSessionControl(identity, controlId),
      },
    }),
    ...windowSurfaceActRows({
      panels,
      requestMicrophone: () => native.requestMicrophone(),
      microphoneRoute: () => state.snapshot().audio.microphoneRoute,
      microphoneRouteWatcher: () => native.microphoneRouteWatcher(),
      recordProductEvent,
    }),
    ...voiceRuntimeActRows(voiceRuntime),
    ...brainActRows({ operator: operator.operator, isVoice: (s) => voiceWindow.owns(s) }),
    [ACT_KIND.SUPERSET_BEGIN_SIGN_IN]: () => operator.host.beginSupersetSignIn(),
    [ACT_KIND.SUPERSET_SUBMIT_CODE]: ({ code }) => operator.host.submitSupersetSignInCode(code),
    [ACT_KIND.SUPERSET_CHOOSE_ORGANIZATION]: ({ slug }) =>
      operator.host.chooseSupersetOrganization(slug),
    [ACT_KIND.SUPERSET_REOPEN_SIGN_IN]: () => operator.host.reopenSupersetSignIn(),
    [ACT_KIND.SUPERSET_CANCEL_SIGN_IN]: () => operator.host.cancelSupersetSignIn(),
    [ACT_KIND.SUPERSET_DISCONNECT]: () => operator.host.disconnectSuperset(),
    [ACT_KIND.UPDATE_CHECK]: () => updates.check(),
    [ACT_KIND.UPDATE_INSTALL]: () => updates.install(),
    [ACT_KIND.UPDATE_OPEN_RELEASE]: () => updates.openLatestRelease(),
    [ACT_KIND.UPDATE_OPEN_CHANGELOG]: () => updates.openChangelog(),
    [ACT_KIND.ONBOARDING_SKIP_CALENDAR]: () => operator.host.skipCalendarOnboarding(),
    [ACT_KIND.ONBOARDING_COMPLETE_CALENDAR]: () => operator.host.completeCalendarOnboarding(),
    // The introduction's one-shot keyless read of this machine's local
    // sessions: the same read-only observe every pass runs, once, with no hook
    // registration and no credential, answered only while the takeover holds
    // the panel that is asking.
    [ACT_KIND.INTRODUCTION_PEEK_SESSIONS]: async (_payload, { introduction }) => {
      if (!introduction || !runMode.observesProviders) return [];
      const now = Date.now();
      const sessions = await peekLocalSessions();
      return sessions.filter(
        (session) => now - session.lastActivityAt <= INTRODUCTION_PEEK_FRESH_MS,
      );
    },
    // The takeover's own session, answered only while it holds the panel and
    // only on a run that reaches the network at all: the offer goes to the
    // accountless voice service with the titles the takeover may name, and
    // the hang-up closes the connection the service reads as the end.
    [ACT_KIND.INTRODUCTION_CREATE_SESSION]: ({ sdp, titles }, { introduction }) =>
      introduction && runMode.sendsNetwork
        ? introductionSession.open({ sdp, titles })
        : Promise.resolve(undefined),
    [ACT_KIND.INTRODUCTION_END_SESSION]: (_payload, { introduction }) => {
      if (introduction) introductionSession.end();
    },
    [ACT_KIND.INTRODUCTION_COMPLETE]: async ({ given }, { introduction }) => {
      if (!introduction) return;
      await windows.endIntroduction(given === true);
    },
    [ACT_KIND.INTRODUCTION_ABANDON]: ({ reason }, { introduction }) => {
      if (!introduction) return;
      config.report(`Introduction abandoned: ${reason}`);
      void windows.endIntroduction(false);
    },
    [ACT_KIND.FEEDBACK_SEND]: ({ submission }) => telemetry.deliverFeedback(submission),
    [ACT_KIND.WINDOW_COPY_TEXT]: ({ words }) => clipboard.writeText(words),
    [ACT_KIND.WINDOW_QUIT]: () => config.quit(),
  };

  const reports: ReportHandlers = {
    ...windowSurfaceReports({ recordProductEvent }),
    ...voiceRuntimeReports(voiceRuntime),
    ...brainReports({ operator: operator.operator, isVoice: (s) => voiceWindow.owns(s) }),
    // The voice window's appends to the conversation, carried to the host's
    // store under this window's opaque reporter, and relayed back to every
    // other panel's Conversation by the host's change event.
    appendConversationLines: (context, entries) =>
      operator.host.appendConversation(entries, windows.reporterOf(context.sender)),
    settleSpeech: (context, id, outcome) => {
      if (!voiceWindow.owns(context.sender)) return;
      void operator.host.settleSpeech(id, outcome);
    },
    reportAppGuide: (_context, snapshot) => operator.reportGuide(snapshot),
    answerBrainAppAction: (_context, requestId, answer) =>
      native.answerAppAction(requestId, answer),
    // The development trace is the host's: a tapped wire event crosses to its
    // writer, which alone knows whether this run records anything.
    recordAgentTrace: (_context, trace) => operator.host.recordAgentTrace(trace),
    notifyReady: async (context) => {
      windows.notePanelReady(context.sender);
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
    },
  };

  registerBridgeHost({
    ipcMain,
    trustedSender: windows.trustedSender,
    senderOf: (sender) => ({
      sender,
      panel: panels.owns(sender),
      voice: voiceWindow.owns(sender),
      // The introduction is a fullscreen mode of the panel rather than a
      // window of its own, so what a takeover-only row is owed is the
      // standing the document holds and the panel asking under it.
      introduction: windows.introductionPlaying() && panels.owns(sender),
    }),
    router: createActRouter(rows),
    reports,
    /**
     * The document as one window stands, answered before anything is drawn
     * over it: the host read once so no window is handed a state it never
     * told, and the microphone taken afresh, because macOS's answer is its
     * own to move and moves while Luke runs. Every later reading of the same
     * document arrives on `app:state`.
     */
    snapshotFor: async (sender): Promise<AppStateSnapshot> => {
      await operator.readBootstrap();
      native.refreshMicrophoneStatus();
      return { ...state.snapshot(), window: windows.windowFactsFor(sender) };
    },
  });
}
