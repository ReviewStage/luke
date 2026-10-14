import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB, openMigratedPglite, sqlClientOverPglite } from "@luke/database/testing";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { test } from "vitest";
import { authDatabaseAdapter } from "../server/auth-database";
import {
  ACCOUNT_TOKEN_STORAGE,
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
  ORGANIZATION_OPTIONS,
} from "../server/auth-policy";
import { DESKTOP_OAUTH_CLIENT, oauthClientRecord } from "../server/oauth-clients";

const AUTH_TABLE_NAME = {
  ACCOUNT: "account",
  INVITATION: "invitation",
  JWKS: "jwks",
  MEMBER: "member",
  OAUTH_ACCESS_TOKEN: "oauth_access_token",
  OAUTH_CLIENT: "oauth_client",
  OAUTH_CONSENT: "oauth_consent",
  OAUTH_REFRESH_TOKEN: "oauth_refresh_token",
  ORGANIZATION: "organization",
  SESSION: "session",
  USER: "user",
  VERIFICATION: "verification",
} as const;

const NameRowSchema = Schema.Struct({ name: Schema.String });

it.layer(getTestDB())("the auth service's own tables", (it) => {
  it.effect("every table the auth service uses stands in the migrated schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        select table_name as name from information_schema.tables
        where table_schema = 'public' and table_name = any(${Object.values(AUTH_TABLE_NAME)})
      `;
      assert.deepEqual(
        rows.map((row) => Schema.decodeUnknownSync(NameRowSchema)(row).name).sort(),
        Object.values(AUTH_TABLE_NAME).sort(),
      );
    }),
  );
});

const MemberRowSchema = Schema.Struct({ user_id: Schema.String, role: Schema.String });

const SlugRowSchema = Schema.Struct({ slug: Schema.String });

/** What Better Auth answers when a call is refused: its error code, on the body. */
const RefusalSchema = Schema.Struct({ body: Schema.Struct({ code: Schema.String }) });

/** What a browser posts to an organization endpoint: flat fields, and `update`'s nested `data`. */
type OrganizationWriteBody = Readonly<Record<string, string | Readonly<Record<string, string>>>>;

/** Every organization write a signed-in browser could ask for over HTTP, with a body it would send. */
const ORGANIZATION_WRITES: ReadonlyArray<{
  readonly path: string;
  readonly body: OrganizationWriteBody;
}> = [
  { path: "/organization/create", body: { name: "Acme", slug: "acme" } },
  { path: "/organization/check-slug", body: { slug: "acme" } },
  { path: "/organization/update", body: { data: { slug: "acme" } } },
  { path: "/organization/delete", body: {} },
  { path: "/organization/set-active", body: {} },
  { path: "/organization/remove-member", body: { memberIdOrEmail: "owner@example.com" } },
  { path: "/organization/update-member-role", body: { memberId: "member", role: "owner" } },
  { path: "/organization/leave", body: {} },
];

/** An account signed up through the server API, and the cookie its sign-up set. */
interface SignedUpAccount {
  readonly id: string;
  readonly cookie: string;
}

/**
 * Luke's own organization policy over a migrated PGlite. Email and password
 * sign-up is on in this instance alone: it is Better Auth's documented
 * server call that both saves an account and signs it in, which is all the
 * test needs of an account, and Luke's own instance signs in through its
 * social providers instead.
 */
function organizationAuth(client: Awaited<ReturnType<typeof openMigratedPglite>>) {
  return betterAuth({
    database: authDatabaseAdapter(drizzle({ client })),
    baseURL: "http://127.0.0.1",
    secret: "auth-database-test-secret-with-enough-length",
    emailAndPassword: { enabled: true },
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [organization(ORGANIZATION_OPTIONS)],
  });
}

async function signUp(
  auth: ReturnType<typeof organizationAuth>,
  name: string,
): Promise<SignedUpAccount> {
  const { headers, response } = await auth.api.signUpEmail({
    body: { name, email: `${name}@example.com`, password: "a-password-long-enough" },
    returnHeaders: true,
  });
  // A browser sends back each cookie's name and value, and none of its attributes.
  const cookie = headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  return { id: response.user.id, cookie };
}

async function withOrganizationAuth(
  body: (fixture: {
    readonly auth: ReturnType<typeof organizationAuth>;
    readonly readRows: <A>(
      statement: Effect.Effect<ReadonlyArray<unknown>, unknown, SqlClient.SqlClient>,
      schema: Schema.Codec<A>,
    ) => Promise<ReadonlyArray<A>>;
  }) => Promise<void>,
): Promise<void> {
  const client = await openMigratedPglite();
  const runtime = ManagedRuntime.make(Layer.mergeAll(sqlClientOverPglite(client)));
  try {
    await body({
      auth: organizationAuth(client),
      readRows: async (statement, schema) =>
        (await runtime.runPromise(statement)).map((row) => Schema.decodeUnknownSync(schema)(row)),
    });
  } finally {
    await runtime.dispose();
    await client.close();
  }
}

function postAuth(path: string, cookie: string, body: OrganizationWriteBody): Request {
  return new Request(`http://127.0.0.1/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1", cookie },
    body: JSON.stringify(body),
  });
}

/**
 * The organization plugin over the migrated schema, reached the two
 * server-only ways a hosted route writes a workspace: created for an account
 * named by id, with no session, and joined by a second account.
 */
test("Better Auth's organization plugin creates a workspace and adds a member in the migrated schema from the server", async () => {
  await withOrganizationAuth(async ({ auth, readRows }) => {
    const owner = await signUp(auth, "owner");
    const teammate = await signUp(auth, "teammate");
    const workspace = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme", userId: owner.id },
    });
    assert.ok(workspace);
    await auth.api.addMember({
      body: { userId: teammate.id, organizationId: workspace.id, role: "member" },
    });

    const rows = await readRows(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql`select user_id, role from member where organization_id = ${workspace.id} order by created_at`,
      ),
      MemberRowSchema,
    );
    assert.deepEqual(rows, [
      { user_id: owner.id, role: "owner" },
      { user_id: teammate.id, role: "member" },
    ]);
  });
});

/**
 * A slug is what a workspace is adopted by, so a signed-in browser that
 * could create an organization, or rename its own, could take a team's slug
 * before the team arrives. The owner of a workspace of their own, signed in,
 * reaches no organization write over HTTP, and is refused the create even
 * through the server API when the call carries their session.
 */
test("a signed-in account creates, renames, and joins no organization over HTTP, and creates none with its session", async () => {
  await withOrganizationAuth(async ({ auth, readRows }) => {
    const intruder = await signUp(auth, "intruder");
    const own = await auth.api.createOrganization({
      body: { name: "Intruder", slug: "intruder", userId: intruder.id },
    });
    assert.ok(own);

    for (const write of ORGANIZATION_WRITES) {
      const answer = await auth.handler(
        postAuth(write.path, intruder.cookie, { organizationId: own.id, ...write.body }),
      );
      assert.equal(answer.status, 404, write.path);
    }

    const refusal = await auth.api
      .createOrganization({
        headers: new Headers({ cookie: intruder.cookie }),
        body: { name: "Acme", slug: "acme" },
      })
      .then(() => undefined, Schema.decodeUnknownSync(RefusalSchema));
    assert.equal(refusal?.body.code, "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION");

    const slugs = await readRows(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`select slug from organization order by slug`,
      ),
      SlugRowSchema,
    );
    assert.deepEqual(slugs, [{ slug: "intruder" }]);
  });
});

test("the auth service encrypts credentials and refuses user-provisioned OAuth clients", () => {
  assert.equal(ACCOUNT_TOKEN_STORAGE.encryptOAuthTokens, true);
  assert.equal(JWT_KEY_STORAGE.jwks.disablePrivateKeyEncryption, false);
  assert.equal(denyOAuthClientPrivileges(), false);
});

test("the desktop client stays public, secretless, trusted, and bound to PKCE", () => {
  const now = new Date("2026-08-17T00:00:00.000Z");
  const record = oauthClientRecord(DESKTOP_OAUTH_CLIENT, now);

  assert.equal(record.id, DESKTOP_OAUTH_CLIENT.id);
  assert.equal(record.clientId, DESKTOP_OAUTH_CLIENT.id);
  assert.equal("clientSecret" in record, false);
  assert.equal(record.public, true);
  assert.equal(record.requirePKCE, true);
  assert.equal(record.skipConsent, true);
  assert.deepEqual(record.redirectUris, ["http://127.0.0.1/callback"]);
  assert.deepEqual(record.grantTypes, ["authorization_code", "refresh_token"]);
  assert.deepEqual(record.scopes, ["openid", "profile", "email", "offline_access"]);
  assert.equal(record.createdAt, now);
  assert.equal(record.updatedAt, now);
});
