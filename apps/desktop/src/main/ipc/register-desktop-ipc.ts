import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BROWSER_LIVE_PORT_CHANNEL } from "@repo/features/browser-live-acts";
import { TERMINAL_PORT_CHANNEL } from "@repo/features/terminal-acts";
import {
  browserLiveProcedures,
  createActPortHandler,
  macShellProcedures,
  type PlatformActProcedures,
  portForwardProcedures,
  terminalProcedures,
} from "@repo/host/act-port";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { LEAVE } from "@repo/host/quit";
import type { WireBoundaryInput } from "@repo/wire";
import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  MessageChannelMain,
  nativeImage,
  type WebContents,
  webContents,
} from "electron";
import { type ReportHandlers, registerBridgeHost } from "../bridge-host";
import { installCli } from "../native/cli-install";
import { spawnMacShell } from "../native/mac-shell";
import type { DesktopServices } from "../services/compose-desktop";
import { windowPushes } from "../window/window-pushes";
import { cliProcedures } from "./cli-acts";
import { macTerminalProcedures } from "./mac-terminal-acts";
import { whenPageGone } from "./page-gone";
import { clientSettingSideEffects } from "./settings-side-effects";
import { updateProcedures } from "./update-acts";
import { windowSurfaceProcedures, windowSurfaceReports } from "./window-surface";

const STILL_WIDTH = 480;

const STILL_QUALITY = 70;

async function windowStill(
  sender: WebContents,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): Promise<string | null> {
  const image = await sender.capturePage(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    { stayHidden: true, stayAwake: true },
  );
  if (image.isEmpty()) return null;
  const scaled =
    image.getSize().width > STILL_WIDTH
      ? image.resize({ width: STILL_WIDTH, quality: "good" })
      : image;
  return `data:image/jpeg;base64,${scaled.toJPEG(STILL_QUALITY).toString("base64")}`;
}

function portTo(channel: string) {
  return (sender: WebContents, ticket: unknown) => {
    const { port1, port2 } = new MessageChannelMain();
    sender.postMessage(channel, ticket, [port2]);
    port1.start();
    return {
      post: (message: unknown) => port1.postMessage(message),
      onMessage: (listener: (message: WireBoundaryInput) => void) =>
        port1.on("message", (event) => listener(event.data)),
      close: () => port1.close(),
    };
  };
}

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
    colorCode,
    run,
    services: effectServices,
  } = services;
  const { launch } = config;
  const { panels } = windows;
  const recordProductEvent = telemetry.recordProductEvent;

  const platformProcedures: PlatformActProcedures<WebContents> = {
    ...browserLiveProcedures<WebContents>({
      host: operator.host,
      ports: {
        open: portTo(BROWSER_LIVE_PORT_CHANNEL),
        whenGone: whenPageGone,
      },
      createId: randomUUID,
      run,
    }),
    ...cliProcedures({ install: () => installCli(config.hostedServiceBaseUrl) }),
    ...macShellProcedures<WebContents>({
      mirror: (agentId) => operator.host.mirrorEnsure({ agentId }),
      spawn: spawnMacShell,
      ports: {
        open: portTo(TERMINAL_PORT_CHANNEL),
        whenGone: whenPageGone,
      },
      whenClosed: (contents, then) => void contents.once("destroyed", then),
      createId: randomUUID,
    }),
    ...macTerminalProcedures({
      home: os.homedir(),
      openInTerminal: (folder) =>
        execFile("/usr/bin/open", ["-a", "Terminal", folder], () => undefined),
      exists: (folder) => fs.existsSync(folder),
    }),
    ...portForwardProcedures<WebContents>({ host: operator.host }),
    ...terminalProcedures<WebContents>({
      host: operator.host,
      ports: {
        open: portTo(TERMINAL_PORT_CHANNEL),
        whenGone: whenPageGone,
      },
      createId: randomUUID,
      fork: (effect) => void run(effect),
    }),
    ...updateProcedures({ updates }),
    ...windowSurfaceProcedures({
      panels,
      requestMicrophone: () => native.requestMicrophone(),
      microphoneRoute: () => state.snapshot().audio.microphoneRoute,
      microphoneRouteWatcher: () => native.microphoneRouteWatcher(),
      recordProductEvent,
      openExternal: config.openExternal,
      copyText: (words) => clipboard.writeText(words),
      copyImage: (png) => {
        const image = nativeImage.createFromBuffer(Buffer.from(png, "base64"));
        if (image.isEmpty()) return false;
        clipboard.writeImage(image);
        return true;
      },
      captureStill: (sender, rect) => windowStill(sender, rect),
      tellUnsavedWork: services.unsavedWork.tell,
      tellMenuOffers: services.menuOffers.tell,
      showBuildLabel: windows.showBuildLabel,
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

  const reports: ReportHandlers = {
    ...windowSurfaceReports({ recordProductEvent }),
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
    senderOf: (sender) => ({ sender, panel: panels.owns(sender) }),
    actPort: createActPortHandler(
      {
        account: {
          host: operator.host,
          haltSessionReplay: operator.haltSessionReplay,
          resumeSessionReplay: operator.resumeSessionReplay,
          askBeforeSignOut: () => services.askBeforeLeaving(LEAVE.SIGN_OUT),
        },
        accountAsks: { host: operator.host },
        agentInbox: { host: operator.host },
        agents: { host: operator.host, notices },
        automations: { host: operator.host },
        chapters: { host: operator.host },
        installedSkills: { host: operator.host },
        integrations: { host: operator.host },
        macCommands: { host: operator.host },
        pushes: windowPushes,
        settings: {
          host: operator.host,
          reporterOf: (actor) => {
            const contents = webContents.getAllWebContents().find((open) => open === actor.sender);
            return contents === undefined ? undefined : windows.reporterOf(contents);
          },
          lastSettings: () => operator.settings(),
          sideEffects: clientSettingSideEffects({ applyLoginItem: windows.applyLoginItem }),
        },
        tasks: {
          host: operator.host,
          colorCode,
          openExternal: config.openExternal,
          serviceBaseUrl: config.hostedServiceBaseUrl,
        },
        workspaces: { host: operator.host, openExternal: config.openExternal },
      },
      platformProcedures,
    ),
    services: effectServices,
    reports,
    snapshotFor: async (sender): Promise<AppStateSnapshot> => {
      await run(operator.readBootstrap());
      native.refreshMicrophoneStatus();
      return windows.appStateFor(sender);
    },
  });
}
