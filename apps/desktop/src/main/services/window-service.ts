import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PRODUCT_EVENT } from "@sidecar/analytics";
import {
  INTRODUCTION_HANDOFF_READY_MS,
  onboardingStateFile,
  openSocketOverWs,
  shouldRunIntroduction,
} from "@sidecar/host";
import { hostedVoiceServiceOrigin } from "@sidecar/hosted";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { DEFAULT_PANEL_FORM_FACTOR } from "@sidecar/surface";
import { IntroductionLiveSessionSource } from "@sidecar/voice";
import type { UnparsedWireValue } from "@sidecar/wire";
import {
  app,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  powerMonitor,
  screen,
  session,
  type WebContents,
} from "electron";
import { channels } from "#shared/bridge";
import type { AppStateSnapshot, AppWindowFacts } from "#shared/messages/app-state";
import { WINDOW_ROLE } from "#shared/messages/session";
import type { AppStateStore } from "../app-state";
import { DockPresence } from "../window/dock-presence";
import { HOTKEY_RANK, HotkeyRegistrar } from "../window/hotkey-registrar";
import { PanelManager } from "../window/panel-manager";
import { VoiceWindow } from "../window/voice-window";
import type { DesktopConfig } from "./desktop-config";
import { IntroductionSession } from "./introduction-session";
import type { NativeNode } from "./native-node";
import type { OperatorClient } from "./operator-client";
import type { DesktopService } from "./service";
import type { TelemetryService } from "./telemetry-service";

/** How long a display change is let settle before the panels are laid out over it. */
const DISPLAY_SETTLE_MS = 100;

export interface WindowServiceDependencies {
  config: DesktopConfig;
  /** What the windows are told from, and where what this service holds of it is written. */
  state: AppStateStore;
  native: NativeNode;
  telemetry: TelemetryService;
  operator: OperatorClient;
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
  /** The takeover's own voice session, the one that stands with no account behind it. */
  readonly introductionSession: IntroductionSession;
  /** Hands a payload to every panel and the voice window, less the window given. */
  broadcast: <Payload>(channel: string, payload: Payload, except?: WebContents) => void;
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
  /** Hands a payload to the voice window alone, the one receiver of offers and withdrawals. */
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
  /**
   * The opaque name one window's writes travel to the host under. It names
   * nothing about the window to anyone else, and the host records it beside
   * the change it produced.
   */
  reporterOf: (sender: WebContents) => string;
  /** Only this build's own renderer may reach a bridge entry. */
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** The one window an action only a renderer can perform is carried to; false when none is open. */
  sendToPrimaryPanel: <Payload>(channel: string, payload: Payload) => boolean;
  applyLoginItem: (openAtLogin: boolean) => void;
  reapplyTalkHotkey: () => void;
  recycleVoiceWindow: () => void;
  /** A panel that finished painting, which is what the takeover's handoff waits for. */
  notePanelReady: (sender: WebContents) => void;
  /**
   * The introduction's one ending, whichever way the takeover reported it.
   * `given` records the completion, so an introduction that was never given
   * plays for real on a later launch.
   */
  endIntroduction: (given: boolean) => Promise<void>;
  /** Whether the introduction holds the panel — what every takeover-only answer gates on. */
  introductionPlaying: () => boolean;
}

/**
 * Everything this process draws or claims from the machine on the windows'
 * behalf: the panels — the one-time introduction among them, as a fullscreen
 * mode of one — the hidden voice window, the keys, the Dock, the login item,
 * the media permissions, and the display and power changes the panels answer.
 * It is the one concern that opens a window, and it opens none until `start`.
 */
export function createWindowService(dependencies: WindowServiceDependencies): WindowService {
  const { config, state, native, telemetry, operator, launchStanding } = dependencies;
  const { runMode } = config;
  const recordProductEvent = telemetry.recordProductEvent;

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
  // The hidden voice window loads a bundle of its own, so that the panel's
  // `App` and its session-replay client are unreachable from a window nobody
  // consented to a recording of. Both documents are files this build wrote
  // into the resource directory, and the pair is the whole of what any
  // window here may navigate to or speak from.
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
    onTakeoverGone: (reason) => {
      config.report(`Introduction abandoned: ${reason}`);
      void endIntroduction(false);
    },
  });
  const introductionPlaying = () => state.snapshot().introduction.playing;
  /**
   * The hidden window that holds the live conversation. Its receiver epochs
   * are the host's: each load asks the host to begin one, and a close or
   * reload ends it there, so a claim the renderer makes names an epoch the
   * host issued.
   */
  const voiceWindow = new VoiceWindow({
    runMode,
    receiver: {
      begin: () => void operator.host.beginReceiver(),
      reset: () => void operator.host.resetReceiver(),
    },
    preloadPath,
    rendererHtmlPath: voiceHtmlPath,
    rendererUrl: voiceUrl,
    onGone: (reason) => {
      config.report(`Voice window replaced: ${reason}`);
      // The window that held the exchange is gone, so what every panel draws
      // in its place is an idle voice; the document says so by holding no
      // view at all.
      const { epoch } = state.snapshot().voice;
      state.update({ voice: { ...(epoch !== undefined ? { epoch } : undefined) } });
      panels.setVoiceExchange(false);
    },
    onGaveUp: (reason) => {
      config.report(`Voice window abandoned: ${reason}`);
    },
  });
  const voiceWindowWanted = runMode.registersGlobalKeys || runMode.sendsNetwork;

  function raiseVoiceWindow(): void {
    // Not while the introduction plays: its own call runs in the panel it
    // took, so a second window standing by with no account behind it has
    // nothing to hold and no credential it should be able to ask for. The
    // ending raises it.
    if (introductionPlaying()) return;
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

  /**
   * Every wait this service schedules — the takeover's handoff and the
   * settling a display change waits out — held so the quit can take them
   * back. Each opens a window or claims the keys when it fires, and the
   * teardown now runs for seconds with the drain behind it, so one landing
   * afterwards would re-open what the teardown had just given back.
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
  // The voice service origin is pinned by the build; a development build may
  // point it elsewhere the way the account service is, and a packaged one may not.
  const introductionSession = new IntroductionSession({
    source: new IntroductionLiveSessionSource({
      serviceOrigin: hostedVoiceServiceOrigin({
        packaged: config.packaged,
        override: config.environment.LUKE_VOICE_SERVICE_ORIGIN,
      }),
      openSocket: openSocketOverWs,
    }),
    recordProductEvent,
  });
  const onboarding = onboardingStateFile(() => config.stateRoot, config.report);

  /**
   * Whether the takeover's window is waiting for the panel to be drawn under
   * it. The window keeps the display until then: the panel draws its capsule
   * at the notch inside the very surface the takeover covers, so the window
   * shrinking to that capsule's own bounds afterwards moves nothing on
   * screen — where letting it shrink first would clip the stand-down into a
   * capsule before the panel had drawn one.
   */
  let awaitingPanel = false;

  function handOverToPanel(): void {
    if (!awaitingPanel) return;
    awaitingPanel = false;
    panels.leaveTakeover();
  }

  /**
   * The introduction's one ending, however the takeover reported it: the
   * sign-off spoken to its end, or a takeover that cannot be given at all.
   * The standing goes down first, so nothing granted against it — the keyless
   * talk key, the accountless session, the takeover's own reports — outlives
   * the ending; the window follows the panel that draws in its place.
   * Idempotent through that standing: a second ending finds nothing playing.
   */
  async function endIntroduction(given: boolean): Promise<void> {
    if (!introductionPlaying() || !launchStanding()) return;
    introductionSession.end();
    if (given) {
      onboarding.update((current) => ({
        ...current,
        introductionCompletedAt: new Date().toISOString(),
      }));
      recordProductEvent(PRODUCT_EVENT.INTRODUCTION_COMPLETE, {});
    }
    state.update({ introduction: { playing: false } });
    awaitingPanel = true;
    // A panel that never reports being drawn must not leave a window covering
    // the whole display, so the window follows anyway once the wait is spent.
    afterDelay(INTRODUCTION_HANDOFF_READY_MS, handOverToPanel);
    raiseVoiceWindow();
    await hotkeys.reapply(HOTKEY_RANK.TALK);
  }

  const hotkeys = new HotkeyRegistrar({
    registersGlobalKeys: runMode.registersGlobalKeys,
    // The introduction's practice beat is the one time the talk key is claimed
    // with no account credential behind it; otherwise a voice stands only when
    // the host says one does.
    hasCredentials: (rank) =>
      operator.voiceAvailable() || (rank === HOTKEY_RANK.TALK && introductionPlaying()),
    recordProductEvent: (name, properties) => recordProductEvent(name, properties),
    host: {
      // While the introduction plays, its own call runs in the panel window
      // it took: the takeover holds the microphone and the beats, so the key
      // has to reach the surface that answers it.
      voiceHost: () => (introductionPlaying() ? panels.primaryPanel() : voiceWindow.current()),
      primaryPanel: () => panels.primaryPanel(),
      displayIdFor: (sender) => panels.displayIdFor(sender),
      modeFor: (displayId) => panels.modeFor(displayId),
      setMode: (displayId, mode, requestFocus) => {
        panels.setMode(displayId, mode, requestFocus);
      },
      hotkeyChanged: (rank) => {
        state.update({
          hotkeys: {
            ...state.snapshot().hotkeys,
            ...(rank === HOTKEY_RANK.TALK
              ? { talk: hotkeys.talk, talkHeld: hotkeys.held }
              : rank === HOTKEY_RANK.ASK
                ? { ask: hotkeys.ask }
                : { stop: hotkeys.stop }),
          },
        });
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
    afterDelay(DISPLAY_SETTLE_MS, () => {
      void (async () => {
        await panels.refreshGeometry();
        if (!launchStanding()) return;
        panels.reconcile();
        // A takeover follows its display: the reconcile above moved its
        // window somewhere it can stand, and re-taking covers whichever
        // display that window now stands on.
        if (introductionPlaying()) panels.enterTakeover();
      })();
    });
  }

  const handleSecondInstance = (_event: Electron.Event, argv: string[]): void => {
    void panels.refreshGeometry().then(() => {
      // A second launch already in flight when the quit landed must not raise
      // panels over a client whose keys and windows are already given back.
      if (!launchStanding()) return;
      if (introductionPlaying()) {
        panels.enterTakeover();
        return;
      }
      if (argv.includes("--expanded")) {
        const panel = panels.primaryPanel();
        const displayId = panel ? panels.displayIdFor(panel.webContents) : undefined;
        if (displayId !== undefined) panels.setMode(displayId, "expanded", true);
        return;
      }
      panels.reconcile();
      panels.showInactiveAll();
    });
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
    introductionSession,
    broadcast,
    publishAppState,
    windowFactsFor,
    sendToVoice,
    reporterOf,
    trustedSender: (event) => {
      const url = event.senderFrame?.url ?? event.sender.getURL();
      return url === rendererUrl || url === voiceUrl;
    },
    sendToPrimaryPanel: (channel, payload) => {
      const panel = panels.primaryPanel();
      if (!panel) return false;
      sendTo(panel.webContents, channel, payload);
      return true;
    },
    applyLoginItem,
    reapplyTalkHotkey: () => void hotkeys.reapply(HOTKEY_RANK.TALK),
    recycleVoiceWindow: () => {
      if (!voiceWindow.current()) return;
      voiceWindow.close();
      raiseVoiceWindow();
    },
    notePanelReady: (sender) => {
      if (panels.owns(sender)) handOverToPanel();
    },
    endIntroduction,
    introductionPlaying,
    start: async () => {
      // The introduction plays only on a host actually reached: a launch that
      // cannot reach its runtime knows nothing of the account and must not
      // greet a signed-in developer as a stranger.
      const giveIntroduction = shouldRunIntroduction({
        requiresAccount: runMode.requiresAccount,
        signedIn: operator.signedIn(),
        completed: onboarding.read()?.introductionCompletedAt !== undefined,
      });
      await panels.refreshGeometry();
      // A Quit landing inside one of the launch's own waits is already tearing
      // this process down; nothing is opened or armed over it. This check sits
      // after every wait that still has a window behind it.
      if (!launchStanding()) return;
      dock.applyIcon();
      dock.watchTheme();
      const settings = await operator.ensureSettings();
      if (!launchStanding()) return;
      if (settings?.stored.showInDock) dock.apply(true);
      applyLoginItem(settings?.stored.openAtLogin ?? APP_SETTING_SCHEMA.openAtLogin.default);
      if (runMode.observesProviders) {
        native.setMediaDuckEnabled(
          settings?.stored.duckOtherMedia ?? APP_SETTING_SCHEMA.duckOtherMedia.default,
        );
      }
      panels.setShowOnAllDisplays(settings?.stored.showOnAllDisplays === true);
      panels.setFormFactor(settings?.stored.formFactor ?? DEFAULT_PANEL_FORM_FACTOR);
      hotkeys.setChosen(HOTKEY_RANK.TALK, settings?.stored.voiceHotkey);
      hotkeys.setChosen(HOTKEY_RANK.ASK, settings?.stored.askHotkey);
      hotkeys.setChosen(HOTKEY_RANK.STOP, settings?.stored.stopHotkey);
      // The standing is written before the first window opens, so the panel's
      // own renderer reads it in the state it bootstraps from and draws the
      // takeover rather than the panel and then the takeover.
      if (giveIntroduction) state.update({ introduction: { playing: true } });
      await hotkeys.reapply(HOTKEY_RANK.TALK);
      if (!launchStanding()) return;
      panels.reconcile();
      // No panel anywhere is nothing to take the screen with, so there is no
      // introduction to run and the ordinary launch stands. Taking it
      // reconciles again, to the one display it covers.
      if (giveIntroduction && panels.enterTakeover() === undefined) {
        state.update({ introduction: { playing: false } });
      }
      raiseVoiceWindow();
      configurePermissions();

      app.on("second-instance", handleSecondInstance);
      screen.on("display-added", handleDisplayChange);
      screen.on("display-removed", handleDisplayChange);
      screen.on("display-metrics-changed", handleDisplayChange);
      powerMonitor.on("resume", wakeHandlers.resume);
      powerMonitor.on("unlock-screen", wakeHandlers["unlock-screen"]);
      powerMonitor.on("user-did-become-active", wakeHandlers["user-did-become-active"]);
    },
    stop: async () => {
      app.removeListener("second-instance", handleSecondInstance);
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
      panels.clearCollapseTimers();
    },
  };
}
