import type { RunMode } from "@sidecar/host";
import { BrowserWindow, type WebContents } from "electron";
import { hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";

/**
 * planning-window.ts -- the one ordinary Mac window a named plan is read and talked through in.
 *
 * Unlike the panels and the hidden voice window it is a normal window: titled,
 * with traffic lights, resizable, and stacked among the developer's other app
 * windows. It is never dressed with `dressMacWindow`, which would hide the
 * traffic lights, keep it off Mission Control, and pin it stationary. It loads
 * the panels' own renderer document under the same hardening, and the role
 * main decides for it mounts the planning surface. It exists at most once,
 * and closing it is the whole of leaving the planning session: what it held
 * is the service's.
 */

/**
 * The size a first open stands at, and the least it may be resized to, as
 * the content under the title bar, which is also what an evidence run
 * captures and `scripts/evidence.sh` checks.
 */
const PLANNING_WINDOW_SIZE = {
  WIDTH: 1_080,
  HEIGHT: 760,
  MIN_WIDTH: 720,
  MIN_HEIGHT: 480,
} as const;

export interface PlanningWindowOptions {
  runMode: RunMode;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  /** The window took or lost the keyboard, which decides whether the app menu stands. */
  onFocusChanged: (focused: boolean) => void;
  /** The window opened, which puts Luke in the Dock and Cmd-Tab. */
  onOpened: () => void;
  /** The window closed, which ends the planning session this Mac held. */
  onClosed: () => void;
}

export class PlanningWindow {
  readonly #options: PlanningWindowOptions;
  #window: BrowserWindow | undefined;

  constructor(options: PlanningWindowOptions) {
    this.#options = options;
  }

  /** Opens the window, or brings the one already open forward. */
  open(): void {
    const standing = this.current();
    if (standing) {
      if (standing.isMinimized()) standing.restore();
      standing.show();
      standing.focus();
      return;
    }
    const window = new BrowserWindow({
      title: "Plans",
      show: false,
      width: PLANNING_WINDOW_SIZE.WIDTH,
      height: PLANNING_WINDOW_SIZE.HEIGHT,
      minWidth: PLANNING_WINDOW_SIZE.MIN_WIDTH,
      minHeight: PLANNING_WINDOW_SIZE.MIN_HEIGHT,
      useContentSize: true,
      webPreferences: hardenedWebPreferences({
        preloadPath: this.#options.preloadPath,
        runMode: this.#options.runMode,
      }),
    });
    this.#window = window;
    refuseForeignNavigation(window, this.#options.rendererUrl);
    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });
    window.on("focus", () => this.#options.onFocusChanged(true));
    window.on("blur", () => this.#options.onFocusChanged(false));
    // Note that a window the quit destroyed is no longer the one held, so its
    // close asks nothing of a host that is already tearing down.
    window.on("closed", () => {
      if (this.#window !== window) return;
      this.#window = undefined;
      this.#options.onFocusChanged(false);
      this.#options.onClosed();
    });
    void window.loadFile(this.#options.rendererHtmlPath);
    this.#options.onOpened();
  }

  current(): BrowserWindow | undefined {
    return this.#window !== undefined && !this.#window.isDestroyed() ? this.#window : undefined;
  }

  owns(webContents: WebContents): boolean {
    const window = this.current();
    return window !== undefined && window.webContents === webContents;
  }

  /** The quit's own close: the window goes without asking anything of the host. */
  close(): void {
    const window = this.#window;
    this.#window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
