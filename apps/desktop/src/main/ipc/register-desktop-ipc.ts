import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MAC_TERMINAL_PORT_CHANNEL } from "@luke/features/mac-terminal-wire";
import { TERMINAL_PORT_CHANNEL } from "@luke/features/terminal-acts";
import { highlightSnippet } from "@luke/host";
import { ACT_KIND } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { channels } from "@luke/host/bridge";
import { startMacTerminal } from "@luke/host/node";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { callInProgress, IDLE_VOICE_VIEW } from "@luke/voice/voice-view";
import { BrowserWindow, clipboard, dialog, ipcMain, MessageChannelMain } from "electron";
import { type ActRows, createActRouter } from "../act-router";
import { type ReportHandlers, registerBridgeHost } from "../bridge-host";
import type { DesktopServices } from "../services/compose-desktop";
import { accountActRows } from "./account-session";
import { automationActRows } from "./automation-acts";
import { avatarActRows, avatarReports } from "./avatar-acts";
import { codingAgentActRows } from "./coding-agent-acts";
import { integrationActRows } from "./integration-acts";
import { issueActRows } from "./issue-acts";
import { macTerminalActRows } from "./mac-terminal-acts";
import { settingsActRows } from "./settings-rows";
import { tasksActRows } from "./tasks-acts";
import { terminalActRows, whenPageGone } from "./terminal-acts";
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
  const {
    config,
    state,
    telemetry,
    native,
    updates,
    operator,
    windows,
    notices,
    testNotification,
    avatar,
    run,
  } = services;
  const { launch } = config;
  const { panels, voiceWindow, callWindow, hotkeys } = windows;
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
      applyLoginItem: windows.applyLoginItem,
      mediaDuck: native.mediaDuck,
    }),
    ...windowSurfaceActRows({
      panels,
      requestMicrophone: () => native.requestMicrophone(),
      microphoneRoute: () => state.snapshot().audio.microphoneRoute,
      microphoneRouteWatcher: () => native.microphoneRouteWatcher(),
      recordProductEvent,
      openExternal: config.openExternal,
      testNotification,
      saveFile: async (sender, name, text) => {
        const window = BrowserWindow.fromWebContents(sender);
        const options = { defaultPath: name };
        const chosen = await (window === null
          ? dialog.showSaveDialog(options)
          : dialog.showSaveDialog(window, options));
        if (chosen.canceled || chosen.filePath === undefined) return false;
        await fs.promises.writeFile(chosen.filePath, text, "utf8");
        return true;
      },
    }),
    ...voiceRuntimeActRows(voiceRuntime),
    ...avatarActRows({ avatar }),
    ...tasksActRows({
      host: operator.host,
      openExternal: config.openExternal,
      serviceBaseUrl: config.hostedServiceBaseUrl,
      activeTaskId: () => state.snapshot().tasks.activeTaskId,
      talkAboutTask: (taskId) => {
        voiceWindow.current()?.webContents.send(channels.onTasksTalk, { taskId });
      },
      voiceReady: () => {
        const snapshot = state.snapshot();
        return (
          snapshot.settings?.status.voiceAvailable === true &&
          snapshot.audio.microphoneStatus === MICROPHONE_STATUS.GRANTED
        );
      },
      callStanding: () => callInProgress(state.snapshot().voice.view ?? IDLE_VOICE_VIEW),
      colourCode: highlightSnippet,
    }),
    ...codingAgentActRows({ host: operator.host, notices }),
    ...macTerminalActRows({
      host: operator.host,
      stateRoot: config.stateRoot,
      ports: {
        open: (sender, ticket) => {
          const { port1, port2 } = new MessageChannelMain();
          sender.postMessage(MAC_TERMINAL_PORT_CHANNEL, ticket, [port2]);
          port1.start();
          return {
            post: (message) => port1.postMessage(message),
            onMessage: (listener) => port1.on("message", (event) => listener(event.data)),
            close: () => port1.close(),
          };
        },
        whenGone: whenPageGone,
      },
      start: startMacTerminal,
    }),
    ...terminalActRows({
      host: operator.host,
      ports: {
        open: (sender, ticket) => {
          const { port1, port2 } = new MessageChannelMain();
          sender.postMessage(TERMINAL_PORT_CHANNEL, ticket, [port2]);
          port1.start();
          return {
            post: (message) => port1.postMessage(message),
            onMessage: (listener) => port1.on("message", (event) => listener(event.data)),
            close: () => port1.close(),
          };
        },
        whenGone: whenPageGone,
      },
      createId: randomUUID,
      run,
    }),
    ...integrationActRows({ host: operator.host }),
    ...automationActRows({ host: operator.host }),
    ...issueActRows({ host: operator.host }),
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
    ...avatarReports({
      state,
      panel: panels,
      callWindow,
      voiceOwns: (sender) => voiceWindow.owns(sender),
    }),
    // The development trace is the host's: a tapped wire event crosses to its
    // writer, which alone knows whether this run records anything.
    recordAgentTrace: (_context, trace) => {
      void run(operator.host.recordAgentTrace(trace));
    },
    notifyReady: async (context) => {
      windows.panelReady();
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
      call: callWindow.owns(sender),
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
