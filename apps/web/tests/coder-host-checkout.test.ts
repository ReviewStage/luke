import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { getTestDB, startPlan } from "@luke/database/testing";
import { Effect, Option, Redacted } from "effect";
import { checkOutAgentRepository } from "../server/hosted/coder-host/checkout";
import { LINK_OUTCOME } from "../server/hosted/github-installations";
import { REPOSITORY_SANDBOX_CONTRACT } from "../server/hosted/repository-shell";
import {
  connectWorkspaceGitHub,
  GITHUB_FIXTURE_BOT,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "./support/github-app-fake";
import { sandboxDouble } from "./support/repository-sandbox";

/**
 * A coding agent's checkout: the repository cloned whole into its sandbox
 * through the firewall on a write token minted for that one repository,
 * which the sandbox's commands and output never carry, and handed back for
 * the session's own `gh` and `git`; and the checkout's commits made the
 * App's bot's, under its login and noreply address. The repository is reached through the installation connected to
 * the plan's workspace. The sandbox is a double at eve's boundary, GitHub a
 * script, and the store PGlite. Synthetic accounts, repositories, and tokens
 * throughout.
 */

const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

/** The installation reaching the repository; each test connects its own, since one installation stands for one workspace. */
const installationOf = (id: number): InstallationFixture => ({
  id,
  login: RELAY.owner,
  repositories: [RELAY],
});

/** The App's bot as the checkout sets it: its login at the noreply address GitHub links to it. */
const BOT_IDENTITY = {
  name: GITHUB_FIXTURE_BOT.login,
  email: `${GITHUB_FIXTURE_BOT.id}+${GITHUB_FIXTURE_BOT.login}@users.noreply.github.com`,
} as const;

/** The token as the firewall carries it: GitHub's Basic header over the token user. */
const TOKEN_HEADER = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;

function carriesToken(text: string): boolean {
  return text.includes(GITHUB_FIXTURE_INSTALLATION_TOKEN) || text.includes(TOKEN_HEADER);
}

/** An account with one agent started on a plan of the repository given, the installation given connected to the plan's workspace. */
const openAgent = (repository: string, installation: InstallationFixture) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const plan = yield* startPlan(userId, { name: "Teammate invitations", repository });
    assert.equal(
      yield* connectWorkspaceGitHub(plan.workspaceId, installation),
      LINK_OUTCOME.LINKED,
    );
    const started = yield* createCodingAgent(userId, {
      planId: plan.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Teammate invitations\n",
      task: null,
      repository,
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    return { agent, target: { userId, conversationId: agent.conversationId } };
  });

it.layer(getTestDB())("a coding agent's checkout", (it) => {
  it.effect(
    "the repository is cloned whole at its default branch with a write token at the firewall for the clone alone, the token reaches no command and no output, and the checkout's commits are the App's bot's",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(7);
        const { agent, target } = yield* openAgent(RELAY_FULL_NAME, installation);
        const github = githubReaching([installation]);
        const sandbox = sandboxDouble(() => undefined);

        const token = yield* checkOutAgentRepository(target, agent, sandbox).pipe(
          Effect.provide(github.layer),
        );

        assert.equal(Redacted.value(token), GITHUB_FIXTURE_INSTALLATION_TOKEN);
        assert.deepEqual(sandbox.clones, [
          {
            repository: RELAY_FULL_NAME,
            branch: RELAY.defaultBranch,
            url: `https://github.com/${RELAY_FULL_NAME}.git`,
          },
        ]);
        assert.equal(sandbox.checkedOut, RELAY_FULL_NAME);
        // Whole, not one commit deep: a branch and a pull request are cut from the history.
        const clone = sandbox.runs.find(
          (run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.URL] !== undefined,
        );
        assert.ok(clone);
        assert.equal(clone.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.DEPTH], undefined);
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
        assert.equal(sandbox.policies.at(-1), "allow-all");
        for (const run of sandbox.runs) {
          assert.equal(carriesToken(JSON.stringify(run)), false);
        }
        // The identity is the checkout's own, set once it stands, under the App's bot and nobody's
        // own account; the double refuses a run in a checkout that does not stand yet.
        assert.deepEqual(sandbox.identities, [BOT_IDENTITY]);
        const identity = sandbox.runs.find(
          (run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.GIT_NAME] !== undefined,
        );
        assert.ok(identity);
        assert.equal(identity.workingDirectory, REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT);
        assert.ok(sandbox.runs.indexOf(identity) > sandbox.runs.indexOf(clone));
        // The repository's mint, beside the one the installation's listing is read on, asked for
        // exactly what a push and a pull request need.
        const mint = github.sent.find(
          (sent) => sent.url.endsWith("/access_tokens") && "repositories" in JSON.parse(sent.body),
        );
        assert.ok(mint);
        assert.deepEqual(JSON.parse(mint.body), {
          repositories: [RELAY.name],
          permissions: { contents: "write", pull_requests: "write" },
        });
      }),
  );

  it.effect("a sandbox with no firewall cannot carry the credential, so nothing is cloned", () =>
    Effect.gen(function* () {
      const installation = installationOf(8);
      const { agent, target } = yield* openAgent(RELAY_FULL_NAME, installation);
      const github = githubReaching([installation]);
      const sandbox = sandboxDouble(() => undefined, { firewall: false });

      const refused = yield* checkOutAgentRepository(target, agent, sandbox).pipe(
        Effect.provide(github.layer),
        Effect.flip,
      );

      assert.equal(refused._tag, "CheckoutRefused");
      assert.deepEqual(sandbox.clones, []);
    }),
  );
});
