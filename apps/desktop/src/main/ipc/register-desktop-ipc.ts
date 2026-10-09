import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, clipboard, ipcMain } from "electron";
import { channels } from "#shared/bridge";
import { ACT_KIND } from "#shared/messages/acts";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { type ActRows, createActRouter } from "../act-router";
import { type ReportHandlers, registerBridgeHost } from "../bridge-host";
import type { DesktopServices } from "../services/compose-desktop";
import { accountActRows } from "./account-session";
import { codingAgentActRows } from "./coding-agent-acts";
import { planningActRows } from "./planning-acts";
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
  const { config, state, telemetry, native, updates, operator, windows, notices, run } = services;
  const { launch } = config;
  const { panels, voiceWindow, hotkeys, dock } = windows;
  const recordProductEvent = telemetry.recordProductEvent;

  /**
   * The voice window's own dependencies, built once: the act rows and the
   * reports below are two readings of the same collaborators, and two objects
   * carrying the same closures would only invite them to drift.
   */
  const voiceRuntime = {
    panels,
    voiceWindow,
    state,
    setShortcutCapturing: (capturing: boolean) => hotkeys.setShortcutCapturing(capturing),
    openExternal: config.openExternal,
    liveDiagnostics: () => operator.host.liveDiagnostics(),
    liveSession: operator.host,
    recordProductEvent,
    recordAgentTrace: (trace: Parameters<typeof operator.host.recordAgentTrace>[0]) => {
      void run(operator.host.recordAgentTrace(trace));
    },
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
    }),
    ...windowSurfaceActRows({
      panels,
      requestMicrophone: () => native.requestMicrophone(),
      microphoneRoute: () => state.snapshot().audio.microphoneRoute,
      microphoneRouteWatcher: () => native.microphoneRouteWatcher(),
      recordProductEvent,
    }),
    ...voiceRuntimeActRows(voiceRuntime),
    ...planningActRows({
      host: operator.host,
      openExternal: config.openExternal,
      activePlanId: () => state.snapshot().planning.activePlanId,
      talkAboutPlan: (planId) => {
        voiceWindow.current()?.webContents.send(channels.onPlanningTalk, { planId });
      },
      voiceReady: () => {
        const snapshot = state.snapshot();
        return (
          snapshot.settings?.status.voiceAvailable === true &&
          snapshot.audio.microphoneStatus === MICROPHONE_STATUS.GRANTED
        );
      },
    }),
    ...codingAgentActRows({ host: operator.host, notices }),
    [ACT_KIND.UPDATE_CHECK]: () => updates.check(),
    [ACT_KIND.UPDATE_INSTALL]: () => updates.install(),
    [ACT_KIND.UPDATE_OPEN_RELEASE]: () => updates.openLatestRelease(),
    [ACT_KIND.UPDATE_OPEN_CHANGELOG]: () => updates.openChangelog(),
    [ACT_KIND.FEEDBACK_SEND]: ({ submission }) => telemetry.deliverFeedback(submission),
    [ACT_KIND.WINDOW_COPY_TEXT]: ({ words }) => clipboard.writeText(words),
  };

  const reports: ReportHandlers = {
    ...windowSurfaceReports({ recordProductEvent }),
    ...voiceRuntimeReports(voiceRuntime),
    // The development trace is the host's: a tapped wire event crosses to its
    // writer, which alone knows whether this run records anything.
    recordAgentTrace: (_context, trace) => {
      void run(operator.host.recordAgentTrace(trace));
    },
    notifyReady: async (context) => {
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
    }),
    router: createActRouter(rows),
    run,
    reports,
    /**
     * The document as one window stands, answered before anything is drawn
     * over it: the host read once so no window is handed a state it never
     * told, and the microphone taken afresh, because macOS's answer is its
     * own to move and moves while Luke runs. Every later reading of the same
     * document arrives on `app:state`.
     */
    snapshotFor: async (sender): Promise<AppStateSnapshot> => {
      await run(operator.readBootstrap());
      native.refreshMicrophoneStatus();
      return { ...state.snapshot(), window: windows.windowFactsFor(sender) };
    },
  });
}
