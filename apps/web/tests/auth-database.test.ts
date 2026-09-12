import assert from "node:assert/strict";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { test } from "vitest";
import {
  ACCOUNT_TOKEN_STORAGE,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
} from "../server/auth-policy";
import {
  DESKTOP_OAUTH_CLIENT,
  MOBILE_OAUTH_CLIENT,
  oauthClientRecord,
} from "../server/oauth-clients";
import { seedOAuthClient } from "../server/seed-clients";
import { testSqlClient } from "./support/sql-client";

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

  it.effect(
    "mobile client seeding updates the one client identity instead of creating another",
    () =>
      Effect.gen(function* () {
        const opened = new Date("2026-08-17T00:00:00.000Z");
        yield* seedOAuthClient(MOBILE_OAUTH_CLIENT, opened);
        const [seeded] = yield* readOAuthClient(MOBILE_OAUTH_CLIENT.id);
        assert.ok(seeded);
        assert.deepEqual(seeded, {
          id: MOBILE_OAUTH_CLIENT.id,
          client_id: MOBILE_OAUTH_CLIENT.id,
          disabled: false,
          skip_consent: true,
          enable_end_session: false,
          scopes: ["openid", "profile", "email", "offline_access"],
          name: "Luke for iOS",
          redirect_uris: ["dev.tryluke.ios://oauth/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          public: true,
          type: "native",
          require_pkce: true,
        });

        const updated = new Date("2026-08-18T00:00:00.000Z");
        yield* seedOAuthClient(MOBILE_OAUTH_CLIENT, updated);
        const rows = yield* readOAuthClient(MOBILE_OAUTH_CLIENT.id);
        assert.equal(rows.length, 1);
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

test("the mobile client stays public, secretless, trusted, and bound to PKCE", () => {
  const now = new Date("2026-08-17T00:00:00.000Z");
  const record = oauthClientRecord(MOBILE_OAUTH_CLIENT, now);

  assert.equal(record.id, MOBILE_OAUTH_CLIENT.id);
  assert.equal(record.clientId, MOBILE_OAUTH_CLIENT.id);
  assert.equal("clientSecret" in record, false);
  assert.equal(record.public, true);
  assert.equal(record.requirePKCE, true);
  assert.equal(record.skipConsent, true);
  assert.deepEqual(record.redirectUris, ["dev.tryluke.ios://oauth/callback"]);
  assert.deepEqual(record.grantTypes, ["authorization_code", "refresh_token"]);
  assert.deepEqual(record.scopes, ["openid", "profile", "email", "offline_access"]);
  assert.equal(record.createdAt, now);
  assert.equal(record.updatedAt, now);
});

test("mobile client uses a custom URI scheme, not a loopback address", () => {
  const [redirectUri] = MOBILE_OAUTH_CLIENT.redirectUris;
  const url = new URL(redirectUri);
  assert.notEqual(url.protocol, "http:");
  assert.notEqual(url.protocol, "https:");
});
