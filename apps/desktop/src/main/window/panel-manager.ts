import type { RunMode } from "@sidecar/host";
import {
  DEFAULT_PANEL_FORM_FACTOR,
  MOTION_DURATION_MS,
  type NativeNotchGeometry,
  type PanelFormFactor,
  positionNotchWindow,
  resolveNotchGeometry,
} from "@sidecar/surface";
import type { UnparsedWireValue } from "@sidecar/wire";
import {
  app,
  BrowserWindow,
  type Display,
  screen,
  systemPreferences,
  type WebContents,
} from "electron";
import { channels } from "#shared/bridge";
import type { DisplayDiagnostic, WindowMode } from "#shared/messages/session";
import { readMacScreenGeometry } from "../native/screen-geometry";
import { dressMacWindow, hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";

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
  readonly #onAllClosed: (() => void) | undefined;
  readonly #onWindowFactsChanged: (() => void) | undefined;
  readonly #onTakeoverGone: ((reason: string) => void) | undefined;
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
   * Whether Luke stands on every display, mirroring the settings file the way
   * the minter mirrors the chosen voice: read once before any panel exists,
   * updated by the same handler that stores a new choice, so every layout
   * decision stays synchronous. Off means the system's main display alone.
   */
  #showOnAllDisplays = false;
  /** The chosen form for displays without a housing, mirrored the same way. */
  #panelFormFactor: PanelFormFactor = DEFAULT_PANEL_FORM_FACTOR;
  #nativeScreens = new Map<number, NativeNotchGeometry>();
  /**
   * The display a fullscreen mode of the panel currently covers, absent when
   * none does. It is the whole standing of a takeover here: the mode changes,
   * the layout, and the reconciler all read it, so a takeover cannot be
   * half-held.
   */
  #takeover: number | undefined;

  constructor(options: PanelManagerOptions) {
    this.#runMode = options.runMode;
    this.#mediaDuck = options.mediaDuck;
    this.#preloadPath = options.preloadPath;
    this.#rendererHtmlPath = options.rendererHtmlPath;
    this.#rendererUrl = options.rendererUrl;
    this.#onAllClosed = options.onAllClosed;
    this.#onWindowFactsChanged = options.onWindowFactsChanged;
    this.#onTakeoverGone = options.onTakeoverGone;
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
    // A takeover is the whole of its display for as long as it holds it, and
    // every way a mode is asked for — the talk key, the tray, a second launch
    // — arrives here, so the refusal belongs here and nowhere else.
    if (this.#takeover === displayId) return this.modeFor(displayId);
    this.#modes.set(displayId, mode);
    const window = this.#windows.get(displayId);
    if (!window || window.isDestroyed()) return mode;

    const expanded = mode === "expanded";
    window.setFocusable(expanded && this.#runMode.takesFocus);
    this.#clearCollapseTimer(displayId);
    if (expanded) {
      this.#position(displayId);
      window.webContents.send(channels.onLifecycle, `mode:${mode}`);
    } else {
      window.webContents.send(channels.onLifecycle, `mode:${mode}`);
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
    this.#onWindowFactsChanged?.();
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
   * The one panel an action aimed at the panel itself lands on — a settings
   * change the brain asks for, the panel expanded from a second launch: the
   * main display's window when Luke stands there, else the first window
   * standing anywhere, so an action about the app has one drawn surface to
   * answer from rather than one per display.
   */
  primaryPanel(): BrowserWindow | undefined {
    const primary = this.#windows.get(screen.getPrimaryDisplay().id);
    if (primary && !primary.isDestroyed()) return primary;
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

  /**
   * Puts one panel window over the whole of its display for as long as a
   * fullscreen mode runs in it. The window is the panel's own, so a takeover
   * cannot strand the user: quitting, reconciling, and the display watch all
   * still answer, and a renderer that dies, hangs, or never loads hands the
   * display back through `onTakeoverGone`.
   *
   * Idempotent, and re-taking is how a takeover follows the screen: it reads
   * the primary panel and its display afresh, so a window rebound to another
   * display, or one whose display changed resolution, covers what is there
   * now. Only the fit is re-applied — a re-take is a display change, and one
   * that reclaimed the pointer or the keyboard would take back what a landed
   * takeover has already handed to the developer. Answers the display id it
   * took, or `undefined` when no panel stands anywhere — the caller then
   * skips the takeover entirely rather than creating a window for it.
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
    // The display's own bounds rather than AppKit's fullscreen: this window is
    // frameless, transparent and declared unfullscreenable, and a Space of its
    // own would animate the transition and hand back a frame nothing here
    // chose. Resizing in place covers the menu bar's strip, which is where a
    // flight that lands on the housing has to draw.
    window.setBounds(display.bounds);
    if (taking) {
      window.setAlwaysOnTop(true, "screen-saver");
      // The takeover is the whole surface, so it starts by intercepting
      // everything; what it hands back once it has landed is its own to say,
      // through the same pointer interception every panel keeps.
      window.setIgnoreMouseEvents(false);
      window.setFocusable(this.#runMode.takesFocus);
      this.#raiseTakeover(window, displayId);
    }
    // One document-wide standing cannot be drawn twice, so the panel set
    // collapses to the display the takeover covers: this takes down any panel
    // the stored choice raised on another display, and `leaveTakeover`
    // honours that choice again.
    this.reconcile();
    return displayId;
  }

  /**
   * Brings the takeover forward, once it has something to show. A window born
   * `show: false` has not painted yet, and a transparent surface put over the
   * whole display before its first frame is a blank sheet swallowing every
   * click — so the raise waits for the paint, exactly as the takeover's own
   * window used to.
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
   * Returns the takeover's window to the mode it held — its bounds among
   * them, laid out by the same reconcile every other caller goes through, so
   * the stored choice of displays stands again. Idempotent, and safe to call
   * for a window that has since gone.
   */
  leaveTakeover(): void {
    const displayId = this.#takeover;
    if (displayId === undefined) return;
    this.#takeover = undefined;
    const window = this.#windows.get(displayId);
    if (window && !window.isDestroyed()) {
      window.setAlwaysOnTop(true, "pop-up-menu");
      window.setIgnoreMouseEvents(true, { forward: true });
      window.setFocusable(this.modeFor(displayId) === "expanded" && this.#runMode.takesFocus);
    }
    this.reconcile();
    this.showInactiveAll();
  }

  /**
   * Whether a spoken exchange is live, as the main process derives it from the
   * voice window's report. One answer for every display: the exchange lives
   * in no panel, so no panel's coming or going can change it, and the media
   * duck follows it directly.
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

  /** Whether some panel window's renderer is asking, whichever display it is on. */
  owns(webContents: WebContents): boolean {
    for (const window of this.#windows.values()) {
      if (!window.isDestroyed() && window.webContents === webContents) return true;
    }
    return false;
  }

  async refreshGeometry(): Promise<void> {
    this.#nativeScreens = await readMacScreenGeometry();
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
    // A takeover covers the display it took, and a second panel standing on
    // another monitor for the duration of a one-time fullscreen mode is a
    // surface nobody asked for. The stored choice is honoured again by the
    // reconcile inside `leaveTakeover`. A takeover whose display has gone
    // pins nothing: the ordinary answer is what moves its window somewhere it
    // can stand, and the takeover travels with it.
    if (this.#takeover !== undefined && this.display(this.#takeover) !== undefined) {
      return [this.#takeover];
    }
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
    // A takeover's bounds are the display's, and nothing that lays out a
    // capsule may resize it out from under itself.
    if (this.#takeover === displayId) return;
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
    this.#onWindowFactsChanged?.();
  }

  /**
   * Moves a living window to another display, state and all: its mode, its
   * collapse-in-flight, its exchange report, and the renderer behind it — which
   * learns its new ground from the snapshot the repositioning has it handed,
   * exactly as it would for a geometry change in place.
   */
  #rebind(fromDisplayId: number, toDisplayId: number): void {
    const window = this.#windows.get(fromDisplayId);
    if (!window) return;
    this.#windows.delete(fromDisplayId);
    this.#windows.set(toDisplayId, window);
    this.#modes.set(toDisplayId, this.modeFor(fromDisplayId));
    this.#modes.delete(fromDisplayId);
    // A takeover names a display and this window has just changed which one
    // it stands on, so the takeover travels with it rather than being
    // released and taken afresh — which would reclaim the pointer and the
    // keyboard a landed takeover has already handed back.
    if (this.#takeover === fromDisplayId) this.#takeover = toDisplayId;
    // The timer's closure names the old display; the reposition below redraws
    // whatever a cancelled collapse would have.
    this.#clearCollapseTimer(fromDisplayId);
  }

  #clearCollapseTimer(displayId: number): void {
    const timer = this.#collapseTimers.get(displayId);
    if (!timer) return;
    clearTimeout(timer);
    this.#collapseTimers.delete(displayId);
  }

  #configure(window: BrowserWindow): void {
    window.setAlwaysOnTop(true, "pop-up-menu");
    dressMacWindow(window);
  }

  /**
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
      webPreferences: hardenedWebPreferences({
        preloadPath: this.#preloadPath,
        runMode: this.#runMode,
      }),
    });
    this.#windows.set(displayId, window);

    this.#configure(window);
    window.setIgnoreMouseEvents(true, { forward: true });
    refuseForeignNavigation(window, this.#rendererUrl);
    // Electron leaves the window standing when its renderer goes, so nothing
    // below fires for a dead takeover; the `closed` handler answers only a
    // window that actually went away. Answered for the takeover alone,
    // because it is the only panel whose blank window covers the screen.
    const takeoverGone = (reason: string) => {
      if (this.#takeover === undefined || this.#windows.get(this.#takeover) !== window) return;
      this.#onTakeoverGone?.(reason);
      // Handing the display back leaves the window standing with a dead
      // renderer behind it, and a panel nobody can draw in is no way back:
      // the same window is loaded again, which is what raising a fresh panel
      // did before the takeover shared the panel's own.
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
        // A takeover is its window's, so a window that went down some other
        // way takes the takeover with it: a display left pinned with nothing
        // standing on it would have the reconciler raise the takeover again.
        if (this.#takeover === id) this.#takeover = undefined;
      }
      if (this.#windows.size === 0) this.#onAllClosed?.();
    });
    void window.loadFile(this.#rendererHtmlPath);
  }
}
