import assert from "node:assert/strict";
import test from "node:test";
import { getTableName } from "drizzle-orm";
import {
  ACCOUNT_TOKEN_STORAGE,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
} from "../server/auth-policy";
import {
  account,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  session,
  user,
  verification,
} from "../server/db/auth-schema";
import { DESKTOP_OAUTH_CLIENT, desktopOAuthClientRecord } from "../server/desktop-oauth-client";
import { seedDesktopOAuthClient } from "../server/seed-desktop-client";

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

test("the generated schema carries every table the auth service uses", () => {
  assert.deepEqual(
    [
      account,
      jwks,
      oauthAccessToken,
      oauthClient,
      oauthConsent,
      oauthRefreshToken,
      session,
      user,
      verification,
    ].map(getTableName),
    Object.values(AUTH_TABLE_NAME),
  );
});

test("the auth service encrypts credentials and refuses user-provisioned OAuth clients", () => {
  assert.equal(ACCOUNT_TOKEN_STORAGE.encryptOAuthTokens, true);
  assert.equal(JWT_KEY_STORAGE.jwks.disablePrivateKeyEncryption, false);
  assert.equal(denyOAuthClientPrivileges(), false);
});

test("the desktop client stays public, secretless, trusted, and bound to PKCE", () => {
  const now = new Date("2026-08-17T00:00:00.000Z");
  const record = desktopOAuthClientRecord(now);

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

test("seeding updates the one client identity instead of creating another", async () => {
  let insertedTable: unknown;
  let insertedRecord: unknown;
  let conflict: { target?: unknown; set?: unknown } | undefined;
  const database = {
    insert(table: unknown) {
      insertedTable = table;
      return {
        values(record: unknown) {
          insertedRecord = record;
          return {
            async onConflictDoUpdate(input: { target?: unknown; set?: unknown }) {
              conflict = input;
            },
          };
        },
      };
    },
  };

  const now = new Date("2026-08-17T00:00:00.000Z");
  await seedDesktopOAuthClient(
    database as unknown as Parameters<typeof seedDesktopOAuthClient>[0],
    now,
  );

  assert.equal(insertedTable, oauthClient);
  assert.deepEqual(insertedRecord, desktopOAuthClientRecord(now));
  assert.equal(conflict?.target, oauthClient.clientId);
  assert.deepEqual(conflict?.set, {
    disabled: false,
    skipConsent: true,
    enableEndSession: false,
    scopes: ["openid", "profile", "email", "offline_access"],
    updatedAt: now,
    name: "Luke for macOS",
    redirectUris: ["http://127.0.0.1/callback"],
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    public: true,
    type: "native",
    requirePKCE: true,
  });
});
