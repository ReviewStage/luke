import { BrowserWindow, screen, type WebContents } from "electron";
import type { RunMode } from "../run-mode";
import { dressMacWindow, hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";

export interface IntroductionWindowOptions {
  runMode: RunMode;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  /**
   * The takeover's renderer died or hung. Every ordinary exit from the
   * introduction is asked for by that renderer, so the main process must own
   * this one: a fullscreen, always-on-top window nobody can dismiss is the
   * worst failure this feature has.
   */
  onGone: (reason: string) => void;
  /**
   * The takeover's window is gone by any route — its own `close()`, or a
   * teardown that never passed through `onGone` — so whoever decides the
   * process's lifetime can check that something visible still stands.
   */
  onClosed: () => void;
}

/**
 * The one fullscreen window the spoken introduction plays in, covering the
 * primary display — menu bar included, because the flight ends at the notch —
 * for exactly as long as the introduction runs. It loads the same renderer
 * bundle as the panels under the same hardening; only its bootstrap role and
 * its bounds differ. It exists at most once, only on a launch the introduction
 * gate chose, and everything it may ask of the main process is answered
 * against `owns()` rather than against anything the renderer claims.
 */
export class IntroductionWindow {
  readonly #options: IntroductionWindowOptions;
  #window: BrowserWindow | undefined;
  /**
   * Whether the introduction still holds the screen. Retiring is separate
   * from closing so an ending can revoke the takeover's standing — the talk
   * key's routing, the introduction mint, the reconcile guards — before the
   * panels are raised, and only then destroy the window: a swap must never
   * pass through zero windows, because all windows closed is how this
   * process decides it is done.
   */
  #retired = false;

  constructor(options: IntroductionWindowOptions) {
    this.#options = options;
  }

  open(): void {
    if (this.active) return;
    this.#retired = false;
    const display = screen.getPrimaryDisplay();
    const window = new BrowserWindow({
      ...display.bounds,
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
      focusable: this.#options.runMode.takesFocus,
      acceptFirstMouse: true,
      type: process.platform === "darwin" ? "panel" : undefined,
      webPreferences: hardenedWebPreferences({
        preloadPath: this.#options.preloadPath,
        runMode: this.#options.runMode,
      }),
    });
    this.#window = window;
    // Above the menu bar, not just other windows: the flight's landing draws
    // where the panel's capsule will stand, which is the bar's own strip.
    window.setAlwaysOnTop(true, "screen-saver");
    dressMacWindow(window);
    refuseForeignNavigation(window, this.#options.rendererUrl);
    window.webContents.on("render-process-gone", (_event, details) => {
      this.#options.onGone(`The takeover's renderer went: ${details.reason}`);
    });
    window.on("unresponsive", () => {
      this.#options.onGone("The takeover's renderer stopped responding.");
    });
    window.webContents.on("did-fail-load", (_event, _code, description) => {
      this.#options.onGone(`The takeover failed to load: ${description}`);
    });
    window.on("closed", () => this.#options.onClosed());
    window.once("ready-to-show", () => {
      if (window.isDestroyed() || this.#retired) return;
      window.show();
      window.focus();
    });
    void window.loadFile(this.#options.rendererHtmlPath);
  }

  /** Whether the introduction holds the screen — what every takeover-only answer gates on. */
  get active(): boolean {
    return !this.#retired && this.#window !== undefined && !this.#window.isDestroyed();
  }

  current(): BrowserWindow | undefined {
    return this.active ? this.#window : undefined;
  }

  owns(webContents: WebContents): boolean {
    const window = this.current();
    return window !== undefined && window.webContents === webContents;
  }

  /** Revokes the takeover's standing without destroying the window yet. */
  retire(): void {
    this.#retired = true;
  }

  /** A display change mid-introduction re-covers the primary display whole. */
  reposition(): void {
    const window = this.current();
    if (!window) return;
    window.setBounds(screen.getPrimaryDisplay().bounds);
  }

  close(): void {
    this.#retired = true;
    const window = this.#window;
    this.#window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
