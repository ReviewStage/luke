import { ErrorReporter, type Layer } from "effect";

export interface RecordingReporter {
  readonly reported: string[];
  readonly layer: Layer.Layer<never>;
}

export function recordingReporter(): RecordingReporter {
  const reported: string[] = [];
  const layer = ErrorReporter.layer([
    ErrorReporter.make(({ error }) => {
      reported.push(error.message);
    }),
  ]);
  return { reported, layer };
}
