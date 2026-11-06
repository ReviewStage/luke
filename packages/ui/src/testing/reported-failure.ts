import type { ReportedFailure } from "../reported-failure.js";

export interface RecordedFailure {
  readonly failure: ReportedFailure;
  readonly shown: () => number;
  readonly copied: readonly string[];
}

export function recordedFailure(details = "time: 2026-10-29T18:20:03.198Z"): RecordedFailure {
  let shown = 0;
  const copied: string[] = [];
  return {
    failure: {
      shown: () => {
        shown += 1;
        return details;
      },
      hidden: () => undefined,
      copy: (text) => {
        copied.push(text);
        return Promise.resolve();
      },
    },
    shown: () => shown,
    copied,
  };
}
