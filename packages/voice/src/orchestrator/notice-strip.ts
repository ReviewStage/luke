/**
 * How long a voice failure stays on the caption strip while it can be read.
 * The strip takes no pointer, so time is its only dismissal: long enough to be
 * read twice, short enough that the shape does not wear a fault all
 * afternoon. The next attempt clears it sooner — connecting starts by
 * reporting nothing wrong.
 */
import type { VoiceFailure } from "@luke/features/words";
import { Duration, Effect, type Fiber } from "effect";

const VOICE_ERROR_NOTICE_MS = 12_000;

interface NoticeStripOptions {
  onChanged(): void;
  /**
   * Forks the expiry effect under whichever services the caller holds; the
   * strip never runs one itself, only holds the fiber back to interrupt it
   * early.
   */
  fork(effect: Effect.Effect<void>): Fiber.Fiber<void>;
  /** The time now, in milliseconds, on the clock the forked expiry sleeps on. */
  now(): number;
}

/**
 * One line of the strip and its clock. The clock runs only while the line can
 * be read: hidden behind speech it stands still, keeping what was left of it,
 * and runs on from there once the line shows again, so no failure expires
 * unseen.
 */
class TimedLine {
  readonly #options: NoticeStripOptions;
  #failure: VoiceFailure | undefined;
  #hidden = false;
  #leftMs = 0;
  #since = 0;
  #timer: Fiber.Fiber<void> | undefined;

  constructor(options: NoticeStripOptions) {
    this.#options = options;
  }

  get failure(): VoiceFailure | undefined {
    return this.#failure;
  }

  /** A new failure, or none: a new thing to read, so its clock starts whole. */
  show(failure: VoiceFailure | undefined): void {
    this.#halt();
    this.#failure = failure;
    this.#leftMs = VOICE_ERROR_NOTICE_MS;
    this.#run();
  }

  hide(hidden: boolean): void {
    if (hidden === this.#hidden) return;
    this.#hidden = hidden;
    if (hidden) this.#pause();
    else this.#run();
  }

  stop(): void {
    this.#halt();
  }

  #run(): void {
    if (this.#failure === undefined || this.#hidden || this.#timer !== undefined) return;
    this.#since = this.#options.now();
    this.#timer = this.#options.fork(
      Effect.andThen(
        Effect.sleep(Duration.millis(this.#leftMs)),
        Effect.sync(() => this.#expire()),
      ),
    );
  }

  #pause(): void {
    if (this.#timer === undefined) return;
    this.#leftMs = Math.max(0, this.#leftMs - (this.#options.now() - this.#since));
    this.#halt();
  }

  #expire(): void {
    this.#timer = undefined;
    this.#failure = undefined;
    this.#options.onChanged();
  }

  /** Interrupts the clock without waiting for it to finish: what it guarantees is that the expiry does not run after, never that the fiber has already ended. */
  #halt(): void {
    this.#timer?.interruptUnsafe();
    this.#timer = undefined;
  }
}

/**
 * The two lines the caption strip draws when there is no speech to draw: what
 * went wrong, and what is temporarily unavailable, each as its key. A fault
 * the developer cannot dismiss must dismiss itself, so each line has a clock,
 * and each new failure re-arms it, because it is a new thing to read.
 */
export class NoticeStrip {
  readonly #options: NoticeStripOptions;
  readonly #error: TimedLine;
  readonly #notice: TimedLine;

  constructor(options: NoticeStripOptions) {
    this.#options = options;
    this.#error = new TimedLine(options);
    this.#notice = new TimedLine(options);
  }

  get error(): VoiceFailure | undefined {
    return this.#error.failure;
  }

  get notice(): VoiceFailure | undefined {
    return this.#notice.failure;
  }

  showError(failure: VoiceFailure | undefined): void {
    this.#error.show(failure);
    this.#options.onChanged();
  }

  showNotice(failure: VoiceFailure | undefined): void {
    this.#notice.show(failure);
    this.#options.onChanged();
  }

  /** Which lines speech hides now (`noticeLinesHidden`): a hidden line's clock stands still until it shows again. */
  conceal(hidden: { error: boolean; notice: boolean }): void {
    this.#error.hide(hidden.error);
    this.#notice.hide(hidden.notice);
  }

  /** Both lines go: an exchange going live outranks the clock either was on. */
  clear(): void {
    this.showError(undefined);
    this.showNotice(undefined);
  }

  /** Lets go of both clocks; the words themselves die with the window. */
  stop(): void {
    this.#error.stop();
    this.#notice.stop();
  }
}
