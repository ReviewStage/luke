import { GITHUB_FAILURE, type GitHubFailure } from "@sidecar/hosted/github-wire";
import type { PlanRepository } from "@sidecar/hosted/plan-wire";
import type { UnparsedWireValue } from "@sidecar/wire";
import { describeWire, readEither } from "@sidecar/wire/effect";
import { Data, Effect, Redacted, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SandboxSession } from "eve/sandbox";
import type { ToolContext } from "eve/tools";
import type { BashToolInput, BashToolOutput } from "eve/tools/bash";
import { GitHubAccess } from "./github-source.js";

/**
 * repository-shell.ts -- the planning model's one source read: a shell command in a clone of the plan's repository at the plan's commit.
 *
 * The clone is made once per sandbox by the sandbox's own `onSession` hook
 * (`apps/web/eve/sandbox.ts`), which eve runs when a plan conversation's
 * session first opens its sandbox; eve snapshots the sandbox when it idles
 * and resumes it with the clone in place. The account's GitHub token is
 * never written into the sandbox: the fetch is let out to `github.com` under
 * a firewall rule that adds the token's header on the way, and the network
 * is shut again once it lands, so no command the model runs can reach
 * anything. The command itself is eve's own `bash` tool, run from the clone.
 */

/** Why a call ran nothing, in words the model can act on. */
export const REPOSITORY_SHELL_REFUSAL = {
  UNREADABLE: "Not run: the arguments must be exactly `command`, one shell command.",
  NOT_CONNECTED:
    "Not run: the account has no GitHub connection, so the repository was not cloned. " +
    "The developer has to connect GitHub.",
  ACCESS_DENIED:
    "Not run: GitHub refused the account's connection, or it lacks access to repositories. " +
    "The developer has to connect GitHub again.",
  CLONE_FAILED:
    "Not run: the repository could not be cloned at the plan's commit. The call may be made again.",
} as const;

const REFUSAL_OF_FAILURE = {
  [GITHUB_FAILURE.NOT_CONNECTED]: REPOSITORY_SHELL_REFUSAL.NOT_CONNECTED,
  [GITHUB_FAILURE.ACCESS_DENIED]: REPOSITORY_SHELL_REFUSAL.ACCESS_DENIED,
  [GITHUB_FAILURE.NOT_FOUND]: REPOSITORY_SHELL_REFUSAL.CLONE_FAILED,
  [GITHUB_FAILURE.EMPTY_REPOSITORY]: REPOSITORY_SHELL_REFUSAL.CLONE_FAILED,
  [GITHUB_FAILURE.RATE_LIMITED]: REPOSITORY_SHELL_REFUSAL.CLONE_FAILED,
  [GITHUB_FAILURE.FAILED]: REPOSITORY_SHELL_REFUSAL.CLONE_FAILED,
} as const satisfies Record<GitHubFailure, string>;

/** Where the clone is fetched from; a test points it at a local repository. */
const GITHUB_ORIGIN = "https://github.com";

export const REPOSITORY_SHELL_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type RepositoryShellResult =
  | ({ readonly status: typeof REPOSITORY_SHELL_STATUS.RAN } & BashToolOutput)
  | { readonly status: typeof REPOSITORY_SHELL_STATUS.NOT_RUN; readonly reason: string };

/**
 * eve's own `bash` tool's run, handed in by the eve project
 * (`apps/web/eve/host.ts`), because no function bundle may import eve itself.
 */
export type RunBash = (input: BashToolInput, context: ToolContext) => Promise<BashToolOutput>;

const RUN_IN_REPOSITORY_INPUT = Schema.Struct({
  command: describeWire(
    Schema.String.check(Schema.isMinLength(1)),
    'One bash command, run from the repository root, such as "ls", "grep -rn invite src", ' +
      'or "cat package.json".',
  ),
});

const readInput = readEither(RUN_IN_REPOSITORY_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const RUN_IN_REPOSITORY_TOOL = {
  name: "run_in_repository",
  description:
    "Run one bash command in a clone of the plan's GitHub repository at the plan's saved commit, " +
    "from the repository root, with no network. Use it to explore: ls, find, grep, cat, git log. " +
    "Answers the exit code, stdout, and stderr, or `not-run` and why.",
  inputSchema: RUN_IN_REPOSITORY_INPUT,
} as const;

const CLONE_SCRIPT = [
  "git init -q repo",
  'git -C repo fetch -q --depth 1 "$LUKE_ORIGIN" "$LUKE_COMMIT"',
  "git -C repo checkout -q FETCH_HEAD",
].join(" && ");

/** Why the sandbox could not be made ready, as the words the model is handed. */
export class CloneFailed extends Data.TaggedError("CloneFailed")<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

const sandboxCall = <A>(call: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: async () => call(),
    catch: () => new CloneFailed({ reason: REPOSITORY_SHELL_REFUSAL.CLONE_FAILED }),
  });

/**
 * The plan's commit fetched into `/workspace/repo` of a fresh sandbox under
 * the account's connection: the token added at the firewall, and the network
 * shut again after, whatever the fetch did.
 */
export function cloneRepository(
  userId: string,
  repository: PlanRepository,
  sandbox: Pick<SandboxSession, "run" | "setNetworkPolicy">,
  origin: string = GITHUB_ORIGIN,
): Effect.Effect<void, CloneFailed, SqlClient.SqlClient | GitHubAccess> {
  return Effect.gen(function* () {
    const github = yield* GitHubAccess;
    const token = yield* github
      .token(userId)
      .pipe(
        Effect.mapError(
          (failure) => new CloneFailed({ reason: REFUSAL_OF_FAILURE[failure.reason] }),
        ),
      );
    const basic = Buffer.from(`x-access-token:${Redacted.value(token)}`).toString("base64");
    yield* sandboxCall(() =>
      sandbox.setNetworkPolicy({
        allow: {
          "github.com": [{ transform: [{ headers: { authorization: `Basic ${basic}` } }] }],
        },
      }),
    );
    const ran = yield* sandboxCall(() =>
      sandbox.run({
        command: CLONE_SCRIPT,
        env: {
          LUKE_ORIGIN: `${origin}/${repository.owner}/${repository.name}`,
          LUKE_COMMIT: repository.commit,
        },
      }),
    ).pipe(Effect.ensuring(Effect.ignore(sandboxCall(() => sandbox.setNetworkPolicy("deny-all")))));
    if (ran.exitCode !== 0) {
      return yield* new CloneFailed({ reason: REPOSITORY_SHELL_REFUSAL.CLONE_FAILED });
    }
  });
}

/**
 * Which of the refusals a sandbox that would not open carried. Note that only
 * our own words are matched and never handed on as found, because the
 * failure eve wraps them in is free text that may echo what was sent.
 */
function refusalOf(cause: unknown): string {
  const words = cause instanceof Error ? cause.message : "";
  return (
    Object.values(REPOSITORY_SHELL_REFUSAL).find((refusal) => words.includes(refusal)) ??
    REPOSITORY_SHELL_REFUSAL.CLONE_FAILED
  );
}

/**
 * One call of `run_in_repository`: the command through eve's `bash`, from the
 * clone. A sandbox eve could not open, its `onSession` clone having failed,
 * answers the clone's own words.
 */
export function runInRepository(
  context: ToolContext,
  bash: RunBash,
  input: UnparsedWireValue,
): Effect.Effect<RepositoryShellResult> {
  const read = readInput(input);
  if (Result.isFailure(read)) {
    return Effect.succeed({
      status: REPOSITORY_SHELL_STATUS.NOT_RUN,
      reason: REPOSITORY_SHELL_REFUSAL.UNREADABLE,
    });
  }
  const command = `cd repo && ${read.success.command}`;
  return Effect.tryPromise({ try: () => bash({ command }, context), catch: refusalOf }).pipe(
    Effect.map((ran): RepositoryShellResult => ({ status: REPOSITORY_SHELL_STATUS.RAN, ...ran })),
    Effect.catch((reason) => Effect.succeed({ status: REPOSITORY_SHELL_STATUS.NOT_RUN, reason })),
  );
}
