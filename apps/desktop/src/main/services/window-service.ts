import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { Effect } from "effect";
import {
  app,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  powerMonitor,
  screen,
  session,
  type WebContents,
} from "electron";
import { channels } from "#shared/bridge";
import type { AppHotkeysSlice, AppStateSnapshot, AppWindowFacts } from "#shared/messages/app-state";
import { WINDOW_ROLE } from "#shared/messages/session";
import type { AgentPlace } from "../agent-notices";
import type { AppStateStore } from "../app-state";
import { DockPresence } from "../window/dock-presence";
import { HOTKEY_RANK, HotkeyRegistrar } from "../window/hotkey-registrar";
import { PanelManager } from "../window/panel-manager";
import { VoiceWindow } from "../window/voice-window";
import type { DesktopConfig } from "./desktop-config";
import type { NativeNode } from "./native-node";
import type { OperatorClient } from "./operator-client";
import type { DesktopService } from "./service";

/** How long a display change is let settle before the panels are laid out over it. */
const DISPLAY_SETTLE_MS = 100;

export interface WindowServiceDependencies {
  config: DesktopConfig;
  /** What the windows are told from, and where what this service holds of it is written. */
  state: AppStateStore;
  native: NativeNode;
  operator: OperatorClient;
  /** Every operator effect this service reads, run on the launch's own runtime. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
  /**
   * Whether the launch this start belongs to still stands. False from the
   * moment a Quit is asked for, which is what every wait below re-checks: a
   * start suspended on one of its own awaits must not resume into opening a
   * window and re-claiming keys the teardown has already given back.
   */
  launchStanding: () => boolean;
}

export interface WindowService extends DesktopService {
  readonly panels: PanelManager;
  readonly voiceWindow: VoiceWindow;
  readonly hotkeys: HotkeyRegistrar;
  readonly dock: DockPresence;
  /**
   * One `app:state` per window, each composed with that window's own facts.
   * The one place the document becomes a push, so what a window is told and
   * what `app:state-request` answers it are the same document read twice.
   */
  publishAppState: () => void;
  /**
   * What one window answers for and the document cannot: which surface it
   * draws, how big it stands, and the display under it. Decided here by which
   * window asked.
   */
  windowFactsFor: (sender: WebContents) => AppWindowFacts;
  /** Hands a payload to the voice window alone, the one peer of the host's live session. */
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
  /** Asks the panels to open a plan on one agent's tab: a notification's click. */
  showAgent: (place: AgentPlace) => void;
  /**
   * The panel window coming forward or going behind, for as long as the
   * subscription stands. The hidden voice window is never the key window, so
   * only the panels are reported.
   */
  onPanelFocusChanged: (listener: (focused: boolean) => void) => () => void;
  /**
   * The opaque name one window's writes travel to the host under. It names
   * nothing about the window to anyone else, and the host records it beside
   * the change it produced.
   */
  reporterOf: (sender: WebContents) => string;
  /** Only this build's own renderer may reach a bridge entry. */
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  applyLoginItem: (openAtLogin: boolean) => void;
  reapplyTalkHotkey: () => void;
  recycleVoiceWindow: () => void;
}

/**
 * Everything this process draws or claims from the machine on the windows'
 * behalf: the panel, the hidden voice window, the keys, the Dock, the login
 * item, the media permissions, and the display and power changes the panel
 * answers.
 * It is the one concern that opens a window, and it opens none until `start`.
 */
export function createWindowService(dependencies: WindowServiceDependencies): WindowService {
  const { config, state, native, operator, run, launchStanding } = dependencies;
  const { runMode } = config;

  const reporters = new WeakMap<WebContents, string>();
  function reporterOf(sender: WebContents): string {
    const held = reporters.get(sender);
    if (held) return held;
    const minted = randomUUID();
    reporters.set(sender, minted);
    return minted;
  }

  const preloadPath = path.join(config.resourceDirectory, "preload.js");
  const rendererHtmlPath = path.join(config.resourceDirectory, "renderer", "index.html");
  const rendererUrl = pathToFileURL(rendererHtmlPath).href;
  // The hidden voice window loads the panels' bundle from a document of its
  // own, mounting what `windowFactsFor`'s role says. Both documents are files
  // this build wrote into the resource directory, and the pair is the whole
  // of what any window here may navigate to or speak from.
  const voiceHtmlPath = path.join(config.resourceDirectory, "renderer", "voice.html");
  const voiceUrl = pathToFileURL(voiceHtmlPath).href;

  const panels = new PanelManager({
    runMode,
    mediaDuck: native.mediaDuck,
    preloadPath,
    rendererHtmlPath,
    rendererUrl,
    onAllClosed: () => config.quit(),
    // A window's mode or display moved without any slice of the document
    // moving, and both ride the snapshot a window is handed: the document is
    // re-announced so every window is handed one again.
    onWindowFactsChanged: () => state.touch(),
  });
  /** The hidden window that holds the live conversation. */
  const voiceWindow = new VoiceWindow({
    runMode,
    preloadPath,
    rendererHtmlPath: voiceHtmlPath,
    rendererUrl: voiceUrl,
    onGone: (reason) => {
      config.report(`Voice window replaced: ${reason}`);
      // The window that held the exchange is gone, so what every panel draws
      // in its place is an idle voice; the document says so by holding no
      // view at all.
      state.update({ voice: {} });
      panels.setVoiceExchange(false);
    },
    onGaveUp: (reason) => {
      config.report(`Voice window abandoned: ${reason}`);
    },
  });
  const voiceWindowWanted = runMode.registersGlobalKeys || runMode.sendsNetwork;

  function raiseVoiceWindow(): void {
    if (voiceWindowWanted && panels.standing > 0) voiceWindow.open();
  }

  /** The one place a payload crosses to a window, and the one assertion that says why. */
  function sendTo<Payload>(sender: WebContents, channel: string, payload: Payload): void {
    // SAFETY: Main-process sends carry structured-clone snapshots produced for channels fixed by this build.
    sender.send(channel, payload as UnparsedWireValue);
  }

  function broadcast<Payload>(channel: string, payload: Payload, except?: WebContents): void {
    panels.broadcast(channel, payload, except);
    const voice = voiceWindow.current();
    if (!voice || voice.webContents === except) return;
    sendTo(voice.webContents, channel, payload);
  }

  function windowFactsFor(sender: WebContents): AppWindowFacts {
    if (voiceWindow.owns(sender)) {
      return { role: WINDOW_ROLE.VOICE, mode: panels.initialMode };
    }
    const displayId = panels.displayIdFor(sender);
    const display =
      (displayId !== undefined ? panels.display(displayId) : undefined) ??
      screen.getPrimaryDisplay();
    return {
      role: WINDOW_ROLE.PANEL,
      mode: displayId !== undefined ? panels.modeFor(displayId) : panels.initialMode,
      display: panels.diagnostic(display),
    };
  }

  function publishAppState(): void {
    const held = state.snapshot();
    const send = (sender: WebContents) => {
      const snapshot: AppStateSnapshot = { ...held, window: windowFactsFor(sender) };
      sendTo(sender, channels.onAppState, snapshot);
    };
    for (const sender of panels.senders()) send(sender);
    const voice = voiceWindow.current();
    if (voice && !voice.isDestroyed()) send(voice.webContents);
  }

  function sendToVoice<Payload>(channel: string, payload: Payload): void {
    const voice = voiceWindow.current();
    if (voice) sendTo(voice.webContents, channel, payload);
  }

  function showAgent(place: AgentPlace): void {
    panels.broadcast(channels.onShowAgent, place);
  }

  function onPanelFocusChanged(listener: (focused: boolean) => void): () => void {
    const focused = (_event: Electron.Event, window: BrowserWindow) => {
      if (panels.owns(window.webContents)) listener(true);
    };
    const blurred = (_event: Electron.Event, window: BrowserWindow) => {
      if (panels.owns(window.webContents)) listener(false);
    };
    app.on("browser-window-focus", focused);
    app.on("browser-window-blur", blurred);
    return () => {
      app.removeListener("browser-window-focus", focused);
      app.removeListener("browser-window-blur", blurred);
    };
  }

  /**
   * Every wait this service schedules — the settling a display change waits
   * out — held so the quit can take them back. Each opens a window when it
   * fires, and the teardown now runs for seconds with the drain behind it, so
   * one landing afterwards would re-open what the teardown had just given
   * back.
   */
  const pendingWaits = new Set<ReturnType<typeof setTimeout>>();
  function afterDelay(delayMs: number, run: () => void): void {
    // Nothing new is scheduled once a quit has been asked for, so the last
    // act of a wait that was already running cannot arm the next one behind
    // the teardown that just cleared them.
    if (!launchStanding()) return;
    const wait = setTimeout(() => {
      pendingWaits.delete(wait);
      if (!launchStanding()) return;
      run();
    }, delayMs);
    pendingWaits.add(wait);
  }
  const hotkeys = new HotkeyRegistrar({
    registersGlobalKeys: runMode.registersGlobalKeys,
    // A voice stands only when the host says one does.
    hasCredentials: () => operator.voiceAvailable(),
    host: {
      voiceHost: () => voiceWindow.current(),
      // The plan open in the panel owns the talk key until it is left, whether
      // or not the panel still shows it; with no plan open the key opens nothing.
      talkPlanId: () => state.snapshot().planning.activePlanId,
      hotkeyChanged: (rank) => {
        const current = state.snapshot().hotkeys;
        const talk = rank === HOTKEY_RANK.TALK ? hotkeys.talk : current.talk;
        const stop = rank === HOTKEY_RANK.STOP ? hotkeys.stop : current.stop;
        const nextHotkeys: AppHotkeysSlice = {
          talkHeld: rank === HOTKEY_RANK.TALK ? hotkeys.held : current.talkHeld,
        };
        if (talk !== undefined) nextHotkeys.talk = talk;
        if (stop !== undefined) nextHotkeys.stop = stop;
        state.update({ hotkeys: nextHotkeys });
      },
    },
  });
  const dock = new DockPresence({
    focusExpanded: (displayId) => panels.focusExpanded(displayId),
    iconDirectory: path.join(config.resourceDirectory, "icon"),
  });

  function applyLoginItem(openAtLogin: boolean): void {
    if (config.packaged) app.setLoginItemSettings({ openAtLogin });
  }

  function configurePermissions(): void {
    const ownWindow = (webContents: Electron.WebContents) =>
      panels.owns(webContents) || voiceWindow.owns(webContents);
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
    afterDelay(DISPLAY_SETTLE_MS, () => panels.reconcile());
  }

  const handleSecondInstance = (_event: Electron.Event, argv: string[]): void => {
    if (!launchStanding()) return;
    if (argv.includes("--expanded")) {
      const panel = panels.primaryPanel();
      const displayId = panel ? panels.displayIdFor(panel.webContents) : undefined;
      if (displayId !== undefined) panels.setMode(displayId, "expanded", true);
      return;
    }
    panels.reconcile();
    panels.focusExpanded();
  };
  // The Dock tile pressed: the window comes back, whether it was closed or
  // only behind another app.
  const handleActivate = (): void => {
    panels.focusExpanded();
  };
  // Named one at a time because Electron's `on` is typed per event name.
  const wake = (eventName: "resume" | "unlock-screen" | "user-did-become-active") => () => {
    handleDisplayChange();
    broadcast(channels.onLifecycle, eventName);
  };
  const wakeHandlers = {
    resume: wake("resume"),
    "unlock-screen": wake("unlock-screen"),
    "user-did-become-active": wake("user-did-become-active"),
  } as const;

  return {
    name: "windows",
    panels,
    voiceWindow,
    hotkeys,
    dock,
    publishAppState,
    windowFactsFor,
    sendToVoice,
    showAgent,
    onPanelFocusChanged,
    reporterOf,
    trustedSender: (event) => {
      const url = event.senderFrame?.url ?? event.sender.getURL();
      return url === rendererUrl || url === voiceUrl;
    },
    applyLoginItem,
    reapplyTalkHotkey: () => void hotkeys.reapply(HOTKEY_RANK.TALK),
    recycleVoiceWindow: () => {
      if (!voiceWindow.current()) return;
      voiceWindow.close();
      raiseVoiceWindow();
    },
    start: async () => {
      dock.applyIcon();
      dock.watchTheme();
      const settings = await run(operator.ensureSettings());
      // A Quit landing inside one of the launch's own waits is already tearing
      // this process down; nothing is opened or armed over it. This check sits
      // after every wait that still has a window behind it.
      if (!launchStanding()) return;
      if (settings?.stored.showInDock) dock.apply(true);
      applyLoginItem(settings?.stored.openAtLogin ?? APP_SETTING_SCHEMA.openAtLogin.default);
      if (runMode.observesProviders) {
        native.setMediaDuckEnabled(
          settings?.stored.duckOtherMedia ?? APP_SETTING_SCHEMA.duckOtherMedia.default,
        );
      }
      hotkeys.setChosen(HOTKEY_RANK.TALK, settings?.stored.voiceHotkey);
      hotkeys.setChosen(HOTKEY_RANK.STOP, settings?.stored.stopHotkey);
      await hotkeys.reapply(HOTKEY_RANK.TALK);
      if (!launchStanding()) return;
      panels.reconcile();
      raiseVoiceWindow();
      configurePermissions();

      app.on("second-instance", handleSecondInstance);
      app.on("activate", handleActivate);
      screen.on("display-added", handleDisplayChange);
      screen.on("display-removed", handleDisplayChange);
      screen.on("display-metrics-changed", handleDisplayChange);
      powerMonitor.on("resume", wakeHandlers.resume);
      powerMonitor.on("unlock-screen", wakeHandlers["unlock-screen"]);
      powerMonitor.on("user-did-become-active", wakeHandlers["user-did-become-active"]);
    },
    stop: async () => {
      app.removeListener("second-instance", handleSecondInstance);
      app.removeListener("activate", handleActivate);
      screen.removeListener("display-added", handleDisplayChange);
      screen.removeListener("display-removed", handleDisplayChange);
      screen.removeListener("display-metrics-changed", handleDisplayChange);
      powerMonitor.removeListener("resume", wakeHandlers.resume);
      powerMonitor.removeListener("unlock-screen", wakeHandlers["unlock-screen"]);
      powerMonitor.removeListener("user-did-become-active", wakeHandlers["user-did-become-active"]);
      for (const wait of pendingWaits) clearTimeout(wait);
      pendingWaits.clear();
      hotkeys.release();
      voiceWindow.closeForGood();
    },
  };
}
