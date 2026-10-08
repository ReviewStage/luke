import type { RunMode } from "@sidecar/host";
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
import { hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";

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
  // Where the close button's corner sits. desktop.css's `--traffic-lights-*`
  // are measured from it, so the title bar's own buttons clear the lights.
  TRAFFIC_LIGHTS: { x: 18, y: 18 },
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
 * Luke's one window: an ordinary, resizable app window on the main display,
 * always showing the panel. It is kept under the panel's old name and shape
 * because every caller — the IPC handlers, the tray, the talk key —
 * addresses a panel by display, and the window answers for
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
  /** Always expanded: the window has no compact shape to fall back to. */
  readonly initialMode: WindowMode = "expanded";
  /** The window, keyed by the display it was opened against. */
  readonly #windows = new Map<number, BrowserWindow>();
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
    const wanted = screen.getPrimaryDisplay().id;
    const [held] = [...this.#windows.keys()];
    if (held === undefined) this.#create(wanted);
    else if (held !== wanted) this.#rebind(held, wanted);
  }

  /**
   * The window has one mode. A request to stand down — Escape, a pointer
   * leaving, a row press standing the panel down — is answered with the mode
   * the window holds, so the renderer keeps drawing the panel; a request to
   * expand with focus brings the window forward.
   */
  setMode(displayId: number, mode: WindowMode, requestFocus: boolean): WindowMode {
    const window = this.#windows.get(displayId);
    if (!window || window.isDestroyed()) return "expanded";
    window.webContents.send(channels.onLifecycle, "mode:expanded");
    if (mode === "expanded" && requestFocus) this.#focusWindow(window);
    return "expanded";
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
    };
  }

  /** Brings the window forward, shown again if it was closed. */
  focusExpanded(_preferredDisplayId?: number): void {
    this.#focusWindow(this.primaryPanel());
  }

  focusIfExpanded(displayId: number): void {
    this.#focusWindow(this.#windows.get(displayId));
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

  /** Shows the window without taking focus, as a second launch or a wake asks. */
  showInactiveAll(): void {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) window.showInactive();
    }
  }

  /** Re-keys the living window under another display. */
  #rebind(fromDisplayId: number, toDisplayId: number): void {
    const window = this.#windows.get(fromDisplayId);
    if (!window) return;
    this.#windows.delete(fromDisplayId);
    this.#windows.set(toDisplayId, window);
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
      trafficLightPosition: DESKTOP_WINDOW.TRAFFIC_LIGHTS,
      webPreferences: hardenedWebPreferences({
        preloadPath: this.#preloadPath,
        runMode: this.#runMode,
      }),
    };
    const window = new BrowserWindow(windowOptions);
    this.#windows.set(displayId, window);

    refuseForeignNavigation(window, this.#rendererUrl);
    window.once("ready-to-show", () => {
      if (window.isDestroyed()) return;
      // A capture run is a camera, not a person: it shows the window without
      // taking the keyboard from whatever else is running.
      if (this.#runMode.takesFocus) this.#focusWindow(window);
      else window.showInactive();
    });
    // Closing is hiding, as for any Mac app that keeps working in the
    // background: the app keeps listening for its keys, and the Dock tile brings
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
      }
      if (this.#windows.size === 0) this.#onAllClosed?.();
    });
    void window.loadFile(this.#rendererHtmlPath);
  }
}
