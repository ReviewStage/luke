import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB, startTask } from "@luke/database/testing";
import { unparsedWire } from "@luke/wire";
import { Effect, type Layer } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../github/github-app.js";
import {
  connectWorkspaceGitHub,
  GITHUB_APP_WITH_TOKENS,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  GITHUB_FIXTURE_MEMBER,
  githubReaching,
  type InstallationFixture,
  memberRepositoryJson,
  openGithubUser,
  openTokenMember,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { type CommandTable, sandboxDouble } from "../testing/repository-sandbox.js";
import {
  REPOSITORY_SHELL_REFUSAL,
  REPOSITORY_SHELL_STATUS,
  type RepositoryCall,
  runInRepository,
} from "./repository-shell.js";

/**
 * The brain's shell, run in the session's sandbox on a checkout of
 * the task's repository: the first call checks the repository out and later
 * calls reuse it, every refusal answers `not-run` with why, and the token the
 * checkout reads through reaches the sandbox's firewall and nothing else.
 * The sandbox is a double at eve's boundary, GitHub a script, and the store
 * PGlite. Synthetic accounts, repositories, tokens, and output throughout.
 */

const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

/** An installation reaching the repository, under the id given: each test connects its own to its task's workspace, since one installation stands for one workspace. */
const installationOf = (id: number): InstallationFixture => ({
  id,
  login: RELAY.owner,
  repositories: [RELAY],
});

const LISTING = { exitCode: 0, stdout: "README.md\nsrc\n", stderr: "" } as const;

/** The commands a checkout answers. */
const COMMANDS: CommandTable = (command) =>
  command === "ls" ? LISTING : command === "cat secret" ? { ...LISTING, stdout: "x" } : undefined;

/** An account holding one task, on the repository given, in a workspace the installation is connected to, and the sandbox its session opens. */
const openTask = (
  repository: string | null,
  installation: InstallationFixture,
  commands: CommandTable = COMMANDS,
) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const started = yield* startTask(userId, { name: "Teammate invitations", repository });
    yield* connectWorkspaceGitHub(started.workspaceId, installation);
    const sandbox = sandboxDouble(commands);
    const call: RepositoryCall = {
      task: { userId, taskId: started.id },
      repository,
      sandbox: sandbox.door,
    };
    return { userId, taskId: started.id, sandbox, call };
  });

const run = (
  call: RepositoryCall,
  command: string,
  github: Layer.Layer<GitHubApp | HttpClient.HttpClient>,
) => runInRepository(call, unparsedWire({ command })).pipe(Effect.provide(github));

/** The token as the firewall carries it: GitHub's Basic header over the token user. */
const TOKEN_HEADER = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;

/** Whether the request mints a token for named repositories, rather than the listing token the installation's repositories are read on. */
function mintsForRepositories(sent: SentToGitHub): boolean {
  return sent.url.endsWith("/access_tokens") && "repositories" in JSON.parse(sent.body);
}

/** Whether the text carries the token, plain or as the header. */
function carriesToken(text: string): boolean {
  return text.includes(GITHUB_FIXTURE_INSTALLATION_TOKEN) || text.includes(TOKEN_HEADER);
}

it.layer(getTestDB())("run_in_repository in the session's sandbox", (it) => {
  it.effect(
    "the first call checks the repository out at its default branch through the firewall, and the next reuses it",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(7);
        const { call, sandbox } = yield* openTask(RELAY_FULL_NAME, installation);
        const github = githubReaching([installation]);

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
        const mint = github.sent.find(mintsForRepositories);
        assert.ok(mint);
        assert.equal(
          mint.url,
          `https://api.github.com/app/installations/${installation.id}/access_tokens`,
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
    "the token reaches the firewall and nothing else: no run, no output, no result carries it",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(8);
        const { call, sandbox } = yield* openTask(RELAY_FULL_NAME, installation);

        const answered = yield* run(call, "ls", githubReaching([installation]).layer);

        assert.equal(carriesToken(JSON.stringify(answered)), false);
        assert.equal(carriesToken(JSON.stringify(sandbox.runs)), false);
        assert.equal(carriesToken(JSON.stringify(sandbox.clones)), false);
        assert.equal(carriesToken(JSON.stringify(sandbox.policiesDuringClone)), true);
      }),
  );

  it.effect("a repository the workspace's installation no longer reaches checks nothing out", () =>
    Effect.gen(function* () {
      const installation = installationOf(9);
      const { call, sandbox } = yield* openTask(RELAY_FULL_NAME, installation);
      const elsewhere = githubReaching([{ ...installation, repositories: [] }]);

      const answered = yield* run(call, "ls", elsewhere.layer);

      assert.deepEqual(answered, {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.NOT_REACHABLE,
      });
      assert.deepEqual(sandbox.clones, []);
      assert.deepEqual(sandbox.policies, []);
      assert.equal(elsewhere.sent.some(mintsForRepositories), false);
    }),
  );

  it.effect(
    "where no installation reaches the repository, the clone carries the member's own token under their GitHub login, and withdraws it after",
    () =>
      Effect.gen(function* () {
        const userId = yield* openTokenMember();
        const started = yield* startTask(userId, {
          name: "Side work",
          repository: RELAY_FULL_NAME,
        });
        const sandbox = sandboxDouble(COMMANDS);
        const call: RepositoryCall = {
          task: { userId, taskId: started.id },
          repository: RELAY_FULL_NAME,
          sandbox: sandbox.door,
        };
        const github = githubReaching([], GITHUB_APP_WITH_TOKENS, {}, (sent) =>
          new URL(sent.url).pathname === `/repos/${RELAY_FULL_NAME}` &&
          sent.headers.get("authorization") === `Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`
            ? Response.json(memberRepositoryJson(RELAY, true))
            : undefined,
        );

        const answered = yield* run(call, "ls", github.layer);

        assert.deepEqual(answered, { status: REPOSITORY_SHELL_STATUS.RAN, ...LISTING });
        const basic = Buffer.from(
          `${GITHUB_FIXTURE_MEMBER.LOGIN}:${GITHUB_FIXTURE_MEMBER.TOKEN}`,
        ).toString("base64");
        assert.deepEqual(sandbox.policiesDuringClone, [
          {
            allow: {
              "*": [],
              "github.com": [
                {
                  match: { path: { startsWith: `/${RELAY_FULL_NAME}.git/` } },
                  transform: [{ headers: { authorization: `Basic ${basic}` } }],
                },
              ],
            },
          },
        ]);
        assert.deepEqual(sandbox.policies, [...sandbox.policiesDuringClone, "allow-all"]);
      }),
  );
});
