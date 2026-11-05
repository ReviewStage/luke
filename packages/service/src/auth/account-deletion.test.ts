import assert from "node:assert/strict";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@repo/database/github-installation-vocabulary";
import { openMigratedPglite } from "@repo/database/testing";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { test } from "vitest";
import { authDatabaseAdapter } from "./auth-database.js";
import {
  accountDeletion,
  DISABLED_AUTH_PATHS,
  ORGANIZATION_OPTIONS,
  type OrganizationDeletionApi,
} from "./auth-policy.js";

/**
 * An account deleted through Better Auth's own `deleteUser`, on our account
 * deletion and organization policy over a migrated PGlite, as the delete
 * procedure calls it: under the account's session, handed the request that
 * session rides on. Email and password sign-up stands in for the Google or
 * GitHub sign-in. Synthetic accounts throughout.
 */

const BASE_URL = "http://127.0.0.1";

function deletionAuth(client: Awaited<ReturnType<typeof openMigratedPglite>>) {
  const auth = betterAuth({
    database: authDatabaseAdapter(drizzle({ client })),
    baseURL: BASE_URL,
    secret: "account-deletion-test-secret-of-enough-length",
    emailAndPassword: { enabled: true },
    disabledPaths: [...DISABLED_AUTH_PATHS],
    user: { deleteUser: accountDeletion((): OrganizationDeletionApi => auth.api) },
    plugins: [organization(ORGANIZATION_OPTIONS)],
  });
  return auth;
}

type Auth = ReturnType<typeof deletionAuth>;

/** An account signed up and signed in: its id and the session its cookie carries, as headers. */
async function signUp(auth: Auth, name: string) {
  const { headers, response } = await auth.api.signUpEmail({
    body: { name, email: `${name}@example.com`, password: "a-password-long-enough" },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  return { id: response.user.id, session: new Headers({ cookie }) };
}

test("deleting an account deletes the workspace it alone belongs to, with its GitHub connection, and leaves a workspace others share", async () => {
  const client = await openMigratedPglite();
  try {
    const auth = deletionAuth(client);
    const ada = await signUp(auth, "ada");
    const grace = await signUp(auth, "grace");
    const solo = await auth.api.createOrganization({
      body: { name: "Ada", slug: "ada", userId: ada.id },
    });
    const shared = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme", userId: ada.id },
    });
    assert.ok(solo && shared);
    await auth.api.addMember({
      body: { userId: grace.id, organizationId: shared.id, role: "member" },
    });
    await client.query(
      `insert into github_installation
         (installation_id, organization_id, account_id, account_login, account_type, status, created_at, updated_at)
       values (4200, $1, 4201, 'ada', $2, $3, now(), now())`,
      [solo.id, GITHUB_ACCOUNT_TYPE.ORGANIZATION, GITHUB_INSTALLATION_STATUS.ACTIVE],
    );

    await auth.api.deleteUser({
      headers: ada.session,
      body: {},
      request: new Request(`${BASE_URL}/api/auth/delete-user`, { headers: ada.session }),
    });

    const workspaces = await client.query<{ id: string }>("select id from organization");
    assert.deepEqual(workspaces.rows, [{ id: shared.id }]);
    const installations = await client.query("select installation_id from github_installation");
    assert.deepEqual(installations.rows, []);
    const context = await auth.$context;
    assert.equal(await context.internalAdapter.findUserById(ada.id), null);
    const members = await auth.api.listMembers({
      headers: grace.session,
      query: { organizationId: shared.id },
    });
    assert.deepEqual(
      members.members.map(({ userId }) => userId),
      [grace.id],
    );
  } finally {
    await client.close();
  }
});
