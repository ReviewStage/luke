import assert from "node:assert/strict";
import { oauthProvider } from "@better-auth/oauth-provider";
import { it } from "@effect/vitest";
import { betterAuth } from "better-auth";
import { symmetricEncrypt } from "better-auth/crypto";
import { jwt, organization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { test } from "vitest";
import { authDatabaseAdapter } from "../server/auth-database";
import {
  ACCOUNT_TOKEN_STORAGE,
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
  ORGANIZATION_OPTIONS,
} from "../server/auth-policy";
import * as authSchema from "../server/db/auth-schema";
import { DESKTOP_OAUTH_CLIENT, oauthClientRecord } from "../server/oauth-clients";
import { dropUnreadableJwks, seedOAuthClient } from "../server/seed-clients";
import { openMigratedPglite, sqlClientOverPglite, testSqlClient } from "./support/sql-client";

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

const OAuthClientRowSchema = Schema.Struct({
  id: Schema.String,
  client_id: Schema.String,
  disabled: Schema.Boolean,
  skip_consent: Schema.Boolean,
  enable_end_session: Schema.Boolean,
  scopes: Schema.Array(Schema.String),
  name: Schema.String,
  redirect_uris: Schema.Array(Schema.String),
  token_endpoint_auth_method: Schema.String,
  grant_types: Schema.Array(Schema.String),
  response_types: Schema.Array(Schema.String),
  public: Schema.Boolean,
  type: Schema.String,
  require_pkce: Schema.Boolean,
});

function readOAuthClient(clientId: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql`select * from oauth_client where client_id = ${clientId}`;
    return rows.map((row) => Schema.decodeUnknownSync(OAuthClientRowSchema)(row));
  });
}

it.layer(testSqlClient)("the auth service's own tables", (it) => {
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

  it.effect("seeding updates the one client identity instead of creating another", () =>
    Effect.gen(function* () {
      const opened = new Date("2026-08-17T00:00:00.000Z");
      yield* seedOAuthClient(DESKTOP_OAUTH_CLIENT, opened);
      const [seeded] = yield* readOAuthClient(DESKTOP_OAUTH_CLIENT.id);
      assert.ok(seeded);
      assert.deepEqual(seeded, {
        id: DESKTOP_OAUTH_CLIENT.id,
        client_id: DESKTOP_OAUTH_CLIENT.id,
        disabled: false,
        skip_consent: true,
        enable_end_session: false,
        scopes: ["openid", "profile", "email", "offline_access"],
        name: "Luke for macOS",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        public: true,
        type: "native",
        require_pkce: true,
      });

      const updated = new Date("2026-08-18T00:00:00.000Z");
      yield* seedOAuthClient(DESKTOP_OAUTH_CLIENT, updated);
      const rows = yield* readOAuthClient(DESKTOP_OAUTH_CLIENT.id);
      assert.equal(rows.length, 1);
    }),
  );

  // A Preview's branch database carries production's key, sealed under a
  // secret the Preview never holds; the seed leaves only what this
  // deployment can sign with.
  it.effect("seeding drops the signing keys sealed under another deployment's secret", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const own = Redacted.make("this-deployment-secret");
      const sealedHere = yield* Effect.promise(() =>
        symmetricEncrypt({
          key: Redacted.value(own),
          data: JSON.stringify({ kty: "OKP", d: "own" }),
        }),
      );
      const sealedElsewhere = yield* Effect.promise(() =>
        symmetricEncrypt({
          key: "production-secret",
          data: JSON.stringify({ kty: "OKP", d: "other" }),
        }),
      );
      const created = new Date("2026-08-17T06:02:37.421Z");
      yield* sql`insert into jwks (id, public_key, private_key, created_at) values
        ('readable', '{}', ${JSON.stringify(sealedHere)}, ${created}),
        ('inherited', '{}', ${JSON.stringify(sealedElsewhere)}, ${created})`;

      yield* dropUnreadableJwks(own);

      const rows = yield* sql`select id as name from jwks order by id`;
      assert.deepEqual(
        rows.map((row) => Schema.decodeUnknownSync(NameRowSchema)(row).name),
        ["readable"],
      );
    }),
  );
});

const AccessTokenRowSchema = Schema.Struct({
  token: Schema.String,
  client_id: Schema.String,
  scopes: Schema.Array(Schema.String),
});

const ISSUED_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

/** What the adapter answers for the row: its scopes as an array and its instants as `Date`s. */
const StoredAccessTokenSchema = Schema.Struct({
  scopes: Schema.Array(Schema.String),
  createdAt: Schema.Date,
  expiresAt: Schema.Date,
});

/**
 * The write every sign-in ends on, taken through Better Auth's own adapter
 * rather than the seeder's raw statement: the token exchange stores the
 * access token with its `scopes`, a `string[]` field whose stored shape is
 * the adapter's decision and not the schema's, and this is the one write in
 * the test suite that would notice the two disagreeing.
 */
test("Better Auth's own adapter writes an access token's scopes into the migrated schema and reads them back", async () => {
  const client = await openMigratedPglite();
  const runtime = ManagedRuntime.make(Layer.mergeAll(sqlClientOverPglite(client)));
  try {
    await runtime.runPromise(seedOAuthClient(DESKTOP_OAUTH_CLIENT));
    const auth = betterAuth({
      database: authDatabaseAdapter(drizzle(client, { schema: authSchema })),
      baseURL: "http://127.0.0.1",
      secret: "auth-database-test-secret-with-enough-length",
      plugins: [
        jwt(JWT_KEY_STORAGE),
        oauthProvider({
          loginPage: "/sign-in.html",
          consentPage: "/consent.html",
          allowDynamicClientRegistration: false,
        }),
      ],
    });
    const context = await auth.$context;
    const issued = new Date("2026-09-12T00:00:00.000Z");
    const expires = new Date(issued.getTime() + 60 * 60 * 1000);
    const token = "access-token-under-test";
    await context.adapter.create({
      model: "oauthAccessToken",
      data: {
        token,
        clientId: DESKTOP_OAUTH_CLIENT.id,
        scopes: [...ISSUED_SCOPES],
        createdAt: issued,
        expiresAt: expires,
      },
    });

    const stored = await context.adapter.findOne({
      model: "oauthAccessToken",
      where: [{ field: "token", value: token }],
    });
    assert.ok(stored);
    const decoded = Schema.decodeUnknownSync(StoredAccessTokenSchema)(stored);
    assert.deepEqual(decoded.scopes, [...ISSUED_SCOPES]);
    assert.deepEqual(
      [decoded.createdAt.getTime(), decoded.expiresAt.getTime()],
      [issued.getTime(), expires.getTime()],
    );

    const rows = await runtime.runPromise(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql`select token, client_id, scopes from oauth_access_token where token = ${token}`,
      ),
    );
    assert.deepEqual(
      rows.map((row) => Schema.decodeUnknownSync(AccessTokenRowSchema)(row)),
      [{ token, client_id: DESKTOP_OAUTH_CLIENT.id, scopes: [...ISSUED_SCOPES] }],
    );
  } finally {
    await runtime.dispose();
    await client.close();
  }
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
  {
    path: "/organization/invite-member",
    body: { email: "stranger@example.com", role: "member" },
  },
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
    database: authDatabaseAdapter(drizzle(client, { schema: authSchema })),
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
