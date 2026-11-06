function writeLine(message: string): void {
  try {
    process.stderr.write(`${message}\n`);
  } catch {}
}

export function reportToStderr(message: string): void {
  writeLine(message);
}

export function tolerateClosedStderr(): void {
  process.stderr.on("error", () => undefined);
}
