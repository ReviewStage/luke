import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@sidecar/database/testing";
import { Effect, Schema } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { test } from "vitest";
import {
  ACCOUNT_TOKEN_STORAGE,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
} from "../server/auth-policy";
import { DESKTOP_OAUTH_CLIENT, oauthClientRecord } from "../server/oauth-clients";

const AUTH_TABLE_NAME = {
  ACCOUNT: "account",
  JWKS: "jwks",
  OAUTH_ACCESS_TOKEN: "oauth_access_token",
  OAUTH_CLIENT: "oauth_client",
  OAUTH_CONSENT: "oauth_consent",
  OAUTH_REFRESH_TOKEN: "oauth_refresh_token",
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
