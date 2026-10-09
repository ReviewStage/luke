import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Option, Redacted } from "effect";
import { CODER_REFUSAL } from "../server/hosted/coder-host/bounds";
import { checkOutAgentRepository } from "../server/hosted/coder-host/checkout";
import { createCodingAgent } from "../server/hosted/coding-agent-store";
import { createPlan } from "../server/hosted/plan-store";
import { REPOSITORY_SANDBOX_CONTRACT } from "../server/hosted/repository-shell";
import {
  GITHUB_FIXTURE_BOT,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  GITHUB_FIXTURE_USER,
  githubReaching,
  openGithubUser,
} from "./support/github-app-fake";
import { sandboxDouble } from "./support/repository-sandbox";
import { testSqlClient } from "./support/sql-client";

/**
 * A coding agent's checkout: the repository cloned whole into its sandbox
 * through the firewall on a write token minted for that one repository,
 * which the sandbox's commands and output never carry, and handed back for
 * the session's own `gh` and `git`; and the checkout's commits made the
 * developer's, under their GitHub name and noreply address, with Luke's
 * co-author trailer under the App's bot. The sandbox is a double at eve's
 * boundary, GitHub a script, and the store PGlite. Synthetic accounts,
 * repositories, and tokens throughout.
 */

const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;

/** The developer's identity as the checkout sets it: their GitHub name at the noreply address GitHub links to the account. */
const DEVELOPER_IDENTITY = {
  name: "Octo Dev",
  email: `${GITHUB_FIXTURE_USER.id}+${GITHUB_FIXTURE_USER.login}@users.noreply.github.com`,
} as const;

/** The trailer each commit ends with: Luke, under the App's bot's noreply address. */
const LUKE_TRAILER = `Co-authored-by: Luke <${GITHUB_FIXTURE_BOT.id}+${GITHUB_FIXTURE_BOT.login}@users.noreply.github.com>`;

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
    "the repository is cloned whole at its default branch with a write token at the firewall for the clone alone, the token reaches no command and no output, and the checkout's commits are the developer's with Luke as co-author",
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
        // The identity is the checkout's own, set once it stands, under the developer's GitHub
        // account; the double refuses a run in a checkout that does not stand yet.
        assert.deepEqual(sandbox.identities, [{ ...DEVELOPER_IDENTITY, trailer: LUKE_TRAILER }]);
        const identity = sandbox.runs.find(
          (run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.GIT_NAME] !== undefined,
        );
        assert.ok(identity);
        assert.equal(identity.workingDirectory, REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT);
        assert.ok(sandbox.runs.indexOf(identity) > sandbox.runs.indexOf(clone));
        // The mint asked for exactly what a push and a pull request need.
        const mint = github.sent.find((sent) => sent.url.endsWith("/access_tokens"));
        assert.ok(mint);
        assert.deepEqual(JSON.parse(mint.body), {
          repositories: [RELAY.name],
          permissions: { contents: "write", pull_requests: "write" },
        });
      }),
  );

  it.effect("a developer who set no name on GitHub is named by their login", () =>
    Effect.gen(function* () {
      const { agent, target } = yield* openAgent(RELAY_FULL_NAME);
      const github = githubReaching([INSTALLATION], undefined, {
        user: { ...GITHUB_FIXTURE_USER, name: null },
      });
      const sandbox = sandboxDouble(() => undefined);

      yield* checkOutAgentRepository(target, agent, sandbox).pipe(Effect.provide(github.layer));

      assert.deepEqual(sandbox.identities, [
        { ...DEVELOPER_IDENTITY, name: GITHUB_FIXTURE_USER.login, trailer: LUKE_TRAILER },
      ]);
    }),
  );

  it.effect(
    "an App whose bot GitHub does not know still sets the developer's identity, with no trailer",
    () =>
      Effect.gen(function* () {
        const { agent, target } = yield* openAgent(RELAY_FULL_NAME);
        const github = githubReaching([INSTALLATION], undefined, { bot: null });
        const sandbox = sandboxDouble(() => undefined);

        const token = yield* checkOutAgentRepository(target, agent, sandbox).pipe(
          Effect.provide(github.layer),
        );

        assert.equal(Redacted.value(token), GITHUB_FIXTURE_INSTALLATION_TOKEN);
        assert.deepEqual(sandbox.identities, [{ ...DEVELOPER_IDENTITY, trailer: undefined }]);
        assert.equal(sandbox.checkedOut, RELAY_FULL_NAME);
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
