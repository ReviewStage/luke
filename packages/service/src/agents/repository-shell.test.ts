import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import {
  cloneRepository,
  type RepositorySandbox,
  refreshRepository,
  snapshotRecordOf,
} from "./repository-shell.js";

/**
 * The checkout's scripts as a sandbox's shell runs them, in a real bash over
 * a real git: GitHub's address is pointed at bare repositories in the test's
 * own folder and the sandbox's workspace at another, so nothing leaves the
 * machine. A repository with no commits yet is cloned empty onto its default
 * branch, and its snapshot's checkout refreshes while it stays empty and
 * once its first commit lands; a branch missing from a repository with
 * commits still fails the clone in git's own words. Synthetic repositories
 * throughout.
 */

const REPOSITORY = "acme/fresh";
const TOKEN = Redacted.make("fixture-token");
const { PATH } = REPOSITORY_SANDBOX_CONTRACT;

/** Git with no configuration of the machine's own, and an identity for the commits a test makes. */
const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@app.test",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@app.test",
} as const;

/** One git run in the folder given; what it printed, or a throw where it failed. */
function git(cwd: string, ...args: string[]): string {
  const ran = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...GIT_ENV },
  });
  if (ran.status !== 0)
    throw new Error(`git ${args.join(" ")} exited ${ran.status}: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** Whether the git run in the folder given succeeds. */
function gitSucceeds(cwd: string, ...args: string[]): boolean {
  return spawnSync("git", args, { cwd, env: { PATH: process.env.PATH, ...GIT_ENV } }).status === 0;
}

/**
 * The test's world: a folder of its own holding GitHub's bare repository of
 * `acme/fresh` with no commits, on `main`, and the sandbox's workspace, and
 * the sandbox over them, whose runs are a real bash with GitHub's address
 * rewritten to the bare repositories; the folder is removed as the test's
 * scope closes.
 */
const world = Effect.acquireRelease(
  Effect.sync(() => {
    const root = mkdtempSync(join(tmpdir(), "repository-shell-"));
    const github = join(root, "github");
    const workspace = join(root, "workspace");
    const remote = join(github, `${REPOSITORY}.git`);
    mkdirSync(remote, { recursive: true });
    mkdirSync(workspace);
    git(remote, "init", "--quiet", "--bare", "--initial-branch=main");
    const sandbox: RepositorySandbox = {
      run: async ({ command, workingDirectory, env }) => {
        const ran = spawnSync("bash", ["-c", command], {
          cwd: join(workspace, (workingDirectory ?? PATH.WORKSPACE).slice(PATH.WORKSPACE.length)),
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            ...GIT_ENV,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: `url.file://${github}/.insteadOf`,
            GIT_CONFIG_VALUE_0: "https://github.com/",
            ...env,
          },
        });
        return { exitCode: ran.status ?? 1, stdout: ran.stdout, stderr: ran.stderr };
      },
      firewall: { set: () => Effect.void, withdraw: () => Effect.void },
    };
    return { root, remote, checkout: join(workspace, "repository"), sandbox };
  }),
  ({ root }) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

/** The first commit pushed to the bare repository's `main`, from a clone of the test's own; answers its sha. */
function pushFirstCommit(root: string, remote: string): string {
  const seed = join(root, "seed");
  git(root, "init", "--quiet", "--initial-branch=main", seed);
  git(seed, "commit", "--quiet", "--allow-empty", "--message", "First commit");
  git(seed, "push", "--quiet", remote, "main");
  return git(seed, "rev-parse", "HEAD");
}

it.effect(
  "a repository with no commits yet is cloned empty, its HEAD on the default branch and its record written",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { checkout, sandbox } = yield* world;

        yield* cloneRepository(sandbox, { fullName: REPOSITORY, defaultBranch: "main" }, TOKEN, {
          depth: "1",
        });

        assert.equal(git(checkout, "symbolic-ref", "HEAD"), "refs/heads/main");
        assert.equal(gitSucceeds(checkout, "rev-parse", "--quiet", "--verify", "HEAD"), false);
        assert.equal(readFileSync(join(checkout, "..", PATH.CHECKOUT_RECORD), "utf8"), REPOSITORY);
      }),
    ),
);

it.effect(
  "a branch missing from a repository with commits still fails the clone in git's own words",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, remote, checkout, sandbox } = yield* world;
        pushFirstCommit(root, remote);

        const refused = yield* cloneRepository(
          sandbox,
          { fullName: REPOSITORY, defaultBranch: "deleted-since" },
          TOKEN,
          { depth: "1" },
        ).pipe(Effect.flip);

        assert.match(refused.reason, /Remote branch deleted-since not found/u);
        assert.equal(gitSucceeds(checkout, "rev-parse", "--git-dir"), false);
      }),
    ),
);

it.effect(
  "the snapshot's empty checkout refreshes while the repository has no commits, and takes its first commit once it lands",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, remote, checkout, sandbox } = yield* world;
        const confirmed = { fullName: REPOSITORY, defaultBranch: "main", recordedAs: REPOSITORY };
        yield* cloneRepository(
          sandbox,
          { ...confirmed, recordedAs: snapshotRecordOf(REPOSITORY) },
          TOKEN,
        );

        yield* refreshRepository(sandbox, confirmed, TOKEN);
        assert.equal(gitSucceeds(checkout, "rev-parse", "--quiet", "--verify", "HEAD"), false);

        const first = pushFirstCommit(root, remote);
        yield* refreshRepository(sandbox, confirmed, TOKEN);
        assert.equal(git(checkout, "rev-parse", "HEAD"), first);
        assert.equal(git(checkout, "symbolic-ref", "HEAD"), "refs/heads/main");
      }),
    ),
);
