import { NativeHelper, type NativeHelperProcess } from "./native-helper";

/**
 * What a parser returns for a line that says the helper cannot answer. A
 * symbol, so a watcher whose state is itself a string can still return one.
 */
export const LINE_UNAVAILABLE: unique symbol = Symbol("line-unavailable");
export type LineUnavailable = typeof LINE_UNAVAILABLE;

/**
 * A line's meaning: a state to report, the helper saying it cannot answer, or
 * nothing — a line that does not parse is dropped rather than guessed at.
 */
export type ParsedLine<State> = State | LineUnavailable | undefined;

export interface LineWatcherOptions<State> {
  binary: string;
  /** Fixed by the build and by the caller; never anything read from a model. */
  arguments?: readonly string[];
  /** `"pipe"` only for a watcher that writes the helper a word. */
  input?: "ignore" | "pipe";
  parse: (line: string) => ParsedLine<State>;
  onState: (state: State) => void;
  /**
   * The helper cannot answer. Called at most once for an ending — a spawn that
   * failed, an error, an exit — and never for a stop the app asked for. Called
   * repeatedly, without ending the watch, for a parsed `LINE_UNAVAILABLE` when
   * `unavailableLineEnds` is false.
   */
  onUnavailable: () => void;
  /**
   * Whether a parsed `LINE_UNAVAILABLE` ends the watch. True for a helper whose
   * refusal is final (the talk key never registers again); false for one whose
   * subject can come back (the default output device changes).
   */
  unavailableLineEnds: boolean;
  /**
   * How long `stop()` waits for the process to actually exit. Zero — the
   * default — kills and does not wait. Non-zero only where a successor needs
   * the system to have released what this process held.
   */
  exitWaitMs?: number;
  /** Internal seam for tests; production always uses the one spawn in NativeHelper. */
  spawnProcess?: () => NativeHelperProcess | undefined;
}

export interface LineWatcher {
  /** Answers whether the helper could be launched at all, not whether it can answer. */
  start(): boolean;
  /** One line to the helper's stdin; false when there is nothing to write to. */
  send(line: string): boolean;
  /** Detaches, kills, and resolves when the process is gone or `exitWaitMs` elapses. */
  stop(): Promise<void>;
}

/**
 * One native helper read as a stream of lines: hold the process, parse each
 * line, report the states, and report a single ending however it is heard.
 * What differs between helpers is the parser and the edges, so that is all a
 * caller supplies.
 */
export function lineWatcher<State>(options: LineWatcherOptions<State>): LineWatcher {
  let helper: NativeHelper | undefined;
  let done = false;

  const end = (): void => {
    if (done) return;
    done = true;
    helper = undefined;
    options.onUnavailable();
  };

  const handle = (line: string): void => {
    if (done) return;
    const parsed = options.parse(line);
    if (parsed === undefined) return;
    if (parsed === LINE_UNAVAILABLE) {
      if (options.unavailableLineEnds) end();
      else options.onUnavailable();
      return;
    }
    options.onState(parsed);
  };

  return {
    start(): boolean {
      // One helper per watcher: a second start would orphan a live process
      // whose lines no one reads, and a restart after an ending would reopen a
      // watch already reported unavailable.
      if (helper || done) return false;
      const started = new NativeHelper({
        binary: options.binary,
        ...(options.arguments ? { arguments: options.arguments } : undefined),
        ...(options.input ? { input: options.input } : undefined),
        output: "lines",
        ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : undefined),
      });
      started.onLine(handle);
      started.onExit(end);
      if (!started.start()) {
        end();
        return false;
      }
      helper = started;
      return true;
    },
    send(line: string): boolean {
      return done ? false : (helper?.writeLine(line) ?? false);
    },
    stop(): Promise<void> {
      // Latched before detaching: the pipe outlives the kill by however long
      // the process takes to die, so a line still in it is dropped rather than
      // acted on under a helper the app has already let go of.
      const stopping = helper;
      done = true;
      helper = undefined;
      return stopping?.stop(options.exitWaitMs ?? 0) ?? Promise.resolve();
    },
  };
}
