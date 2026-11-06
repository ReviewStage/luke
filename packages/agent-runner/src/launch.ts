import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Cause, Queue, Redacted } from "effect";
import { Data } from "effect";
import type { EventSink } from "./events.js";
import { RUNNER_ENV, RUNNER_PLACE, type RunnerEnd, type RunnerWakeup } from "./protocol.js";

export function runsOnHost(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[RUNNER_ENV.PLACE] === RUNNER_PLACE.HOST;
}

export class RunnerFailed extends Data.TaggedError("RunnerFailed")<{ readonly detail: string }> {}

export interface RunnerSelf {
  readonly executable: string;
  readonly script: string;
}

export interface LaunchContext<Config> {
  readonly config: Config;
  readonly lines: Queue.Dequeue<string, Cause.Done>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly bearer: Redacted.Redacted;
  readonly sink: EventSink;
  readonly self?: RunnerSelf | undefined;
}

export interface LaunchOutcome {
  readonly end: RunnerEnd;
  readonly failure: string;
  readonly wakeups?: readonly RunnerWakeup[];
}

export function installedSkillsPath(folder: string | undefined, entry: string): string | undefined {
  if (folder === undefined) return undefined;
  const path = join(folder, entry);
  return existsSync(path) ? path : undefined;
}
