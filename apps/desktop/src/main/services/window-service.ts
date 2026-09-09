import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PRODUCT_EVENT } from "@sidecar/analytics";
import {
  INTRODUCTION_FADE_MS,
  INTRODUCTION_HANDOFF_READY_MS,
  INTRODUCTION_RENDER_DEADLINE_MS,
  onboardingStateFile,
  shouldRunIntroduction,
} from "@sidecar/host";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { DEFAULT_PANEL_FORM_FACTOR } from "@sidecar/surface";
import {
  introductionRealtimeCredentialMinter,
  type RealtimeCredentialMinter,
} from "@sidecar/voice";
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
import { IDLE_VOICE_VIEW, type VoiceView } from "#shared/messages/voice-view";
import type { BridgeContext } from "../register-bridge";
import { DockPresence } from "../window/dock-presence";
import { HOTKEY_RANK, HotkeyRegistrar } from "../window/hotkey-registrar";
import { IntroductionWindow } from "../window/introduction-window";
import { PanelManager } from "../window/panel-manager";
import { VoiceWindow } from "../window/voice-window";
import type { DesktopConfig } from "./desktop-config";
import type { NativeNode } from "./native-node";
import type { OperatorClient } from "./operator-client";
import type { DesktopService } from "./service";
import type { TelemetryService } from "./telemetry-service";

export interface WindowServiceDependencies {
  config: DesktopConfig;
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
  readonly introductionWindow: IntroductionWindow;
  readonly hotkeys: HotkeyRegistrar;
  readonly dock: DockPresence;
  /** The takeover's own bounded mint, the one voice that stands with no account behind it. */
  readonly introductionMinter: RealtimeCredentialMinter;
  /** Hands a payload to every panel and the voice window, less the window given. */
  broadcast: <Payload>(channel: string, payload: Payload, except?: WebContents) => void;
  /** Hands a payload to the voice window alone, the one receiver of offers and withdrawals. */
  sendToVoice: <Payload>(channel: string, payload: Payload) => void;
  /** The window an opaque reporter names in this process, so its own report is not echoed back to it. */
  reporterOf: (context: BridgeContext) => string;
  webContentsByReporter: (reporter: string) => WebContents | undefined;
  /** Only this build's own renderer may reach a bridge entry. */
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** The one window an act only a renderer can perform is carried to; false when none is open. */
  sendToPrimaryPanel: <Payload>(channel: string, payload: Payload) => boolean;
  applyLoginItem: (openAtLogin: boolean) => void;
  reapplyTalkHotkey: () => void;
  recycleVoiceWindow: () => void;
  storeVoiceView: (view: VoiceView) => void;
  voiceView: () => VoiceView | undefined;
  introductionMounted: () => void;
  /** A panel that finished painting, which is what the introduction's handoff waits for. */
  notePanelReady: (context: BridgeContext) => void;
  finishIntroduction: (given: boolean) => Promise<void>;
  abandonIntroduction: () => Promise<void>;
}

/**
 * Everything this process draws or claims from the machine on the windows'
 * behalf: the panels, the hidden voice window, the one-time introduction, the
 * keys, the Dock, the login item, the media permissions, and the display and
 * power changes the panels answer. It is the one concern that opens a window,
 * and it opens none until `start`.
 */
export function createWindowService(dependencies: WindowServiceDependencies): WindowService {
  const { config, native, telemetry, operator, launchStanding } = dependencies;
  const { runMode } = config;
  const recordProductEvent = telemetry.recordProductEvent;

  const reporters = new WeakMap<WebContents, string>();
  const windowsByReporter = new Map<string, WebContents>();
  function reporterOf(context: BridgeContext): string {
    const held = reporters.get(context.sender);
    if (held) return held;
    const minted = randomUUID();
    reporters.set(context.sender, minted);
    windowsByReporter.set(minted, context.sender);
    context.sender.once("destroyed", () => windowsByReporter.delete(minted));
    return minted;
  }

  const preloadPath = path.join(config.resourceDirectory, "preload.js");
  const rendererHtmlPath = path.join(config.resourceDirectory, "renderer", "index.html");
  const rendererUrl = pathToFileURL(rendererHtmlPath).href;

  const panels = new PanelManager({
    runMode,
    mediaDuck: native.mediaDuck,
    preloadPath,
    rendererHtmlPath,
    rendererUrl,
    onAllClosed: () => config.quit(),
  });
  const introductionWindow = new IntroductionWindow({
    runMode,
    preloadPath,
    rendererHtmlPath,
    rendererUrl,
    onGone: (reason) => {
      config.report(`Introduction abandoned: ${reason}`);
      void abandonIntroduction();
    },
    onClosed: () => {
      if (panels.standing === 0) config.quit();
    },
  });
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
    rendererHtmlPath,
    rendererUrl,
    onGone: (reason) => {
      config.report(`Voice window replaced: ${reason}`);
      latestVoiceView = undefined;
      panels.setVoiceExchange(false);
      broadcast(channels.onVoiceViewChanged, IDLE_VOICE_VIEW);
    },
    onGaveUp: (reason) => {
      config.report(`Voice window abandoned: ${reason}`);
    },
  });
  const voiceWindowWanted = runMode.registersGlobalKeys || runMode.sendsNetwork;

  function raiseVoiceWindow(): void {
    if (voiceWindowWanted && panels.standing > 0) voiceWindow.open();
  }

  function broadcast<Payload>(channel: string, payload: Payload, except?: WebContents): void {
    panels.broadcast(channel, payload, except);
    const voice = voiceWindow.current();
    if (!voice || voice.webContents === except) return;
    // SAFETY: Main-process broadcasts carry structured-clone snapshots produced for channels fixed by this build.
    voice.webContents.send(channel, payload as UnparsedWireValue);
  }

  function sendToVoice<Payload>(channel: string, payload: Payload): void {
    // SAFETY: as above; the voice window is one of the same windows.
    voiceWindow.current()?.webContents.send(channel, payload as UnparsedWireValue);
  }

  let latestVoiceView: VoiceView | undefined;
  let introductionRendererReady = false;
  let resolveIntroductionPanelReady: (() => void) | undefined;
  /**
   * The takeover's own waits — the render deadline, the handoff, the fade
   * that hands the panel back — held so the quit can take them back. Each
   * acts on a window or the keys when it fires, so one landing after the
   * teardown would re-open the takeover or re-claim the talk key the
   * teardown had just given back.
   */
  const introductionWaits = new Set<ReturnType<typeof setTimeout>>();
  function afterIntroductionDelay(delayMs: number, run: () => void): void {
    const wait = setTimeout(() => {
      introductionWaits.delete(wait);
      if (!launchStanding()) return;
      run();
    }, delayMs);
    introductionWaits.add(wait);
  }
  const introductionMinter = introductionRealtimeCredentialMinter({
    serviceBaseUrl: config.hostedServiceBaseUrl,
  });
  const onboarding = onboardingStateFile(() => config.stateRoot, config.report);

  async function finishIntroduction(given: boolean): Promise<void> {
    if (!introductionWindow.active || !launchStanding()) return;
    if (given) {
      onboarding.update((current) => ({
        ...current,
        introductionCompletedAt: new Date().toISOString(),
      }));
      recordProductEvent(PRODUCT_EVENT.INTRODUCTION_COMPLETE, {});
    }
    introductionWindow.retire();
    const panelReady = new Promise<void>((resolve) => {
      resolveIntroductionPanelReady = resolve;
    });
    panels.reconcile();
    raiseVoiceWindow();
    await Promise.race([
      panelReady,
      new Promise<void>((resolve) => {
        afterIntroductionDelay(INTRODUCTION_HANDOFF_READY_MS, resolve);
      }),
    ]);
    resolveIntroductionPanelReady = undefined;
    afterIntroductionDelay(INTRODUCTION_FADE_MS, () => {
      introductionWindow.close();
      void hotkeys.reapply(HOTKEY_RANK.TALK);
    });
  }

  async function abandonIntroduction(): Promise<void> {
    if (!introductionWindow.active || !launchStanding()) return;
    introductionWindow.retire();
    panels.reconcile();
    raiseVoiceWindow();
    panels.showInactiveAll();
    introductionWindow.close();
    await hotkeys.reapply(HOTKEY_RANK.TALK);
  }

  const hotkeys = new HotkeyRegistrar({
    registersGlobalKeys: runMode.registersGlobalKeys,
    // The introduction's practice beat is the one time the talk key is claimed
    // with no account credential behind it; otherwise a voice stands only when
    // the host says one does.
    hasCredentials: (rank) =>
      operator.voiceAvailable() || (rank === HOTKEY_RANK.TALK && introductionWindow.active),
    recordProductEvent: (name, properties) => recordProductEvent(name, properties),
    host: {
      voiceHost: () => introductionWindow.current() ?? voiceWindow.current(),
      primaryPanel: () => panels.primaryPanel(),
      displayIdFor: (sender) => panels.displayIdFor(sender),
      modeFor: (displayId) => panels.modeFor(displayId),
      setMode: (displayId, mode, requestFocus) => {
        panels.setMode(displayId, mode, requestFocus);
      },
      broadcast: (channel, payload) => broadcast(channel, payload),
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
      panels.owns(webContents) ||
      introductionWindow.owns(webContents) ||
      voiceWindow.owns(webContents);
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
    setTimeout(
      () =>
        void (async () => {
          await panels.refreshGeometry();
          if (introductionWindow.active) {
            introductionWindow.reposition();
            return;
          }
          panels.reconcile();
        })(),
      100,
    );
  }

  const handleSecondInstance = (_event: Electron.Event, argv: string[]): void => {
    void panels.refreshGeometry().then(() => {
      if (introductionWindow.active) {
        introductionWindow.reposition();
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
    introductionWindow,
    hotkeys,
    dock,
    introductionMinter,
    broadcast,
    sendToVoice,
    reporterOf,
    webContentsByReporter: (reporter) => windowsByReporter.get(reporter),
    trustedSender: (event) => (event.senderFrame?.url ?? event.sender.getURL()) === rendererUrl,
    sendToPrimaryPanel: (channel, payload) => {
      const panel = panels.primaryPanel();
      if (!panel) return false;
      // SAFETY: as in `broadcast`; the payload is a structured-clone snapshot for a channel fixed by this build.
      panel.webContents.send(channel, payload as UnparsedWireValue);
      return true;
    },
    applyLoginItem,
    reapplyTalkHotkey: () => void hotkeys.reapply(HOTKEY_RANK.TALK),
    recycleVoiceWindow: () => {
      if (!voiceWindow.current()) return;
      voiceWindow.close();
      raiseVoiceWindow();
    },
    storeVoiceView: (view) => {
      latestVoiceView = view;
    },
    voiceView: () => latestVoiceView,
    introductionMounted: () => {
      introductionRendererReady = true;
    },
    notePanelReady: (context) => {
      if (!resolveIntroductionPanelReady || !panels.owns(context.sender)) return;
      resolveIntroductionPanelReady();
      resolveIntroductionPanelReady = undefined;
    },
    finishIntroduction,
    abandonIntroduction,
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
      if (giveIntroduction) {
        introductionWindow.open();
        afterIntroductionDelay(INTRODUCTION_RENDER_DEADLINE_MS, () => {
          if (!introductionWindow.active || introductionRendererReady) return;
          config.report("Introduction abandoned: the takeover never reported mounting.");
          void abandonIntroduction();
        });
      }
      panels.setShowOnAllDisplays(settings?.stored.showOnAllDisplays === true);
      panels.setFormFactor(settings?.stored.formFactor ?? DEFAULT_PANEL_FORM_FACTOR);
      hotkeys.setChosen(HOTKEY_RANK.TALK, settings?.stored.voiceHotkey);
      hotkeys.setChosen(HOTKEY_RANK.ASK, settings?.stored.askHotkey);
      hotkeys.setChosen(HOTKEY_RANK.STOP, settings?.stored.stopHotkey);
      await hotkeys.reapply(HOTKEY_RANK.TALK);
      if (!launchStanding()) return;
      if (!introductionWindow.active) panels.reconcile();
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
      for (const wait of introductionWaits) clearTimeout(wait);
      introductionWaits.clear();
      hotkeys.release();
      voiceWindow.closeForGood();
      panels.clearCollapseTimers();
    },
  };
}
