import { createHash } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, hasRepository, readAgentByKey } from "@repo/database/models/agent-store";
import { latestTurnsOfReached } from "@repo/database/models/message-reads";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { holdSandbox, sandboxHeld } from "@repo/database/models/sandbox-terminal-lease";
import { redactCredentials } from "@repo/features/credential-redaction";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { TURN_STATUS } from "@repo/wire";
import { Clock, Duration, Effect, Option, Schedule } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../../github/github-app.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import {
  type FirewallSession,
  type RepositoryCredential,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  SANDBOX_STATUS,
  UP_STATUSES,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import { CODER } from "./bounds.js";
import { agentRepositoryToken } from "./checkout.js";

export const SNAPSHOT = {
  TIMEOUT: Duration.seconds(30),
  WAKE_POLL: Duration.seconds(1),
  STOP_TIMEOUT: Duration.seconds(10),
  STDERR_TAIL: 600,
} as const;

export const SNAPSHOT_MISS = {
  STARTED: "started",
  MOVED: "moved",
  NO_SANDBOX: "no-sandbox",
  FAILED: "failed",
  TIMED_OUT: "timed-out",
} as const;

export type SnapshotMiss = (typeof SNAPSHOT_MISS)[keyof typeof SNAPSHOT_MISS];

export type SnapshotOutcome =
  | {
      readonly copied: true;
      readonly branch: string;
      readonly commit: string;
      readonly uncommitted: boolean;
    }
  | { readonly copied: false; readonly miss: SnapshotMiss };

export interface SnapshotAsk<R> {
  readonly userId: string;
  readonly sessionId: string;
  readonly branch: string;
  readonly message: string;
  readonly credential: Effect.Effect<RepositoryCredential, unknown, R>;
  readonly keepUp: Effect.Effect<boolean, unknown, R>;
}

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

function runningSession(sandbox: ListedSandbox | undefined): string | undefined {
  return sandbox?.status === SANDBOX_STATUS.RUNNING ? sandbox.currentSessionId : undefined;
}

function stderrTail(stderr: string): string {
  const line = redactCredentials(stderr)
    .trim()
    .replace(/\s*\n\s*/gu, " / ");
  return line.slice(-SNAPSHOT.STDERR_TAIL);
}

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
    return runningSession(listed[0]) as string;
  });

const stopMissed = (why: string) =>
  Effect.logWarning(`a woken source sandbox was not stopped again: ${why}`);

const stopUp = <R>(api: VercelSandboxApi, ask: SnapshotAsk<R>) =>
  Effect.gen(function* () {
    const listed = yield* api.listTagged(ask.sessionId);
    if (yield* ask.keepUp) return;
    for (const sandbox of listed) {
      if (sandbox.currentSessionId === undefined || !UP_STATUSES.has(sandbox.status ?? "")) {
        continue;
      }
      const running = { name: sandbox.name, sessionId: sandbox.currentSessionId };
      yield* sandboxFirewall(api).clear(running);
      yield* (yield* api.session(running)).stop();
    }
  }).pipe(
    Effect.timeout(SNAPSHOT.STOP_TIMEOUT),
    Effect.catch((failure) => stopMissed(String(failure))),
  );

const stopWoken = <R>(api: VercelSandboxApi, ask: SnapshotAsk<R>) =>
  Effect.gen(function* () {
    if (yield* ask.keepUp) return;
    yield* Effect.forkDetach(stopUp(api, ask));
  }).pipe(
    Effect.interruptible,
    Effect.timeout(SNAPSHOT.STOP_TIMEOUT),
    Effect.catch((failure) => stopMissed(String(failure))),
  );

const withdrawUnlessInUse = <R>(
  api: VercelSandboxApi,
  session: FirewallSession,
  ask: SnapshotAsk<R>,
) =>
  Effect.gen(function* () {
    if (yield* ask.keepUp) return;
    yield* sandboxFirewall(api).write(session, {});
  }).pipe(
    Effect.interruptible,
    Effect.timeout(SNAPSHOT.STOP_TIMEOUT),
    Effect.catch((failure) =>
      Effect.logWarning(
        `a member's token was not taken off the source's sandbox: ${String(failure)}`,
      ),
    ),
  );

const copyIn = <R>(api: VercelSandboxApi, ask: SnapshotAsk<R>) =>
  Effect.gen(function* () {
    const [sandbox] = yield* api.listTagged(ask.sessionId);
    if (sandbox === undefined) {
      return { copied: false, miss: SNAPSHOT_MISS.NO_SANDBOX } as const;
    }
    const up = UP_STATUSES.has(sandbox.status ?? "");
    if (!up) yield* Effect.addFinalizer(() => stopWoken(api, ask));
    const session = runningSession(sandbox) ?? (yield* upSession(api, ask.sessionId, sandbox.name));
    const owner = { userId: ask.userId, name: sandbox.name, sandboxSessionId: session };
    const credential = yield* ask.credential;
    if (credential.access.kind === GITHUB_ACCESS.TOKEN) {
      yield* Effect.addFinalizer(() => withdrawUnlessInUse(api, owner, ask));
    }
    yield* sandboxFirewall(api).write(owner, { github: credential });
    const ran = yield* (yield* api.session({ name: sandbox.name, sessionId: session })).run({
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

export const snapshotSource = /* @__PURE__ */ Effect.fn("web/snapshotSource")(function* <R>(
  api: VercelSandboxApi,
  ask: SnapshotAsk<R>,
): Effect.fn.Return<SnapshotOutcome, never, R | DatabaseServices> {
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

const TAKEN_UP = { CONTINUED: "continued", FORKED: "forked" } as const;

const TURN_UNDER_WAY: ReadonlySet<string> = new Set([TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]);

export const agentTurnUnderWay = (conversationId: string) =>
  Effect.map(latestTurnsOfReached([conversationId]), (turns) =>
    TURN_UNDER_WAY.has(turns.get(conversationId)?.status ?? ""),
  );

function snapshotBranch(source: Agent, forked: boolean, idempotencyKey: string): string {
  const base = source.branch ?? `${CODER.BRANCH_PREFIX}agent-${source.id.slice(0, 8)}`;
  const start = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 8);
  return `${base}-${forked ? TAKEN_UP.FORKED : TAKEN_UP.CONTINUED}-${start}`;
}

export type SourceCopyServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

export const copySourceWork = /* @__PURE__ */ Effect.fn("web/copySourceWork")(function* (
  userId: string,
  source: Agent,
  repository: string | null,
  forked: boolean,
  idempotencyKey: string,
): Effect.fn.Return<SnapshotOutcome, never, SourceCopyServices> {
  const missed = (miss: SnapshotMiss): SnapshotOutcome => ({ copied: false, miss });
  return yield* Effect.gen(function* () {
    if (Option.isSome(yield* readAgentByKey(userId, idempotencyKey))) {
      return missed(SNAPSHOT_MISS.STARTED);
    }
    if (!hasRepository(source) || repository?.toLowerCase() !== source.repository.toLowerCase()) {
      return missed(SNAPSHOT_MISS.MOVED);
    }
    const [session] = yield* standingSessionsOf(source.userId, [source.conversationId]);
    if (session === undefined) return missed(SNAPSHOT_MISS.NO_SANDBOX);
    const api = yield* vercelSandboxApi(deploymentOidcToken);
    const target = { userId, conversationId: source.conversationId };
    const heldUntil = new Date(
      (yield* Clock.currentTimeMillis) +
        Duration.toMillis(Duration.sum(SNAPSHOT.TIMEOUT, SNAPSHOT.STOP_TIMEOUT)),
    );
    yield* holdSandbox(source.conversationId, heldUntil);
    const keepUp = Effect.gen(function* () {
      if (yield* sandboxHeld(source.conversationId, heldUntil)) return true;
      return yield* agentTurnUnderWay(source.conversationId);
    });
    return yield* snapshotSource(api, {
      userId: source.userId,
      sessionId: session.sessionId,
      branch: snapshotBranch(source, forked, idempotencyKey),
      message: `Snapshot of ${source.title ?? source.model} for ${forked ? TAKEN_UP.FORKED : TAKEN_UP.CONTINUED} agent`,
      credential: agentRepositoryToken(target, source),
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
