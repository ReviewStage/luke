import { BrowserWindow, type WebContents } from "electron";
import type { RunMode } from "../run-mode";
import { hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";

export interface VoiceWindowOptions {
  runMode: RunMode;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  /**
   * The voice renderer died or hung. Nothing drawn depends on it, so the main
   * process simply stands a fresh one up; an outstanding speech offer recovers
   * by its own deadline.
   */
  onGone: (reason: string) => void;
}

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
 * on the way out rather than waited on.
 */
export class VoiceWindow {
  readonly #options: VoiceWindowOptions;
  #window: BrowserWindow | undefined;

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
    window.webContents.on("render-process-gone", (_event, details) => {
      this.#options.onGone(`The voice renderer went: ${details.reason}`);
    });
    window.on("unresponsive", () => {
      this.#options.onGone("The voice renderer stopped responding.");
    });
    window.webContents.on("did-fail-load", (_event, _code, description) => {
      this.#options.onGone(`The voice renderer failed to load: ${description}`);
    });
    void window.loadFile(this.#options.rendererHtmlPath);
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
}
