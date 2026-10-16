import { createServer } from "node:net";
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

const PR_RUN_PROCESS = {
  /** How long the group has to end after SIGTERM before it is sent SIGKILL. */
  KILL_GRACE: Duration.seconds(3),
  /** How long the output is read once the command exited, for what it wrote just before. */
  DRAIN_GRACE: Duration.seconds(1),
} as const;

/** The developer's login shell. */
export interface RunShell {
  readonly path: string;
}

/**
 * What the command's environment adds to the app's own: nothing that pages,
 * git asking nothing, colour kept though the output is a pipe (the tab draws
 * it on a terminal), where the checkout is, and whatever the caller adds.
 */
function commandEnvironment(folder: string, added: Readonly<Record<string, string>>) {
  return {
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    FORCE_COLOR: "1",
    CLICOLOR_FORCE: "1",
    LUKE_PR_CHECKOUT: folder,
    ...added,
  };
}

/** The command run in the checkout until it ends, its output handed to `write`; answers its exit status, null where a signal ended it. */
export function runPullRequestCommand(
  shell: RunShell,
  folder: string,
  command: string,
  write: (bytes: Uint8Array) => Effect.Effect<void>,
  environment: Readonly<Record<string, string>> = {},
): Effect.Effect<number | null, unknown, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(shell.path, ["-l", "-c", command], {
        cwd: folder,
        env: commandEnvironment(folder, environment),
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

/** The port a run is handed when the Mac finds none free, which a run command may still bind or not. */
const FALLBACK_PORT = 3000;

/** A port no process on this Mac holds now, asked of the system by listening on port 0 and letting it go. */
export const freeLocalPort: Effect.Effect<number> = Effect.callback<number>((resume) => {
  const server = createServer();
  server.once("error", () => resume(Effect.succeed(FALLBACK_PORT)));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : FALLBACK_PORT;
    server.close(() => resume(Effect.succeed(port)));
  });
});
