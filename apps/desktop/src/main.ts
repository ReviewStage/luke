import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureSnapshot, type NativeNotchGeometry, positionNotchWindow } from "@sidecar/core";
import {
  app,
  BrowserWindow,
  type Display,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  session,
  systemPreferences,
  Tray,
} from "electron";
import { readMacScreenGeometry } from "./macos-screen-geometry";
import {
  type AppBootstrap,
  channels,
  type DisplayDiagnostic,
  type MicrophoneStatus,
  type WindowMode,
} from "./shared/contracts";

const captureOutput = argumentValue("--capture-evidence");
const profile = argumentValue("--profile") ?? "idle";
const fixtureName = argumentValue("--fixture") ?? "smoke";
const fixture = fixtureSnapshot(fixtureName);
const captureMode = captureOutput !== undefined;
let windowMode: WindowMode = captureMode
  ? process.argv.includes("--compact")
    ? "compact"
    : "expanded"
  : process.argv.includes("--expanded")
    ? "expanded"
    : "compact";
let panelWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let selectedDisplayId: number | undefined;
let nativeScreens = new Map<number, NativeNotchGeometry>();

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function selectedDisplay(): Display {
  const displays = screen.getAllDisplays();
  return displays.find((display) => display.id === selectedDisplayId) ?? screen.getPrimaryDisplay();
}

function layoutFor(display = selectedDisplay()) {
  return positionNotchWindow(display, windowMode, nativeScreens.get(display.id));
}

function displayDiagnostic(display = selectedDisplay()): DisplayDiagnostic {
  const layout = layoutFor(display);
  return {
    id: display.id,
    label: display.label || `Display ${display.id}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    notch: layout.notch,
  };
}

function refreshNativeGeometry(): void {
  nativeScreens = readMacScreenGeometry();
  if (captureMode) {
    const display = screen.getPrimaryDisplay();
    nativeScreens.set(display.id, {
      displayId: display.id,
      safeAreaTop: 38,
      notchWidth: 210,
      hasNotch: true,
      source: "fixture",
    });
  }
}

function positionPanel(animate = false): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  const display = selectedDisplay();
  selectedDisplayId = display.id;
  const layout = layoutFor(display);
  panelWindow.setBounds(
    {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    },
    animate && process.platform === "darwin" && !captureMode,
  );
  panelWindow.webContents.send(channels.displayChanged, displayDiagnostic(display));
}

function configurePanelBehavior(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, "pop-up-menu");
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    window.setHiddenInMissionControl(true);
    window.setWindowButtonVisibility(false);
  }
}

function setWindowMode(mode: WindowMode, requestFocus: boolean): WindowMode {
  windowMode = mode;
  if (!panelWindow || panelWindow.isDestroyed()) return windowMode;

  const expanded = mode === "expanded";
  panelWindow.setFocusable(expanded && !captureMode);
  positionPanel(true);
  panelWindow.webContents.send(channels.lifecycle, `mode:${mode}`);

  if (expanded && requestFocus && !captureMode) {
    panelWindow.show();
    panelWindow.focus();
  } else {
    panelWindow.showInactive();
  }
  return windowMode;
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

function rendererUrl(): string {
  return pathToFileURL(path.join(__dirname, "renderer", "index.html")).href;
}

function trustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? event.sender.getURL();
  return url === rendererUrl();
}

function registerIpc(): void {
  ipcMain.handle(channels.bootstrap, (event): AppBootstrap => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return {
      mode: windowMode,
      profile,
      fixture,
      packaged: app.isPackaged,
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      microphoneStatus: microphoneStatus(),
      display: displayDiagnostic(),
    };
  });

  ipcMain.handle(channels.setExpanded, (event, expanded: unknown) => {
    if (!trustedSender(event) || typeof expanded !== "boolean") {
      throw new Error("Invalid window mode request");
    }
    return setWindowMode(expanded ? "expanded" : "compact", false);
  });

  ipcMain.on(channels.setPointerInterception, (event, interceptsPointer: unknown) => {
    if (!trustedSender(event) || typeof interceptsPointer !== "boolean") {
      return;
    }
    panelWindow?.setIgnoreMouseEvents(!interceptsPointer, { forward: true });
  });

  ipcMain.handle(channels.requestMicrophone, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return requestMicrophone();
  });

  ipcMain.on(channels.quit, (event) => {
    if (trustedSender(event)) app.quit();
  });

  ipcMain.on(channels.rendererReady, async (event) => {
    if (!trustedSender(event) || !captureOutput || !panelWindow) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
    const image = await panelWindow.webContents.capturePage(undefined, {
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
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, _origin, details) =>
      webContents === panelWindow?.webContents &&
      permission === "media" &&
      details.mediaType === "audio",
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      callback(
        webContents === panelWindow?.webContents &&
          permission === "media" &&
          mediaTypes.length > 0 &&
          mediaTypes.every((mediaType: string) => mediaType === "audio"),
      );
    },
  );
}

function createPanel(): void {
  const display = screen.getPrimaryDisplay();
  selectedDisplayId = display.id;
  const layout = layoutFor(display);

  panelWindow = new BrowserWindow({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    title: "Luke",
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: windowMode === "expanded" && !captureMode,
    acceptFirstMouse: true,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !captureMode,
      backgroundThrottling: true,
    },
  });

  configurePanelBehavior(panelWindow);
  panelWindow.setIgnoreMouseEvents(true, { forward: true });
  panelWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  panelWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl()) event.preventDefault();
  });
  panelWindow.once("ready-to-show", () => {
    if (!captureMode) panelWindow?.showInactive();
  });
  panelWindow.on("closed", () => {
    panelWindow = undefined;
  });
  void panelWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function createTrayImage(): Electron.NativeImage {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">',
    '<path fill="white" d="M2 10h2V8H2v2Zm3 3h2V5H5v8Zm3 3h2V2H8v14Zm3-2h2V4h-2v10Zm3-4h2V8h-2v2Z"/>',
    "</svg>",
  ].join("");
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
  image.setTemplateImage(true);
  return image;
}

function createTray(): void {
  if (process.platform !== "darwin") return;
  tray = new Tray(createTrayImage());
  tray.setToolTip("Luke");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show notch capsule",
        click: () => setWindowMode("compact", false),
      },
      {
        label: "Show expanded panel",
        click: () => setWindowMode("expanded", true),
      },
      {
        label: "Start microphone",
        click: () => {
          setWindowMode("expanded", true);
          panelWindow?.webContents.send(channels.startMicrophone);
        },
      },
      {
        label: "Re-read display geometry",
        click: () => {
          refreshNativeGeometry();
          positionPanel();
        },
      },
      { type: "separator" },
      { label: "Quit Luke", role: "quit" },
    ]),
  );
  tray.on("click", () => {
    setWindowMode(windowMode === "compact" ? "expanded" : "compact", true);
  });
}

function handleDisplayChange(): void {
  setTimeout(() => {
    refreshNativeGeometry();
    positionPanel();
  }, 100);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => setWindowMode("expanded", true));
  void app.whenReady().then(() => {
    if (process.platform === "darwin") app.setActivationPolicy("accessory");
    Menu.setApplicationMenu(null);
    refreshNativeGeometry();
    registerIpc();
    createPanel();
    configurePermissions();
    createTray();

    screen.on("display-added", handleDisplayChange);
    screen.on("display-removed", handleDisplayChange);
    screen.on("display-metrics-changed", handleDisplayChange);
    for (const eventName of ["resume", "unlock-screen", "user-did-become-active"] as const) {
      const handlePowerEvent = () => {
        handleDisplayChange();
        panelWindow?.webContents.send(channels.lifecycle, eventName);
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

app.on("window-all-closed", () => app.quit());
