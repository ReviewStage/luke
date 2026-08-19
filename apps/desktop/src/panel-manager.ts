import {
  DEFAULT_PANEL_FORM_FACTOR,
  MOTION_DURATION_MS,
  type NativeNotchGeometry,
  type PanelFormFactor,
  positionNotchWindow,
  resolveNotchGeometry,
  type UnparsedWireValue,
} from "@sidecar/core";
import {
  app,
  BrowserWindow,
  type Display,
  screen,
  systemPreferences,
  type WebContents,
} from "electron";
import { readMacScreenGeometry } from "./macos-screen-geometry";
import { keepWindowStationary } from "./macos-stationary-window";
import type { RunMode } from "./run-mode";
import { channels, type DisplayDiagnostic, type WindowMode } from "./shared/contracts";

export interface PanelDuck {
  setExchangeActive(active: boolean): void;
}

export interface PanelManagerOptions {
  runMode: RunMode;
  mediaDuck: PanelDuck;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  argv?: readonly string[];
}

/**
 * `--duration-exit` plus `--duration-shape` in the shared motion tokens: the
 * content leaves, then the surface closes on the spring, and only then may the
 * window follow.
 */
const COLLAPSE_ANIMATION_MS = MOTION_DURATION_MS.EXIT + MOTION_DURATION_MS.SURFACE;

/** The mode every window is born in; only the dev and capture flags change it. */
function initialWindowMode(runMode: RunMode, argv: readonly string[]): WindowMode {
  if (!runMode.takesFocus) {
    return argv.includes("--compact") ? "compact" : "expanded";
  }
  return argv.includes("--expanded") ? "expanded" : "compact";
}

/**
 * One panel window per display Luke stands on, each with its own mode, collapse
 * timer, and exchange report. Reconcile, rebind, and the sequenced resize live
 * here so a display arriving or leaving cannot drop a conversation, and so
 * every caller — the panel, the tray, the talk key — gets the same ordering
 * when a window grows or shrinks.
 */
export class PanelManager {
  readonly #runMode: RunMode;
  readonly #mediaDuck: PanelDuck;
  readonly #preloadPath: string;
  readonly #rendererHtmlPath: string;
  readonly #rendererUrl: string;
  readonly initialMode: WindowMode;
  /**
   * One panel window per display Luke stands on, keyed by the display's id, each
   * with its own mode: a panel opened on one monitor must not resize the capsule
   * on another. The collapse timers ride the same key, because a collapse is a
   * single window's affair.
   */
  readonly #windows = new Map<number, BrowserWindow>();
  readonly #modes = new Map<number, WindowMode>();
  readonly #collapseTimers = new Map<number, NodeJS.Timeout>();
  /**
   * Which windows hold a live spoken exchange, and the single answer the media
   * duck is given: live anywhere is live. Only the voice host ever actually
   * opens one, but every window reports, so the union is what keeps a
   * bystander's idle from ending the host's exchange.
   */
  readonly #voiceExchanges = new Map<number, boolean>();
  /**
   * Whether Luke stands on every display, mirroring the settings file the way
   * the minter mirrors the chosen voice: read once before any panel exists,
   * updated by the same handler that stores a new choice, so every layout
   * decision stays synchronous. Off means the system's main display alone.
   */
  #showOnAllDisplays = false;
  /** The chosen form for displays without a housing, mirrored the same way. */
  #panelFormFactor: PanelFormFactor = DEFAULT_PANEL_FORM_FACTOR;
  #nativeScreens = new Map<number, NativeNotchGeometry>();

  constructor(options: PanelManagerOptions) {
    this.#runMode = options.runMode;
    this.#mediaDuck = options.mediaDuck;
    this.#preloadPath = options.preloadPath;
    this.#rendererHtmlPath = options.rendererHtmlPath;
    this.#rendererUrl = options.rendererUrl;
    this.initialMode = initialWindowMode(options.runMode, options.argv ?? process.argv);
  }

  /**
   * Makes the windows match the chosen displays: one raised on every chosen
   * display that is connected, none anywhere else. A window whose display went
   * away is moved to a display that needs one rather than destroyed beside a
   * fresh create — a swap of the main display must carry the conversation and
   * the panel's state across, not drop them on the floor. Raising before razing
   * is load-bearing for what remains — a swap must never pass through zero
   * windows, because all windows closed is how this process decides it is done.
   * Everything that changes what the set should be lands here: a switch
   * pressed, a display plugged or unplugged, the stored choice read at launch.
   */
  reconcile(): void {
    const wanted = this.#effectiveDisplayIds();
    const wantedSet = new Set(wanted);
    const missing = wanted.filter((displayId) => !this.#windows.has(displayId));
    const excess = [...this.#windows.keys()].filter((displayId) => !wantedSet.has(displayId));
    // Pair each display that needs a window with a window that lost its display.
    while (missing.length > 0 && excess.length > 0) {
      const toDisplayId = missing.shift();
      const fromDisplayId = excess.shift();
      if (toDisplayId === undefined || fromDisplayId === undefined) break;
      this.#rebind(fromDisplayId, toDisplayId);
    }
    for (const displayId of missing) this.#create(displayId);
    for (const displayId of excess) {
      const window = this.#windows.get(displayId);
      this.#windows.delete(displayId);
      this.#modes.delete(displayId);
      this.#clearCollapseTimer(displayId);
      // A window taken down takes its exchange report with it, so a host that
      // goes mid-conversation releases the duck rather than pinning it forever.
      this.#voiceExchanges.delete(displayId);
      this.#applyVoiceExchanges();
      window?.destroy();
    }
    this.positionAll();
  }

  /**
   * The two directions are sequenced differently, and the ordering lives here so
   * every caller gets it — the panel, the tray, and the motion recorder alike.
   * Growing needs the window first, or the panel has nowhere to unfold into.
   * Shrinking needs the capsule drawn first, or the window clips the panel out
   * from under its own collapse. One display's window at a time: a panel opened
   * on one monitor is no reason to resize the capsule on another.
   */
  setMode(displayId: number, mode: WindowMode, requestFocus: boolean): WindowMode {
    this.#modes.set(displayId, mode);
    const window = this.#windows.get(displayId);
    if (!window || window.isDestroyed()) return mode;

    const expanded = mode === "expanded";
    window.setFocusable(expanded && this.#runMode.takesFocus);
    this.#clearCollapseTimer(displayId);
    if (expanded) {
      this.#position(displayId);
      window.webContents.send(channels.lifecycle, `mode:${mode}`);
    } else {
      window.webContents.send(channels.lifecycle, `mode:${mode}`);
      const delay = this.#collapseDelay();
      if (delay === 0) this.#position(displayId);
      else {
        this.#collapseTimers.set(
          displayId,
          setTimeout(() => {
            this.#collapseTimers.delete(displayId);
            if (this.modeFor(displayId) === "compact") this.#position(displayId);
          }, delay),
        );
      }
    }

    if (expanded && requestFocus && this.#runMode.takesFocus) {
      this.#focusWindow(window);
    } else {
      window.showInactive();
    }
    return mode;
  }

  /**
   * Hands a payload to every living window, optionally skipping the one that
   * already holds the answer in its reply and must redraw from that rather
   * than race a broadcast.
   */
  broadcast<Payload>(channel: string, payload: Payload, except?: WebContents): void {
    for (const window of this.#windows.values()) {
      if (window.isDestroyed() || window.webContents === except) continue;
      // SAFETY: Main-process broadcasts carry structured-clone snapshots produced for channels fixed by this build.
      window.webContents.send(channel, payload as UnparsedWireValue);
    }
  }

  /**
   * The one window a spoken conversation lives in. Voice is a single thing —
   * one microphone, one reply, one face speaking — so the talk key and the
   * attention readouts go to a single renderer rather than opening one
   * conversation per display: the main display's window when Luke stands there,
   * else the first window standing anywhere.
   */
  voiceHost(): BrowserWindow | undefined {
    const primary = this.#windows.get(screen.getPrimaryDisplay().id);
    if (primary && !primary.isDestroyed()) return primary;
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) return window;
    }
    return undefined;
  }

  /** The display a renderer message came from, so each window answers for itself. */
  displayIdFor(sender: WebContents): number | undefined {
    for (const [displayId, window] of this.#windows) {
      if (!window.isDestroyed() && window.webContents === sender) return displayId;
    }
    return undefined;
  }

  modeFor(displayId: number): WindowMode {
    return this.#modes.get(displayId) ?? this.initialMode;
  }

  display(displayId: number): Display | undefined {
    return screen.getAllDisplays().find((candidate) => candidate.id === displayId);
  }

  diagnostic(display: Display): DisplayDiagnostic {
    return {
      id: display.id,
      label: display.label || `Display ${display.id}`,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      notch: resolveNotchGeometry(
        display,
        this.#nativeScreens.get(display.id),
        this.#panelFormFactor,
      ),
    };
  }

  /**
   * The expanded panel owed the keyboard: the one that asked, when the asker is
   * known and still expanded, else whichever panel stands expanded. With two
   * panels open, focus must return to the one the user was typing in rather
   * than to whichever the map happens to list first.
   */
  focusExpanded(preferredDisplayId?: number): void {
    if (preferredDisplayId !== undefined && this.modeFor(preferredDisplayId) === "expanded") {
      const preferred = this.#windows.get(preferredDisplayId);
      if (preferred && !preferred.isDestroyed()) {
        this.#focusWindow(preferred);
        return;
      }
    }
    for (const [displayId, window] of this.#windows) {
      if (this.modeFor(displayId) !== "expanded") continue;
      this.#focusWindow(window);
      return;
    }
  }

  /**
   * Brings the named panel forward when it is the expanded one holding a field.
   * A compact window has nothing to type into.
   */
  focusIfExpanded(displayId: number): void {
    if (this.modeFor(displayId) !== "expanded") return;
    this.#focusWindow(this.#windows.get(displayId));
  }

  positionAll(): void {
    for (const displayId of this.#windows.keys()) this.#position(displayId);
  }

  setShowOnAllDisplays(show: boolean): void {
    this.#showOnAllDisplays = show;
  }

  setFormFactor(formFactor: PanelFormFactor): void {
    this.#panelFormFactor = formFactor;
  }

  setVoiceExchange(displayId: number, active: boolean): void {
    this.#voiceExchanges.set(displayId, active);
    this.#applyVoiceExchanges();
  }

  /** Whether some panel window's renderer is asking, whichever display it is on. */
  owns(webContents: WebContents): boolean {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed() && window.webContents === webContents) return true;
    }
    return false;
  }

  refreshGeometry(): void {
    this.#nativeScreens = readMacScreenGeometry();
    // A capture run pins a fixture housing on the main display, where the
    // evidence is taken; an interactive fixture still stands on the real
    // screen, because it is a person looking, not a camera.
    if (!this.#runMode.takesFocus) {
      const display = screen.getPrimaryDisplay();
      this.#nativeScreens.set(display.id, {
        displayId: display.id,
        safeAreaTop: 38,
        menuBarHeight: 38,
        notchWidth: 210,
        hasNotch: true,
        source: "fixture",
      });
    }
  }

  showInactiveAll(): void {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) window.showInactive();
    }
  }

  clearCollapseTimers(): void {
    for (const displayId of [...this.#collapseTimers.keys()]) this.#clearCollapseTimer(displayId);
  }

  /**
   * Where Luke stands right now: every connected display when asked to stand on
   * all of them, the system's main display alone otherwise. A capture run stays
   * on the main display regardless, where its fixture housing is pinned.
   */
  #effectiveDisplayIds(): number[] {
    if (this.#runMode.takesFocus && this.#showOnAllDisplays) {
      return screen.getAllDisplays().map((display) => display.id);
    }
    return [screen.getPrimaryDisplay().id];
  }

  #layoutFor(display: Display, mode: WindowMode) {
    return positionNotchWindow(
      display,
      mode,
      this.#nativeScreens.get(display.id),
      this.#panelFormFactor,
    );
  }

  /**
   * Resizes without AppKit's frame animation. An animated setBounds re-lays out
   * the renderer at a new viewport width on every frame — and its duration scales
   * with the distance moved, so a 482px growth ran far longer than the panel's
   * own motion. The window instead snaps to the size the mode needs and the renderer
   * animates the capsule into the panel inside it, where the viewport is constant
   * and the work stays on the compositor.
   */
  #position(displayId: number): void {
    const window = this.#windows.get(displayId);
    if (!window || window.isDestroyed()) return;
    const display = this.display(displayId);
    // A window whose display has gone is the reconciler's to take down, not
    // this function's to guess a home for.
    if (!display) return;
    const layout = this.#layoutFor(display, this.modeFor(displayId));
    window.setBounds({
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    });
    window.webContents.send(channels.displayChanged, this.diagnostic(display));
  }

  /**
   * Moves a living window to another display, state and all: its mode, its
   * collapse-in-flight, its exchange report, and the renderer behind it — which
   * learns its new ground from the `displayChanged` the repositioning sends,
   // SAFETY: The preceding check establishes the asserted contract.
   * exactly as it would for a geometry change in place.
   */
  #rebind(fromDisplayId: number, toDisplayId: number): void {
    const window = this.#windows.get(fromDisplayId);
    if (!window) return;
    this.#windows.delete(fromDisplayId);
    this.#windows.set(toDisplayId, window);
    this.#modes.set(toDisplayId, this.modeFor(fromDisplayId));
    this.#modes.delete(fromDisplayId);
    // The timer's closure names the old display; the reposition below redraws
    // whatever a cancelled collapse would have.
    this.#clearCollapseTimer(fromDisplayId);
    const exchange = this.#voiceExchanges.get(fromDisplayId);
    this.#voiceExchanges.delete(fromDisplayId);
    if (exchange !== undefined) this.#voiceExchanges.set(toDisplayId, exchange);
    this.#applyVoiceExchanges();
  }

  #clearCollapseTimer(displayId: number): void {
    const timer = this.#collapseTimers.get(displayId);
    if (!timer) return;
    clearTimeout(timer);
    this.#collapseTimers.delete(displayId);
  }

  #configure(window: BrowserWindow): void {
    window.setAlwaysOnTop(true, "pop-up-menu");
    if (process.platform === "darwin") {
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      window.setHiddenInMissionControl(true);
      window.setWindowButtonVisibility(false);
      keepWindowStationary(window);
    }
  }

  /**
   // SAFETY: The preceding check establishes the asserted contract.
   * Brings one panel forward as the key window. An accessory app has no Dock
   * presence, so the app itself has to come forward before one of its windows can
   * take keyboard focus.
   */
  #focusWindow(window: BrowserWindow | undefined): void {
    if (!window || window.isDestroyed() || !this.#runMode.takesFocus) return;
    if (process.platform === "darwin") app.focus({ steal: true });
    window.show();
    window.focus();
  }

  #applyVoiceExchanges(): void {
    this.#mediaDuck.setExchangeActive([...this.#voiceExchanges.values()].some(Boolean));
  }

  #collapseDelay(): number {
    if (!this.#runMode.animates) return 0;
    return systemPreferences.getAnimationSettings().prefersReducedMotion
      ? 0
      : COLLAPSE_ANIMATION_MS;
  }

  #create(displayId: number): void {
    const display = this.display(displayId);
    if (!display) return;
    this.#modes.set(displayId, this.initialMode);
    const layout = this.#layoutFor(display, this.initialMode);

    const window = new BrowserWindow({
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
      focusable: this.initialMode === "expanded" && this.#runMode.takesFocus,
      acceptFirstMouse: true,
      type: process.platform === "darwin" ? "panel" : undefined,
      webPreferences: {
        preload: this.#preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: this.#runMode.takesFocus,
        backgroundThrottling: false,
      },
    });
    this.#windows.set(displayId, window);

    this.#configure(window);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== this.#rendererUrl) event.preventDefault();
    });
    window.once("ready-to-show", () => {
      if (this.#runMode.takesFocus && !window.isDestroyed()) window.showInactive();
    });
    // The reconciler deletes before it destroys, so this answers only a window
    // that went down some other way — and it must not leave a ghost in the map,
    // nor a phantom exchange holding the duck down. Found by the window rather
    // than the id it was born under, because a rebind may have moved it.
    window.on("closed", () => {
      for (const [id, candidate] of [...this.#windows]) {
        if (candidate !== window) continue;
        this.#windows.delete(id);
        this.#modes.delete(id);
        this.#clearCollapseTimer(id);
        this.#voiceExchanges.delete(id);
        this.#applyVoiceExchanges();
      }
    });
    void window.loadFile(this.#rendererHtmlPath);
  }
}
