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

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Cause, Queue, Redacted } from "effect";
import { Data } from "effect";
import type { EventSink } from "./events.js";
import type { RunnerEnd, RunnerWakeup } from "./protocol.js";

/** Whether the runner runs on the developer's Mac, under Seatbelt, rather than in a Linux sandbox under bubblewrap. */
export const ON_MAC = process.platform === "darwin";

/**
 * Where a command the agent runs on a Mac may write beside its worktree and
 * its temp folder, each a folder of the developer's home: the caches
 * toolchains share across projects, so a build or an install there works as
 * in the developer's own shell. A Mac's sandbox is the developer's whole
 * home otherwise, read but not written. Each harness spells them as its own
 * sandbox takes a path.
 */
export const MAC_TOOLCHAIN_CACHES = [".cache", "Library/Caches", ".npm"] as const;

/**
 * The Git folder a worktree's commits write, where it is not the worktree's
 * own: a local agent's worktree is one of Luke's shared clone
 * (`@luke/host`'s `agentWorktreeScript`), whose objects and refs stand
 * outside it, so a sandbox that writes only the worktree could not commit.
 * Read from the worktree's `.git` file and its `commondir`, as Git resolves
 * them (https://git-scm.com/docs/gitrepository-layout); none for a checkout
 * whose `.git` is its own folder, and none where either cannot be read.
 */
export function gitCommonDir(cwd: string): string | undefined {
  try {
    const dotGit = join(cwd, ".git");
    if (statSync(dotGit).isDirectory()) return undefined;
    const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
    if (pointer === undefined) return undefined;
    const gitDir = resolve(cwd, pointer);
    const common = readFileSync(join(gitDir, "commondir"), "utf8").trim();
    return resolve(gitDir, common);
  } catch {
    return undefined;
  }
}

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
