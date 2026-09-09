import type { NativeHelperProcess } from "#main/native/native-helper";

export interface FakeNativeHelper {
  /** The process the watcher is handed in place of a spawned binary. */
  readonly process: NativeHelperProcess;
  /** Delivers stdout bytes exactly as written — split a line to exercise framing. */
  emit(chunk: string): void;
  /** The helper's `exit` event. */
  exit(): void;
  /** Every chunk written to the helper's stdin, in order, exactly as written. */
  readonly written: string[];
  killed(): boolean;
  /** Whether stdin was closed without a kill — how the media helper is released. */
  inputEnded(): boolean;
}

/**
 * A helper process that never was: the watcher subscribes and writes to it
 * exactly as it would to a spawned binary, and the test says what came back.
 */
export function fakeNativeHelper(): FakeNativeHelper {
  const written: string[] = [];
  const exits: (() => void)[] = [];
  let onData: ((chunk: string) => void) | undefined;
  let killed = false;
  let inputEnded = false;

  const process: NativeHelperProcess = {
    stdin: {
      write: (chunk) => {
        written.push(chunk);
      },
      end: () => {
        inputEnded = true;
      },
      on: () => undefined,
    },
    stdout: {
      setEncoding: () => undefined,
      on: (_event, listener) => {
        onData = listener;
      },
    },
    on: (event, listener) => {
      if (event === "exit") exits.push(listener);
    },
    // Detaching before the kill is what keeps a line the dying helper got out
    // from being acted on, so a fired exit after one must reach nothing.
    removeAllListeners: () => {
      exits.length = 0;
    },
    kill: () => {
      killed = true;
    },
  };

  return {
    process,
    written,
    emit: (chunk) => onData?.(chunk),
    exit: () => {
      for (const listener of [...exits]) listener();
    },
    killed: () => killed,
    inputEnded: () => inputEnded,
  };
}
