/**
 * launch.ts -- what every harness's launch is handed once the runner has read its config, and what it answers when it ends.
 *
 * The runner reads the bearer, the config line and Luke's events route the
 * same way for either harness (`runner.ts`), then hands the rest of stdin and
 * the event sink to Claude Code's launch or Codex's (`codex.ts`). Each
 * answers why it ended once it has stopped its harness, and the runner posts
 * the launch's last event after that, so nothing the harness emits on the way
 * down is numbered after it.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Cause, Queue, Redacted } from "effect";
import { Data } from "effect";
import type { EventSink } from "./events.js";
import type { RunnerEnd, RunnerWakeup } from "./protocol.js";

/** Why a launch could not run at all, before or after its harness. */
export class RunnerFailed extends Data.TaggedError("RunnerFailed")<{ readonly detail: string }> {}

/**
 * How to start the runner's own bundle again, as a command its harness runs:
 * Node's executable and the bundle's path, as the process was started with.
 * Codex's launch runs it as app-server's token command (`codex-token.ts`).
 */
export interface RunnerSelf {
  readonly executable: string;
  readonly script: string;
}

/** What a harness's launch is handed. */
export interface LaunchContext<Config> {
  readonly config: Config;
  /** Luke's stdin lines after the config, ended when Luke closes stdin. */
  readonly lines: Queue.Dequeue<string, Cause.Done>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly bearer: Redacted.Redacted;
  readonly sink: EventSink;
  /** The runner's own bundle as a command; none where the runner was not started from one, as in a test that names none. */
  readonly self?: RunnerSelf | undefined;
}

/** Why a launch ended, the harness's failure where it failed, and the wakeups a released wait left, for the last event. */
export interface LaunchOutcome {
  readonly end: RunnerEnd;
  readonly failure: string;
  readonly wakeups?: readonly RunnerWakeup[];
}

/**
 * The path under the installed skills' folder a config names, where Luke
 * wrote it; none where the config names no folder or the member installed
 * no skills, since Luke writes the folder only where there are some. Read
 * as each launch starts, so a relaunch finds what the sandbox's disk kept.
 */
export function installedSkillsPath(folder: string | undefined, entry: string): string | undefined {
  if (folder === undefined) return undefined;
  const path = join(folder, entry);
  return existsSync(path) ? path : undefined;
}
