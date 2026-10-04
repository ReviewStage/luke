import type { RunMode } from "@sidecar/host";
import {
  DEFAULT_PANEL_FORM_FACTOR,
  type NativeNotchGeometry,
  type PanelFormFactor,
  resolveNotchGeometry,
} from "@sidecar/surface";
import type { UnparsedWireValue } from "@sidecar/wire";
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Display,
  type Rectangle,
  screen,
  type WebContents,
} from "electron";
import { channels } from "#shared/bridge";
import type { DisplayDiagnostic, WindowMode } from "#shared/messages/session";
import { readMacScreenGeometry } from "../native/screen-geometry";
import {
  dressMacWindow,
  hardenedWebPreferences,
  refuseForeignNavigation,
  WINDOW_LEVEL,
} from "./hardened-window";

interface PanelDuck {
  setExchangeActive(active: boolean): void;
}

interface PanelManagerOptions {
  runMode: RunMode;
  mediaDuck: PanelDuck;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  /**
   * The last panel window went down on its own. All panels closed is how
   * this process decides it is done, and `window-all-closed` can no longer
   * say so once a hidden window of Luke's own stands beside them.
   */
  onAllClosed?: () => void;
  /**
   * A fact one window answers for has moved — its mode, or the geometry of
   * the display under it. Neither is a slice of the app-state document, and
   * both ride the snapshot a window is handed, so the document has to be
   * announced again for the window to be handed one.
   */
  onWindowFactsChanged?: () => void;
  /**
   * The renderer behind a fullscreen takeover died, hung, or never loaded. A
   * dead renderer leaves its window standing, and a window standing over the
   * whole display with nothing drawn on it is the one failure a takeover must
   * not be able to reach — the desktop, the menu bar, and every other app are
   * behind it. An ordinary panel's renderer going is the panel's own affair
   * and nothing here answers for it.
   */
  onTakeoverGone?: (reason: string) => void;
}

/**
 * Checklist: scripts/evidence.sh validates every capture at WIDTH by HEIGHT.
 *
 * The window Luke opens in: large enough to read a plan beside its questions,
 * and never past the display's work area less a margin, so a small display
 * still shows the whole window with the Dock and the menu bar clear of it.
 */
const DESKTOP_WINDOW = {
  WIDTH: 1280,
  HEIGHT: 840,
  MIN_WIDTH: 760,
  MIN_HEIGHT: 520,
  // Small enough that a 13-inch display's work area still fits the full size.
  MARGIN: 24,
  BACKGROUND: "#0b0b0d",
} as const;

/** The first frame of the window, centred in the display's work area. */
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

/**
 * Puts the window back to an ordinary app window after a takeover dressed it
 * at a level of its own: a normal level, the current Space only, in Mission
 * Control, with its traffic lights. Changing the level is also what puts
 * AppKit's managed collection behavior back over the stationary flag.
 */
function undressMacWindow(window: BrowserWindow): void {
  window.setAlwaysOnTop(false);
  if (process.platform !== "darwin") return;
  window.setVisibleOnAllWorkspaces(false);
  window.setHiddenInMissionControl(false);
  window.setWindowButtonVisibility(true);
}

/**
 * Luke's one window: an ordinary, resizable app window on the main display,
 * always showing the panel. It is kept under the panel's old name and shape
 * because every caller — the IPC handlers, the tray, the talk key, the
 * introduction — addresses a panel by display, and the window answers for
 * the display it was opened against. Closing it hides it; the app keeps
 * listening, and the Dock tile or a second launch brings it back.
 */
export class PanelManager {
  readonly #runMode: RunMode;
  readonly #mediaDuck: PanelDuck;
  readonly #preloadPath: string;
  readonly #rendererHtmlPath: string;
  readonly #rendererUrl: string;
  readonly #onAllClosed: (() => void) | undefined;
  readonly #onWindowFactsChanged: (() => void) | undefined;
  readonly #onTakeoverGone: ((reason: string) => void) | undefined;
  /** Always expanded: the window has no compact shape to fall back to. */
  readonly initialMode: WindowMode = "expanded";
  /** The window, keyed by the display it was opened against. */
  readonly #windows = new Map<number, BrowserWindow>();
  #panelFormFactor: PanelFormFactor = DEFAULT_PANEL_FORM_FACTOR;
  #nativeScreens = new Map<number, NativeNotchGeometry>();
  /**
   * The display the introduction's takeover covers, absent when none does,
   * and the frame the window held before it, so leaving puts the window back
   * where the developer left it.
   */
  #takeover: number | undefined;
  #boundsBeforeTakeover: Rectangle | undefined;
  /** Set once a quit begins, so closing the window then destroys it rather than hiding it. */
  #quitting = false;

  constructor(options: PanelManagerOptions) {
    this.#runMode = options.runMode;
    this.#mediaDuck = options.mediaDuck;
    this.#preloadPath = options.preloadPath;
    this.#rendererHtmlPath = options.rendererHtmlPath;
    this.#rendererUrl = options.rendererUrl;
    this.#onAllClosed = options.onAllClosed;
    this.#onWindowFactsChanged = options.onWindowFactsChanged;
    this.#onTakeoverGone = options.onTakeoverGone;
    app.on("before-quit", () => {
      this.#quitting = true;
    });
  }

  /**
   * Makes sure the one window stands, keyed by the main display. A window
   * whose display went away is re-keyed rather than recreated, so the
   * conversation and the panel's state survive a swap of the main display;
   * macOS itself moves the frame onto a display that is still there.
   */
  reconcile(): void {
    const wanted = this.#effectiveDisplayId();
    const [held] = [...this.#windows.keys()];
    if (held === undefined) this.#create(wanted);
    else if (held !== wanted) this.#rebind(held, wanted);
  }

  /**
   * The window has one mode. A request for the capsule — Escape, a pointer
   * leaving, a row press standing the panel down — is answered with the mode
   * the window holds, so the renderer keeps drawing the panel; a request to
   * expand with focus brings the window forward.
   */
  setMode(displayId: number, mode: WindowMode, requestFocus: boolean): WindowMode {
    const window = this.#windows.get(displayId);
    if (!window || window.isDestroyed()) return "expanded";
    window.webContents.send(channels.onLifecycle, "mode:expanded");
    if (mode === "expanded" && requestFocus && this.#takeover !== displayId) {
      this.#focusWindow(window);
    }
    return "expanded";
  }

  /** Nothing to stand down: an ordinary window does not cover the chat a row press opens. */
  standDown(): void {}

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

  /** The window an action aimed at the app lands on. */
  primaryPanel(): BrowserWindow | undefined {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) return window;
    }
    return undefined;
  }

  /** Every living panel's renderer, for a payload composed per window. */
  senders(): readonly WebContents[] {
    const senders: WebContents[] = [];
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) senders.push(window.webContents);
    }
    return senders;
  }

  /** The display a renderer message came from, so each window answers for itself. */
  displayIdFor(sender: WebContents): number | undefined {
    for (const [displayId, window] of this.#windows) {
      if (!window.isDestroyed() && window.webContents === sender) return displayId;
    }
    return undefined;
  }

  modeFor(_displayId: number): WindowMode {
    return "expanded";
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

  /** Brings the window forward, shown again if it was closed. */
  focusExpanded(_preferredDisplayId?: number): void {
    this.#focusWindow(this.primaryPanel());
  }

  focusIfExpanded(displayId: number): void {
    this.#focusWindow(this.#windows.get(displayId));
  }

  /** The developer owns the frame; only the takeover ever sets it. */
  positionAll(): void {}

  /** One window on the main display, whatever the stored choice says. */
  setShowOnAllDisplays(_show: boolean): void {}

  setFormFactor(formFactor: PanelFormFactor): void {
    this.#panelFormFactor = formFactor;
  }

  /**
   * Puts the window over the whole of its display for the introduction. The
   * frame it held is kept and put back by `leaveTakeover`. A renderer that
   * dies, hangs, or never loads hands the display back through
   * `onTakeoverGone`. Idempotent: a re-take after a display change covers
   * what is there now without reclaiming the pointer or the keyboard.
   * Answers the display id it took, or `undefined` when no window stands.
   */
  enterTakeover(): number | undefined {
    const window = this.primaryPanel();
    if (!window) return undefined;
    const displayId = this.displayIdFor(window.webContents);
    if (displayId === undefined) return undefined;
    const display = this.display(displayId);
    if (!display) return undefined;
    const taking = this.#takeover === undefined;
    this.#takeover = displayId;
    if (taking) this.#boundsBeforeTakeover = window.getBounds();
    window.setBounds(display.bounds);
    if (taking) {
      dressMacWindow(window, WINDOW_LEVEL.TAKEOVER);
      window.setIgnoreMouseEvents(false);
      this.#raiseTakeover(window, displayId);
    }
    return displayId;
  }

  /**
   * Brings the takeover forward once it has painted: a window born
   * `show: false` put over the whole display before its first frame is a
   * blank sheet swallowing every click.
   */
  #raiseTakeover(window: BrowserWindow, displayId: number): void {
    if (window.isVisible()) {
      this.#focusWindow(window);
      return;
    }
    window.once("ready-to-show", () => {
      if (window.isDestroyed() || this.#takeover !== displayId) return;
      this.#focusWindow(window);
    });
  }

  /**
   * Returns the window to an ordinary app window at the frame it held before
   * the takeover. Idempotent, and safe to call for a window that has since gone.
   */
  leaveTakeover(): void {
    const displayId = this.#takeover;
    if (displayId === undefined) return;
    this.#takeover = undefined;
    const window = this.#windows.get(displayId);
    const display = this.display(displayId);
    if (window && !window.isDestroyed()) {
      undressMacWindow(window);
      // The takeover hands the pointer back as it lands; an app window takes it whole.
      window.setIgnoreMouseEvents(false);
      const restored = this.#boundsBeforeTakeover ?? (display ? desktopBounds(display) : undefined);
      if (restored) window.setBounds(restored);
      this.#focusWindow(window);
    }
    this.#boundsBeforeTakeover = undefined;
    this.#onWindowFactsChanged?.();
  }

  /**
   * Whether a spoken exchange is live, as the main process derives it from the
   * voice window's report. The media duck follows it directly.
   */
  setVoiceExchange(active: boolean): void {
    this.#mediaDuck.setExchangeActive(active);
  }

  /** How many panel windows stand — the count the process's lifetime is decided by. */
  get standing(): number {
    let count = 0;
    for (const window of this.#windows.values()) if (!window.isDestroyed()) count += 1;
    return count;
  }

  /** Whether the panel window's renderer is asking. */
  owns(webContents: WebContents): boolean {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed() && window.webContents === webContents) return true;
    }
    return false;
  }

  async refreshGeometry(): Promise<void> {
    this.#nativeScreens = await readMacScreenGeometry();
    // A capture run pins a fixture housing on the main display, where the
    // evidence is taken; the introduction's flight still lands on it.
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

  /** Shows the window without taking focus, as a second launch or a wake asks. */
  showInactiveAll(): void {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) window.showInactive();
    }
  }

  /** No collapse runs on a clock any more; kept for the teardown that calls it. */
  clearCollapseTimers(): void {}

  /** The main display, or the takeover's while one stands. */
  #effectiveDisplayId(): number {
    if (this.#takeover !== undefined && this.display(this.#takeover) !== undefined) {
      return this.#takeover;
    }
    return screen.getPrimaryDisplay().id;
  }

  /** Re-keys the living window under another display, takeover and all. */
  #rebind(fromDisplayId: number, toDisplayId: number): void {
    const window = this.#windows.get(fromDisplayId);
    if (!window) return;
    this.#windows.delete(fromDisplayId);
    this.#windows.set(toDisplayId, window);
    if (this.#takeover === fromDisplayId) this.#takeover = toDisplayId;
    this.#onWindowFactsChanged?.();
  }

  /**
   * Brings the window forward as the key window, showing it again if it was
   * closed. The app has to come forward before one of its windows can take
   * keyboard focus.
   */
  #focusWindow(window: BrowserWindow | undefined): void {
    if (!window || window.isDestroyed() || !this.#runMode.takesFocus) return;
    if (process.platform === "darwin") app.focus({ steal: true });
    window.show();
    window.focus();
  }

  #create(displayId: number): void {
    const display = this.display(displayId);
    if (!display) return;
    const bounds = desktopBounds(display);

    const windowOptions: BrowserWindowConstructorOptions = {
      ...bounds,
      minWidth: DESKTOP_WINDOW.MIN_WIDTH,
      minHeight: DESKTOP_WINDOW.MIN_HEIGHT,
      title: "Luke",
      show: false,
      backgroundColor: DESKTOP_WINDOW.BACKGROUND,
      // The renderer draws its own title bar under the traffic lights, so the
      // window keeps its frame, its shadow, and its buttons, and nothing else.
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
      webPreferences: hardenedWebPreferences({
        preloadPath: this.#preloadPath,
        runMode: this.#runMode,
      }),
    };
    const window = new BrowserWindow(windowOptions);
    this.#windows.set(displayId, window);

    refuseForeignNavigation(window, this.#rendererUrl);
    // Electron leaves the window standing when its renderer goes, so nothing
    // below fires for a dead takeover. Answered for the takeover alone,
    // because it is the only time a blank window covers the screen.
    const takeoverGone = (reason: string) => {
      if (this.#takeover === undefined || this.#windows.get(this.#takeover) !== window) return;
      this.#onTakeoverGone?.(reason);
      if (!window.isDestroyed()) window.webContents.reload();
    };
    window.webContents.on("render-process-gone", (_event, details) => {
      takeoverGone(`its renderer went: ${details.reason}`);
    });
    window.on("unresponsive", () => {
      takeoverGone("its renderer stopped responding");
    });
    window.webContents.on("did-fail-load", (_event, _code, description) => {
      takeoverGone(`it failed to load: ${description}`);
    });
    window.once("ready-to-show", () => {
      if (window.isDestroyed()) return;
      // A capture run is a camera, not a person: it shows the window without
      // taking the keyboard from whatever else is running.
      if (this.#runMode.takesFocus) this.#focusWindow(window);
      else window.showInactive();
    });
    // Closing is hiding, as for any Mac app that keeps working in the
    // background: the voice and the briefings go on, and the Dock tile brings
    // the window back. Only a quit lets it go.
    window.on("close", (event) => {
      if (this.#quitting) return;
      event.preventDefault();
      window.hide();
    });
    // Found by the window rather than the id it was born under, because a
    // rebind may have moved it.
    window.on("closed", () => {
      for (const [id, candidate] of [...this.#windows]) {
        if (candidate !== window) continue;
        this.#windows.delete(id);
        if (this.#takeover === id) this.#takeover = undefined;
      }
      if (this.#windows.size === 0) this.#onAllClosed?.();
    });
    void window.loadFile(this.#rendererHtmlPath);
  }
}
