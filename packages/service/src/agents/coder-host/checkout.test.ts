import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createAutomation } from "@luke/database/models/automation-store";
import {
  type CodingAgent,
  createCodingAgent,
  hasRepository,
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
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { Effect, Option, Redacted } from "effect";
import { LINK_OUTCOME } from "../../github/github-installations.js";
import {
  connectWorkspaceGitHub,
  GITHUB_APP_WITH_TOKENS,
  GITHUB_FIXTURE_BOT,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  GITHUB_FIXTURE_MEMBER,
  githubReaching,
  type InstallationFixture,
  memberRepositoryJson,
  openGithubUser,
  openTokenMember,
  type SentToGitHub,
} from "../../testing/github-app-fake.js";
import { sandboxDouble } from "../../testing/repository-sandbox.js";
import { DEEPEN_STEP, REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { credentialPolicy } from "../terminal/agent-sandbox.js";
import { agentCoAuthor, checkOutAgentRepository, deepenAgentCheckout } from "./checkout.js";

/**
 * A coding agent's checkout: the repository cloned one commit deep into its
 * sandbox as it opens, through the firewall on a read token minted for that
 * one repository, with nothing left standing; then deepened to its whole
 * history on the first write, on a write token, which the sandbox's
 * commands and output never carry, and handed back for the session's own
 * `gh` and `git`; no developer's own token ever is.
 * Who the agent writes as: the developer who started it, on their GitHub
 * account with the App's bot as co-author, where their sign-in may push to
 * the repository; the App's bot otherwise, and always for an agent an
 * automation started, its row saying why; and the account a member's own
 * token belongs to, read on it, where that token is the agent's credential.
 * The repository is reached through the installation connected to the
 * plan's workspace, or the member's token where none reaches it. The sandbox is a
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

/** The member's own GitHub account, as `GET /user` answers on their token. */
const MEMBER = {
  id: Number(GITHUB_FIXTURE_MEMBER.ID),
  login: GITHUB_FIXTURE_MEMBER.LOGIN,
  name: "Octo Member",
} as const;

/** GitHub as the member's own token reads it: their account, and the repository, which it may push to. */
function memberTokenReach(sent: SentToGitHub): Response | undefined {
  if (sent.headers.get("authorization") !== `Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`)
    return undefined;
  const { pathname } = new URL(sent.url);
  if (pathname === "/user") return Response.json({ ...MEMBER, type: "User" });
  if (pathname === `/repos/${RELAY_FULL_NAME}`) {
    return Response.json(memberRepositoryJson(RELAY, true));
  }
  return undefined;
}

/** A member who saved their own token, with one agent on a plan of the repository, which no installation of the plan's workspace reaches. */
const openTokenAgent = Effect.gen(function* () {
  const userId = yield* openTokenMember();
  const task = yield* startTask(userId, {
    name: "Teammate invitations",
    repository: RELAY_FULL_NAME,
  });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: "start-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    repository: RELAY_FULL_NAME,
    githubAccess: GITHUB_ACCESS.TOKEN,
  });
  assert.ok(Option.isSome(started));
  const { agent } = started.value;
  assert.ok(hasRepository(agent));
  return { agent, target: { userId, conversationId: agent.conversationId } };
});

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
    assert.ok(hasRepository(agent));
    return { agent, target: { userId, conversationId: agent.conversationId } };
  });

/** Who the agent's row says it writes as now. */
const authorOf = (userId: string, agent: CodingAgent) =>
  Effect.map(
    readCodingAgent(userId, agent.id),
    (read): CodingAgentAuthor | null => Option.getOrThrow(read).author,
  );

/** The sandbox's checkout as an agent's first write leaves it: opened shallow, then deepened; answers the policy standing at the firewall after. */
const checkOutAndDeepen = (
  target: { readonly userId: string; readonly conversationId: string },
  agent: Parameters<typeof checkOutAgentRepository>[1],
  sandbox: ReturnType<typeof sandboxDouble>,
) =>
  Effect.gen(function* () {
    yield* checkOutAgentRepository(target, agent, sandbox);
    yield* deepenAgentCheckout(target, agent, sandbox);
    return sandbox.policies.at(-1);
  });

/** The App's installation token for the repository, as the session's firewall carries it. */
const APP_CREDENTIAL = credentialPolicy({
  token: Redacted.make(GITHUB_FIXTURE_INSTALLATION_TOKEN),
  fullName: RELAY_FULL_NAME,
  access: { kind: GITHUB_ACCESS.APP },
});

/** The mints sent to GitHub for one repository, by the permissions each asked for. */
const repositoryMints = (sent: readonly SentToGitHub[]) =>
  sent
    .filter((one) => one.url.endsWith("/access_tokens") && "repositories" in JSON.parse(one.body))
    .map((one) => JSON.parse(one.body));

it.layer(getTestDB())("a coding agent's checkout", (it) => {
  it.effect(
    "the sandbox opens on a clone one commit deep at the default branch, on a read token at the firewall for the clone alone, with no identity and no credential standing",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(12);
        const { agent, target } = yield* openAgent(installation);
        const github = githubReaching([installation], undefined, {}, developerReach(false));
        const sandbox = sandboxDouble(() => undefined);

        yield* checkOutAgentRepository(target, agent, sandbox).pipe(Effect.provide(github.layer));

        assert.deepEqual(sandbox.clones, [
          {
            repository: RELAY_FULL_NAME,
            branch: RELAY.defaultBranch,
            url: `https://github.com/${RELAY_FULL_NAME}.git`,
          },
        ]);
        assert.equal(sandbox.checkedOut, RELAY_FULL_NAME);
        assert.equal(sandbox.shallow, true);
        assert.equal(sandbox.policies.at(-1), "allow-all");
        assert.deepEqual(sandbox.identities, []);
        assert.deepEqual(repositoryMints(github.sent), [
          { repositories: [RELAY.name], permissions: { contents: "read" } },
        ]);
        for (const run of sandbox.runs) {
          assert.equal(carriesToken(JSON.stringify(run)), false);
        }
        // Nothing about who the agent writes as is read until a write needs it.
        assert.equal(yield* authorOf(target.userId, agent), null);
      }),
  );

  it.effect(
    "the first write sets the write token at the firewall, where it stays for the session, deepens the checkout to its whole history through it, sets the identity, and records the deepen; no token reaches a command, and a developer whose GitHub may not push leaves the commits the App's",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(7);
        const { agent, target } = yield* openAgent(installation);
        const github = githubReaching([installation], undefined, {}, developerReach(false));
        const sandbox = sandboxDouble(() => undefined);

        const standing = yield* checkOutAndDeepen(target, agent, sandbox).pipe(
          Effect.provide(github.layer),
        );

        assert.deepEqual(standing, APP_CREDENTIAL);
        assert.equal(sandbox.shallow, false);
        assert.equal(sandbox.deepened, 1);
        assert.deepEqual(sandbox.policiesDuringFetch, [APP_CREDENTIAL]);
        assert.equal(sandbox.deepenMarked, true);
        for (const run of sandbox.runs) {
          assert.equal(carriesToken(JSON.stringify(run)), false);
        }
        // The identity is the checkout's own, set once its history is whole, under the App's bot, and the record after it.
        assert.deepEqual(sandbox.identities, [BOT_IDENTITY]);
        const stepAt = (step: string) =>
          sandbox.runs.findIndex(
            (run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.DEEPEN] === step,
          );
        const identity = sandbox.runs.findIndex(
          (run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.GIT_NAME] !== undefined,
        );
        assert.ok(stepAt(DEEPEN_STEP.FETCH) >= 0 && identity > stepAt(DEEPEN_STEP.FETCH));
        assert.ok(stepAt(DEEPEN_STEP.MARK) > identity);
        assert.equal(yield* authorOf(target.userId, agent), CODING_AGENT_AUTHOR.APP_NO_PUSH);
        // The write mint asked for exactly what a push and a pull request need.
        assert.deepEqual(repositoryMints(github.sent).at(-1), {
          repositories: [RELAY.name],
          permissions: { contents: "write", pull_requests: "write" },
        });
      }),
  );

  it.effect(
    "a deepen cut short after its fetch records nothing, so the next write runs it again whole, its identity and credential among it",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(14);
        const { agent, target } = yield* openAgent(installation);
        const github = githubReaching([installation], undefined, {}, developerReach(false));
        const sandbox = sandboxDouble(() => undefined);
        yield* checkOutAgentRepository(target, agent, sandbox).pipe(Effect.provide(github.layer));
        sandbox.identityAnswers.push({ exitCode: 1, stderr: "error: could not lock config file" });

        const cut = yield* deepenAgentCheckout(target, agent, sandbox).pipe(
          Effect.provide(github.layer),
          Effect.flip,
        );
        assert.equal(cut._tag, "CheckoutRefused");
        assert.equal(sandbox.shallow, false);
        assert.equal(sandbox.deepenMarked, false);
        // Whatever stands at the firewall meanwhile, the next deepen sets the credential again.
        yield* Effect.promise(async () => sandbox.setNetworkPolicy?.("allow-all"));

        yield* deepenAgentCheckout(target, agent, sandbox).pipe(Effect.provide(github.layer));

        assert.deepEqual(sandbox.identities, [BOT_IDENTITY]);
        assert.deepEqual(sandbox.policies.at(-1), APP_CREDENTIAL);
        assert.equal(sandbox.deepenMarked, true);
        assert.equal(sandbox.deepened, 1);
      }),
  );

  it.effect(
    "a deepen that finished is not run again: no token is minted and nothing is set at the firewall",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(13);
        const { agent, target } = yield* openAgent(installation);
        const github = githubReaching([installation], undefined, {}, developerReach(false));
        const sandbox = sandboxDouble(() => undefined);
        yield* checkOutAndDeepen(target, agent, sandbox).pipe(Effect.provide(github.layer));
        const mintsBefore = repositoryMints(github.sent).length;
        const policiesBefore = sandbox.policies.length;

        yield* deepenAgentCheckout(target, agent, sandbox).pipe(Effect.provide(github.layer));

        assert.equal(sandbox.policies.length, policiesBefore);
        assert.equal(sandbox.deepened, 1);
        assert.equal(repositoryMints(github.sent).length, mintsBefore);
        assert.deepEqual(sandbox.identities, [BOT_IDENTITY]);
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

        const standing = yield* checkOutAndDeepen(target, agent, sandbox).pipe(
          Effect.provide(github.layer),
        );
        const coAuthor = yield* agentCoAuthor(target, agent).pipe(Effect.provide(github.layer));

        assert.deepEqual(standing, APP_CREDENTIAL);
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
          yield* checkOutAndDeepen(target, agent, sandbox).pipe(Effect.provide(github.layer));
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

  it.effect(
    "an agent on its starter's own token writes as the account the token belongs to, with the App's bot as co-author, its row saying so, and sets that token at the firewall as theirs",
    () =>
      Effect.gen(function* () {
        const { agent, target } = yield* openTokenAgent;
        const github = githubReaching([], GITHUB_APP_WITH_TOKENS, {}, memberTokenReach);
        const sandbox = sandboxDouble(() => undefined);

        const standing = yield* checkOutAndDeepen(target, agent, sandbox).pipe(
          Effect.provide(github.layer),
        );
        const coAuthor = yield* agentCoAuthor(target, agent).pipe(Effect.provide(github.layer));

        // The member's own token, on the repository's own paths, as theirs.
        assert.deepEqual(
          standing,
          credentialPolicy({
            token: Redacted.make(GITHUB_FIXTURE_MEMBER.TOKEN),
            fullName: RELAY_FULL_NAME,
            access: {
              kind: GITHUB_ACCESS.TOKEN,
              githubLogin: GITHUB_FIXTURE_MEMBER.LOGIN,
              githubUserId: GITHUB_FIXTURE_MEMBER.ID,
              markInvalid: Effect.void,
            },
          }),
        );
        assert.deepEqual(sandbox.identities, [
          {
            name: MEMBER.name,
            email: `${MEMBER.id}+${MEMBER.login}@users.noreply.github.com`,
          },
        ]);
        assert.equal(coAuthor, `Co-authored-by: ${BOT_IDENTITY.name} <${BOT_IDENTITY.email}>`);
        assert.equal(yield* authorOf(target.userId, agent), CODING_AGENT_AUTHOR.TOKEN);
        for (const run of sandbox.runs) {
          assert.equal(JSON.stringify(run).includes(GITHUB_FIXTURE_MEMBER.TOKEN), false);
        }
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
