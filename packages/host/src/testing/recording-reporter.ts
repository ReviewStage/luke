/**
 * recording-reporter.ts -- Effect's `ErrorReporter` as a suite stands it in for Sentry's: every error a boundary reports, written down by its message.
 */

import { ErrorReporter, type Layer } from "effect";

/** What a suite reads back: each reported error's message, in the order reported, and the layer that registers the reporter. */
export interface RecordingReporter {
  readonly reported: string[];
  readonly layer: Layer.Layer<never>;
}

/** A reporter that keeps each reported error's message rather than sending it anywhere. */
export function recordingReporter(): RecordingReporter {
  const reported: string[] = [];
  const layer = ErrorReporter.layer([
    ErrorReporter.make(({ error }) => {
      reported.push(error.message);
    }),
  ]);
  return { reported, layer };
}
