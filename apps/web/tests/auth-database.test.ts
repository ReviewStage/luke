import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as authSchema from "@sidecar/database/schemas/auth";
import { getTestDB, openMigratedPglite, sqlClientOverPglite } from "@sidecar/database/testing";
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

/**
 * The organization plugin over the migrated schema, reached the two
 * server-only ways a hosted route writes a workspace: created for an account
 * named by id, with no session, and joined by a second account. Its
 * invitation doors are shut, since an invitation with no mail to send would
 * only sit in the table.
 */
test("Better Auth's organization plugin creates a workspace and adds a member in the migrated schema, and serves no invitation", async () => {
  const client = await openMigratedPglite();
  const runtime = ManagedRuntime.make(Layer.mergeAll(sqlClientOverPglite(client)));
  try {
    const created = new Date("2026-10-12T00:00:00.000Z");
    await runtime.runPromise(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`insert into "user" (id, name, email, created_at, updated_at) values
          ('owner', 'Owner', 'owner@example.com', ${created}, ${created}),
          ('teammate', 'Teammate', 'teammate@example.com', ${created}, ${created})`,
      ),
    );
    const auth = betterAuth({
      database: authDatabaseAdapter(drizzle(client, { schema: authSchema })),
      baseURL: "http://127.0.0.1",
      secret: "auth-database-test-secret-with-enough-length",
      disabledPaths: [...DISABLED_AUTH_PATHS],
      plugins: [organization(ORGANIZATION_OPTIONS)],
    });

    const workspace = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme", userId: "owner" },
    });
    assert.ok(workspace);
    await auth.api.addMember({
      body: { userId: "teammate", organizationId: workspace.id, role: "member" },
    });

    const rows = await runtime.runPromise(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql`select user_id, role from member where organization_id = ${workspace.id} order by user_id`,
      ),
    );
    assert.deepEqual(
      rows.map((row) => Schema.decodeUnknownSync(MemberRowSchema)(row)),
      [
        { user_id: "owner", role: "owner" },
        { user_id: "teammate", role: "member" },
      ],
    );

    const invite = await auth.handler(
      new Request("http://127.0.0.1/api/auth/organization/invite-member", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "stranger@example.com",
          role: "member",
          organizationId: workspace.id,
        }),
      }),
    );
    assert.equal(invite.status, 404);
  } finally {
    await runtime.dispose();
    await client.close();
  }
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
