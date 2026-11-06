import { NativeHelper } from "./native-helper";

export interface LineWatcherOptions<State> {
  binary: string;
  input?: "ignore" | "pipe";
  parse: (line: string) => State | undefined;
  onState: (state: State) => void;
  onUnavailable: () => void;
}

export interface LineWatcher {
  start(): boolean;
  send(line: string): boolean;
  stop(): void;
}

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
      const stopping = helper;
      done = true;
      helper = undefined;
      stopping?.stop();
    },
  };
}
