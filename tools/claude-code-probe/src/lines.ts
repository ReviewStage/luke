export interface LineSplitter {
  readonly push: (chunk: string) => readonly string[];
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
