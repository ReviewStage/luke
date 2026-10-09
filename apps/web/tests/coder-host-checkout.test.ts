import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";
import { CODER_REFUSAL } from "../server/hosted/coder-host/bounds";
import { checkOutAgentRepository } from "../server/hosted/coder-host/checkout";
import { createCodingAgent } from "../server/hosted/coding-agent-store";
import { createPlan } from "../server/hosted/plan-store";
import { REPOSITORY_SANDBOX_CONTRACT } from "../server/hosted/repository-shell";
import {
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  openGithubUser,
} from "./support/github-app-fake";
import { sandboxDouble } from "./support/repository-sandbox";
import { testSqlClient } from "./support/sql-client";

/**
 * A coding agent's checkout: the repository cloned whole into its sandbox
 * through the firewall on a write token minted for that one repository,
 * which the sandbox's commands and output never carry, and handed back for
 * the session's own `gh` and `git`. The sandbox is a double at eve's
 * boundary, GitHub a script, and the store PGlite. Synthetic accounts,
 * repositories, and tokens throughout.
 */

const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;

/** The token as the firewall carries it: GitHub's Basic header over the token user. */
const TOKEN_HEADER = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;

function carriesToken(text: string): boolean {
  return text.includes(GITHUB_FIXTURE_INSTALLATION_TOKEN) || text.includes(TOKEN_HEADER);
}

/** An account with one agent started on a plan of the repository given. */
const openAgent = (repository: string) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const plan = yield* createPlan(userId, { name: "Teammate invitations", repository });
    const started = yield* createCodingAgent(userId, {
      planId: plan.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Teammate invitations\n",
      repository,
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    return { agent, target: { userId, conversationId: agent.conversationId } };
  });

it.layer(testSqlClient)("a coding agent's checkout", (it) => {
  it.effect(
    "the repository is cloned whole at its default branch with a write token at the firewall for the clone alone, and the token reaches no command and no output",
    () =>
      Effect.gen(function* () {
        const { agent, target } = yield* openAgent(RELAY_FULL_NAME);
        const github = githubReaching([INSTALLATION]);
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
        // The mint asked for exactly what a push and a pull request need.
        const mint = github.sent.find((sent) => sent.url.endsWith("/access_tokens"));
        assert.ok(mint);
        assert.deepEqual(JSON.parse(mint.body), {
          repositories: [RELAY.name],
          permissions: { contents: "write", pull_requests: "write" },
        });
      }),
  );

  it.effect(
    "a repository the developer no longer reaches is refused by name, and nothing is cloned",
    () =>
      Effect.gen(function* () {
        const { agent, target } = yield* openAgent("Acme/Ledger");
        const github = githubReaching([INSTALLATION]);
        const sandbox = sandboxDouble(() => undefined);

        const refused = yield* checkOutAgentRepository(target, agent, sandbox).pipe(
          Effect.provide(github.layer),
          Effect.flip,
        );

        assert.equal(refused.reason, CODER_REFUSAL.NOT_REACHABLE);
        assert.deepEqual(sandbox.clones, []);
        assert.deepEqual(sandbox.policies, []);
      }),
  );

  it.effect("a sandbox with no firewall cannot carry the credential, so nothing is cloned", () =>
    Effect.gen(function* () {
      const { agent, target } = yield* openAgent(RELAY_FULL_NAME);
      const github = githubReaching([INSTALLATION]);
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
