import { Logger } from "effect";

/**
 * Writes one line to stderr, and loses it rather than throwing when stderr is
 * gone. A development launch's stderr is a pipe to the terminal that started
 * it, and stopping the app from that terminal closes the pipe before the quit
 * finishes tearing down; a write then fails with EIO or EPIPE, and an
 * uncaught one would end the quit in Electron's error dialog. A line that has
 * nobody left to read it is the one thing this reporter may drop.
 */
function writeLine(message: string): void {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // Nothing reads a closed pipe; the quit goes on.
  }
}

/** The plain-function face every unconverted caller still holds. */
export function reportToStderr(message: string): void {
  writeLine(message);
}

/**
 * The same sink as an Effect `Logger`, so a caller already running on Effect
 * can replace the runtime's default logger with this one directly rather than
 * closing over `reportToStderr` again. Both faces draw from `writeLine`
 * above, so the line a caller sees is the same whichever one wrote it.
 */
export const stderrLogger: Logger.Logger<unknown, void> = Logger.make((options) => {
  writeLine(String(options.message));
});

/**
 * A pipe can also fail after the write was accepted, and Node raises that on
 * the stream as an `error` event, which is uncaught unless something listens.
 */
export function tolerateClosedStderr(): void {
  process.stderr.on("error", () => undefined);
}
