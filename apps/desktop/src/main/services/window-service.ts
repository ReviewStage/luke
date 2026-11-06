import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_LINK_CLAIM, APP_LINK_SCHEME, appLinkClaim } from "@repo/features/app-links";
import type { ShownLink } from "@repo/features/link-grammar";
import { PAGE_SCHEME } from "@repo/features/page-frame";
import type { AppStateSnapshot, AppWindowFacts } from "@repo/host/app-state";
import { applyThemePreference, NativeTheme } from "@repo/host/appearance";
import type { AppStateStore, OperatorClient } from "@repo/host/client";
import { PUSH } from "@repo/host/contract";
import type { DesktopService } from "@repo/host/desktop-service";
import { APP_SETTING_SCHEMA } from "@repo/settings";
import { devBuildBadge } from "@repo/settings/dev-build";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { Effect } from "effect";
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
import type { BuildLabelMenu } from "../app-menu";
import { followDockIcon } from "../window/dock-icon";
import { askForNotifications } from "../window/notice-doors";
import { pageResponse } from "../window/page-protocol";
import { PanelManager } from "../window/panel-manager";
import { reportRendererErrors } from "../window/renderer-errors";
import { followResponsiveness } from "../window/renderer-health";
import { windowMaterialFor } from "../window/window-material";
import { grantWindowPermissions } from "../window/window-permissions";
import { windowPushes } from "../window/window-pushes";
import { PanelWindows, zoomFactorOf, zoomSteer } from "../window/zoom";
import type { DesktopConfig } from "./desktop-config";
import { reportUnresponsivePanel } from "./telemetry-service";

const DISPLAY_SETTLE_MS = 100;

export interface WindowServiceDependencies {
  config: DesktopConfig;
  state: AppStateStore;
  operator: OperatorClient;
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
  launchStanding: () => boolean;
}

export interface WindowService extends DesktopService {
  readonly panels: PanelManager;
  publishAppState: () => void;
  applyAppearance: () => Effect.Effect<void>;
  appStateFor: (sender: WebContents) => AppStateSnapshot;
  panelReady: () => void;
  showSettings: () => void;
  onPanelFocusChanged: (listener: (focused: boolean) => void) => () => void;
  reporterOf: (sender: WebContents) => string;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  applyLoginItem: (openAtLogin: boolean) => void;
  showBuildLabel: (shown: boolean) => boolean;
}

export function createWindowService(dependencies: WindowServiceDependencies): WindowService {
  const { config, state, operator, run, launchStanding } = dependencies;
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

  const panels = new PanelManager({
    runMode,
    material: windowMaterialFor(process.getSystemVersion()),
    instance: config.instance,
    preloadPath,
    rendererHtmlPath,
    rendererUrl,
    zoomFactor: () => zoomFactorOf(state.snapshot().settings?.stored.zoom),
    placementPath: runMode.takesFocus ? path.join(config.stateRoot, "main-window.json") : undefined,
    closing: () => !launchStanding(),
    onAllClosed: () => config.quit(),
    onFullScreenChanged: () => publishAppState(),
    followResponsiveness: (window) => {
      void run(followResponsiveness(window, reportUnresponsivePanel));
    },
    onRendererGone: (reason) => config.report(`Panel renderer gone: ${reason}`),
  });
  let stopRendererErrors = (): void => undefined;
  let buildLabelHidden = false;
  let showBuildLabel = (_shown: boolean): boolean => false;

  const withNativeTheme = Effect.provideService(NativeTheme, nativeTheme);
  const withPanelWindows = Effect.provideService(PanelWindows, {
    standing: () => panels.windows(),
  });
  const steerZoom = zoomSteer();
  const applyAppearance = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      const stored = state.snapshot().settings?.stored;
      return Effect.andThen(
        applyThemePreference(stored?.theme).pipe(withNativeTheme),
        steerZoom(stored?.zoom).pipe(withPanelWindows),
      );
    });
  function windowFactsFor(sender: WebContents): AppWindowFacts {
    return { fullScreen: panels.fullScreen(sender), buildLabelHidden };
  }

  function appStateFor(sender: WebContents): AppStateSnapshot {
    return { ...state.snapshot(), window: windowFactsFor(sender) };
  }

  function publishAppState(): void {
    for (const sender of panels.senders()) windowPushes.pushState(sender, appStateFor(sender));
  }

  function showSettings(): void {
    panels.broadcast(PUSH.MENU_COMMAND, APP_COMMAND.SETTINGS);
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

  const pendingWaits = new Set<ReturnType<typeof setTimeout>>();
  function afterDelay(delayMs: number, run: () => void): void {
    if (!launchStanding()) return;
    const wait = setTimeout(() => {
      pendingWaits.delete(wait);
      if (!launchStanding()) return;
      run();
    }, delayMs);
    pendingWaits.add(wait);
  }
  function applyLoginItem(openAtLogin: boolean): void {
    if (config.packaged) app.setLoginItemSettings({ openAtLogin });
  }

  function configurePermissions(): void {
    grantWindowPermissions(session.defaultSession, (webContents) => panels.owns(webContents));
  }

  function handleDisplayChange(): void {
    afterDelay(DISPLAY_SETTLE_MS, () => panels.reconcile());
  }

  const handleSecondInstance = (): void => {
    if (!launchStanding()) return;
    panels.reconcile();
    panels.focusExpanded();
  };
  const openAppLink = (link: ShownLink): void => {
    panels.focusExpanded();
    panels.broadcast(PUSH.SHOW_LINK, link);
  };
  const handleActivate = (): void => {
    panels.focusExpanded();
  };
  const wake = (eventName: "resume" | "unlock-screen" | "user-did-become-active") => () => {
    handleDisplayChange();
    if (eventName === "resume") void run(operator.host.terminalWake());
    if (eventName === "resume") void run(operator.host.hostsPresenceRefresh());
    if (eventName !== "user-did-become-active") void run(operator.host.tasksResync());
  };
  const wakeHandlers = {
    resume: wake("resume"),
    "unlock-screen": wake("unlock-screen"),
    "user-did-become-active": wake("user-did-become-active"),
  } as const;

  return {
    name: "windows",
    panels,
    publishAppState,
    applyAppearance,
    appStateFor,
    panelReady: () => config.appLinks.ready(openAppLink),
    showSettings,
    onPanelFocusChanged,
    reporterOf,
    trustedSender: (event) => {
      const url = event.senderFrame?.url ?? event.sender.getURL();
      return url === rendererUrl;
    },
    applyLoginItem,
    showBuildLabel: (shown) => showBuildLabel(shown),
    start: async () => {
      const badge = config.packaged
        ? undefined
        : devBuildBadge({ instance: config.instance, commit: config.commit });
      const bandDockIcon = followDockIcon(
        path.join(config.resourceDirectory, "icon"),
        badge,
        config.report,
      );
      const buildLabelMenu = (shown: boolean): BuildLabelMenu => ({
        shown,
        onShow: (next) => void showBuildLabel(next),
      });
      if (badge !== undefined) {
        showBuildLabel = (next) => {
          buildLabelHidden = !next;
          bandDockIcon(next ? badge : undefined);
          config.showMenuBar({ buildLabel: buildLabelMenu(next) });
          publishAppState();
          return true;
        };
      }
      const settings = await run(operator.ensureSettings());
      if (!launchStanding()) return;
      await run(applyThemePreference(settings?.stored.theme).pipe(withNativeTheme));
      applyLoginItem(settings?.stored.openAtLogin ?? APP_SETTING_SCHEMA.openAtLogin.default);
      if (runMode.observesProviders) askForNotifications();
      session.defaultSession.protocol.handle(PAGE_SCHEME, (request) =>
        run(pageResponse(request.url, operator.host.tasksPage)),
      );
      if (!config.packaged) stopRendererErrors = reportRendererErrors(config.report);
      if (runMode.takesFocus) config.showMenuBar({ developerTools: true });
      if (badge !== undefined) config.showMenuBar({ buildLabel: buildLabelMenu(true) });
      config.showMenuBar({
        panel: {
          isPanel: (window) => panels.windows().some((panel) => panel === window),
          onReopen: (command) => {
            panels.focusExpanded();
            if (command !== undefined) panels.broadcast(PUSH.MENU_COMMAND, command);
          },
        },
      });
      panels.reconcile();
      configurePermissions();

      const linkClaim = appLinkClaim({ packaged: config.packaged, live: runMode.sendsNetwork });
      if (linkClaim === APP_LINK_CLAIM.CLAIM) app.setAsDefaultProtocolClient(APP_LINK_SCHEME);
      if (linkClaim === APP_LINK_CLAIM.RELEASE) app.removeAsDefaultProtocolClient(APP_LINK_SCHEME);
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
      config.appLinks.close();
      stopRendererErrors();
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
      if (session.defaultSession.protocol.isProtocolHandled(PAGE_SCHEME)) {
        session.defaultSession.protocol.unhandle(PAGE_SCHEME);
      }
    },
  };
}
