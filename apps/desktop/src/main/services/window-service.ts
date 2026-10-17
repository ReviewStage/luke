import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_LINK_CLAIM, APP_LINK_SCHEME, appLinkClaim } from "@luke/features/app-links";
import type { ReadLink } from "@luke/features/luke-link";
import { PAGE_SCHEME } from "@luke/features/page-frame";
import type {
  AgentEndToast,
  AgentPlace,
  ChatMessageToast,
  FailedRunPlace,
  FailedRunToast,
  InboxItemToast,
} from "@luke/host/agent-notices";
import type { AppHotkeysSlice, AppStateSnapshot, AppWindowFacts } from "@luke/host/app-state";
import { applyThemePreference, followAppearance, NativeTheme } from "@luke/host/appearance";
import { channels } from "@luke/host/bridge";
import type { OperatorClient } from "@luke/host/client";
import { type AppStateStore, voiceWindowGone, voiceWindowState } from "@luke/host/client";
import type { DesktopService } from "@luke/host/desktop-service";
import { APP_SETTING_SCHEMA } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import type { UnparsedWireValue } from "@luke/wire";
import { Effect, Exit, Scope } from "effect";
import {
  app,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  nativeTheme,
  powerMonitor,
  screen,
  session,
  type WebContents,
} from "electron";
import { CallWindow } from "../window/call-window";
import { CallWindowPresence } from "../window/call-window-presence";
import { followDockIcon } from "../window/dock-icon";
import { HOTKEY_RANK, HotkeyRegistrar } from "../window/hotkey-registrar";
import { askForNotifications } from "../window/notice-doors";
import { pageResponse } from "../window/page-protocol";
import { PanelManager } from "../window/panel-manager";
import { reportRendererErrors } from "../window/renderer-errors";
import { VoiceWindow } from "../window/voice-window";
import { applyZoomPreference, PanelWindows, zoomFactorOf } from "../window/zoom";
import type { DesktopConfig } from "./desktop-config";
import type { NativeNode } from "./native-node";

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
  /** The floating call window, shown while a call stands and no Luke window has the keyboard. */
  readonly callWindow: CallWindow;
  readonly hotkeys: HotkeyRegistrar;
  /**
   * One `app:state` per window, each composed with that window's own facts.
   * The one place the document becomes a push, so what a window is told and
   * what `app:state-request` answers it are the same document read twice.
   */
  publishAppState: () => void;
  /**
   * Steers the app to the theme and the zoom the document holds. Run before
   * every publish, so a window handed new settings already draws under the
   * appearance they name, and a write that failed — which moves no settings —
   * steers nothing.
   */
  applyAppearance: () => Effect.Effect<void>;
  /**
   * What one window answers for and the document cannot: which surface it
   * draws, and whether it stands in full screen. Decided here by which window
   * asked.
   */
  windowFactsFor: (sender: WebContents) => AppWindowFacts;
  /** Hands a payload to the voice window alone, the one peer of the host's live session. */
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
  /** Asks the panels to open a task on one agent's tab: a notification's click. */
  showAgent: (place: AgentPlace) => void;
  /** A panel has painted and hears the links it is handed: every Luke link held opens now, and each later one as it comes. */
  panelReady: () => void;
  /** Asks the panels to say an agent's turn ended in their toast: its end while the window is focused. */
  toastAgentEnd: (end: AgentEndToast) => void;
  /** Asks the panels to open a task on its Inbox tab: an inbox notification's click. */
  showInbox: (taskId: string) => void;
  /** Asks the panels to open the window's Inbox on an item of an agent with no task. */
  showInboxItem: (item: {
    readonly agentId: string;
    readonly itemId: string;
    readonly workspaceId?: string;
  }) => void;
  /** Asks the panels to open Settings: the menu bar's Check for Updates, whose answer is drawn there. */
  showSettings: () => void;
  /** Asks the panels to say an inbox item opened in their toast: one that opened while the window is focused. */
  toastInboxItem: (item: InboxItemToast) => void;
  /** Asks the panels to open a failed run in its automation's workspace: its notification's click. */
  showFailedRun: (place: FailedRunPlace) => void;
  /** Asks the panels to say a run failed to start in their toast: one that failed while the window is focused. */
  toastFailedRun: (run: FailedRunToast) => void;
  /** Asks the panels to open the Chat of the workspace a message waits in: a chat notification's click. */
  showChat: (workspaceId: string) => void;
  /** Asks the panels to say a chat message waits in their toast: one that came to wait while the window is focused. */
  toastChatMessage: (message: ChatMessageToast) => void;
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
 * behalf: the panel, the hidden voice window, the call window, the keys, the Dock, the login
 * item, the media permissions, the scheme a plan's pages are drawn from, and
 * the display and power changes the panel answers.
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
  // The hidden voice window loads its own entry from a document of its own,
  // which mounts the voice host alone. Both documents are files
  // this build wrote into the resource directory, and the pair is the whole
  // of what any window here may navigate to or speak from.
  const voiceHtmlPath = path.join(config.resourceDirectory, "renderer", "voice.html");
  const voiceUrl = pathToFileURL(voiceHtmlPath).href;
  // The call window's document, on the same terms: its own entry, no host.
  const callHtmlPath = path.join(config.resourceDirectory, "renderer", "call.html");
  const callUrl = pathToFileURL(callHtmlPath).href;

  const panels = new PanelManager({
    runMode,
    instance: config.instance,
    mediaDuck: native.mediaDuck,
    preloadPath,
    rendererHtmlPath,
    rendererUrl,
    zoomFactor: () => zoomFactorOf(state.snapshot().settings?.stored.zoom),
    // A capture run opens at the frame its evidence is measured at, and
    // keeps no place of its own.
    placementPath: runMode.takesFocus ? path.join(config.stateRoot, "main-window.json") : undefined,
    closing: () => !launchStanding(),
    onAllClosed: () => config.quit(),
    // The title bar's buttons move into the traffic lights' place while
    // macOS hides them, so the window is told as its frame changes.
    onFullScreenChanged: () => publishAppState(),
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
      // view at all, and keeps the avatar, which the host and the panel say.
      state.update({ voice: voiceWindowGone(state.snapshot().voice) });
      panels.setVoiceExchange(false);
    },
    onGaveUp: (reason) => {
      config.report(`Voice window abandoned: ${reason}`);
    },
  });
  const voiceWindowWanted = runMode.registersGlobalKeys || runMode.sendsNetwork;
  const callWindow = new CallWindow({
    runMode,
    preloadPath,
    rendererHtmlPath: callHtmlPath,
    rendererUrl: callUrl,
    placementPath: path.join(config.stateRoot, "call-window.json"),
  });
  const callPresence = new CallWindowPresence(callWindow);
  /** What stops a development build's renderer errors reaching the terminal; nothing until the start begins it. */
  let stopRendererErrors = (): void => undefined;

  /** Electron's own `nativeTheme`, the one appearance every window here follows. */
  const withNativeTheme = Effect.provideService(NativeTheme, nativeTheme);
  /** What the panels' grounds follow the appearance in; closing it takes the listener back. */
  const appearanceScope = Scope.makeUnsafe();
  /** The panel windows standing now, the ones a zoom is applied to. */
  const withPanelWindows = Effect.provideService(PanelWindows, {
    standing: () => panels.windows(),
  });
  const applyAppearance = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      const stored = state.snapshot().settings?.stored;
      return Effect.andThen(
        applyThemePreference(stored?.theme).pipe(withNativeTheme),
        applyZoomPreference(stored?.zoom).pipe(withPanelWindows),
      );
    });

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
    if (voiceWindow.owns(sender) || callWindow.owns(sender)) return { fullScreen: false };
    return { fullScreen: panels.fullScreen(sender) };
  }

  function publishAppState(): void {
    const held = state.snapshot();
    const send = (sender: WebContents, shown: typeof held) => {
      const snapshot: AppStateSnapshot = { ...shown, window: windowFactsFor(sender) };
      sendTo(sender, channels.onAppState, snapshot);
    };
    for (const sender of panels.senders()) send(sender, held);
    const voice = voiceWindow.current();
    if (voice && !voice.isDestroyed()) send(voice.webContents, voiceWindowState(held));
    const call = callWindow.current();
    if (call) send(call.webContents, voiceWindowState(held));
    // The call window follows the document it draws, so it stands, goes, and
    // grows for the avatar on the same version every window is told.
    callPresence.voiceChanged(held.voice);
  }

  function sendToVoice<Payload>(channel: string, payload: Payload): void {
    const voice = voiceWindow.current();
    if (voice) sendTo(voice.webContents, channel, payload);
  }

  function showAgent(place: AgentPlace): void {
    panels.broadcast(channels.onShowAgent, place);
  }

  function toastAgentEnd({ place, words, detail, failed }: AgentEndToast): void {
    panels.broadcast(channels.onAgentEnded, { ...place, words, detail, failed });
  }

  function showInbox(taskId: string): void {
    panels.broadcast(channels.onShowInbox, { taskId });
  }

  function showInboxItem(item: {
    readonly agentId: string;
    readonly itemId: string;
    readonly workspaceId?: string;
  }): void {
    panels.broadcast(channels.onShowInboxItem, {
      agentId: item.agentId,
      itemId: item.itemId,
      ...(item.workspaceId === undefined ? undefined : { workspaceId: item.workspaceId }),
    });
  }

  function showSettings(): void {
    panels.broadcast(channels.onMenuCommand, APP_COMMAND.SETTINGS);
  }

  function toastInboxItem(item: InboxItemToast): void {
    panels.broadcast(channels.onInboxItemOpened, item);
  }

  function showFailedRun(place: FailedRunPlace): void {
    panels.broadcast(channels.onShowFailedRun, place);
  }

  function toastFailedRun({ place, words, detail }: FailedRunToast): void {
    panels.broadcast(channels.onRunFailed, { ...place, words, detail });
  }

  function showChat(workspaceId: string): void {
    panels.broadcast(channels.onShowChat, { workspaceId });
  }

  function toastChatMessage(message: ChatMessageToast): void {
    panels.broadcast(channels.onChatMessageWaiting, message);
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

  // Which panel has the keyboard, for the call window: while one does, that
  // panel draws the call itself, as its call bar or its own call card.
  const panelFocused = (_event: Electron.Event, window: BrowserWindow) => {
    if (panels.owns(window.webContents)) callPresence.panelFocused(window.webContents);
  };
  const panelBlurred = (_event: Electron.Event, window: BrowserWindow) => {
    if (panels.owns(window.webContents)) callPresence.panelBlurred(window.webContents);
  };

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
    // Note that a named development instance claims no system-wide key,
    // because it runs beside the plain one and two Lukes cannot share a chord:
    // whichever launched first would take it from the other.
    registersGlobalKeys: runMode.registersGlobalKeys && config.instance === undefined,
    // A voice stands only when the host says one does.
    hasCredentials: () => operator.voiceAvailable(),
    host: {
      voiceHost: () => voiceWindow.current(),
      // The task open in the panel is what a press with no call opens one
      // about, whether or not the panel still shows it; a standing call takes
      // the press whatever task is open, and with neither the key opens nothing.
      talkTaskId: () => state.snapshot().tasks.activeTaskId,
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

  // A second launch's Luke link is heard by main itself, from before the windows stand (`../main.ts`).
  const handleSecondInstance = (): void => {
    if (!launchStanding()) return;
    panels.reconcile();
    panels.focusExpanded();
  };
  // A Luke link's place opens in the panels, the window brought forward.
  const openAppLink = (link: ReadLink): void => {
    panels.focusExpanded();
    panels.broadcast(channels.onShowLink, link);
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
    // A terminal's socket may have died in the sleep without a word, and one waiting out a backoff need not wait on.
    if (eventName === "resume") void run(operator.host.terminalWake());
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
    callWindow,
    hotkeys,
    publishAppState,
    applyAppearance,
    windowFactsFor,
    sendToVoice,
    showAgent,
    panelReady: () => config.appLinks.ready(openAppLink),
    showInbox,
    showInboxItem,
    showSettings,
    toastInboxItem,
    showFailedRun,
    toastFailedRun,
    showChat,
    toastChatMessage,
    toastAgentEnd,
    onPanelFocusChanged,
    reporterOf,
    trustedSender: (event) => {
      const url = event.senderFrame?.url ?? event.sender.getURL();
      return url === rendererUrl || url === voiceUrl || url === callUrl;
    },
    applyLoginItem,
    reapplyTalkHotkey: () => void hotkeys.reapply(HOTKEY_RANK.TALK),
    recycleVoiceWindow: () => {
      if (!voiceWindow.current()) return;
      voiceWindow.close();
      raiseVoiceWindow();
    },
    start: async () => {
      followDockIcon(path.join(config.resourceDirectory, "icon"));
      const settings = await run(operator.ensureSettings());
      // A Quit landing inside one of the launch's own waits is already tearing
      // this process down; nothing is opened or armed over it. This check sits
      // after every wait that still has a window behind it.
      if (!launchStanding()) return;
      // The theme is steered before any panel opens, so the first frame of
      // every window is already drawn in the appearance it will keep.
      await run(applyThemePreference(settings?.stored.theme).pipe(withNativeTheme));
      await run(
        followAppearance((dark) => panels.paint(dark)).pipe(
          Scope.provide(appearanceScope),
          withNativeTheme,
        ),
      );
      applyLoginItem(settings?.stored.openAtLogin ?? APP_SETTING_SCHEMA.openAtLogin.default);
      if (runMode.observesProviders) {
        native.setMediaDuckEnabled(
          settings?.stored.duckOtherMedia ?? APP_SETTING_SCHEMA.duckOtherMedia.default,
        );
      }
      // macOS is asked now, while the developer is here to answer, rather
      // than as the first agent ends behind the window. Note that it is
      // asked whatever the setting says, because asking posts nothing and
      // macOS asks only once, and a switch turned on later would otherwise
      // leave its first notification to ask, and be refused.
      if (runMode.observesProviders) askForNotifications();
      hotkeys.setChosen(HOTKEY_RANK.TALK, settings?.stored.voiceHotkey);
      hotkeys.setChosen(HOTKEY_RANK.STOP, settings?.stored.stopHotkey);
      await hotkeys.reapply(HOTKEY_RANK.TALK);
      if (!launchStanding()) return;
      // A plan's pages are read through the host on the account's bearer, so the frame holds an address alone.
      session.defaultSession.protocol.handle(PAGE_SCHEME, (request) =>
        run(pageResponse(request.url, operator.host.tasksPage)),
      );
      // A development build writes its windows' errors where the run's own
      // lines go, from before the first window opens, and offers their
      // developer tools; the menu bar draws none in a packaged build. Note
      // that a capture run is offered none either, because its windows are
      // opened without them (`hardenedWebPreferences`).
      if (!config.packaged) stopRendererErrors = reportRendererErrors(config.report);
      if (runMode.takesFocus) {
        config.showMenuBar({
          developerTools: {
            onOpenVoiceWindow: () =>
              voiceWindow.current()?.webContents.openDevTools({ mode: "detach" }),
            onOpenCallWindow: () =>
              callWindow.current()?.webContents.openDevTools({ mode: "detach" }),
          },
        });
      }
      panels.reconcile();
      raiseVoiceWindow();
      configurePermissions();

      // A packaged Luke asks macOS for its own scheme; a live development run gives back a claim stock Electron holds, which would open a bare Electron.
      const linkClaim = appLinkClaim({ packaged: config.packaged, live: runMode.sendsNetwork });
      if (linkClaim === APP_LINK_CLAIM.CLAIM) app.setAsDefaultProtocolClient(APP_LINK_SCHEME);
      if (linkClaim === APP_LINK_CLAIM.RELEASE) app.removeAsDefaultProtocolClient(APP_LINK_SCHEME);
      app.on("second-instance", handleSecondInstance);
      app.on("activate", handleActivate);
      app.on("browser-window-focus", panelFocused);
      app.on("browser-window-blur", panelBlurred);
      screen.on("display-added", handleDisplayChange);
      screen.on("display-removed", handleDisplayChange);
      screen.on("display-metrics-changed", handleDisplayChange);
      powerMonitor.on("resume", wakeHandlers.resume);
      powerMonitor.on("unlock-screen", wakeHandlers["unlock-screen"]);
      powerMonitor.on("user-did-become-active", wakeHandlers["user-did-become-active"]);
    },
    stop: async () => {
      config.appLinks.close();
      stopRendererErrors();
      app.removeListener("second-instance", handleSecondInstance);
      app.removeListener("activate", handleActivate);
      app.removeListener("browser-window-focus", panelFocused);
      app.removeListener("browser-window-blur", panelBlurred);
      screen.removeListener("display-added", handleDisplayChange);
      screen.removeListener("display-removed", handleDisplayChange);
      screen.removeListener("display-metrics-changed", handleDisplayChange);
      powerMonitor.removeListener("resume", wakeHandlers.resume);
      powerMonitor.removeListener("unlock-screen", wakeHandlers["unlock-screen"]);
      powerMonitor.removeListener("user-did-become-active", wakeHandlers["user-did-become-active"]);
      for (const wait of pendingWaits) clearTimeout(wait);
      pendingWaits.clear();
      await run(Scope.close(appearanceScope, Exit.void));
      hotkeys.release();
      if (session.defaultSession.protocol.isProtocolHandled(PAGE_SCHEME)) {
        session.defaultSession.protocol.unhandle(PAGE_SCHEME);
      }
      voiceWindow.closeForGood();
      callWindow.closeForGood();
    },
  };
}
