import type { RunMode } from "@luke/host";
import { BrowserWindow, type WebContents } from "electron";
import { hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";
import { MAXIMUM_REVIVALS_PER_LOAD, onRendererDeath, RendererRevival } from "./renderer-revival";

export interface VoiceWindowOptions {
  runMode: RunMode;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  /**
   * The voice renderer died or hung and a fresh one is about to be stood up,
   * or the bound below has been reached and none will be. Nothing drawn
   * depends on it.
   */
  onGone: (reason: string) => void;
  /**
   * Reopening has stopped for this run: the renderer went down
   * `MAXIMUM_REVIVALS_PER_LOAD` times without once finishing a load. A hidden
   * window that crash-looped would be seen by nobody, so it is reported once
   * and stood down, the way the trace writer answers a full disk, and voice
   * is said to be unavailable wherever a call is offered.
   */
  onGaveUp: (reason: string) => void;
}

/**
 * The one hidden window that will hold the live conversation, so that it
 * outlives every panel: a panel reload, close, or display change must not end
 * an exchange. It loads the renderer's voice entry (`voice.html`) under the
 * same hardening as the panels, and it is never shown, never focused, and
 * never a target for anything drawn. It exists at most
 * once, and everything it may ask of the main process is answered against
 * `owns()` rather than against anything the renderer claims.
 *
 * It does not count toward the app's lifetime: the panels closing is how this
 * process decides it is done, and this window is destroyed by the main process
 * on the way out rather than waited on. It owns its own lifetime otherwise: a
 * renderer that dies is replaced after a pause, at most a few times per run
 * before a load succeeds (`renderer-revival.ts`, the panel's bound too), so a
 * renderer that dies on load cannot crash-loop a window nobody can see.
 */
export class VoiceWindow {
  readonly #options: VoiceWindowOptions;
  #window: BrowserWindow | undefined;
  readonly #revival: RendererRevival;

  constructor(options: VoiceWindowOptions) {
    this.#options = options;
    this.#revival = new RendererRevival({
      revive: () => this.open(),
      onGone: options.onGone,
      onGaveUp: (reason) =>
        options.onGaveUp(
          `${reason} It was replaced ${MAXIMUM_REVIVALS_PER_LOAD} times without loading, so it stays down for this run.`,
        ),
    });
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
        // The live call's audio plays here, hidden, and must not be throttled.
        backgroundThrottling: false,
      }),
    });
    this.#window = window;
    refuseForeignNavigation(window, this.#options.rendererUrl);
    window.webContents.on("did-finish-load", () => this.#revival.loaded());
    onRendererDeath(window.webContents, "voice", (reason) => this.#replace(window, reason));
    window.on("unresponsive", () => {
      this.#replace(window, "The voice renderer stopped responding.");
    });
    // A load that fails is heard as `did-fail-load` above, so its promise's rejection says nothing more.
    window.loadFile(this.#options.rendererHtmlPath).catch(() => undefined);
  }

  /**
   * Stands a fresh renderer up in place of one that died, after a short pause
   * and only within the bound. A window `close()` already retired reports
   * nothing: its listeners can still fire as it is torn down.
   */
  #replace(window: BrowserWindow, reason: string): void {
    if (window !== this.#window) return;
    this.close();
    this.#revival.gone(reason);
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
    this.#revival.stop();
    this.close();
  }
}
