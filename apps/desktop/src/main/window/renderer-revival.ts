import type { WebContents } from "electron";

export const MAXIMUM_REVIVALS_PER_LOAD = 3;
const REVIVAL_DELAY_MS = 1_000;
const ERR_ABORTED = -3;

interface RendererRevivalOptions {
  revive: () => void;
  onGone: (reason: string) => void;
  onGaveUp: (reason: string) => void;
}

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

export class RendererRevival {
  readonly #options: RendererRevivalOptions;
  #revivals = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(options: RendererRevivalOptions) {
    this.#options = options;
  }

  loaded(): void {
    this.#revivals = 0;
  }

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

  restart(): void {
    this.stop();
    this.#stopped = false;
    this.#revivals = 0;
    this.#options.revive();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
