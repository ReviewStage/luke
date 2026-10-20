import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAC_TERMINAL_PORT_CHANNEL } from "@luke/features/mac-terminal-wire";
import { TERMINAL_PORT_CHANNEL } from "@luke/features/terminal-acts";
import { highlightSnippet } from "@luke/host";
import { createActPortHandler, type PlatformActProcedures } from "@luke/host/act-port";
import { createActRouter } from "@luke/host/act-router";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { PUSH } from "@luke/host/contract";
import { startMacTerminal, worktreesRoot } from "@luke/host/node";
import { EXPERIMENT, experimentOn, NO_EXPERIMENTS } from "@luke/settings";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { callInProgress, IDLE_VOICE_VIEW } from "@luke/voice/voice-view";
import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  MessageChannelMain,
  type WebContents,
  webContents,
} from "electron";
import { type ReportHandlers, registerBridgeHost } from "../bridge-host";
import type { DesktopServices } from "../services/compose-desktop";
import { createBrowserViews } from "../window/browser-views";
import { HOTKEY_RANK } from "../window/hotkey-registrar";
import { windowPushes } from "../window/window-pushes";
import { avatarProcedures, avatarReports } from "./avatar-acts";
import { browserProcedures } from "./browser-acts";
import { macTerminalProcedures } from "./mac-terminal-acts";
import { clientSettingSideEffects } from "./settings-side-effects";
import { terminalProcedures, whenPageGone } from "./terminal-acts";
import { updateProcedures } from "./update-acts";
import { voiceRuntimeProcedures, voiceRuntimeReports } from "./voice-runtime";
import { windowSurfaceProcedures, windowSurfaceReports } from "./window-surface";

/**
 * Every channel the sandboxed renderers reach this process through, composed
 * once and attached between the composition and its start: a window that
 * loaded before its channels were registered would meet an unhandled invoke,
 * and the windows open in the window service's own start.
 *
 * What is composed here is the act port — the host's procedures, handed what
 * they reach of this process, beside the procedures only Electron can answer,
 * total by their type together — and the reports beside it. Nothing else registers IPC.
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
    services: effectServices,
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

  // A Browser tab's page is told to the panel that opened it alone, and goes with that panel's page.
  const browserViews = createBrowserViews({
    tellPage: (sender, page) => windowPushes.push(sender, PUSH.BROWSER_STATE, page),
    tellKey: (sender, key) => windowPushes.push(sender, PUSH.BROWSER_KEY, key),
    tellFocus: (sender, focus) => windowPushes.push(sender, PUSH.BROWSER_FOCUS, focus),
    whenGone: whenPageGone,
  });

  // The acts main answers itself on the act port: its windows', ports', and
  // system's, the ones only it can answer.
  const platformProcedures: PlatformActProcedures<WebContents> = {
    ...avatarProcedures({ avatar }),
    ...browserProcedures({
      views: browserViews,
      experimentOn: () =>
        experimentOn(state.snapshot().settings?.experiments ?? NO_EXPERIMENTS, EXPERIMENT.BROWSER),
    }),
    ...macTerminalProcedures({
      host: operator.host,
      worktreesRoot: worktreesRoot(os.homedir()),
      openInTerminal: (folder) =>
        execFile("/usr/bin/open", ["-a", "Terminal", folder], () => undefined),
      exists: (folder) => fs.existsSync(folder),
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
    ...terminalProcedures({
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
    ...updateProcedures({ updates }),
    ...voiceRuntimeProcedures(voiceRuntime),
    ...windowSurfaceProcedures({
      panels,
      requestMicrophone: () => native.requestMicrophone(),
      microphoneRoute: () => state.snapshot().audio.microphoneRoute,
      microphoneRouteWatcher: () => native.microphoneRouteWatcher(),
      recordProductEvent,
      openExternal: config.openExternal,
      testNotification,
      copyText: (words) => clipboard.writeText(words),
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
      deliverFeedback: (submission) => telemetry.deliverFeedback(submission),
    }),
  };

  // `app:act` carries no act now that every one rides the act port; it
  // answers each as unknown until the channel is taken out.
  const router = createActRouter<WebContents>({});

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
    router,
    run,
    actPort: createActPortHandler(
      {
        account: {
          host: operator.host,
          haltSessionReplay: operator.haltSessionReplay,
          resumeSessionReplay: operator.resumeSessionReplay,
        },
        accountAsks: { host: operator.host },
        agentInbox: { host: operator.host },
        agents: { host: operator.host, notices },
        automations: { host: operator.host },
        factory: { host: operator.host },
        integrations: { host: operator.host },
        issues: { host: operator.host },
        pushes: windowPushes,
        settings: {
          host: operator.host,
          // The port names its window as an unknown sender; only a window of
          // this process's own is one the reporter is minted for.
          reporterOf: (actor) => {
            const contents = webContents.getAllWebContents().find((open) => open === actor.sender);
            return contents === undefined ? undefined : windows.reporterOf(contents);
          },
          lastSettings: () => operator.settings(),
          sideEffects: clientSettingSideEffects({
            hotkeys,
            applyLoginItem: windows.applyLoginItem,
            mediaDuck: native.mediaDuck,
          }),
          stopChordHolder: (chord) =>
            hotkeys.reserve(chord, HOTKEY_RANK.STOP) === HOTKEY_RANK.TALK ? "talk" : undefined,
        },
        tasks: {
          host: operator.host,
          colourCode: highlightSnippet,
          openExternal: config.openExternal,
          serviceBaseUrl: config.hostedServiceBaseUrl,
          activeTaskId: () => state.snapshot().tasks.activeTaskId,
          talkAboutTask: (taskId) => {
            const voice = voiceWindow.current();
            if (voice) windowPushes.push(voice.webContents, PUSH.TASKS_TALK, { taskId });
          },
          voiceReady: () => {
            const snapshot = state.snapshot();
            return (
              snapshot.settings?.status.voiceAvailable === true &&
              snapshot.audio.microphoneStatus === MICROPHONE_STATUS.GRANTED
            );
          },
          callStanding: () => callInProgress(state.snapshot().voice.view ?? IDLE_VOICE_VIEW),
        },
        taskIssues: { host: operator.host },
        workspaces: { host: operator.host, openExternal: config.openExternal },
      },
      platformProcedures,
    ),
    services: effectServices,
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
