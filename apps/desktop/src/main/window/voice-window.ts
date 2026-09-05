import { BrowserWindow, type WebContents } from "electron";
import type { RunMode } from "../run-mode";
import { hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";

export interface VoiceWindowOptions {
  runMode: RunMode;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  /**
   * The voice renderer died or hung and a fresh one is about to be stood up,
   * or the bound below has been reached and none will be. Nothing drawn
   * depends on it; an outstanding speech offer recovers by its own deadline.
   */
  onGone: (reason: string) => void;
  /**
   * Reopening has stopped for this run: the renderer went down
   * `MAXIMUM_REOPENS_PER_RUN` times without once finishing a load. A hidden
   * window that crash-looped would be seen by nobody, so it is reported once
   * and stood down, the way the trace writer answers a full disk.
   */
  onGaveUp: (reason: string) => void;
}

/** How many times a run may stand the voice renderer back up before a load succeeds. */
export const MAXIMUM_REOPENS_PER_RUN = 3;
/** The pause before a replacement, so a renderer dying on load cannot spin the process. */
export const REOPEN_DELAY_MS = 1_000;

/**
 * The one hidden window that will hold the live conversation, so that it
 * outlives every panel: a panel reload, close, or display change must not end
 * an exchange. It loads the same renderer bundle as the panels under the same
 * hardening, differing only in its bootstrap role, and it is never shown,
 * never focused, and never a target for anything drawn. It exists at most
 * once, and everything it may ask of the main process is answered against
 * `owns()` rather than against anything the renderer claims.
 *
 * It does not count toward the app's lifetime: the panels closing is how this
 * process decides it is done, and this window is destroyed by the main process
 * on the way out rather than waited on. It owns its own lifetime otherwise: a
 * renderer that dies is replaced after a pause, at most a few times per run
 * before a load succeeds, so a renderer that dies on load cannot crash-loop
 * a window nobody can see.
 */
export class VoiceWindow {
  readonly #options: VoiceWindowOptions;
  #window: BrowserWindow | undefined;
  /** Reopens since the last load that finished; reset only by `did-finish-load`. */
  #reopens = 0;
  #reopenTimer: ReturnType<typeof setTimeout> | undefined;
  #closedForGood = false;

  constructor(options: VoiceWindowOptions) {
    this.#options = options;
  }

  open(): void {
    if (this.current()) return;
    const window = new BrowserWindow({
      title: "Luke",
      show: false,
      width: 1,
      height: 1,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: hardenedWebPreferences({
        preloadPath: this.#options.preloadPath,
        runMode: this.#options.runMode,
      }),
    });
    this.#window = window;
    refuseForeignNavigation(window, this.#options.rendererUrl);
    window.webContents.on("did-finish-load", () => {
      this.#reopens = 0;
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      this.#replace(window, `The voice renderer went: ${details.reason}`);
    });
    window.on("unresponsive", () => {
      this.#replace(window, "The voice renderer stopped responding.");
    });
    window.webContents.on("did-fail-load", (_event, _code, description) => {
      this.#replace(window, `The voice renderer failed to load: ${description}`);
    });
    void window.loadFile(this.#options.rendererHtmlPath);
  }

  /**
   * Stands a fresh renderer up in place of one that died, after a short pause
   * and only within the bound. A window `close()` already retired reports
   * nothing: its listeners can still fire as it is torn down.
   */
  #replace(window: BrowserWindow, reason: string): void {
    if (this.#closedForGood || window !== this.#window || this.#reopenTimer) return;
    this.close();
    if (this.#reopens >= MAXIMUM_REOPENS_PER_RUN) {
      this.#closedForGood = true;
      this.#options.onGaveUp(
        `${reason} It was replaced ${MAXIMUM_REOPENS_PER_RUN} times without loading, so it stays down for this run.`,
      );
      return;
    }
    this.#reopens += 1;
    this.#options.onGone(reason);
    this.#reopenTimer = setTimeout(() => {
      this.#reopenTimer = undefined;
      if (!this.#closedForGood) this.open();
    }, REOPEN_DELAY_MS);
    this.#reopenTimer.unref?.();
  }

  current(): BrowserWindow | undefined {
    return this.#window !== undefined && !this.#window.isDestroyed() ? this.#window : undefined;
  }

  owns(webContents: WebContents): boolean {
    const window = this.current();
    return window !== undefined && window.webContents === webContents;
  }

  close(): void {
    const window = this.#window;
    this.#window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }

  /** The quit's own close: nothing is stood back up after it. */
  closeForGood(): void {
    this.#closedForGood = true;
    if (this.#reopenTimer) clearTimeout(this.#reopenTimer);
    this.#reopenTimer = undefined;
    this.close();
  }
}
