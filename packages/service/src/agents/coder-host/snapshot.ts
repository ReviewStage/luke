/**
 * snapshot.ts -- the source agent's work, pushed or not, copied to a new branch for an agent continued or forked from it.
 *
 * Each agent runs in a sandbox of its own, so what the source never
 * committed and pushed would be lost to the agent started from it. As that
 * Start is made, the service reaches the source's sandbox by its eve
 * session's tag (`../vercel-sandbox-api.ts`), wakes it where it stopped, as
 * the Terminal tab's resume does, and records its checkout whole: what it
 * committed, what it changed, and every file it made that git does not
 * ignore, as one commit on top of its `HEAD`, or `HEAD` itself where
 * nothing changed. The commit is built on an index of its own in a
 * temporary directory, so the source's own index and working tree are never
 * touched, and the source may be idle or mid-turn: nothing here writes to it
 * but git's objects, and a push. The push goes through the repository's
 * write token, set at the sandbox's firewall on GitHub's hosts as eve's own
 * `authenticateGitHub` and the Terminal tab set it, so no token enters the
 * sandbox's files or a command's words. A sandbox this step woke is stopped
 * again once it is done, however it ended, unless a developer's terminal
 * holds it, a turn of the source began meanwhile, or another Start's copy
 * still holds it past this one's own hold; one already up stays as it was.
 * That stop's calls to Vercel run on a fiber of its own, so the Start never
 * waits on them, and one they never confirmed is stopped by the scheduled
 * sweep once the copy's hold lapses. A copy that fails logs the tail of what
 * it printed on stderr, credential-shaped runs redacted.
 * Files named the way credentials are kept are never copied. No copy is
 * made where the task moved to another repository since the source
 * started, since the new agent's checkout would not hold the branch. The
 * whole step is bounded, so a Start waits on it no longer than that, and
 * whatever goes wrong is a miss the caller names, never a failure.
 */

import { createHash } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { type CodingAgent, readCodingAgentByKey } from "@luke/database/models/coding-agent-store";
import { latestTurnsOfReached } from "@luke/database/models/message-reads";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import { holdSandbox, sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import { readTaskHeader } from "@luke/database/models/task-store";
import { redactCredentials } from "@luke/features/credential-redaction";
import { TURN_STATUS } from "@luke/wire";
import { Clock, Duration, Effect, Option, type Redacted, Schedule } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../../github/github-app.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { githubTokenPolicy } from "../terminal/agent-sandbox.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import { CODER } from "./bounds.js";
import { agentRepositoryToken } from "./checkout.js";

export const SNAPSHOT = {
  /** The most a Start waits on the copy, the source's sandbox woken and the push included. */
  TIMEOUT: Duration.seconds(30),
  /** How often a woken sandbox is asked whether it is up yet. */
  WAKE_POLL: Duration.seconds(1),
  /** The most the background stop of a woken sandbox runs, once the copy is done or given up. */
  STOP_TIMEOUT: Duration.seconds(10),
  /** How many characters of a failed copy's stderr are logged, from its end. */
  STDERR_TAIL: 600,
} as const;

/** Why the source's work was not copied: the Start already made its agent, the task moved repository since the source started, the source never opened a sandbox, the copy failed, or it ran past its bound. */
export const SNAPSHOT_MISS = {
  STARTED: "started",
  /** The task moved to another repository than the source's, which the new agent's checkout would not hold the branch in. */
  MOVED: "moved",
  NO_SANDBOX: "no-sandbox",
  FAILED: "failed",
  TIMED_OUT: "timed-out",
} as const;

export type SnapshotMiss = (typeof SNAPSHOT_MISS)[keyof typeof SNAPSHOT_MISS];

/** What a copy came to: the branch pushed, at its commit, and whether that commit holds work `HEAD` did not; or why there is none. */
export type SnapshotOutcome =
  | {
      readonly copied: true;
      readonly branch: string;
      readonly commit: string;
      readonly uncommitted: boolean;
    }
  | { readonly copied: false; readonly miss: SnapshotMiss };

/** What a copy is asked: whose sandbox, the branch and the commit's message, the token the push goes through, and whether a woken sandbox must be left up. */
export interface SnapshotAsk<R> {
  /** The eve session the source's sandbox is tagged with. */
  readonly sessionId: string;
  readonly branch: string;
  readonly message: string;
  /** The repository's write token, minted once the sandbox stands up. */
  readonly token: Effect.Effect<Redacted.Redacted, unknown, R>;
  /** Whether a sandbox this step woke stays up: a developer's terminal holds it, or a turn of the source began. */
  readonly keepUp: Effect.Effect<boolean, unknown, R>;
}

/** The states a sandbox is up in, or coming up in, which this step neither wakes nor stops. */
const UP_STATUSES: ReadonlySet<string> = new Set(["pending", "running"]);

/**
 * Files the copy never picks up from the working tree, by glob, because
 * they are named the way credentials are kept and a push would publish
 * them: one tracked already stays as `HEAD` holds it.
 */
const UNCOPIED_PATHS: readonly string[] = [
  "**/.env",
  "**/.env.local",
  "**/.env.*.local",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/id_rsa",
  "**/id_ed25519",
];

/**
 * The copy, run in the checkout with the branch and the message as its two
 * arguments: the work recorded on an index of its own in a directory made
 * for it, committed on `HEAD` where the tree differs, pushed to the branch,
 * and the commit and `HEAD` printed on one line. The push skips the
 * repository's own hooks, which are the agent's to run, and forces, because
 * the branch is named for this one Start and a retry of it pushes again.
 * What it adds leaves out the files named like credentials above.
 */
const SNAPSHOT_SCRIPT = [
  "set -eu",
  "index_dir=$(mktemp -d)",
  "trap 'rm -rf \"$index_dir\"' EXIT",
  'GIT_INDEX_FILE="$index_dir/index"',
  "export GIT_INDEX_FILE",
  "head=$(git rev-parse --verify HEAD)",
  'git read-tree "$head"',
  `git add -A -- . ${UNCOPIED_PATHS.map((path) => `':(exclude,glob)${path}'`).join(" ")}`,
  "tree=$(git write-tree)",
  'if [ "$tree" = "$(git rev-parse "$head^{tree}")" ]; then commit=$head; else commit=$(git commit-tree "$tree" -p "$head" -m "$2"); fi',
  'git push --quiet --no-verify --force origin "$commit:refs/heads/$1"',
  'printf \'%s %s\\n\' "$commit" "$head"',
].join("\n");

/** The commit and `HEAD` the copy printed on its last line; nothing where it printed no such line. */
function printedCommits(
  stdout: string,
): { readonly commit: string; readonly head: string } | undefined {
  const last = stdout.trim().split("\n").at(-1) ?? "";
  const [commit, head] = last.split(" ");
  const sha = /^[0-9a-f]{40,64}$/u;
  return commit !== undefined && head !== undefined && sha.test(commit) && sha.test(head)
    ? { commit, head }
    : undefined;
}

/** The session a running sandbox runs; none for one not running. */
function runningSession(sandbox: ListedSandbox | undefined): string | undefined {
  return sandbox?.status === "running" ? sandbox.currentSessionId : undefined;
}

/**
 * The end of a failed copy's stderr as a log line takes it: credential-shaped
 * runs redacted and its lines joined into one, then its last `STDERR_TAIL`
 * characters kept. Note that the redaction comes before the cut, so a cut
 * never leaves the tail of a credential standing.
 */
function stderrTail(stderr: string): string {
  const line = redactCredentials(stderr)
    .trim()
    .replace(/\s*\n\s*/gu, " / ");
  return line.slice(-SNAPSHOT.STDERR_TAIL);
}

/** The sandbox's running session, waiting for one woken to come up. */
const upSession = (api: VercelSandboxApi, sessionId: string, name: string) =>
  Effect.gen(function* () {
    const resumed = runningSession(yield* api.resume(name));
    if (resumed !== undefined) return resumed;
    const listed = yield* api.listTagged(sessionId).pipe(
      Effect.repeat({
        schedule: Schedule.spaced(SNAPSHOT.WAKE_POLL),
        until: (sandboxes) => runningSession(sandboxes[0]) !== undefined,
      }),
    );
    // SAFETY: the repeat ends only once the first sandbox listed runs a session.
    return runningSession(listed[0]) as string;
  });

/** A woken sandbox's stop failing, logged and let go, since the copy's outcome stands whatever the stop came to. */
const stopMissed = (why: string) =>
  Effect.logWarning(`a woken source sandbox was not stopped again: ${why}`);

/**
 * Every sandbox of the session that is up, stopped, within the stop's bound.
 * It lists the sandbox again rather than trusting a session it was handed,
 * so a wake interrupted before it answered is stopped too, and asks again
 * whether it must stay up once listed, so a terminal, a turn, or another
 * Start's copy that took it up since the first ask keeps it.
 */
const stopUp = <R>(api: VercelSandboxApi, ask: SnapshotAsk<R>) =>
  Effect.gen(function* () {
    const listed = yield* api.listTagged(ask.sessionId);
    if (yield* ask.keepUp) return;
    for (const sandbox of listed) {
      if (sandbox.currentSessionId === undefined || !UP_STATUSES.has(sandbox.status ?? "")) {
        continue;
      }
      yield* api.stopSession(sandbox.currentSessionId);
    }
  }).pipe(
    Effect.timeout(SNAPSHOT.STOP_TIMEOUT),
    Effect.catch((failure) => stopMissed(String(failure))),
  );

/**
 * The sandbox this step woke stopped again, unless it must stay up. Whether
 * it stays up is read here, and the stop itself, Vercel's list and stop, is
 * forked detached, so it outlives the Start's own fiber and the Start never
 * waits on it; one it never confirms is the sweep's once the copy's hold
 * lapses.
 */
const stopWoken = <R>(api: VercelSandboxApi, ask: SnapshotAsk<R>) =>
  Effect.gen(function* () {
    if (yield* ask.keepUp) return;
    yield* Effect.forkDetach(stopUp(api, ask));
  }).pipe(
    Effect.interruptible,
    Effect.timeout(SNAPSHOT.STOP_TIMEOUT),
    Effect.catch((failure) => stopMissed(String(failure))),
  );

/** The copy inside the scope a woken sandbox's stop is registered on. */
const copyIn = <R>(api: VercelSandboxApi, ask: SnapshotAsk<R>) =>
  Effect.gen(function* () {
    const [sandbox] = yield* api.listTagged(ask.sessionId);
    if (sandbox === undefined) {
      return { copied: false, miss: SNAPSHOT_MISS.NO_SANDBOX } as const;
    }
    const up = UP_STATUSES.has(sandbox.status ?? "");
    // Note that the stop is registered ahead of the wake, so a wake cut short by the bound is stopped too.
    if (!up) yield* Effect.addFinalizer(() => stopWoken(api, ask));
    const session = runningSession(sandbox) ?? (yield* upSession(api, ask.sessionId, sandbox.name));
    yield* api.updateNetworkPolicy(session, githubTokenPolicy(yield* ask.token));
    const ran = yield* api.run(session, {
      command: "sh",
      args: ["-c", SNAPSHOT_SCRIPT, "sh", ask.branch, ask.message],
      cwd: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
    });
    const printed = ran.exitCode === 0 ? printedCommits(ran.stdout) : undefined;
    if (printed === undefined) {
      yield* Effect.logWarning(
        `the source's work was not copied: the copy exited ${ran.exitCode}: ${stderrTail(ran.stderr)}`,
      );
      return { copied: false, miss: SNAPSHOT_MISS.FAILED } as const;
    }
    return {
      copied: true,
      branch: ask.branch,
      commit: printed.commit,
      uncommitted: printed.commit !== printed.head,
    } as const;
  });

/**
 * The source's work copied to the branch asked for, as above, within the
 * bound; a sandbox gone, a call that failed, or the bound passed is a miss,
 * logged, and never the caller's failure.
 */
export const snapshotSource = /* @__PURE__ */ Effect.fn("web/snapshotSource")(function* <R>(
  api: VercelSandboxApi,
  ask: SnapshotAsk<R>,
): Effect.fn.Return<SnapshotOutcome, never, R> {
  const outcome = yield* Effect.scoped(copyIn(api, ask)).pipe(
    Effect.timeoutOption(SNAPSHOT.TIMEOUT),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`the source's work was not copied: ${String(failure)}`),
        Option.some<SnapshotOutcome>({ copied: false, miss: SNAPSHOT_MISS.FAILED }),
      ),
    ),
  );
  if (Option.isSome(outcome)) return outcome.value;
  yield* Effect.logWarning("the source's work was not copied in time");
  return { copied: false, miss: SNAPSHOT_MISS.TIMED_OUT };
});

/** How the new agent takes the source's work up, which its branch and the snapshot's commit say. */
const TAKEN_UP = { CONTINUED: "continued", FORKED: "forked" } as const;

/** The turn states a source's sandbox is in use under, which a woken sandbox is left up for. */
const TURN_UNDER_WAY: ReadonlySet<string> = new Set([TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]);

/**
 * The branch the copy is pushed to: the source's own, or one named for the
 * source where it recorded none, then how the new agent takes it up and a
 * short name for this one Start, read from its key so a retry names the
 * same branch.
 */
function snapshotBranch(source: CodingAgent, forked: boolean, idempotencyKey: string): string {
  const base = source.branch ?? `${CODER.BRANCH_PREFIX}agent-${source.id.slice(0, 8)}`;
  const start = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 8);
  return `${base}-${forked ? TAKEN_UP.FORKED : TAKEN_UP.CONTINUED}-${start}`;
}

/** What a copy of a source's work reaches: the store, GitHub through the App, and Vercel's API. */
export type SourceCopyServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

/**
 * The source agent's work copied for an agent the account starts from it,
 * as above, under the Start's key; nothing copied for a retry whose Start
 * already made its agent, which is handed nothing new, or for a source that
 * never opened a sandbox. The token the push goes through is the one a
 * coding agent's checkout is minted, through the installation of the
 * source's workspace as the account reaches it.
 */
export const copySourceWork = /* @__PURE__ */ Effect.fn("web/copySourceWork")(function* (
  userId: string,
  source: CodingAgent,
  forked: boolean,
  idempotencyKey: string,
): Effect.fn.Return<SnapshotOutcome, never, SourceCopyServices> {
  const missed = (miss: SnapshotMiss): SnapshotOutcome => ({ copied: false, miss });
  return yield* Effect.gen(function* () {
    if (Option.isSome(yield* readCodingAgentByKey(userId, idempotencyKey))) {
      return missed(SNAPSHOT_MISS.STARTED);
    }
    // Note that the new agent clones the task's repository as it stands now, so a branch pushed to the
    // one the source cloned before the task moved would be none of its checkout's.
    const task = yield* readTaskHeader(userId, source.taskId ?? "");
    const repository = Option.isSome(task) ? task.value.repository : null;
    if (repository?.toLowerCase() !== source.repository.toLowerCase()) {
      return missed(SNAPSHOT_MISS.MOVED);
    }
    const [session] = yield* standingSessionsOf(source.userId, [source.conversationId]);
    if (session === undefined) return missed(SNAPSHOT_MISS.NO_SANDBOX);
    const api = yield* vercelSandboxApi(deploymentOidcToken);
    const target = { userId, conversationId: source.conversationId };
    // The copy holds the sandbox as a terminal does for as long as it may take, so a copy beside it
    // for another Start reads it held past its own hold and leaves it up, and a sandbox no copy
    // stopped is stopped by the terminal sweep once the hold lapses.
    const heldUntil = new Date(
      (yield* Clock.currentTimeMillis) +
        Duration.toMillis(Duration.sum(SNAPSHOT.TIMEOUT, SNAPSHOT.STOP_TIMEOUT)),
    );
    yield* holdSandbox(source.conversationId, heldUntil);
    const keepUp = Effect.gen(function* () {
      if (yield* sandboxHeld(source.conversationId, heldUntil)) return true;
      const turns = yield* latestTurnsOfReached([source.conversationId]);
      return TURN_UNDER_WAY.has(turns.get(source.conversationId)?.status ?? "");
    });
    return yield* snapshotSource(api, {
      sessionId: session.sessionId,
      branch: snapshotBranch(source, forked, idempotencyKey),
      message: `Snapshot of ${source.title ?? source.model} for ${forked ? TAKEN_UP.FORKED : TAKEN_UP.CONTINUED} agent`,
      token: Effect.map(agentRepositoryToken(target, source), (minted) => minted.token),
      keepUp,
    });
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`the source's work was not copied: ${String(failure)}`),
        missed(SNAPSHOT_MISS.FAILED),
      ),
    ),
  );
});
