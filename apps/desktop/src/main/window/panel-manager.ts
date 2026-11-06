import { PRODUCT_NAME } from "@repo/features/product-name";
import type { RunMode } from "@repo/host";
import type { EventPushName, PushPayload } from "@repo/host/contract";
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Display,
  type Rectangle,
  screen,
  type WebContents,
} from "electron";
import { layLiquidGlass } from "../native/liquid-glass";
import { hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";
import { askReloadPanel } from "./reload-dialog";
import { onRendererDeath, RendererRevival } from "./renderer-revival";
import { followSwipes } from "./swipe-navigation";
import { WINDOW_MATERIAL, type WindowMaterial } from "./window-material";
import {
  placementOf,
  placeWindow,
  readWindowPlacement,
  writeWindowPlacement,
} from "./window-placement";
import { windowPushes } from "./window-pushes";
import { trafficLightsAt } from "./zoom";

interface PanelManagerOptions {
  runMode: RunMode;
  material?: WindowMaterial | undefined;
  instance?: string | undefined;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  zoomFactor: () => number;
  placementPath: string | undefined;
  closing: () => boolean;
  onAllClosed?: () => void;
  onFullScreenChanged?: () => void;
  followResponsiveness?: (window: BrowserWindow) => void;
  onRendererGone?: (reason: string) => void;
}

const DESKTOP_WINDOW = {
  WIDTH: 1280,
  HEIGHT: 840,
  MIN_WIDTH: 760,
  MIN_HEIGHT: 520,
  MARGIN: 24,
  MATERIAL: "sidebar",
  CLEAR: "#00000000",
} as const;

const SIDEBAR_VIBRANCY = {
  vibrancy: DESKTOP_WINDOW.MATERIAL,
  visualEffectState: "followWindow",
} as const satisfies BrowserWindowConstructorOptions;

function layGlassOnceLoaded(window: BrowserWindow): void {
  window.webContents.once("did-finish-load", () => {
    if (window.isDestroyed()) return;
    window.setWindowButtonVisibility(true);
    if (!layLiquidGlass(window)) window.setVibrancy(DESKTOP_WINDOW.MATERIAL);
  });
}

function desktopBounds(display: Display): Rectangle {
  const area = display.workArea;
  const width = Math.min(DESKTOP_WINDOW.WIDTH, area.width - DESKTOP_WINDOW.MARGIN * 2);
  const height = Math.min(DESKTOP_WINDOW.HEIGHT, area.height - DESKTOP_WINDOW.MARGIN * 2);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

export class PanelManager {
  readonly #runMode: RunMode;
  readonly #instance: string | undefined;
  readonly #preloadPath: string;
  readonly #rendererHtmlPath: string;
  readonly #rendererUrl: string;
  readonly #zoomFactor: () => number;
  readonly #onAllClosed: (() => void) | undefined;
  readonly #onFullScreenChanged: (() => void) | undefined;
  readonly #followResponsiveness: ((window: BrowserWindow) => void) | undefined;
  readonly #onRendererGone: ((reason: string) => void) | undefined;
  readonly #placementPath: string | undefined;
  readonly #closing: () => boolean;
  readonly #windows = new Map<number, BrowserWindow>();
  readonly #hidden = new WeakSet<BrowserWindow>();

  readonly #material: WindowMaterial;

  constructor(options: PanelManagerOptions) {
    this.#runMode = options.runMode;
    this.#material = options.material ?? WINDOW_MATERIAL.SIDEBAR;
    this.#instance = options.instance;
    this.#preloadPath = options.preloadPath;
    this.#rendererHtmlPath = options.rendererHtmlPath;
    this.#rendererUrl = options.rendererUrl;
    this.#zoomFactor = options.zoomFactor;
    this.#onAllClosed = options.onAllClosed;
    this.#onFullScreenChanged = options.onFullScreenChanged;
    this.#followResponsiveness = options.followResponsiveness;
    this.#onRendererGone = options.onRendererGone;
    this.#placementPath = options.placementPath;
    this.#closing = options.closing;
  }

  reconcile(): void {
    const wanted = screen.getPrimaryDisplay().id;
    const [held] = [...this.#windows.keys()];
    if (held === undefined) this.#create(wanted);
    else if (held !== wanted) this.#rebind(held, wanted);
  }

  broadcast<Name extends EventPushName>(push: Name, payload: PushPayload<Name>): void {
    for (const window of this.#windows.values()) {
      if (window.isDestroyed()) continue;
      windowPushes.push(window.webContents, push, payload);
    }
  }

  primaryPanel(): BrowserWindow | undefined {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) return window;
    }
    return undefined;
  }

  #holdState(window: BrowserWindow): void {
    windowPushes.holdState(window.webContents, this.#hidden.has(window));
  }

  #followVisibility(window: BrowserWindow): void {
    const hidden = () => {
      if (window.isDestroyed()) return;
      this.#hidden.add(window);
      this.#holdState(window);
    };
    const shown = () => {
      if (window.isDestroyed()) return;
      this.#hidden.delete(window);
      this.#holdState(window);
    };
    window.on("hide", hidden);
    window.on("minimize", hidden);
    window.on("show", shown);
    window.on("restore", shown);
    window.on("focus", shown);
  }

  windows(): readonly BrowserWindow[] {
    return [...this.#windows.values()].filter((window) => !window.isDestroyed());
  }

  senders(): readonly WebContents[] {
    const senders: WebContents[] = [];
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) senders.push(window.webContents);
    }
    return senders;
  }

  displayIdFor(sender: WebContents): number | undefined {
    for (const [displayId, window] of this.#windows) {
      if (!window.isDestroyed() && window.webContents === sender) return displayId;
    }
    return undefined;
  }

  display(displayId: number): Display | undefined {
    return screen.getAllDisplays().find((candidate) => candidate.id === displayId);
  }

  focusExpanded(): void {
    this.#focusWindow(this.primaryPanel());
  }

  focusIfExpanded(displayId: number): void {
    this.#focusWindow(this.#windows.get(displayId));
  }

  get standing(): number {
    let count = 0;
    for (const window of this.#windows.values()) if (!window.isDestroyed()) count += 1;
    return count;
  }

  owns(webContents: WebContents): boolean {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed() && window.webContents === webContents) return true;
    }
    return false;
  }

  fullScreen(webContents: WebContents): boolean {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed() && window.webContents === webContents) return window.isFullScreen();
    }
    return false;
  }

  showInactiveAll(): void {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) window.showInactive();
    }
  }

  #rebind(fromDisplayId: number, toDisplayId: number): void {
    const window = this.#windows.get(fromDisplayId);
    if (!window) return;
    this.#windows.delete(fromDisplayId);
    this.#windows.set(toDisplayId, window);
  }

  #focusWindow(window: BrowserWindow | undefined): void {
    if (!window || window.isDestroyed() || !this.#runMode.takesFocus) return;
    if (process.platform === "darwin") app.focus({ steal: true });
    window.show();
    window.focus();
  }

  #keepPlacement(window: BrowserWindow): void {
    if (this.#placementPath === undefined) return;
    writeWindowPlacement(
      this.#placementPath,
      placementOf({
        normal: window.getNormalBounds(),
        shown: window.getBounds(),
        zoomed: window.isMaximized(),
        fullScreen: window.isFullScreen(),
      }),
    );
  }

  #create(displayId: number): void {
    const display = this.display(displayId);
    if (!display) return;
    const placement = placeWindow({
      saved:
        this.#placementPath === undefined ? undefined : readWindowPlacement(this.#placementPath),
      workAreas: screen.getAllDisplays().map((each) => each.workArea),
      first: desktopBounds(display),
    });
    const zoomFactor = this.#zoomFactor();

    const material = this.#material;
    const windowOptions: BrowserWindowConstructorOptions = {
      ...placement.bounds,
      ...(placement.fullScreen ? { fullscreen: true } : undefined),
      minWidth: DESKTOP_WINDOW.MIN_WIDTH,
      minHeight: DESKTOP_WINDOW.MIN_HEIGHT,
      title: this.#instance === undefined ? PRODUCT_NAME : `${PRODUCT_NAME} (${this.#instance})`,
      show: false,
      backgroundColor: DESKTOP_WINDOW.CLEAR,
      ...(material === WINDOW_MATERIAL.LIQUID_GLASS
        ? { transparent: true, visualEffectState: SIDEBAR_VIBRANCY.visualEffectState }
        : SIDEBAR_VIBRANCY),
      titleBarStyle: "hiddenInset",
      trafficLightPosition: trafficLightsAt(zoomFactor),
      webPreferences: {
        ...hardenedWebPreferences({ preloadPath: this.#preloadPath, runMode: this.#runMode }),
        zoomFactor,
      },
    };
    const window = new BrowserWindow(windowOptions);
    this.#windows.set(displayId, window);
    const page = window.webContents;
    if (material === WINDOW_MATERIAL.LIQUID_GLASS) layGlassOnceLoaded(window);

    refuseForeignNavigation(window, this.#rendererUrl);
    this.#followVisibility(window);
    this.#followResponsiveness?.(window);
    const revival = this.#followDeaths(window);
    const drew = () => {
      if (window.isDestroyed()) return;
      revival.loaded();
    };
    window.webContents.on("did-finish-load", drew);
    window.once("ready-to-show", () => {
      if (window.isDestroyed()) return;
      drew();
      if (placement.zoomed) window.maximize();
      if (this.#runMode.takesFocus) this.#focusWindow(window);
      else window.showInactive();
    });
    window.on("close", (event) => {
      this.#keepPlacement(window);
      if (this.#closing()) return;
      event.preventDefault();
      window.hide();
    });
    const instance = this.#instance;
    if (instance !== undefined) {
      window.on("page-title-updated", (event, title) => {
        event.preventDefault();
        window.setTitle(`${title} (${instance})`);
      });
    }
    window.on("enter-full-screen", () => this.#onFullScreenChanged?.());
    window.on("leave-full-screen", () => this.#onFullScreenChanged?.());
    followSwipes(window);
    window.on("closed", () => {
      revival.stop();
      windowPushes.holdState(page, false);
      for (const [id, candidate] of [...this.#windows]) {
        if (candidate !== window) continue;
        this.#windows.delete(id);
      }
      if (this.#windows.size === 0) this.#onAllClosed?.();
    });
    this.#load(window);
  }

  #load(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    window.loadFile(this.#rendererHtmlPath).catch(() => undefined);
  }

  #followDeaths(window: BrowserWindow): RendererRevival {
    const revival: RendererRevival = new RendererRevival({
      revive: () => this.#load(window),
      onGone: (reason) => this.#onRendererGone?.(`${reason} It is being reloaded.`),
      onGaveUp: (reason) => {
        this.#onRendererGone?.(`${reason} It stopped reloading, so the developer was asked.`);
        void askReloadPanel(window).then((reload) => {
          if (window.isDestroyed() || this.#closing()) return;
          if (!reload) app.quit();
          if (!this.#closing()) revival.restart();
        });
      },
    });
    onRendererDeath(window.webContents, "panel", (reason) => {
      if (window.isDestroyed() || this.#closing()) return;
      revival.gone(reason);
    });
    return revival;
  }
}
