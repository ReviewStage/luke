/**
 * renderer-revival.ts -- stands a window's renderer back up after it dies or fails to load, a bounded number of times before one load succeeds.
 *
 * The voice window and the panel share one bound, so a renderer that dies on
 * load cannot spin the process in either: each death waits a short pause
 * before the window is stood back up, and past the bound the window's owner
 * is told it gave up instead. A load that finishes clears the count.
 */

import type { WebContents } from "electron";

/** How many times a window's renderer may be stood back up before a load succeeds. */
export const MAXIMUM_REVIVALS_PER_LOAD = 3;
/** The pause before a revival, so a renderer dying on load cannot spin the process. */
const REVIVAL_DELAY_MS = 1_000;
/** Chromium's code for a load another navigation replaced, which is no failure of the page. */
const ERR_ABORTED = -3;

interface RendererRevivalOptions {
  /** Stands the renderer back up: a fresh window, or the same window's page loaded again. */
  revive: () => void;
  /** The renderer went and is about to be stood back up, after the pause. */
  onGone: (reason: string) => void;
  /** The renderer went once more than the bound allows, so it is not stood back up. */
  onGaveUp: (reason: string) => void;
}

/**
 * Hears each death of a page's renderer: the renderer going, or its main
 * frame failing to load. A subframe's failure is the page's own to draw, and
 * a load another navigation replaced failed nothing. `what` names the
 * renderer in the reason `died` is handed.
 */
export function onRendererDeath(
  page: WebContents,
  what: string,
  died: (reason: string) => void,
): void {
  page.on("render-process-gone", (_event, details) => {
    died(`The ${what} renderer went (${details.reason}).`);
  });
  page.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === ERR_ABORTED) return;
    died(`The ${what} renderer failed to load (${description}).`);
  });
}

/**
 * The bound one window's renderer is stood back up under. Note that a death
 * heard while a revival is already pending is the same death told twice (a
 * failed load and the renderer going, say), so it counts once.
 */
export class RendererRevival {
  readonly #options: RendererRevivalOptions;
  /** Revivals since the last load that finished. */
  #revivals = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(options: RendererRevivalOptions) {
    this.#options = options;
  }

  /** A load finished: the count starts over. */
  loaded(): void {
    this.#revivals = 0;
  }

  /** The renderer went: stood back up after the pause, or given up on past the bound. */
  gone(reason: string): void {
    if (this.#stopped || this.#timer) return;
    if (this.#revivals >= MAXIMUM_REVIVALS_PER_LOAD) {
      this.#stopped = true;
      this.#options.onGaveUp(reason);
      return;
    }
    this.#revivals += 1;
    this.#options.onGone(reason);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (!this.#stopped) this.#options.revive();
    }, REVIVAL_DELAY_MS);
    this.#timer.unref?.();
  }

  /** Stands the renderer back up at once with a fresh count, as a person asks after it gave up. */
  restart(): void {
    this.stop();
    this.#stopped = false;
    this.#revivals = 0;
    this.#options.revive();
  }

  /** Nothing is stood back up after this: the window is going for good. */
  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
