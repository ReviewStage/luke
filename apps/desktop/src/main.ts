import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  fixtureSnapshot,
  InMemorySessionRegistry,
  type NativeNotchGeometry,
  positionNotchWindow,
  SessionAttentionReviewer,
  type SessionProviderAdapter,
} from "@sidecar/core";
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
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { ClaudeCodeSessionAdapter } from "./claude-code-adapter";
import { CodexSessionAdapter } from "./codex-adapter";
import { ConductorSessionAdapter } from "./conductor-adapter";
import { CursorSessionAdapter } from "./cursor-adapter";
import { DevinSessionAdapter } from "./devin-adapter";
import { readMacScreenGeometry } from "./macos-screen-geometry";
import { openAiAttentionEvaluatorFromEnvironment } from "./openai-attention-evaluator";
import { SettingsStore } from "./settings-store";
import {
  type AppBootstrap,
  channels,
  type DisplayDiagnostic,
  type MicrophoneStatus,
  type SettingsUpdateResult,
  type WindowMode,
} from "./shared/contracts";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  type CredentialProviderId,
  isCredentialProviderId,
} from "./shared/credential-providers";

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
const SESSION_REFRESH_INTERVAL_MS = 5_000;
const sessionRegistry = new InMemorySessionRegistry();
// `directory` and the cipher are read lazily so the store can be declared before
// the Electron app is ready.
const settingsStore = new SettingsStore({
  directory: () => app.getPath("userData"),
  cipher: {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plainText) => safeStorage.encryptString(plainText),
    decrypt: (cipherText) => safeStorage.decryptString(cipherText),
  },
});
const conductorAdapter = new ConductorSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.CONDUCTOR),
});
const cursorAdapter = new CursorSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.CURSOR),
});
const devinAdapter = new DevinSessionAdapter({
  readApiKey: () => settingsStore.readApiKey(CREDENTIAL_PROVIDER_ID.DEVIN),
});
// Saving a key affects only the provider it belongs to, so this maps each
// credential to the one observer that reads it.
const adapterByCredentialProvider: ReadonlyMap<CredentialProviderId, SessionProviderAdapter> =
  new Map<CredentialProviderId, SessionProviderAdapter>([
    [CREDENTIAL_PROVIDER_ID.CONDUCTOR, conductorAdapter],
    [CREDENTIAL_PROVIDER_ID.CURSOR, cursorAdapter],
    [CREDENTIAL_PROVIDER_ID.DEVIN, devinAdapter],
  ]);
const sessionAdapters = [
  new ClaudeCodeSessionAdapter(),
  new CodexSessionAdapter(),
  conductorAdapter,
  cursorAdapter,
  devinAdapter,
] as const;
// A fixture run must stay deterministic and credential-free, so it never builds
// an evaluator — not just capture runs.
const attentionEvaluator = fixtureMode ? undefined : openAiAttentionEvaluatorFromEnvironment();
const attentionReviewer = attentionEvaluator
  ? new SessionAttentionReviewer({
      evaluator: attentionEvaluator,
      currentSession: (identity) => sessionRegistry.get(identity),
    })
  : undefined;
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
let sessionRefreshTimer: NodeJS.Timeout | undefined;
let collapseTimer: NodeJS.Timeout | undefined;
let sessionRefreshRunning = false;
let attentionReviewRunning = false;

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

/**
 * Resizes without AppKit's frame animation. An animated setBounds re-lays out
 * the renderer at a new viewport width on every frame — and its duration scales
 * with the distance moved, so a 482px growth ran far longer than the panel's
 * own motion. The window now snaps to the size the mode needs and the renderer
 * animates the capsule into the panel inside it, where the viewport is constant
 * and the work stays on the compositor.
 */
function positionPanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  const display = selectedDisplay();
  selectedDisplayId = display.id;
  const layout = layoutFor(display);
  panelWindow.setBounds({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
  });
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

/**
 * Brings the panel forward as the key window. An accessory app has no Dock
 * presence, so the app itself has to come forward before one of its windows can
 * take keyboard focus.
 */
function focusPanelWindow(): void {
  if (!panelWindow || panelWindow.isDestroyed() || captureMode) return;
  if (process.platform === "darwin") app.focus({ steal: true });
  panelWindow.show();
  panelWindow.focus();
}

/**
 * `--duration-exit` plus `--duration-shape` in
 * apps/desktop/src/renderer/styles/base.css: the content leaves, then the
 * surface closes on the spring, and only then may the window follow.
 */
const COLLAPSE_ANIMATION_MS = 550;

function collapseDelay(): number {
  if (captureMode) return 0;
  return systemPreferences.getAnimationSettings().prefersReducedMotion ? 0 : COLLAPSE_ANIMATION_MS;
}

/**
 * The two directions are sequenced differently, and the ordering lives here so
 * every caller gets it — the panel, the tray, and the motion recorder alike.
 * Growing needs the window first, or the panel has nowhere to unfold into.
 * Shrinking needs the capsule drawn first, or the window clips the panel out
 * from under its own collapse.
 */
function setWindowMode(mode: WindowMode, requestFocus: boolean): WindowMode {
  windowMode = mode;
  if (!panelWindow || panelWindow.isDestroyed()) return windowMode;

  const expanded = mode === "expanded";
  panelWindow.setFocusable(expanded && !captureMode);
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = undefined;
  }
  if (expanded) {
    positionPanel();
    panelWindow.webContents.send(channels.lifecycle, `mode:${mode}`);
  } else {
    panelWindow.webContents.send(channels.lifecycle, `mode:${mode}`);
    const delay = collapseDelay();
    if (delay === 0) positionPanel();
    else {
      collapseTimer = setTimeout(() => {
        collapseTimer = undefined;
        if (windowMode === "compact") positionPanel();
      }, delay);
    }
  }

  if (expanded && requestFocus && !captureMode) {
    focusPanelWindow();
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
  ipcMain.handle(channels.bootstrap, async (event): Promise<AppBootstrap> => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return {
      mode: windowMode,
      startPeeked,
      startInSlot,
      profile,
      fixture,
      captureMode,
      fixtureMode,
      packaged: app.isPackaged,
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      microphoneStatus: microphoneStatus(),
      display: displayDiagnostic(),
      sessions: fixtureMode ? [] : sessionRegistry.snapshot().sessions,
      settings: await settingsStore.snapshot(),
    };
  });

  ipcMain.handle(channels.setExpanded, (event, expanded: unknown, focus: unknown) => {
    if (!trustedSender(event) || typeof expanded !== "boolean") {
      throw new Error("Invalid window mode request");
    }
    return setWindowMode(expanded ? "expanded" : "compact", focus === true);
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

  // The renderer can replace or clear a provider's credential but never reads
  // it back; the reply reports only where each key now comes from.
  ipcMain.handle(
    channels.setProviderApiKey,
    async (event, providerId: unknown, apiKey: unknown): Promise<SettingsUpdateResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      // The provider list is fixed by this build, so an id outside it is a
      // malformed request rather than something the user can correct.
      if (!isCredentialProviderId(providerId)) throw new Error("Unknown credential provider");
      if (apiKey !== undefined && typeof apiKey !== "string") {
        throw new Error("Invalid API key request");
      }
      try {
        const result = await settingsStore.setApiKey(providerId, apiKey);
        // Only the provider whose key changed is affected, so the local
        // observers are left alone rather than re-crawling the filesystem on
        // every save.
        const adapter = adapterByCredentialProvider.get(providerId);
        if (!result.reason && adapter) void sessionRegistry.refresh(adapter);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await settingsStore.snapshot(),
          reason: "Could not save that API key on this system.",
        };
      }
    },
  );

  // Where to get a key is a question the panel cannot answer itself, so it
  // hands the question to the browser. The renderer names a provider rather
  // than an address: the pages Luke can open are the ones in the provider
  // registry, and no URL crosses this boundary.
  ipcMain.on(channels.openProviderApiKeys, (event, providerId: unknown) => {
    if (!trustedSender(event) || !isCredentialProviderId(providerId)) return;
    void shell.openExternal(CREDENTIAL_PROVIDERS[providerId].apiKeysUrl);
  });

  // The panel is normally shown without stealing focus. A text field cannot be
  // typed into that way, so the renderer asks for focus when it opens one.
  ipcMain.on(channels.focusPanel, (event) => {
    if (!trustedSender(event) || windowMode !== "expanded") return;
    focusPanelWindow();
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

async function refreshProviderSessions(): Promise<void> {
  if (fixtureMode || sessionRefreshRunning) return;
  sessionRefreshRunning = true;
  try {
    // Providers are observed concurrently and reported independently: the
    // registry commits each provider atomically, so one that is slow or failing
    // can neither delay nor cancel the others. A network provider would
    // otherwise hold up the local ones for as long as its requests take.
    await Promise.all(
      sessionAdapters.map(async (adapter) => {
        try {
          await sessionRegistry.refresh(adapter);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`Session observation failed (${adapter.provider.id}): ${message}\n`);
        }
      }),
    );
  } finally {
    sessionRefreshRunning = false;
  }
  // Attention review runs outside the observation guard so a slow model call
  // never delays the next provider snapshot.
  void reviewSessionAttention();
}

async function reviewSessionAttention(): Promise<void> {
  if (!attentionReviewer || attentionReviewRunning) return;
  attentionReviewRunning = true;
  try {
    for (const review of await attentionReviewer.review(sessionRegistry.list())) {
      sessionRegistry.setAttention(review, review.decision);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Attention review failed: ${message}\n`);
  } finally {
    attentionReviewRunning = false;
  }
}

function startSessionObservation(): void {
  if (fixtureMode) return;
  sessionRegistry.subscribe((snapshot) => {
    panelWindow?.webContents.send(channels.sessionsChanged, snapshot.sessions);
  });
  void refreshProviderSessions();
  sessionRefreshTimer = setInterval(() => {
    void refreshProviderSessions();
  }, SESSION_REFRESH_INTERVAL_MS);
  sessionRefreshTimer.unref();
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
      backgroundThrottling: false,
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

function trayMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      // The ellipsis is the macOS convention for an item that opens somewhere
      // rather than acting, and the accelerator is shown rather than registered:
      // Command-, belongs to whichever app is frontmost, so Luke claims it only
      // inside its own window, where the renderer handles it.
      //
      // No icon: a menu item takes a NativeImage sized in points, and the
      // system's named gear arrives at its natural size, which draws far too
      // large beside the text. Apple's own menu bar menus label these items
      // rather than picture them, so this follows them.
      label: "Settings…",
      accelerator: "CommandOrControl+,",
      registerAccelerator: false,
      click: () => {
        setWindowMode("expanded", true);
        panelWindow?.webContents.send(channels.lifecycle, "tab:settings");
      },
    },
    { type: "separator" },
    { label: "Quit Luke", role: "quit" },
  ]);
}

/**
 * Luke's face, as macOS wants a status item drawn: a template image, which is
 * pure black plus alpha and is recoloured by the system rather than by us, so it
 * follows the menu bar through light, dark, and the inverted highlight a press
 * draws. The `@2x` file beside it is picked up from the same call, which is what
 * keeps the item sharp on a Retina display.
 */
function trayImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(path.join(__dirname, "menubar", "lukeTemplate.png"));
  image.setTemplateImage(true);
  return image;
}

function createTray(): void {
  if (process.platform !== "darwin") return;
  const image = trayImage();
  tray = new Tray(image);
  // A status item that draws nothing is a status item no one can find, and this
  // one is the only way to reach Settings or to quit. If the artwork is ever
  // missing from a build, the name it used to carry stands in for it.
  if (image.isEmpty()) tray.setTitle("Luke");
  tray.setToolTip("Luke");
  // Clicking opens the menu and nothing else. The capsule is how the panel is
  // opened; a menu bar item that also toggled it made one of them a surprise.
  tray.setContextMenu(trayMenu());
}

function handleDisplayChange(): void {
  setTimeout(() => {
    refreshNativeGeometry();
    positionPanel();
  }, 100);
}

if (!app.requestSingleInstanceLock()) {
  // Luke runs as an accessory app, so a second launch otherwise exits silently
  // and looks like the launcher did nothing.
  process.stderr.write(
    "Luke is already running; the existing panel was refreshed instead of starting a second copy.\n",
  );
  app.quit();
} else {
  // A repeat launch is usually someone checking the notch capsule, so re-assert
  // the panel where it already is. Expanding hides the compact capsule, which is
  // the one thing the relaunch was meant to show. An explicit `--expanded` is a
  // stated intent rather than a side effect, so it is still honoured.
  app.on("second-instance", (_event, argv) => {
    refreshNativeGeometry();
    if (argv.includes("--expanded")) {
      setWindowMode("expanded", true);
      return;
    }
    positionPanel();
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.showInactive();
  });
  void app.whenReady().then(() => {
    if (process.platform === "darwin") app.setActivationPolicy("accessory");
    Menu.setApplicationMenu(null);
    refreshNativeGeometry();
    registerIpc();
    // Resolving settings touches the filesystem and the OS keychain. Starting it
    // here keeps that work off the renderer's first paint, which blocks on the
    // bootstrap reply.
    void settingsStore.snapshot();
    createPanel();
    configurePermissions();
    createTray();
    startSessionObservation();

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

app.on("before-quit", () => {
  if (sessionRefreshTimer) clearInterval(sessionRefreshTimer);
  if (collapseTimer) clearTimeout(collapseTimer);
});

app.on("window-all-closed", () => app.quit());
