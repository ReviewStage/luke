import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { Effect, Layer, Result } from "effect";
import type { ToolContext } from "eve/tools";
import eveBash from "eve/tools/bash";
import { GitHubAccess } from "../server/hosted/github-source";
import {
  cloneRepository,
  REPOSITORY_SHELL_REFUSAL,
  REPOSITORY_SHELL_STATUS,
  type RepositoryShellResult,
  RUN_IN_REPOSITORY_TOOL,
  type RunBash,
  runInRepository,
} from "../server/hosted/repository-shell";
import { fakeGitHub } from "./support/github-fake";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning model's shell over the plan's repository: the clone a new
 * sandbox is made ready with, and the tool's run in it through eve's own
 * `bash` tool. The sandbox is a directory of this test's own whose commands
 * run under a real bash, and the repository is a real git repository beside
 * it that the clone fetches from, so what a command answers shows which
 * commit the clone was made at.
 *
 * Synthetic accounts, tokens, repositories, and source throughout.
 */

const TOKEN = "fixture-token-shell";
const INVITES_AT_START = "export function invite(email: string) {}\n";
const INVITES_MOVED_ON = "export function invite(email: string, role: Role) {}\n";

/** Git isolated from whatever the machine running the test has configured. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@luke.test",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@luke.test",
};

function bash(command: string, cwd: string, env: Record<string, string> = {}) {
  const ran = spawnSync("bash", ["-c", command], {
    cwd,
    env: { ...GIT_ENV, ...env },
    encoding: "utf8",
  });
  return { exitCode: ran.status ?? 1, stdout: ran.stdout, stderr: ran.stderr };
}

type Sandbox = Awaited<ReturnType<ToolContext["getSandbox"]>>;

/** A sandbox whose `/workspace` is `root`, running each command under bash there. */
function directorySandbox(root: string): Sandbox {
  const sandbox = {
    run: async ({ command, env }: { command: string; env?: Record<string, string> }) =>
      bash(command, root, env),
    setNetworkPolicy: async () => undefined,
  };
  // SAFETY: the clone reaches `run` and `setNetworkPolicy` alone, and eve's `bash` reaches `run`.
  return sandbox as unknown as Sandbox;
}

/** eve's context for one tool call, whose sandbox is the one `getSandbox` opens. */
function toolContext(getSandbox: () => Promise<Sandbox>): ToolContext {
  return {
    session: {
      id: "wrun_shell",
      auth: { current: null, initiator: null },
      turn: { id: "turn_0", sequence: 0 },
    },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName: RUN_IN_REPOSITORY_TOOL.name,
    getToken: unreached,
    requireAuth: unreached,
    getSandbox,
    getSkill: unreached,
  };
}

/** eve's own `bash` tool, as `apps/web/eve/host.ts` hands it to the host. */
const runBash: RunBash = async (input, context) => {
  const output = await eveBash.execute(input, context);
  if (Symbol.asyncIterator in output) return assert.fail("eve's bash streamed its output");
  return output;
};

function unreached(): never {
  throw new Error("reached in a test that offers it nothing");
}

/** `acme/relay` under `origin`, whose second commit changes the invites file; answers the first commit. */
function relayRepository(origin: string): string {
  const path = join(origin, "acme", "relay");
  mkdirSync(join(path, "src"), { recursive: true });
  const git = (command: string) => assert.equal(bash(command, path).exitCode, 0, command);
  git("git init -q -b main");
  writeFileSync(join(path, "README.md"), "# Relay\n");
  writeFileSync(join(path, "src", "invites.ts"), INVITES_AT_START);
  git("git add -A && git commit -q -m start");
  const started = bash("git rev-parse HEAD", path).stdout.trim();
  writeFileSync(join(path, "src", "invites.ts"), INVITES_MOVED_ON);
  git("git commit -q -am 'moved on'");
  return started;
}

const USER_ID = "user-shell";

/** A sandbox directory and one for GitHub holding the repository, with the account connected. */
const openRepository = (github: ReturnType<typeof fakeGitHub>) =>
  Effect.gen(function* () {
    const root = yield* temporaryDirectoryScoped();
    const workspace = join(root, "workspace");
    const origin = join(root, "github");
    mkdirSync(workspace);
    const commit = relayRepository(origin);
    github.connect(USER_ID, TOKEN, []);
    return {
      sandbox: directorySandbox(workspace),
      repository: { owner: "acme", name: "relay", branch: "main", commit },
      origin: `file://${origin}`,
    };
  });

function ran(result: RepositoryShellResult) {
  if (result.status !== REPOSITORY_SHELL_STATUS.RAN) {
    return assert.fail(`expected a command run, got ${JSON.stringify(result)}`);
  }
  return result;
}

it.layer(Layer.merge(testSqlClient, NodeFileSystem.layer))("run_in_repository", (it) => {
  it.effect(
    "a new sandbox is cloned at the plan's commit, and every call runs in that clone",
    () => {
      const github = fakeGitHub();
      return Effect.gen(function* () {
        const { sandbox, repository, origin } = yield* openRepository(github);
        yield* cloneRepository(USER_ID, repository, sandbox, origin);
        const context = toolContext(async () => sandbox);
        const run = (input: WireBoundaryInput) =>
          runInRepository(context, runBash, unparsedWire(input));

        const invites = ran(yield* run({ command: "cat src/invites.ts" }));
        const wrote = ran(yield* run({ command: "echo note > scratch.txt" }));
        const kept = ran(yield* run({ command: "cat scratch.txt && git log --oneline | wc -l" }));
        const missing = ran(yield* run({ command: "cat nowhere.ts" }));

        assert.equal(invites.stdout, INVITES_AT_START);
        assert.equal(wrote.exitCode, 0);
        assert.equal(kept.stdout, "note\n1\n");
        assert.notEqual(missing.exitCode, 0);
        assert.ok(missing.stderr.includes("nowhere.ts"));
        assert.ok(!JSON.stringify([invites, kept]).includes(TOKEN));
      }).pipe(Effect.provide(github.layer));
    },
  );

  it.effect(
    "an account with no GitHub connection is told to connect when the sandbox will not open",
    () => {
      const github = fakeGitHub();
      return Effect.gen(function* () {
        const { sandbox, repository, origin } = yield* openRepository(github);
        const unconnected = { token: () => github.access.token("user-unconnected") };

        const cloned = yield* Effect.result(
          cloneRepository(USER_ID, repository, sandbox, origin).pipe(
            Effect.provideService(GitHubAccess, unconnected),
          ),
        );
        if (Result.isSuccess(cloned)) return assert.fail("an unconnected account was cloned for");
        // eve rejects every open of a sandbox whose `onSession` threw, with what it threw.
        const context = toolContext(() => Promise.reject(cloned.failure));
        const result = yield* runInRepository(context, runBash, unparsedWire({ command: "ls" }));

        assert.deepEqual(result, {
          status: REPOSITORY_SHELL_STATUS.NOT_RUN,
          reason: REPOSITORY_SHELL_REFUSAL.NOT_CONNECTED,
        });
      }).pipe(Effect.provide(github.layer));
    },
  );

  it.effect("a call naming anything beside its command runs nothing", () =>
    Effect.gen(function* () {
      const context = toolContext(unreached);

      const result = yield* runInRepository(
        context,
        runBash,
        unparsedWire({ command: "ls", commit: "0".repeat(40) }),
      );

      assert.equal(result.status, REPOSITORY_SHELL_STATUS.NOT_RUN);
    }),
  );
});
