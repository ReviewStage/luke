import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@repo/database/github-installation-vocabulary";
import { workspaceSeams } from "@repo/database/models/workspace-seams";
import { agentTable } from "@repo/database/schemas/agent";
import { organization as organizationTable, session, user } from "@repo/database/schemas/auth";
import { githubInstallation } from "@repo/database/schemas/github-installation";
import { conversations } from "@repo/database/schemas/storage";
import { openMigratedPglite, openTaskAgent, sqlClientOverPglite } from "@repo/database/testing";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { accountDeletionSteps, workspaceDeletionSteps } from "../accounts/deletion-hooks.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { accountDeletionTestServices } from "../testing/account-deletion-services.js";
import { authApp } from "./auth-app.js";
import { authDatabaseAdapter } from "./auth-database.js";
import {
  accountDeletion,
  DISABLED_AUTH_PATHS,
  ORGANIZATION_OPTIONS,
  type OrganizationDeletionApi,
  workspaceDeletion,
} from "./auth-policy.js";

/**
 * An account deleted at Better Auth's own `/delete-user`, through the auth
 * route, as the Mac and the browser ask for it: Better Auth checks the
 * session is fresh, its hooks run the deletion's own steps on the route's
 * services, and the workspaces the account alone belongs to go before it.
 * One PGlite holds both Better Auth's rows and ours. Email and password
 * sign-up stands in for the Google or GitHub sign-in. Synthetic accounts
 * throughout.
 */

const BASE_URL = "http://127.0.0.1";

const decodeSignedUp = Schema.decodeUnknownSync(
  Schema.Struct({ user: Schema.Struct({ id: Schema.String }) }),
);

const decodeRefusal = Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }));

/** The auth route over a Better Auth on the PGlite given, with our account deletion and organization policy. */
const openAuthRoute = (client: Awaited<ReturnType<typeof openMigratedPglite>>) =>
  Effect.gen(function* () {
    const auth = betterAuth({
      database: authDatabaseAdapter(drizzle({ client })),
      baseURL: BASE_URL,
      secret: "account-deletion-test-secret-of-enough-length",
      emailAndPassword: { enabled: true },
      disabledPaths: [...DISABLED_AUTH_PATHS],
      user: {
        deleteUser: accountDeletion((): OrganizationDeletionApi => auth.api, accountDeletionSteps),
      },
      plugins: [
        organization({
          ...ORGANIZATION_OPTIONS,
          organizationHooks: workspaceDeletion(workspaceDeletionSteps),
        }),
      ],
    });
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      accountDeletionTestServices,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      authApp((request) => auth.handler(request), workspaceSeams(auth.api)).pipe(
        HttpRouter.provideRequest(services),
      ),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));
    const post = (path: string, body: object, cookie?: string) =>
      Effect.promise(() =>
        handler(
          new Request(`${BASE_URL}/api/auth/${path}`, {
            method: "POST",
            headers: {
              origin: BASE_URL,
              "content-type": "application/json",
              ...(cookie === undefined ? undefined : { cookie }),
            },
            body: JSON.stringify(body),
          }),
        ),
      );
    /** An account signed up and signed in: its id and the cookie its session rides on. */
    const signUp = (name: string) =>
      Effect.gen(function* () {
        const answered = yield* post("sign-up/email", {
          name,
          email: `${name}@example.com`,
          password: "a-password-long-enough",
        });
        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        const cookie = answered.headers
          .getSetCookie()
          .map((line) => line.split(";")[0])
          .join("; ");
        const { id } = decodeSignedUp(yield* Effect.promise(() => answered.json())).user;
        return { id, cookie };
      });
    return { auth, post, signUp };
  });

/** A workspace of Ada's alone, holding a GitHub connection and an agent a member who has since left ran, and one she shares with Grace. */
const openWorkspaces = (
  route: Effect.Success<ReturnType<typeof openAuthRoute>>,
  ada: string,
  grace: string,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const solo = yield* Effect.promise(() =>
      route.auth.api.createOrganization({ body: { name: "Ada", slug: "ada", userId: ada } }),
    );
    const shared = yield* Effect.promise(() =>
      route.auth.api.createOrganization({ body: { name: "Acme", slug: "acme", userId: ada } }),
    );
    assert.ok(solo && shared);
    yield* Effect.promise(() =>
      route.auth.api.addMember({
        body: { userId: grace, organizationId: shared.id, role: "member" },
      }),
    );
    const now = new Date("2099-01-01T00:00:00.000Z");
    yield* db.insert(githubInstallation).values({
      installationId: 4_200,
      organizationId: solo.id,
      accountId: 4_201,
      accountLogin: "ada",
      accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
      status: GITHUB_INSTALLATION_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
    const agentId = yield* openTaskAgent(grace, solo.id, null);
    const [agent] = yield* db
      .select({ conversationId: agentTable.conversationId })
      .from(agentTable)
      .where(eq(agentTable.id, agentId));
    assert.ok(agent);
    return { solo: solo.id, shared: shared.id, leftBehind: agent.conversationId };
  });

it.effect(
  "deleting an account at Better Auth's endpoint deletes the workspace it alone belongs to, with its GitHub connection, stamps the agents' conversations it left, and leaves a workspace others share",
  () =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
        Effect.promise(() => opened.close()),
      );
      yield* Effect.gen(function* () {
        const db = yield* Database;
        const route = yield* openAuthRoute(client);
        const ada = yield* route.signUp("ada");
        const grace = yield* route.signUp("grace");
        const { shared, leftBehind } = yield* openWorkspaces(route, ada.id, grace.id);

        const deleted = yield* route.post("delete-user", {}, ada.cookie);

        assert.equal(deleted.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(yield* db.select({ id: organizationTable.id }).from(organizationTable), [
          { id: shared },
        ]);
        assert.deepEqual(yield* db.select().from(githubInstallation), []);
        assert.deepEqual(
          yield* db.select({ id: user.id }).from(user).where(eq(user.id, ada.id)),
          [],
        );
        const [stamped] = yield* db
          .select({ deletedAt: conversations.deletedAt })
          .from(conversations)
          .where(eq(conversations.id, leftBehind));
        assert.ok(stamped?.deletedAt != null);
      }).pipe(Effect.provide(sqlClientOverPglite(client)), Effect.scoped);
    }),
);

it.effect(
  "a session signed in longer ago than Better Auth deletes for is refused as expired, and nothing is deleted",
  () =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
        Effect.promise(() => opened.close()),
      );
      yield* Effect.gen(function* () {
        const db = yield* Database;
        const route = yield* openAuthRoute(client);
        const ada = yield* route.signUp("ada");
        const grace = yield* route.signUp("grace");
        const { solo, leftBehind } = yield* openWorkspaces(route, ada.id, grace.id);
        // Ada signed in two days ago, past Better Auth's one-day fresh age.
        yield* db
          .update(session)
          .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
          .where(eq(session.userId, ada.id));

        const refused = yield* route.post("delete-user", {}, ada.cookie);

        assert.equal(refused.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
        assert.equal(
          decodeRefusal(yield* Effect.promise(() => refused.json())).code,
          "SESSION_EXPIRED",
        );
        assert.equal(
          (yield* db.select({ id: user.id }).from(user).where(eq(user.id, ada.id))).length,
          1,
        );
        assert.equal(
          (yield* db
            .select({ id: organizationTable.id })
            .from(organizationTable)
            .where(eq(organizationTable.id, solo))).length,
          1,
        );
        const [untouched] = yield* db
          .select({ deletedAt: conversations.deletedAt })
          .from(conversations)
          .where(eq(conversations.id, leftBehind));
        assert.equal(untouched?.deletedAt, null);
      }).pipe(Effect.provide(sqlClientOverPglite(client)), Effect.scoped);
    }),
);
