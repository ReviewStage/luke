import type { AvatarGrant } from "@luke/features/avatar-grant";
import type { RunMode } from "@luke/host";
import { PanelAvatarRelay } from "@luke/host/panel-avatar";
import type { AvatarFeed } from "@luke/voice/avatar";
import type { AvatarViewSignal } from "@luke/voice/avatar-view";
import type { UnparsedWireValue } from "@luke/wire";
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Display,
  type Rectangle,
  screen,
  type WebContents,
} from "electron";
import { hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";
import { followSwipes } from "./swipe-navigation";
import {
  placementOf,
  placeWindow,
  readWindowPlacement,
  writeWindowPlacement,
} from "./window-placement";
import { trafficLightsAt } from "./zoom";

interface PanelDuck {
  setExchangeActive(active: boolean): void;
}

interface PanelManagerOptions {
  runMode: RunMode;
  /** The named development instance this run is, which every window's title then carries; none for the plain one. */
  instance?: string | undefined;
  mediaDuck: PanelDuck;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  /** The zoom factor a window is created at: the stored size as it stands. */
  zoomFactor: () => number;
  /**
   * The file the window's place is kept in as it closes and read from as it
   * opens; none for a run that keeps no place, which opens at the first frame.
   */
  placementPath: string | undefined;
  /**
   * Whether this process is going, so closing the window lets it go rather
   * than hiding it. Read from the quit rather than from `before-quit`,
   * because a quit held for a question is not one that is going.
   */
  closing: () => boolean;
  /**
   * The last panel window went down on its own. All panels closed is how
   * this process decides it is done, and `window-all-closed` can no longer
   * say so once a hidden window of Luke's own stands beside them.
   */
  onAllClosed?: () => void;
  /**
   * The window went into full screen or came out of it, which its title bar
   * lays itself out by (`windowFactsFor`).
   */
  onFullScreenChanged?: () => void;
}

/**
 * Checklist: scripts/evidence.sh validates every capture at WIDTH by HEIGHT.
 *
 * The window Luke first opens in: large enough to read a plan beside its
 * questions, and never past the display's work area less a margin, so a
 * small display still shows the whole window with the Dock and the menu bar
 * clear of it.
 */
const DESKTOP_WINDOW = {
  WIDTH: 1280,
  HEIGHT: 840,
  MIN_WIDTH: 760,
  MIN_HEIGHT: 520,
  // Small enough that a 13-inch display's work area still fits the full size.
  MARGIN: 24,
  // The window's ground before the renderer paints, one per appearance; each
  // is desktop.css's `--desktop-ground` for that appearance.
  BACKGROUND: { DARK: "#0c0c0e", LIGHT: "#fcfcfc" },
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
 * Luke's one window: an ordinary, resizable app window, opened where it was
 * last left (`window-placement.ts`) and always showing the panel. It is kept
 * under the panel's old name and shape because every caller — the IPC
 * handlers, the tray, the talk key — addresses a panel by display, and the
 * window answers for the display it was opened against. Closing it hides
 * it; the app keeps listening, and the Dock tile or a second launch brings
 * it back.
 */
export class PanelManager {
  readonly #runMode: RunMode;
  readonly #instance: string | undefined;
  readonly #mediaDuck: PanelDuck;
  readonly #preloadPath: string;
  readonly #rendererHtmlPath: string;
  readonly #rendererUrl: string;
  readonly #zoomFactor: () => number;
  readonly #onAllClosed: (() => void) | undefined;
  readonly #onFullScreenChanged: (() => void) | undefined;
  readonly #placementPath: string | undefined;
  readonly #closing: () => boolean;
  /** The window, keyed by the display it was opened against. */
  readonly #windows = new Map<number, BrowserWindow>();
  /**
   * Whether the app draws dark, as the window service last said. The launch
   * paints from the resolved appearance before it opens the first window, so
   * this initial value is never what a window is created on.
   */
  #dark = true;
  /** The windows whose renderer has drawn its first frame, the ones the avatar's grant may reach. */
  readonly #drawn = new WeakSet<BrowserWindow>();
  readonly #avatar = new PanelAvatarRelay(() => {
    const window = this.primaryPanel();
    return window && this.#drawn.has(window) ? window.webContents : undefined;
  });

  constructor(options: PanelManagerOptions) {
    this.#runMode = options.runMode;
    this.#instance = options.instance;
    this.#mediaDuck = options.mediaDuck;
    this.#preloadPath = options.preloadPath;
    this.#rendererHtmlPath = options.rendererHtmlPath;
    this.#rendererUrl = options.rendererUrl;
    this.#zoomFactor = options.zoomFactor;
    this.#onAllClosed = options.onAllClosed;
    this.#onFullScreenChanged = options.onFullScreenChanged;
    this.#placementPath = options.placementPath;
    this.#closing = options.closing;
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

  /**
   * Keyframe's grant for the call's avatar, or nothing once its session is to
   * close. The panel runs the session wherever it is and whichever tab it
   * shows, since the avatar's voice is what the developer hears, and draws
   * its video at the top of the Call tab.
   */
  showAvatarSession(grant: AvatarGrant | undefined): void {
    this.#avatar.showAvatarSession(grant);
  }

  /** One message of Luke's voice feed, for the avatar to lip-sync. */
  feedAvatar(feed: AvatarFeed): void {
    this.#avatar.feedAvatar(feed);
  }

  /** The call window's offer or close for its view of the avatar's video, for the panel to answer. */
  signalAvatarView(signal: AvatarViewSignal): void {
    this.#avatar.signalView(signal);
  }

  /** Every living panel window, for what each one applies itself: the zoom. */
  windows(): readonly BrowserWindow[] {
    return [...this.#windows.values()].filter((window) => !window.isDestroyed());
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

  display(displayId: number): Display | undefined {
    return screen.getAllDisplays().find((candidate) => candidate.id === displayId);
  }

  /** Brings the window forward, shown again if it was closed. */
  focusExpanded(): void {
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

  /** Whether the panel window whose renderer is asking stands in full screen. */
  fullScreen(webContents: WebContents): boolean {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed() && window.webContents === webContents) return window.isFullScreen();
    }
    return false;
  }

  /** Shows the window without taking focus, as a second launch or a wake asks. */
  showInactiveAll(): void {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) window.showInactive();
    }
  }

  /**
   * Grounds every window, and every window opened after, in the appearance the
   * app now resolves to, so a resize or a reload never flashes the other one.
   * The renderer repaints itself from `prefers-color-scheme`; this is only the
   * native ground under it.
   */
  paint(dark: boolean): void {
    this.#dark = dark;
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed()) window.setBackgroundColor(this.#background());
    }
  }

  #background(): string {
    return this.#dark ? DESKTOP_WINDOW.BACKGROUND.DARK : DESKTOP_WINDOW.BACKGROUND.LIGHT;
  }

  /** Re-keys the living window under another display. */
  #rebind(fromDisplayId: number, toDisplayId: number): void {
    const window = this.#windows.get(fromDisplayId);
    if (!window) return;
    this.#windows.delete(fromDisplayId);
    this.#windows.set(toDisplayId, window);
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

  /** Keeps where the window stands, as it closes, for the next launch to open it there. */
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
    // Created at the stored zoom, so the first frame is drawn at the size it
    // keeps rather than jumping to it once the page has loaded.
    const zoomFactor = this.#zoomFactor();

    const windowOptions: BrowserWindowConstructorOptions = {
      ...placement.bounds,
      // Only ever set when true, because a false here takes the green
      // button's full screen away from the window altogether.
      ...(placement.fullScreen ? { fullscreen: true } : undefined),
      minWidth: DESKTOP_WINDOW.MIN_WIDTH,
      minHeight: DESKTOP_WINDOW.MIN_HEIGHT,
      title: this.#instance === undefined ? "Luke" : `Luke (${this.#instance})`,
      show: false,
      backgroundColor: this.#background(),
      // The renderer draws its own title bar under the traffic lights, so the
      // window keeps its frame, its shadow, and its buttons, and nothing else.
      titleBarStyle: "hiddenInset",
      trafficLightPosition: trafficLightsAt(zoomFactor),
      webPreferences: {
        ...hardenedWebPreferences({ preloadPath: this.#preloadPath, runMode: this.#runMode }),
        zoomFactor,
      },
    };
    const window = new BrowserWindow(windowOptions);
    this.#windows.set(displayId, window);

    refuseForeignNavigation(window, this.#rendererUrl);
    // Each page the window loads, a reload's included, is handed the avatar's
    // grant standing, since the renderer it replaced ran the session and the
    // voice window stays muted while the avatar reads as up. Note that the
    // first page is handed it twice, which the renderer reads as one grant.
    const drew = () => {
      if (window.isDestroyed()) return;
      this.#drawn.add(window);
      this.#avatar.pageDrew();
    };
    window.webContents.on("did-finish-load", drew);
    window.once("ready-to-show", () => {
      if (window.isDestroyed()) return;
      drew();
      if (placement.zoomed) window.maximize();
      // A capture run is a camera, not a person: it shows the window without
      // taking the keyboard from whatever else is running.
      if (this.#runMode.takesFocus) this.#focusWindow(window);
      else window.showInactive();
    });
    // Closing is hiding, as for any Mac app that keeps working in the
    // background: the app keeps listening for its keys, and the Dock tile brings
    // the window back. Only a quit lets it go.
    window.on("close", (event) => {
      this.#keepPlacement(window);
      if (this.#closing()) return;
      event.preventDefault();
      window.hide();
    });
    // A named instance's window says which instance it is wherever macOS
    // lists it, after the title the page gives it.
    const instance = this.#instance;
    if (instance !== undefined) {
      window.on("page-title-updated", (event, title) => {
        event.preventDefault();
        window.setTitle(`${title} (${instance})`);
      });
    }
    window.on("enter-full-screen", () => this.#onFullScreenChanged?.());
    window.on("leave-full-screen", () => this.#onFullScreenChanged?.());
    // A mouse's back and forward buttons arrive as a swipe under Logi Options+.
    followSwipes(window);
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
