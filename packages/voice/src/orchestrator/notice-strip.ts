/**
 * How long a voice failure stays on the caption strip. The strip takes no
 * pointer, so time is its only dismissal: long enough to be read twice, short
 * enough that the shape does not wear a fault all afternoon. The next attempt
 * clears it sooner — connecting starts by reporting nothing wrong.
 */
import type { TimerHandle } from "../scheduled-timer.js";

export const VOICE_ERROR_NOTICE_MS = 12_000;

export interface NoticeStripOptions {
  onChanged(): void;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (timer: TimerHandle) => void;
}

/**
 * The two lines the caption strip draws when there is no speech to draw: what
 * went wrong, and what is temporarily unavailable. They share the strip and
 * so they share a clock — a fault the developer cannot dismiss must dismiss
 * itself — and each new message re-arms it, because it is a new thing to
 * read.
 */
export class NoticeStrip {
  readonly #options: NoticeStripOptions;
  #error: string | undefined;
  #notice: string | undefined;
  #errorTimer: TimerHandle | undefined;
  #noticeTimer: TimerHandle | undefined;

  constructor(options: NoticeStripOptions) {
    this.#options = options;
  }

  get error(): string | undefined {
    return this.#error;
  }

  get notice(): string | undefined {
    return this.#notice;
  }

  showError(message: string | undefined): void {
    this.#error = message;
    this.#errorTimer = this.#arm(this.#errorTimer, message, () => {
      this.#errorTimer = undefined;
      this.#error = undefined;
      this.#options.onChanged();
    });
    this.#options.onChanged();
  }

  showNotice(message: string | undefined): void {
    this.#notice = message;
    this.#noticeTimer = this.#arm(this.#noticeTimer, message, () => {
      this.#noticeTimer = undefined;
      this.#notice = undefined;
      this.#options.onChanged();
    });
    this.#options.onChanged();
  }

  /** Both lines go: an exchange going live outranks the clock either was on. */
  clear(): void {
    this.showError(undefined);
    this.showNotice(undefined);
  }

  /** Lets go of both clocks; the words themselves die with the window. */
  stop(): void {
    this.#cancel(this.#errorTimer);
    this.#errorTimer = undefined;
    this.#cancel(this.#noticeTimer);
    this.#noticeTimer = undefined;
  }

  #arm(
    standing: TimerHandle | undefined,
    message: string | undefined,
    expire: () => void,
  ): TimerHandle | undefined {
    this.#cancel(standing);
    if (message === undefined) return undefined;
    return (this.#options.schedule ?? setTimeout)(expire, VOICE_ERROR_NOTICE_MS);
  }

  #cancel(timer: TimerHandle | undefined): void {
    if (timer === undefined) return;
    // SAFETY: the handle is whatever `schedule ?? setTimeout` returned, and
    // the fallbacks are paired — a handle from `setTimeout` can only reach
    // `clearTimeout`.
    (this.#options.cancel ?? clearTimeout)(timer as never);
  }
}
