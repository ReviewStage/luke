import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { unparsedWire } from "@sidecar/wire";
import { Effect, type Layer } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { GitHubApp } from "../server/github/github-app";
import { createPlan } from "../server/hosted/plan-store";
import {
  REPOSITORY_SANDBOX_CONTRACT,
  REPOSITORY_SHELL_BOUNDS,
  REPOSITORY_SHELL_REFUSAL,
  REPOSITORY_SHELL_STATUS,
  type RepositoryCall,
  type RepositorySandboxDoor,
  runInRepository,
} from "../server/hosted/repository-shell";
import {
  fakeGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  openGithubUser,
} from "./support/github-app-fake";
import { type CommandTable, sandboxDouble } from "./support/repository-sandbox";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning model's shell, run in the session's sandbox on a checkout of
 * the plan's repository: the first call checks the repository out and later
 * calls reuse it, every refusal answers `not-run` with why, and the token the
 * checkout reads through reaches the sandbox's firewall and nothing else.
 * The sandbox is a double at eve's boundary, GitHub a script, and the store
 * PGlite. Synthetic accounts, repositories, tokens, and output throughout.
 */

const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

/** The installation the user reaches the repository through. */
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;

const LISTING = { exitCode: 0, stdout: "README.md\nsrc\n", stderr: "" } as const;

/** The commands a checkout answers. */
const COMMANDS: CommandTable = (command) =>
  command === "ls" ? LISTING : command === "cat secret" ? { ...LISTING, stdout: "x" } : undefined;

/** A GitHub that reaches the repository and mints for its installation. */
const reachingGithub = () => githubReaching([INSTALLATION]);

/** An account holding one plan, on the repository given, and the sandbox its session opens. */
const openPlan = (repository: string | null, commands: CommandTable = COMMANDS) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const started = yield* createPlan(userId, { name: "Teammate invitations", repository });
    const sandbox = sandboxDouble(commands);
    const call: RepositoryCall = {
      plan: { userId, planId: started.id },
      repository,
      sandbox: sandbox.door,
    };
    return { userId, planId: started.id, sandbox, call };
  });

const run = (
  call: RepositoryCall,
  command: string,
  github: Layer.Layer<GitHubApp | HttpClient.HttpClient>,
) => runInRepository(call, unparsedWire({ command })).pipe(Effect.provide(github));

/** The token as the firewall carries it: GitHub's Basic header over the token user. */
const TOKEN_HEADER = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;

/** Whether the text carries the token, plain or as the header. */
function carriesToken(text: string): boolean {
  return text.includes(GITHUB_FIXTURE_INSTALLATION_TOKEN) || text.includes(TOKEN_HEADER);
}

it.layer(testSqlClient)("run_in_repository in the session's sandbox", (it) => {
  it.effect(
    "the first call checks the repository out at its default branch through the firewall, and the next reuses it",
    () =>
      Effect.gen(function* () {
        const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME);
        const github = reachingGithub();

        const first = yield* run(call, "ls", github.layer);
        const sentForFirst = github.sent.length;
        const second = yield* run(call, "ls", github.layer);

        assert.deepEqual(first, { status: REPOSITORY_SHELL_STATUS.RAN, ...LISTING });
        assert.deepEqual(second, first);
        // One checkout, of the default branch, at the URL without a credential.
        assert.deepEqual(sandbox.clones, [
          {
            repository: RELAY_FULL_NAME,
            branch: RELAY.defaultBranch,
            url: `https://github.com/${RELAY_FULL_NAME}.git`,
          },
        ]);
        assert.equal(sandbox.openings, 2);
        // The token was minted for that one repository with contents read, and the second call asked GitHub nothing.
        const mint = github.sent.find((sent) => sent.url.endsWith("/access_tokens"));
        assert.ok(mint);
        assert.equal(
          mint.url,
          `https://api.github.com/app/installations/${INSTALLATION.id}/access_tokens`,
        );
        assert.deepEqual(JSON.parse(mint.body), {
          repositories: [RELAY.name],
          permissions: { contents: "read" },
        });
        assert.match(mint.headers.get("authorization") ?? "", /^Bearer ey/u);
        assert.equal(github.sent.length, sentForFirst);
        // The token stood at the firewall for the clone alone: injected on github.com for the repository's own paths, and withdrawn after.
        assert.deepEqual(sandbox.policiesDuringClone, [
          {
            allow: {
              "*": [],
              "github.com": [
                {
                  match: { path: { startsWith: `/${RELAY_FULL_NAME}.git/` } },
                  transform: [{ headers: { authorization: TOKEN_HEADER } }],
                },
              ],
            },
          },
        ]);
        assert.deepEqual(sandbox.policies, [...sandbox.policiesDuringClone, "allow-all"]);
      }),
  );

  it.effect(
    "the command runs from the checkout root, under the time bound, and never in shell text",
    () =>
      Effect.gen(function* () {
        const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME);
        const command = `grep -rn "invite" src; echo "it's done"`;

        yield* run(call, command, reachingGithub().layer);

        const ran = sandbox.runs.at(-1);
        assert.ok(ran);
        assert.equal(ran.workingDirectory, REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT);
        assert.equal(ran.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.COMMAND], command);
        assert.equal(ran.command.includes("invite"), false);
        assert.match(
          ran.command,
          new RegExp(`timeout ${REPOSITORY_SHELL_BOUNDS.COMMAND_TIMEOUT_SECONDS}s env -i `, "u"),
        );
      }),
  );

  it.effect(
    "the token reaches the firewall and nothing else: no run, no output, no result carries it",
    () =>
      Effect.gen(function* () {
        const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME);

        const answered = yield* run(call, "ls", reachingGithub().layer);

        assert.equal(carriesToken(JSON.stringify(answered)), false);
        assert.equal(carriesToken(JSON.stringify(sandbox.runs)), false);
        assert.equal(carriesToken(JSON.stringify(sandbox.clones)), false);
        assert.equal(carriesToken(JSON.stringify(sandbox.policiesDuringClone)), true);
      }),
  );

  it.effect("a plan with no repository yet is refused before any sandbox opens", () =>
    Effect.gen(function* () {
      const { call, sandbox } = yield* openPlan(null);
      const github = reachingGithub();

      const answered = yield* run(call, "ls", github.layer);

      assert.deepEqual(answered, {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.NO_REPOSITORY,
      });
      assert.equal(sandbox.openings, 0);
      assert.deepEqual(github.sent, []);
    }),
  );

  it.effect("a repository the developer no longer reaches through the App checks nothing out", () =>
    Effect.gen(function* () {
      const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME);
      const elsewhere = githubReaching([{ ...INSTALLATION, repositories: [] }]);

      const answered = yield* run(call, "ls", elsewhere.layer);

      assert.deepEqual(answered, {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.NOT_REACHABLE,
      });
      assert.deepEqual(sandbox.clones, []);
      assert.deepEqual(sandbox.policies, []);
      assert.equal(
        elsewhere.sent.some((sent) => sent.url.endsWith("/access_tokens")),
        false,
      );
    }),
  );

  it.effect("a revoked GitHub authorization asks for a new sign-in, and checks nothing out", () =>
    Effect.gen(function* () {
      const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME);
      const revoked = fakeGitHub(() =>
        Response.json({ message: "Bad credentials" }, { status: 401 }),
      );

      const answered = yield* run(call, "ls", revoked.layer);

      assert.deepEqual(answered, {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.SIGN_IN_REQUIRED,
      });
      assert.deepEqual(sandbox.clones, []);
    }),
  );

  it.effect("a GitHub that could not be read is a refusal the model may retry, not a fact", () =>
    Effect.gen(function* () {
      const { call } = yield* openPlan(RELAY_FULL_NAME);
      const down = fakeGitHub(() => new Response(null, { status: 502 }));

      const answered = yield* run(call, "ls", down.layer);

      assert.deepEqual(answered, {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.GITHUB_UNAVAILABLE,
      });
    }),
  );

  it.effect(
    "a checkout that fails says so with git's words, withdraws the token, runs no command, and is tried again next call",
    () =>
      Effect.gen(function* () {
        const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME);
        const github = reachingGithub();
        sandbox.cloneAnswers.push({
          exitCode: 128,
          stderr: "fatal: could not read from remote repository",
        });

        const failed = yield* run(call, "ls", github.layer);
        const retried = yield* run(call, "ls", github.layer);

        assert.equal(failed.status, REPOSITORY_SHELL_STATUS.NOT_RUN);
        assert.ok("reason" in failed);
        assert.ok(failed.reason.startsWith(REPOSITORY_SHELL_REFUSAL.CHECKOUT_FAILED));
        assert.match(failed.reason, /could not read from remote repository/u);
        assert.equal(carriesToken(JSON.stringify(failed)), false);
        assert.equal(sandbox.policies[1], "allow-all");
        assert.deepEqual(retried, { status: REPOSITORY_SHELL_STATUS.RAN, ...LISTING });
        assert.equal(sandbox.clones.length, 2);
        // Only the retried call ran a command: the failed one ran none in a checkout that did not stand.
        const inCheckout = sandbox.runs.filter(
          (ran) => ran.workingDirectory === REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
        );
        assert.equal(inCheckout.length, 1);
      }),
  );

  it.effect("a plan whose repository changed is checked out again, of the new repository", () =>
    Effect.gen(function* () {
      const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME);
      const ledger = { owner: RELAY.owner, name: "Ledger", defaultBranch: "main" } as const;
      const github = githubReaching([{ ...INSTALLATION, repositories: [RELAY, ledger] }]);

      yield* run(call, "ls", github.layer);
      const moved = yield* run(
        { ...call, repository: `${ledger.owner}/${ledger.name}` },
        "ls",
        github.layer,
      );

      assert.deepEqual(moved, { status: REPOSITORY_SHELL_STATUS.RAN, ...LISTING });
      assert.deepEqual(
        sandbox.clones.map((clone) => [clone.repository, clone.branch]),
        [
          [RELAY_FULL_NAME, RELAY.defaultBranch],
          [`${ledger.owner}/${ledger.name}`, ledger.defaultBranch],
        ],
      );
    }),
  );

  it.effect("a sandbox that cannot be opened, or has no firewall, checks nothing out", () =>
    Effect.gen(function* () {
      const { call } = yield* openPlan(RELAY_FULL_NAME);
      const github = reachingGithub();
      const closed: RepositorySandboxDoor = () => Promise.reject(new Error("fixture: no sandbox"));
      const bare = sandboxDouble(COMMANDS, { firewall: false });

      const unopened = yield* run({ ...call, sandbox: closed }, "ls", github.layer);
      const unbrokered = yield* run({ ...call, sandbox: bare.door }, "ls", github.layer);

      assert.deepEqual(unopened, {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.SANDBOX_UNAVAILABLE,
      });
      assert.deepEqual(unbrokered, {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.NO_FIREWALL,
      });
      assert.deepEqual(bare.clones, []);
    }),
  );

  it.effect(
    "a command's output is cut to the bound, and arguments other than one command run nothing",
    () =>
      Effect.gen(function* () {
        const long = "x".repeat(REPOSITORY_SHELL_BOUNDS.OUTPUT_MAX_CHARS + 5);
        const { call, sandbox } = yield* openPlan(RELAY_FULL_NAME, (command) =>
          command === "cat big" ? { exitCode: 0, stdout: long, stderr: long } : undefined,
        );
        const github = reachingGithub();

        const cut = yield* run(call, "cat big", github.layer);
        const unreadable = yield* runInRepository(
          call,
          unparsedWire({ command: "ls", cwd: "/etc" }),
        ).pipe(Effect.provide(github.layer));

        assert.equal(cut.status, REPOSITORY_SHELL_STATUS.RAN);
        assert.ok("stdout" in cut);
        assert.equal(cut.stdout.length, REPOSITORY_SHELL_BOUNDS.OUTPUT_MAX_CHARS);
        assert.equal(cut.stderr.length, REPOSITORY_SHELL_BOUNDS.OUTPUT_MAX_CHARS);
        assert.deepEqual(unreadable, {
          status: REPOSITORY_SHELL_STATUS.NOT_RUN,
          reason: REPOSITORY_SHELL_REFUSAL.UNREADABLE,
        });
        assert.equal(sandbox.runs.filter((ran) => ran.env?.LUKE_COMMAND !== undefined).length, 1);
      }),
  );
});
