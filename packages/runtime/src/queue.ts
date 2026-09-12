import type { ScheduledTimer } from "./children.js";

export type { ScheduledTimer } from "./children.js";

/**
 * How input that arrives while a conversation is busy is queued, ported from
 * OpenClaw `b7528507`'s reply queue. A conversation runs one execution at a
 * time; what arrives during one is admitted here under the queue's mode and
 * bounds, and handed back at the next safe boundary as one or more turns.
 *
 * - Steer: the run under way takes the words at its next model boundary.
 *   When it cannot — no run is active, or the run has ended — the input
 *   waits as a follow-up.
 * - Follow-up: each input opens its own turn after the run under way.
 * - Collect: inputs that arrive within the debounce window open one turn
 *   together after the run under way.
 * - Interrupt: the run under way is cancelled and the input opens at once.
 *
 * The queue holds at most its capacity; past it, the overflow policy decides.
 * Summarize is the default: the oldest queued inputs are folded into a short
 * summary that rides ahead of the next drain, so nothing arrives unannounced
 * and nothing unbounded is kept.
 */

export const QUEUE_MODE = {
  STEER: "steer",
  FOLLOWUP: "followup",
  COLLECT: "collect",
  INTERRUPT: "interrupt",
} as const;

export type QueueMode = (typeof QUEUE_MODE)[keyof typeof QUEUE_MODE];

export const QUEUE_OVERFLOW = {
  SUMMARIZE: "summarize",
  DROP_OLDEST: "old",
  DROP_NEWEST: "new",
} as const;

export type QueueOverflow = (typeof QUEUE_OVERFLOW)[keyof typeof QUEUE_OVERFLOW];

export const QUEUE_DEFAULTS = {
  MODE: QUEUE_MODE.STEER,
  DEBOUNCE_MS: 500,
  CAPACITY: 20,
  OVERFLOW: QUEUE_OVERFLOW.SUMMARIZE,
  /** How much of a summarized input's words the summary keeps. */
  SUMMARY_HEAD_CHARS: 80,
} as const;

export interface QueueSettings {
  readonly mode: QueueMode;
  readonly debounceMs: number;
  readonly capacity: number;
  readonly overflow: QueueOverflow;
}

export const DEFAULT_QUEUE_SETTINGS: QueueSettings = {
  mode: QUEUE_DEFAULTS.MODE,
  debounceMs: QUEUE_DEFAULTS.DEBOUNCE_MS,
  capacity: QUEUE_DEFAULTS.CAPACITY,
  overflow: QUEUE_DEFAULTS.OVERFLOW,
};

export interface QueuedInput {
  /** The input's own identity, so the same input admitted twice is one entry. */
  readonly id: string;
  readonly text: string;
  readonly atMs: number;
}

export interface PendingQueueState {
  readonly entries: readonly QueuedInput[];
  /** One line per summarized input, oldest first; drained ahead of the entries. */
  readonly summaryLines: readonly string[];
  readonly summarizedCount: number;
}

export const EMPTY_QUEUE: PendingQueueState = { entries: [], summaryLines: [], summarizedCount: 0 };

export interface QueueAdmission {
  readonly state: PendingQueueState;
  /** Whether the input entered the queue; false when it was already there or the overflow refused it. */
  readonly admitted: boolean;
  /** Inputs the overflow let go of, summarized or dropped, in the order they went. */
  readonly evicted: readonly QueuedInput[];
}

/** The one line an input folded by the overflow keeps: the head of its words, whitespace collapsed. */
export function queueSummaryLine(input: QueuedInput): string {
  const head = input.text.replace(/\s+/g, " ").trim();
  return head.length > QUEUE_DEFAULTS.SUMMARY_HEAD_CHARS
    ? `${head.slice(0, QUEUE_DEFAULTS.SUMMARY_HEAD_CHARS)}…`
    : head;
}

/**
 * Admits one input under the capacity and overflow policy. Pure: the caller
 * holds the state and decides when to drain it. An input already queued by id
 * is not queued twice, which is what keeps a duplicated hook or a retried
 * submission from opening two turns.
 */
export function admitToQueue(
  state: PendingQueueState,
  input: QueuedInput,
  settings: Pick<QueueSettings, "capacity" | "overflow"> = DEFAULT_QUEUE_SETTINGS,
): QueueAdmission {
  if (state.entries.some((entry) => entry.id === input.id)) {
    return { state, admitted: false, evicted: [] };
  }
  const capacity = Math.max(1, Math.floor(settings.capacity));
  if (state.entries.length < capacity) {
    return { state: { ...state, entries: [...state.entries, input] }, admitted: true, evicted: [] };
  }
  switch (settings.overflow) {
    case QUEUE_OVERFLOW.DROP_NEWEST:
      return { state, admitted: false, evicted: [input] };
    case QUEUE_OVERFLOW.DROP_OLDEST: {
      const [oldest, ...rest] = state.entries;
      return {
        state: { ...state, entries: [...rest, input] },
        admitted: true,
        evicted: oldest ? [oldest] : [],
      };
    }
    case QUEUE_OVERFLOW.SUMMARIZE: {
      const [oldest, ...rest] = state.entries;
      if (!oldest) return { state, admitted: false, evicted: [input] };
      return {
        state: {
          entries: [...rest, input],
          summaryLines: [...state.summaryLines, queueSummaryLine(oldest)],
          summarizedCount: state.summarizedCount + 1,
        },
        admitted: true,
        evicted: [oldest],
      };
    }
  }
}

/** The words a drain opens with about what the overflow folded, or nothing when it folded nothing. */
export function queueSummaryText(state: PendingQueueState): string | undefined {
  if (state.summarizedCount === 0) return undefined;
  const count = state.summarizedCount;
  return [
    `${count} earlier ${count === 1 ? "input was" : "inputs were"} summarized because the queue was full:`,
    ...state.summaryLines.map((line) => `- ${line}`),
  ].join("\n");
}

/** One drained turn's worth of inputs, with the summary that rides ahead of the first. */
export interface QueueBatch {
  readonly inputs: readonly QueuedInput[];
  readonly summary?: string;
}

/** Splits the queue into the turns its mode opens: one per input for follow-up, one for all for collect. */
export function drainQueue(state: PendingQueueState, mode: QueueMode): readonly QueueBatch[] {
  if (state.entries.length === 0 && state.summarizedCount === 0) return [];
  const summary = queueSummaryText(state);
  if (mode === QUEUE_MODE.FOLLOWUP && state.entries.length > 0) {
    return state.entries.map((input, index) => ({
      inputs: [input],
      ...(index === 0 && summary ? { summary } : undefined),
    }));
  }
  return [{ inputs: state.entries, ...(summary ? { summary } : undefined) }];
}

export interface PendingInputQueueOptions {
  settings?: Partial<QueueSettings>;
  /** Hands the input to the run under way at its next boundary; false when no run can take it. */
  steer: (input: QueuedInput) => boolean;
  /** Cancels the run under way so the input can open at once. */
  interrupt: () => void;
  /** Opens the drained turns, in order. */
  flush: (batches: readonly QueueBatch[]) => void;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
}

/**
 * The live queue of one conversation. Input is admitted under the mode and
 * bounds above; a debounce timer collects what arrives together; and the
 * flush hands the drained turns to the conversation. Nothing here runs a
 * model: the queue decides when words open a turn, and the conversation
 * decides everything after.
 */
export class PendingInputQueue {
  readonly #settings: QueueSettings;
  readonly #options: PendingInputQueueOptions;
  readonly #schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly #cancel: (timer: ScheduledTimer) => void;
  #state: PendingQueueState = EMPTY_QUEUE;
  #timer: ScheduledTimer | undefined;

  constructor(options: PendingInputQueueOptions) {
    this.#options = options;
    this.#settings = { ...DEFAULT_QUEUE_SETTINGS, ...options.settings };
    this.#schedule =
      options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.#cancel =
      options.cancel ??
      ((timer) => {
        // SAFETY: a timer this queue scheduled itself came from setTimeout above.
        globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
  }

  get settings(): QueueSettings {
    return this.#settings;
  }

  get state(): PendingQueueState {
    return this.#state;
  }

  /** How many asks wait here for a turn: the entries and the ones folded into the summary alike. */
  get size(): number {
    return this.#state.entries.length + this.#state.summarizedCount;
  }

  /**
   * Admits one input under the mode. Answers whether it was taken anywhere —
   * steered into the run under way, or queued for a later turn — so a caller
   * can tell a duplicate from a new input.
   */
  push(input: QueuedInput, mode: QueueMode = this.#settings.mode): boolean {
    if (mode === QUEUE_MODE.STEER && this.size === 0 && this.#options.steer(input)) return true;
    const admission = admitToQueue(this.#state, input, this.#settings);
    this.#state = admission.state;
    if (!admission.admitted) return false;
    if (mode === QUEUE_MODE.INTERRUPT) {
      this.#options.interrupt();
      this.#flushNow();
      return true;
    }
    this.#arm();
    return true;
  }

  /** Drains everything now, in the mode given; a caller uses it when a run ends with input waiting. */
  flush(mode: QueueMode = this.#settings.mode): void {
    this.#flushNow(mode);
  }

  /**
   * Withdraws one queued input before it is drained, so words the developer
   * took back never open a turn. Answers whether it was still waiting here;
   * an input already steered or drained is past withdrawing.
   */
  withdraw(id: string): boolean {
    const entries = this.#state.entries.filter((entry) => entry.id !== id);
    if (entries.length === this.#state.entries.length) return false;
    this.#state = { ...this.#state, entries };
    if (entries.length === 0 && this.#state.summarizedCount === 0) this.#disarm();
    return true;
  }

  /**
   * Withdraws one input the overflow already folded, by its place in the
   * summary (fold order, oldest first), so a summary whose asks were all
   * taken back holds no turn open and counts nothing waiting.
   */
  withdrawSummarized(index: number): boolean {
    const lines = this.#state.summaryLines;
    if (!Number.isInteger(index) || index < 0 || index >= lines.length) return false;
    this.#state = {
      ...this.#state,
      summaryLines: lines.filter((_, at) => at !== index),
      summarizedCount: this.#state.summarizedCount - 1,
    };
    if (this.#state.entries.length === 0 && this.#state.summarizedCount === 0) this.#disarm();
    return true;
  }

  /** Forgets everything queued; the timer goes with it. */
  clear(): void {
    this.#disarm();
    this.#state = EMPTY_QUEUE;
  }

  #arm(): void {
    if (this.#timer !== undefined) return;
    this.#timer = this.#schedule(() => {
      this.#timer = undefined;
      this.#flushNow();
    }, this.#settings.debounceMs);
  }

  #disarm(): void {
    if (this.#timer === undefined) return;
    this.#cancel(this.#timer);
    this.#timer = undefined;
  }

  #flushNow(mode: QueueMode = this.#settings.mode): void {
    this.#disarm();
    const batches = drainQueue(this.#state, mode);
    this.#state = EMPTY_QUEUE;
    if (batches.length > 0) this.#options.flush(batches);
  }
}
