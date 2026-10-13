import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  WORKSPACE_ROLE,
  type WorkspacesAnswer,
  workspacesAnswerSchema,
} from "@sidecar/hosted/workspace-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq } from "drizzle-orm";
import { Cause, Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { member, organization, user } from "../server/db/auth-schema";
import { githubInstallation } from "../server/db/github-installation-schema";
import { GITHUB_INSTALLATION_STATUS } from "../server/db/github-installation-vocabulary";
import { db } from "../server/db/query";
import { setInstallationStatus } from "../server/hosted/github-installations";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import type { WorkspaceSeams } from "../server/hosted/workspace-seams";
import { workspacesApp } from "../server/workspaces-app";
import { type FakeGitHub, githubReaching, openGithubUser } from "./support/github-app-fake";
import { openWorkspacePlugin } from "./support/workspace-plugin";

/**
 * The account's workspaces, answered by the group the way a function
 * answers them, over Better Auth's own organization plugin on PGlite and a
 * GitHub the test scripts: the bearer names the account and nothing else
 * does, a read makes the account's personal workspace and one per GitHub
 * App installation its GitHub reaches that nobody made one for, owned by
 * it, and no later read makes another, and an installation another account
 * made a workspace for is offered to join, never joined.
 *
 * Synthetic accounts, bearers, installations, and logins throughout.
 */

const ORIGIN = "https://luke.test";
const WORKSPACES = "/api/workspaces";

const ACME = { id: 31_001, login: "acme", accountType: "Organization", repositories: [] } as const;
const OCTO = { id: 31_002, login: "octo-dev", repositories: [] } as const;
/** An installation on an account a reinstall finds again by GitHub's id for it. */
const ACME_ACCOUNT = { ...ACME, id: 31_101, accountId: 72_001 } as const;

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** An account under the name given, with no GitHub account, so its GitHub cannot be read. */
const openUser = (name: string) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name, email: `${userId}@luke.test` });
    return userId;
  });

/** An account under the name given, signed in with GitHub, its token on its account row. */
const openGithubAccount = (name: string) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    yield* db.update(user).set({ name }).where(eq(user.id, userId));
    return userId;
  });

/** One request answered by the group over the ambient database and the GitHub given, each bearer standing for the account it names. */
const ask = (seams: WorkspaceSeams, github: FakeGitHub, userId: string | undefined) =>
  Effect.gen(function* () {
    // The handler runs on the router's own fiber, so it is handed the test's clock: a GitHub token's expiry is read off it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      workspacesApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace(/^Bearer /u, "")),
          ),
        workspaces: seams,
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const request = new Request(new URL(WORKSPACES, ORIGIN), {
      headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
    });
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

/** What an answer carries, failing the test where it is not the wire's. */
function answerOf(answered: Answer): WorkspacesAnswer {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(workspacesAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

/** The workspaces of an answer without their ids, which the plugin generates. */
function namesOf(answered: WorkspacesAnswer) {
  return answered.workspaces.map(({ name, personal, role, active }) => ({
    name,
    personal,
    role,
    active,
  }));
}

const organizationIds = () => db.select({ id: organization.id }).from(organization);

it.effect("a request without a bearer is refused and makes no workspace", () =>
  Effect.gen(function* () {
    const { seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      yield* openGithubAccount("Ada Lovelace");

      const answered = yield* ask(seams, githubReaching([ACME]), undefined);

      assert.deepEqual(answered, {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
      assert.deepEqual(yield* organizationIds(), []);
    }).pipe(Effect.provide(database));
  }),
);

it.effect("the first read makes the personal workspace, and the second answers the same one", () =>
  Effect.gen(function* () {
    const { seams, database } = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount("Ada Lovelace");
      const github = githubReaching([]);

      const first = answerOf(yield* ask(seams, github, ada));
      const second = answerOf(yield* ask(seams, github, ada));

      assert.deepEqual(first, {
        workspaces: [
          {
            id: first.workspaces[0]?.id,
            name: "Ada Lovelace",
            personal: true,
            role: "owner",
            active: true,
          },
        ],
        available: [],
      });
      assert.deepEqual(second, first);
      assert.deepEqual(
        yield* db
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, first.workspaces[0]?.id ?? "")),
        [{ slug: `personal-${ada}` }],
      );
    }).pipe(Effect.provide(database));
  }),
);

it.effect(
  "a read makes one workspace per installation the account's GitHub reaches, owned by it, and the second read makes none",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const github = githubReaching([ACME, OCTO]);

        const first = answerOf(yield* ask(seams, github, ada));
        const made = yield* organizationIds();
        const second = answerOf(yield* ask(seams, github, ada));

        assert.deepEqual(namesOf(first), [
          { name: "Ada Lovelace", personal: true, role: WORKSPACE_ROLE.OWNER, active: true },
          { name: "acme", personal: false, role: WORKSPACE_ROLE.OWNER, active: true },
          { name: "octo-dev", personal: false, role: WORKSPACE_ROLE.OWNER, active: true },
        ]);
        assert.deepEqual(first.available, []);
        assert.deepEqual(second, first);
        assert.equal(made.length, 3);
        assert.deepEqual(yield* organizationIds(), made);
        assert.deepEqual(
          yield* db
            .select({
              organizationId: githubInstallation.organizationId,
              accountLogin: githubInstallation.accountLogin,
              accountType: githubInstallation.accountType,
              status: githubInstallation.status,
            })
            .from(githubInstallation)
            .where(eq(githubInstallation.installationId, ACME.id)),
          [
            {
              organizationId: first.workspaces[1]?.id,
              accountLogin: "acme",
              accountType: "Organization",
              status: "active",
            },
          ],
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "an installation another account made a workspace for is offered to join, and the read joins nobody to it",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const github = githubReaching([ACME]);
        const adas = answerOf(yield* ask(seams, github, ada));
        const acme = adas.workspaces[1]?.id ?? assert.fail("no workspace for the installation");

        const graces = answerOf(yield* ask(seams, github, grace));

        assert.deepEqual(namesOf(graces), [
          { name: "Grace Hopper", personal: true, role: WORKSPACE_ROLE.OWNER, active: true },
        ]);
        assert.deepEqual(graces.available, [{ installationId: ACME.id, name: "acme" }]);
        assert.deepEqual(
          yield* db
            .select({ userId: member.userId, role: member.role })
            .from(member)
            .where(eq(member.organizationId, acme)),
          [{ userId: ada, role: WORKSPACE_ROLE.OWNER }],
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "an organization someone else made under an installation's login is never adopted by the installation's sync",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const mallory = yield* openUser("Mallory");
        const ada = yield* openGithubAccount("Ada Lovelace");
        const squatted = yield* Effect.promise(() =>
          api.createOrganization({ body: { name: "acme", slug: "acme", userId: mallory } }),
        );

        const adas = answerOf(yield* ask(seams, githubReaching([ACME_ACCOUNT]), ada));

        const acme = adas.workspaces[1];
        assert.deepEqual(
          { name: acme?.name, role: acme?.role, active: acme?.active },
          { name: "acme", role: WORKSPACE_ROLE.OWNER, active: true },
        );
        assert.notEqual(acme?.id, squatted.id);
        assert.deepEqual(
          yield* db
            .select({ slug: organization.slug, installationId: githubInstallation.installationId })
            .from(organization)
            .leftJoin(githubInstallation, eq(githubInstallation.organizationId, organization.id))
            .where(eq(organization.id, acme?.id ?? "")),
          [{ slug: `acme-${ACME_ACCOUNT.accountId}`, installationId: ACME_ACCOUNT.id }],
        );
        assert.deepEqual(
          yield* db
            .select({ userId: member.userId })
            .from(member)
            .where(eq(member.organizationId, squatted.id)),
          [{ userId: mallory }],
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "a reinstall on the same GitHub account brings back the workspace the removed installation left, its members with it",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubAccount("Ada Lovelace");
        const grace = yield* openGithubAccount("Grace Hopper");
        const first = answerOf(yield* ask(seams, githubReaching([ACME_ACCOUNT]), ada));
        const acme = first.workspaces[1]?.id ?? assert.fail("no workspace for the installation");
        yield* Effect.promise(() =>
          api.addMember({ body: { userId: grace, organizationId: acme, role: "member" } }),
        );
        yield* setInstallationStatus(ACME_ACCOUNT.id, GITHUB_INSTALLATION_STATUS.DELETED);
        const made = yield* organizationIds();
        const reinstalled = { ...ACME_ACCOUNT, id: ACME_ACCOUNT.id + 1 };

        const adas = answerOf(yield* ask(seams, githubReaching([reinstalled]), ada));
        const graces = answerOf(yield* ask(seams, githubReaching([reinstalled]), grace));

        assert.deepEqual(adas.workspaces.map(({ id, role }) => ({ id, role })).slice(1), [
          { id: acme, role: WORKSPACE_ROLE.OWNER },
        ]);
        assert.deepEqual(graces.workspaces.map(({ id, role }) => ({ id, role })).slice(1), [
          { id: acme, role: WORKSPACE_ROLE.MEMBER },
        ]);
        // Grace's personal workspace, made by her first read, is the one organization the reinstall reads add.
        assert.equal((yield* organizationIds()).length, made.length + 1);
        assert.deepEqual(
          yield* db
            .select({
              installationId: githubInstallation.installationId,
              status: githubInstallation.status,
            })
            .from(githubInstallation)
            .where(eq(githubInstallation.organizationId, acme)),
          [{ installationId: reinstalled.id, status: GITHUB_INSTALLATION_STATUS.ACTIVE }],
        );
      }).pipe(Effect.provide(database));
    }),
);

it.effect(
  "an account whose GitHub cannot be read still sees its workspaces, a shared one with its role, and nothing to join",
  () =>
    Effect.gen(function* () {
      const { api, seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openUser("Ada Lovelace");
        const grace = yield* openUser("Grace Hopper");
        const acme = yield* Effect.promise(() =>
          api.createOrganization({ body: { name: "Acme", slug: "acme-team", userId: ada } }),
        );
        yield* Effect.promise(() =>
          api.addMember({ body: { userId: grace, organizationId: acme.id, role: "member" } }),
        );

        const graces = answerOf(yield* ask(seams, githubReaching([ACME]), grace));

        assert.deepEqual(namesOf(graces), [
          { name: "Grace Hopper", personal: true, role: WORKSPACE_ROLE.OWNER, active: true },
          { name: "Acme", personal: false, role: WORKSPACE_ROLE.MEMBER, active: true },
        ]);
        assert.equal(graces.workspaces[1]?.id, acme.id);
        assert.deepEqual(graces.available, []);
      }).pipe(Effect.provide(database));
    }),
);

it.effect("a plugin that refuses the personal workspace is answered as unavailable", () =>
  Effect.gen(function* () {
    const { database } = yield* openWorkspacePlugin;
    const refusing: WorkspaceSeams = {
      createOrganization: () =>
        Effect.fail(new Cause.UnknownError(undefined, "Failed to create organization")),
    };
    yield* Effect.gen(function* () {
      const ada = yield* openGithubAccount("Ada Lovelace");

      const answered = yield* ask(refusing, githubReaching([]), ada);

      assert.deepEqual(answered, {
        status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        body: { error: HOSTED_API_ERROR.UNAVAILABLE },
      });
    }).pipe(Effect.provide(database));
  }),
);
