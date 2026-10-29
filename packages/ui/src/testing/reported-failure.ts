/**
 * reported-failure.ts -- a failure as an app would hand it to a component that says it in place, recording each time it was said shown and copying into a list, so a test reads what the component reported and copied.
 */

import type { ReportedFailure } from "../reported-failure.js";

/** A recorded failure: what a component was handed, how often it said it was shown, and what was copied of it. */
export interface RecordedFailure {
  readonly failure: ReportedFailure;
  readonly shown: () => number;
  readonly copied: readonly string[];
}

/** A failure whose details are `details`, recording what is said of it. */
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
