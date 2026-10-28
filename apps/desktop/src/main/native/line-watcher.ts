import { NativeHelper } from "./native-helper";

export interface LineWatcherOptions<State> {
  binary: string;
  /** `"pipe"` only for a watcher that writes the helper a word. */
  input?: "ignore" | "pipe";
  /** A line's state to report, or nothing: a line that does not parse is dropped rather than guessed at. */
  parse: (line: string) => State | undefined;
  onState: (state: State) => void;
  /**
   * The helper cannot answer. Called at most once, for an ending — a spawn
   * that failed, an error, an exit — and never for a stop the app asked for.
   */
  onUnavailable: () => void;
}

export interface LineWatcher {
  /** Answers whether the helper could be launched at all, not whether it can answer. */
  start(): boolean;
  /** One line to the helper's stdin; false when there is nothing to write to. */
  send(line: string): boolean;
  /** Detaches and kills, without waiting for the process to exit. */
  stop(): void;
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
        ...(options.input ? { input: options.input } : undefined),
        output: "lines",
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
    stop(): void {
      // Latched before detaching: the pipe outlives the kill by however long
      // the process takes to die, so a line still in it is dropped rather than
      // acted on under a helper the app has already let go of.
      const stopping = helper;
      done = true;
      helper = undefined;
      stopping?.stop();
    },
  };
}
