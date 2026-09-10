/**
 * Writes one line to stderr, and loses it rather than throwing when stderr is
 * gone. A development launch's stderr is a pipe to the terminal that started
 * it, and stopping the app from that terminal closes the pipe before the quit
 * finishes tearing down; a report written then fails with EIO or EPIPE, and an
 * uncaught one would end the quit in Electron's error dialog. A line that has
 * nobody left to read it is the one thing this reporter may drop.
 */
export function reportToStderr(message: string): void {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // Nothing reads a closed pipe; the quit goes on.
  }
}

/**
 * A pipe can also fail after the write was accepted, and Node raises that on
 * the stream as an `error` event, which is uncaught unless something listens.
 */
export function tolerateClosedStderr(): void {
  process.stderr.on("error", () => undefined);
}
