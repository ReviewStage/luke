/**
 * How long a voice failure stays on the caption strip. The strip takes no
 * pointer, so time is its only dismissal: long enough to be read twice, short
 * enough that the shape does not wear a fault all afternoon. The next attempt
 * clears it sooner — connecting starts by reporting nothing wrong.
 */
import { Duration, Effect, type Fiber } from "effect";

export const VOICE_ERROR_NOTICE_MS = 12_000;

interface NoticeStripOptions {
  onChanged(): void;
  /**
   * Forks the expiry effect under whichever services the caller holds; the
   * strip never runs one itself, only holds the fiber back to interrupt it
   * early.
   */
  fork(effect: Effect.Effect<void>): Fiber.Fiber<void>;
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
  #errorTimer: Fiber.Fiber<void> | undefined;
  #noticeTimer: Fiber.Fiber<void> | undefined;

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
    standing: Fiber.Fiber<void> | undefined,
    message: string | undefined,
    expire: () => void,
  ): Fiber.Fiber<void> | undefined {
    this.#cancel(standing);
    if (message === undefined) return undefined;
    return this.#options.fork(
      Effect.andThen(Effect.sleep(Duration.millis(VOICE_ERROR_NOTICE_MS)), Effect.sync(expire)),
    );
  }

  /** Interrupts a bound without waiting for it to finish: what it guarantees is that the work does not run after, never that the fiber has already ended. */
  #cancel(fiber: Fiber.Fiber<void> | undefined): void {
    fiber?.interruptUnsafe();
  }
}
