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
import {
  DESKTOP_OAUTH_CLIENT,
  MOBILE_OAUTH_CLIENT,
  oauthClientRecord,
} from "../server/oauth-clients";
import { seedOAuthClient } from "../server/seed-clients";

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

test("seeding updates the one client identity instead of creating another", async () => {
  let insertedTable: typeof oauthClient | undefined;
  let insertedRecord: ReturnType<typeof oauthClientRecord> | undefined;
  let conflict: { target?: unknown; set?: unknown } | undefined;
  type SeedDatabase = Parameters<typeof seedOAuthClient>[0];
  // SAFETY: Test double implements only the insert chain seedOAuthClient exercises.
  const database = {
    insert(table: typeof oauthClient) {
      insertedTable = table;
      return {
        values(record: ReturnType<typeof oauthClientRecord>) {
          insertedRecord = record;
          return {
            async onConflictDoUpdate(input: { target?: unknown; set?: unknown }) {
              conflict = input;
            },
          };
        },
      };
    },
  } as unknown as SeedDatabase;

  const now = new Date("2026-08-17T00:00:00.000Z");
  await seedOAuthClient(database, DESKTOP_OAUTH_CLIENT, now);

  assert.equal(insertedTable, oauthClient);
  assert.deepEqual(insertedRecord, oauthClientRecord(DESKTOP_OAUTH_CLIENT, now));
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
  assert.ok(
    url.protocol.endsWith(":") &&
      !["http:", "https:", "javascript:", "data:", "vbscript:"].includes(url.protocol),
    "redirect URI must use a custom scheme",
  );
});

test("mobile client seeding updates the one client identity instead of creating another", async () => {
  let insertedTable: typeof oauthClient | undefined;
  let insertedRecord: ReturnType<typeof oauthClientRecord> | undefined;
  let conflict: { target?: unknown; set?: unknown } | undefined;
  type SeedDatabase = Parameters<typeof seedOAuthClient>[0];
  // SAFETY: Test double implements only the insert chain seedOAuthClient exercises.
  const database = {
    insert(table: typeof oauthClient) {
      insertedTable = table;
      return {
        values(record: ReturnType<typeof oauthClientRecord>) {
          insertedRecord = record;
          return {
            async onConflictDoUpdate(input: { target?: unknown; set?: unknown }) {
              conflict = input;
            },
          };
        },
      };
    },
  } as unknown as SeedDatabase;

  const now = new Date("2026-08-17T00:00:00.000Z");
  await seedOAuthClient(database, MOBILE_OAUTH_CLIENT, now);

  assert.equal(insertedTable, oauthClient);
  assert.deepEqual(insertedRecord, oauthClientRecord(MOBILE_OAUTH_CLIENT, now));
  assert.equal(conflict?.target, oauthClient.clientId);
  assert.deepEqual(conflict?.set, {
    disabled: false,
    skipConsent: true,
    enableEndSession: false,
    scopes: ["openid", "profile", "email", "offline_access"],
    updatedAt: now,
    name: "Luke for iOS",
    redirectUris: ["dev.tryluke.ios://oauth/callback"],
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    public: true,
    type: "native",
    requirePKCE: true,
  });
});
