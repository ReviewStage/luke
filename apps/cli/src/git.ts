import { CLI_EXIT } from "@repo/features/cli-exit";
import { githubRepositoryOfRemote } from "@repo/features/cli-git-remote";
import { Effect, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { CommandFailed } from "./output.js";

const ORIGIN = "origin";

interface GitRun {
  readonly code: number;
  readonly stdout: string;
}

const GIT_STDERR = { SHOWN: "inherit", HIDDEN: "ignore" } as const;

type GitStderr = (typeof GIT_STDERR)[keyof typeof GIT_STDERR];

function git(args: readonly string[], stderr: GitStderr = GIT_STDERR.HIDDEN) {
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make("git", [...args], { stdin: "ignore", stderr });
      const stdout = yield* Stream.mkString(Stream.decodeText(handle.stdout));
      const code = yield* handle.exitCode;
      return { code: Number(code), stdout } satisfies GitRun;
    }),
  ).pipe(
    Effect.mapError(
      () =>
        new CommandFailed({
          exit: CLI_EXIT.REFUSED,
          message: "Could not run git. Install git, or name the repository with -R owner/name.",
        }),
    ),
  );
}

function gitOrFail(args: readonly string[], message: string, stderr?: GitStderr) {
  return Effect.flatMap(git(args, stderr), (run) =>
    run.code === 0
      ? Effect.succeed(run.stdout)
      : Effect.fail(new CommandFailed({ exit: CLI_EXIT.REFUSED, message })),
  );
}

export const originRepository = Effect.gen(function* () {
  const remote = yield* gitOrFail(
    ["remote", "get-url", ORIGIN],
    `This folder has no git remote named ${ORIGIN}. Run the command in a checkout, or name the repository with -R owner/name.`,
  );
  const repository = githubRepositoryOfRemote(remote);
  if (repository !== undefined) return repository;
  return yield* new CommandFailed({
    exit: CLI_EXIT.REFUSED,
    message: `${ORIGIN} (${remote.trim()}) is not a GitHub repository. Name one with -R owner/name.`,
  });
});

export function originHasBranch(branch: string) {
  return Effect.map(
    gitOrFail(
      ["ls-remote", "--heads", ORIGIN, `refs/heads/${branch}`],
      `Could not read ${ORIGIN}'s branches.`,
      GIT_STDERR.SHOWN,
    ),
    (printed) => printed.trim().length > 0,
  );
}

export const treeIsClean = Effect.map(
  gitOrFail(["status", "--porcelain"], "Could not read this checkout's status."),
  (printed) => printed.trim().length === 0,
);

export function checkoutFromOrigin(branch: string) {
  return Effect.gen(function* () {
    yield* gitOrFail(
      ["fetch", ORIGIN, `+refs/heads/${branch}:refs/remotes/${ORIGIN}/${branch}`],
      `Could not fetch ${branch} from ${ORIGIN}.`,
      GIT_STDERR.SHOWN,
    );
    const local = yield* git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    if (local.code !== 0) {
      yield* gitOrFail(
        ["checkout", "--track", "-b", branch, `${ORIGIN}/${branch}`],
        `Could not check out ${branch}.`,
        GIT_STDERR.SHOWN,
      );
      return;
    }
    yield* gitOrFail(["checkout", branch], `Could not check out ${branch}.`, GIT_STDERR.SHOWN);
    yield* gitOrFail(
      ["merge", "--ff-only", `${ORIGIN}/${branch}`],
      `${branch} here has commits ${ORIGIN} does not. It is checked out as it was; reconcile it with ${ORIGIN}/${branch} by hand.`,
      GIT_STDERR.SHOWN,
    );
  });
}
