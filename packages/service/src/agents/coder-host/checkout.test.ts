import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import {
  type Agent,
  createAgent,
  hasRepository,
  type NewAgentRepository,
  readAgent,
} from "@repo/database/models/agent-store";
import { createAutomation } from "@repo/database/models/automation-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_AUTHOR, type AgentAuthor } from "@repo/features/agent-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { CHECKOUT_IDENTITY_VARIABLE } from "@repo/features/checkout-identity";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { COMMIT_AUTHOR } from "@repo/settings";
import { Effect, Option } from "effect";
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
import { CODER_REFUSAL } from "./bounds.js";
import {
  agentAuthorship,
  agentDeepenPlan,
  agentExtraReads,
  agentRepositoryRead,
  CheckoutRefused,
  COMMIT_BY,
  cloneAgentExtras,
  cloneAgentRepository,
  deepenCheckoutWith,
} from "./checkout.js";

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

/** The trailer crediting the App's bot as co-author. */
const BOT_TRAILER = `Co-authored-by: ${BOT_IDENTITY.name} <${BOT_IDENTITY.email}>`;

/** The developer's own GitHub account, as `GET /user` answers on their token. */
const DEVELOPER = { id: 7_001, login: "ada", name: "Ada Lovelace" } as const;

/** The developer's account as their commits name it. */
const DEVELOPER_IDENTITY = {
  name: DEVELOPER.name,
  email: `${DEVELOPER.id}+${DEVELOPER.login}@users.noreply.github.com`,
} as const;

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
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: "start-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Teammate invitations\n",
    prompt: null,
    repository: RELAY_FULL_NAME,
    githubAccess: GITHUB_ACCESS.TOKEN,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
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
    db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
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
  options: {
    readonly userId?: string;
    readonly byAutomation?: boolean;
    readonly extraRepositories?: readonly NewAgentRepository[];
  } = {},
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
              organizationId: task.workspaceId,
              repositories: task.repository === null ? [] : [task.repository],
              name: "Nightly invitations",
              trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
              action: {
                kind: AUTOMATION_ACTION.AGENT,
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
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: "# Teammate invitations\n",
      prompt: null,
      repository: RELAY_FULL_NAME,
      extraRepositories: options.extraRepositories,
      automationId: automation?.id,
      automationOrigin:
        automation === undefined
          ? undefined
          : {
              name: automation.name,
              firing: {
                kind: AUTOMATION_FIRING.SCHEDULE,
                dueAt: Date.parse("2026-10-15T09:00:00Z"),
              },
              prompt: automation.action.prompt,
            },
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    assert.ok(hasRepository(agent));
    return { agent, target: { userId, conversationId: agent.conversationId } };
  });

/** Who the agent's row says it writes as now. */
const authorOf = (userId: string, agent: Agent) =>
  Effect.map(
    readAgent(userId, agent.id),
    (read): AgentAuthor | null => Option.getOrThrow(read).author,
  );

/** The sandbox's checkout as a launch opens it: the repository read, then cloned shallow. */
const checkOut = (
  target: { readonly userId: string; readonly conversationId: string },
  agent: Parameters<typeof agentRepositoryRead>[1],
  sandbox: ReturnType<typeof sandboxDouble>,
) =>
  Effect.flatMap(agentRepositoryRead(target, agent), (read) =>
    cloneAgentRepository(agent, sandbox, read),
  );

/** The sandbox's checkout as a launch leaves it: opened shallow, then deepened on the plan read for it; answers the policy standing at the firewall after. */
const checkOutAndDeepen = (
  target: { readonly userId: string; readonly conversationId: string },
  agent: Parameters<typeof agentRepositoryRead>[1],
  sandbox: ReturnType<typeof sandboxDouble>,
) =>
  Effect.gen(function* () {
    yield* checkOut(target, agent, sandbox);
    yield* deepenCheckoutWith(sandbox, yield* agentDeepenPlan(target, agent));
    return sandbox.policies.at(-1);
  });

/** A rule that sets the authorization given, on every request to its host or on those whose path matches. */
const authorizing = (authorization: string, path?: object) =>
  path === undefined
    ? { transform: [{ headers: { authorization } }] }
    : { match: { path }, transform: [{ headers: { authorization } }] };

/** The App's installation token for the repository, as the session's firewall carries it: on GitHub's two hosts, as Basic credentials, every other host open. */
const APP_AUTHORIZATION = `Basic ${Buffer.from(`x-access-token:${GITHUB_FIXTURE_INSTALLATION_TOKEN}`).toString("base64")}`;
const APP_CREDENTIAL = {
  allow: {
    "*": [],
    "github.com": [authorizing(APP_AUTHORIZATION)],
    "api.github.com": [authorizing(APP_AUTHORIZATION)],
  },
};

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

        yield* checkOut(target, agent, sandbox).pipe(Effect.provide(github.layer));

        assert.deepEqual(sandbox.clones, [
          {
            repository: RELAY_FULL_NAME,
            branch: RELAY.defaultBranch,
            url: `https://github.com/${RELAY_FULL_NAME}.git`,
          },
        ]);
        assert.equal(sandbox.checkedOut, RELAY_FULL_NAME);
        assert.equal(sandbox.shallow, true);
        assert.deepEqual(sandbox.policies.at(-1), { mode: "allow-all" });
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
        for (const run of sandbox.runs) {
          assert.equal(carriesToken(JSON.stringify(run)), false);
        }
        // The identity is the checkout's own, set once its history is whole, under the App's bot.
        assert.deepEqual(sandbox.identities, [BOT_IDENTITY]);
        const stepAt = (step: string) =>
          sandbox.runs.findIndex(
            (run) => run.env?.[REPOSITORY_SANDBOX_CONTRACT.VARIABLE.DEEPEN] === step,
          );
        const identity = sandbox.runs.findIndex(
          (run) => run.env?.[CHECKOUT_IDENTITY_VARIABLE.NAME] !== undefined,
        );
        assert.ok(stepAt(DEEPEN_STEP.FETCH) >= 0 && identity > stepAt(DEEPEN_STEP.FETCH));
        assert.equal(yield* authorOf(target.userId, agent), AGENT_AUTHOR.APP_NO_PUSH);
        // The write mint asked for exactly what a push and a pull request need.
        assert.deepEqual(repositoryMints(github.sent).at(-1), {
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

        const standing = yield* checkOutAndDeepen(target, agent, sandbox).pipe(
          Effect.provide(github.layer),
        );
        const authorship = yield* agentAuthorship(target, agent).pipe(Effect.provide(github.layer));

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
        assert.deepEqual(authorship, { by: COMMIT_BY.DEVELOPER, coAuthor: BOT_TRAILER });
        assert.equal(yield* authorOf(target.userId, agent), AGENT_AUTHOR.DEVELOPER);
      }),
  );

  it.effect(
    "a developer who chose the App's bot with themselves credited has the bot author and the trailer name their account, the row saying they chose it, and one who chose themselves alone authors with no trailer",
    () =>
      Effect.gen(function* () {
        const appInstallation = installationOf(14);
        const byApp = yield* openAgent(appInstallation);
        yield* writeAccountPreferences(byApp.target.userId, {
          commitAuthor: COMMIT_AUTHOR.APP_WITH_DEVELOPER,
        });
        const soloInstallation = installationOf(15);
        const solo = yield* openAgent(soloInstallation);
        yield* writeAccountPreferences(solo.target.userId, {
          commitAuthor: COMMIT_AUTHOR.DEVELOPER,
        });
        const github = githubReaching(
          [appInstallation, soloInstallation],
          undefined,
          {},
          developerReach(true),
        );

        const read = (opened: typeof byApp) =>
          Effect.gen(function* () {
            const sandbox = sandboxDouble(() => undefined);
            yield* checkOutAndDeepen(opened.target, opened.agent, sandbox);
            return {
              identities: sandbox.identities,
              authorship: yield* agentAuthorship(opened.target, opened.agent),
              author: yield* authorOf(opened.target.userId, opened.agent),
            };
          }).pipe(Effect.provide(github.layer));

        assert.deepEqual(yield* read(byApp), {
          identities: [BOT_IDENTITY],
          authorship: {
            by: COMMIT_BY.APP,
            coAuthor: `Co-authored-by: ${DEVELOPER_IDENTITY.name} <${DEVELOPER_IDENTITY.email}>`,
          },
          author: AGENT_AUTHOR.APP_CHOSEN,
        });
        assert.deepEqual(yield* read(solo), {
          identities: [DEVELOPER_IDENTITY],
          authorship: { by: COMMIT_BY.DEVELOPER, coAuthor: undefined },
          author: AGENT_AUTHOR.DEVELOPER,
        });
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
          const authorship = yield* agentAuthorship(target, agent).pipe(
            Effect.provide(github.layer),
          );
          assert.deepEqual(sandbox.identities, [BOT_IDENTITY]);
          assert.deepEqual(authorship, { by: COMMIT_BY.APP, coAuthor: undefined });
        }

        assert.deepEqual(
          [
            yield* authorOf(automated.target.userId, automated.agent),
            yield* authorOf(google.target.userId, google.agent),
          ],
          [AGENT_AUTHOR.APP_AUTOMATION, AGENT_AUTHOR.APP_UNLINKED],
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
        const authorship = yield* agentAuthorship(target, agent).pipe(Effect.provide(github.layer));

        // The member's own token, on the repository's own paths, as theirs.
        const basic = `Basic ${Buffer.from(`${GITHUB_FIXTURE_MEMBER.LOGIN}:${GITHUB_FIXTURE_MEMBER.TOKEN}`).toString("base64")}`;
        const bearer = `Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`;
        assert.deepEqual(standing, {
          allow: {
            "*": [],
            "github.com": [authorizing(basic, { startsWith: `/${RELAY_FULL_NAME}.git/` })],
            "api.github.com": [
              authorizing(bearer, { exact: `/repos/${RELAY_FULL_NAME}` }),
              authorizing(bearer, { startsWith: `/repos/${RELAY_FULL_NAME}/` }),
            ],
          },
        });
        assert.deepEqual(sandbox.identities, [
          {
            name: MEMBER.name,
            email: `${MEMBER.id}+${MEMBER.login}@users.noreply.github.com`,
          },
        ]);
        assert.deepEqual(authorship, { by: COMMIT_BY.DEVELOPER, coAuthor: BOT_TRAILER });
        assert.equal(yield* authorOf(target.userId, agent), AGENT_AUTHOR.TOKEN);
        for (const run of sandbox.runs) {
          assert.equal(JSON.stringify(run).includes(GITHUB_FIXTURE_MEMBER.TOKEN), false);
        }
      }),
  );

  it.effect(
    "an agent in several repositories clones each beside its own checkout, in a folder of its name unless the workspace holds one, at its branch or its default, and is minted one write token for them all, set at the firewall as one repository's is",
    () =>
      Effect.gen(function* () {
        const web = { owner: RELAY.owner, name: "Web" } as const;
        const named = { owner: RELAY.owner, name: "Repository" } as const;
        const installation = { ...installationOf(21), repositories: [RELAY, web, named] };
        const { agent, target } = yield* openAgent(installation, {
          extraRepositories: [
            { repository: `${web.owner}/${web.name}` },
            { repository: `${named.owner}/${named.name}`, baseBranch: "next" },
          ],
        });
        const github = githubReaching([installation], undefined, {}, developerReach(false));
        const sandbox = sandboxDouble(() => undefined);

        const standing = yield* Effect.gen(function* () {
          yield* checkOut(target, agent, sandbox);
          yield* cloneAgentExtras(sandbox, yield* agentExtraReads(target, agent));
          yield* deepenCheckoutWith(sandbox, yield* agentDeepenPlan(target, agent));
          return sandbox.policies.at(-1);
        }).pipe(Effect.provide(github.layer));

        assert.equal(sandbox.checkedOut, RELAY_FULL_NAME);
        assert.deepEqual(sandbox.extraClones, [
          { folder: "Web", branch: "main", url: "https://github.com/Acme/Web.git" },
          {
            folder: "Acme-Repository",
            branch: "next",
            url: "https://github.com/Acme/Repository.git",
          },
        ]);
        assert.deepEqual(standing, APP_CREDENTIAL);
        assert.deepEqual(repositoryMints(github.sent).at(-1), {
          repositories: [RELAY.name, web.name, named.name],
          permissions: { contents: "write", pull_requests: "write" },
        });
        for (const run of sandbox.runs) {
          assert.equal(carriesToken(JSON.stringify(run)), false);
        }
      }),
  );

  it.effect(
    "an agent in several repositories is refused its token, naming the repository, where one is no longer reached",
    () =>
      Effect.gen(function* () {
        const installation = installationOf(22);
        const { agent, target } = yield* openAgent(installation, {
          extraRepositories: [{ repository: "Acme/Gone" }],
        });
        const github = githubReaching([installation], undefined, {}, developerReach(false));

        const refused = yield* agentDeepenPlan(target, agent).pipe(
          Effect.provide(github.layer),
          Effect.flip,
        );

        assert.ok(refused instanceof CheckoutRefused);
        assert.deepEqual(
          [refused.reason, refused.detail],
          [CODER_REFUSAL.NOT_REACHABLE, "Not reached: Acme/Gone."],
        );
      }),
  );

  it.effect("a sandbox with no firewall cannot carry the credential, so nothing is cloned", () =>
    Effect.gen(function* () {
      const installation = installationOf(8);
      const { agent, target } = yield* openAgent(installation);
      const github = githubReaching([installation], undefined, {}, developerReach(false));
      const sandbox = sandboxDouble(() => undefined, { firewall: false });

      const refused = yield* checkOut(target, agent, sandbox).pipe(
        Effect.provide(github.layer),
        Effect.flip,
      );

      assert.equal(refused._tag, "CheckoutRefused");
      assert.deepEqual(sandbox.clones, []);
    }),
  );
});
