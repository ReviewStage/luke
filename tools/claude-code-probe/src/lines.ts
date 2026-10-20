/**
 * lines.ts -- a command's output, which arrives in chunks cut anywhere, read back as the whole lines the driver printed.
 */

/** A splitter that holds a partial line until the chunk that finishes it arrives. */
export interface LineSplitter {
  /** The lines the chunk finished, in order; a trailing partial line is held. */
  readonly push: (chunk: string) => readonly string[];
  /** The partial line held, as the last line, once the output has ended. */
  readonly flush: () => readonly string[];
}

export function lineSplitter(): LineSplitter {
  let held = "";
  return {
    push: (chunk) => {
      const parts = `${held}${chunk}`.split("\n");
      held = parts.pop() ?? "";
      return parts.filter((line) => line.trim() !== "");
    },
    flush: () => {
      const last = held;
      held = "";
      return last.trim() === "" ? [] : [last];
    },
  };
}
