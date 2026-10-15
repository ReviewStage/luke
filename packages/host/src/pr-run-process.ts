import { Duration, Effect, Fiber, Option, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

/**
 * pr-run-process.ts -- a repository's run command, run in the developer's login shell from the root of a pull request's checkout, for as long as it runs.
 *
 * The command is handed to the shell whole as its `-c` argument, never
 * spliced into shell text, with nothing on its stdin, and runs as the leader
 * of a process group of its own. It has no timeout: a server runs until the
 * developer stops it. What it prints on either stream is handed to `write`
 * as it arrives, one chunk at a time, and the next chunk is not read until
 * `write` returns, so a caller that waits on a slow reader backs the pipe up
 * into the command rather than into this process. When the command ends on
 * its own its status is answered, and anything it left running in its group
 * is ended; when the scope it runs in closes first (a Stop, a closed tab, a
 * sign-out, a quit) the group is sent SIGTERM and, if anything is left,
 * SIGKILL `KILL_GRACE` later. A command that could not be started fails.
 */

export const PR_RUN_PROCESS = {
  /** How long the group has to end after SIGTERM before it is sent SIGKILL. */
  KILL_GRACE: Duration.seconds(3),
  /** How long the output is read once the command exited, for what it wrote just before. */
  DRAIN_GRACE: Duration.seconds(1),
} as const;

/** The developer's login shell. */
export interface RunShell {
  readonly path: string;
}

/** What the command's environment adds to the app's own: nothing that pages, git asking nothing, and where the checkout is. */
function commandEnvironment(folder: string): Record<string, string> {
  return {
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LUKE_PR_CHECKOUT: folder,
  };
}

/** The command run in the checkout until it ends, its output handed to `write`; answers its exit status, null where a signal ended it. */
export function runPullRequestCommand(
  shell: RunShell,
  folder: string,
  command: string,
  write: (bytes: Uint8Array) => Effect.Effect<void>,
): Effect.Effect<number | null, unknown, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(shell.path, ["-l", "-c", command], {
        cwd: folder,
        env: commandEnvironment(folder),
        extendEnv: true,
        stdin: "ignore",
        forceKillAfter: PR_RUN_PROCESS.KILL_GRACE,
      });
      const drain = yield* Effect.forkScoped(Effect.ignore(Stream.runForEach(handle.all, write)));
      const exitCode = yield* Effect.option(handle.exitCode);
      // Note that the output is waited on only briefly, because a child the command left running holds the pipe open.
      yield* Effect.ignore(Effect.timeoutOption(Fiber.join(drain), PR_RUN_PROCESS.DRAIN_GRACE));
      return Option.getOrNull(Option.map(exitCode, Number));
    }),
  );
}
