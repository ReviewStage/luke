import { runtimeExit } from "@sidecar/brain";
import type { ExecutionRuntime } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";

/** The work is described here and run by whichever edge composed it. */
export function greeting(name: string): Effect.Effect<string> {
  return Effect.sync(() => `hello ${name}`);
}

/** Handing the runner on is not running: only the second call would run one. */
export function runnerFor(execution: ExecutionRuntime): ReturnType<typeof runtimeExit> {
  return runtimeExit(execution);
}
