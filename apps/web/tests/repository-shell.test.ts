import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { createPlan } from "@sidecar/database/models/plan-store";
import { getTestDB } from "@sidecar/database/testing";
import { unparsedWire } from "@sidecar/wire";
import { Effect, type Layer } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../server/github/github-app";
import {
  REPOSITORY_SHELL_REFUSAL,
  REPOSITORY_SHELL_STATUS,
  type RepositoryCall,
  runInRepository,
} from "../server/hosted/repository-shell";
import {
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  openGithubUser,
} from "./support/github-app-fake";
import { type CommandTable, sandboxDouble } from "./support/repository-sandbox";

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

it.layer(getTestDB())("run_in_repository in the session's sandbox", (it) => {
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
});
