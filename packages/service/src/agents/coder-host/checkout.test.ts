import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createAutomation } from "@luke/database/models/automation-store";
import {
  type CodingAgent,
  createCodingAgent,
  readCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { CODING_AGENT_AUTHOR, type CodingAgentAuthor } from "@luke/features/coding-agent-wire";
import { Effect, Option, Redacted } from "effect";
import { LINK_OUTCOME } from "../../github/github-installations.js";
import {
  connectWorkspaceGitHub,
  GITHUB_FIXTURE_BOT,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
  type SentToGitHub,
} from "../../testing/github-app-fake.js";
import { sandboxDouble } from "../../testing/repository-sandbox.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { agentCoAuthor, checkOutAgentRepository } from "./checkout.js";

/**
 * A coding agent's checkout: the repository cloned whole into its sandbox
 * through the firewall on a write token minted for that one repository,
 * which the sandbox's commands and output never carry, and handed back for
 * the session's own `gh` and `git`; no developer's own token ever is.
 * Who the agent writes as: the developer who started it, on their GitHub
 * account with the App's bot as co-author, where their sign-in may push to
 * the repository; the App's bot otherwise, and always for an agent an
 * automation started, its row saying why. The repository is reached through
 * the installation connected to the plan's workspace. The sandbox is a
 * double at eve's boundary, GitHub a script, and the store PGlite.
 * Synthetic accounts, repositories, and tokens throughout.
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

/** The developer's own GitHub account, as `GET /user` answers on their token. */
const DEVELOPER = { id: 7_001, login: "ada", name: "Ada Lovelace" } as const;

/** The token the developer's GitHub sign-in left on their row (`standingGithubRow`). */
const DEVELOPER_TOKEN = "ghu_standing";

/** The token as `git` carries it at the firewall: GitHub's Basic header over the token user. */
const TOKEN_HEADER = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;

function carriesToken(text: string): boolean {
  return [GITHUB_FIXTURE_INSTALLATION_TOKEN, TOKEN_HEADER, DEVELOPER_TOKEN].some((token) =>
    text.includes(token),
  );
}

/** GitHub as the developer's token reads it: their account, and the repository with whether they may push to it. */
function developerReach(pushes: boolean) {
  return (sent: SentToGitHub): Response | undefined => {
    if (sent.headers.get("authorization") !== `Bearer ${DEVELOPER_TOKEN}`) return undefined;
    const { pathname } = new URL(sent.url);
    if (pathname === "/user") return Response.json({ ...DEVELOPER, type: "User" });
    if (pathname === `/repos/${RELAY_FULL_NAME}`) {
      return Response.json({ full_name: RELAY_FULL_NAME, permissions: { push: pushes } });
    }
    return undefined;
  };
}

/** An account with no GitHub sign-in, as one made with Google stands. */
const openGoogleUser = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
  );
  return id;
});

/**
 * An account with one agent on a plan of the repository given, the
 * installation given connected to the plan's workspace; the account signed
 * in with GitHub unless it is handed one, and the agent started by an
 * automation of the account's where asked.
 */
const openAgent = (
  installation: InstallationFixture,
  options: { readonly userId?: string; readonly byAutomation?: boolean } = {},
) =>
  Effect.gen(function* () {
    const userId = options.userId ?? (yield* openGithubUser());
    const task = yield* startTask(userId, {
      name: "Teammate invitations",
      repository: RELAY_FULL_NAME,
    });
    assert.equal(
      yield* connectWorkspaceGitHub(task.workspaceId, installation),
      LINK_OUTCOME.LINKED,
    );
    const automation =
      options.byAutomation === true
        ? Option.getOrThrow(
            yield* createAutomation(userId, {
              taskId: task.id,
              name: "Nightly invitations",
              trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
              action: {
                kind: AUTOMATION_ACTION.CODING_AGENT,
                prompt: "Fix the invitations.",
                choice: { model: "anthropic/claude-opus-5.5", effort: "high" },
              },
              guards: AUTOMATION_DEFAULT_GUARDS,
              nextRunAt: new Date("2026-10-15T09:00:00Z"),
              webhookSecretHash: null,
              archiveSuccessful: false,
            }),
          )
        : undefined;
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Teammate invitations\n",
      prompt: null,
      repository: RELAY_FULL_NAME,
      automationId: automation?.id,
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    return { agent, target: { userId, conversationId: agent.conversationId } };
  });

/** Who the agent's row says it writes as now. */
const authorOf = (userId: string, agent: CodingAgent) =>
  Effect.map(
    readCodingAgent(userId, agent.id),
    (read): CodingAgentAuthor | null => Option.getOrThrow(read).author,
  );

it.layer(getTestDB())("a coding agent's checkout", (it) => {
  it.effect(
    "the repository is cloned whole at its default branch with a write token at the firewall for the clone alone, no token reaches a command or its output, and a developer whose GitHub may not push leaves the commits the App's",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(7);
        const { agent, target } = yield* openAgent(installation);
        const github = githubReaching([installation], undefined, {}, developerReach(false));
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
        // The identity is the checkout's own, set once it stands, under the App's bot; the
        // double refuses a run in a checkout that does not stand yet.
        assert.deepEqual(sandbox.identities, [BOT_IDENTITY]);
        const identity = sandbox.runs.find(
          (run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.GIT_NAME] !== undefined,
        );
        assert.ok(identity);
        assert.equal(identity.workingDirectory, REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT);
        assert.ok(sandbox.runs.indexOf(identity) > sandbox.runs.indexOf(clone));
        assert.equal(yield* authorOf(target.userId, agent), CODING_AGENT_AUTHOR.APP_NO_PUSH);
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

  it.effect(
    "a developer whose GitHub may push authors the commits with the App's bot as co-author, and the sandbox is still handed the App's token alone",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(9);
        const { agent, target } = yield* openAgent(installation);
        const github = githubReaching([installation], undefined, {}, developerReach(true));
        const sandbox = sandboxDouble(() => undefined);

        const token = yield* checkOutAgentRepository(target, agent, sandbox).pipe(
          Effect.provide(github.layer),
        );
        const coAuthor = yield* agentCoAuthor(target, agent).pipe(Effect.provide(github.layer));

        assert.equal(Redacted.value(token), GITHUB_FIXTURE_INSTALLATION_TOKEN);
        assert.deepEqual(sandbox.identities, [
          {
            name: DEVELOPER.name,
            email: `${DEVELOPER.id}+${DEVELOPER.login}@users.noreply.github.com`,
          },
        ]);
        for (const policy of sandbox.policies) {
          assert.equal(JSON.stringify(policy).includes(DEVELOPER_TOKEN), false);
        }
        for (const run of sandbox.runs) {
          assert.equal(carriesToken(JSON.stringify(run)), false);
        }
        assert.equal(coAuthor, `Co-authored-by: ${BOT_IDENTITY.name} <${BOT_IDENTITY.email}>`);
        assert.equal(yield* authorOf(target.userId, agent), CODING_AGENT_AUTHOR.DEVELOPER);
      }),
  );

  it.effect(
    "an agent an automation started writes as the App's bot without reading its owner's GitHub, and one whose developer has no GitHub sign-in does too, each row saying why",
    () =>
      Effect.gen(function* () {
        const byAutomation = installationOf(10);
        const automated = yield* openAgent(byAutomation, { byAutomation: true });
        const unlinked = installationOf(11);
        const google = yield* openAgent(unlinked, { userId: yield* openGoogleUser });
        const github = githubReaching(
          [byAutomation, unlinked],
          undefined,
          {},
          developerReach(true),
        );

        for (const { agent, target } of [automated, google]) {
          const sandbox = sandboxDouble(() => undefined);
          yield* checkOutAgentRepository(target, agent, sandbox).pipe(Effect.provide(github.layer));
          const coAuthor = yield* agentCoAuthor(target, agent).pipe(Effect.provide(github.layer));
          assert.deepEqual(sandbox.identities, [BOT_IDENTITY]);
          assert.equal(coAuthor, undefined);
        }

        assert.deepEqual(
          [
            yield* authorOf(automated.target.userId, automated.agent),
            yield* authorOf(google.target.userId, google.agent),
          ],
          [CODING_AGENT_AUTHOR.APP_AUTOMATION, CODING_AGENT_AUTHOR.APP_UNLINKED],
        );
        assert.ok(
          github.sent.every(
            (sent) => sent.headers.get("authorization") !== `Bearer ${DEVELOPER_TOKEN}`,
          ),
          "the automation's owner's token is never read",
        );
      }),
  );

  it.effect("a sandbox with no firewall cannot carry the credential, so nothing is cloned", () =>
    Effect.gen(function* () {
      const installation = installationOf(8);
      const { agent, target } = yield* openAgent(installation);
      const github = githubReaching([installation], undefined, {}, developerReach(false));
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
