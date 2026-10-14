import assert from "node:assert/strict";
import { openMigratedPglite } from "@sidecar/database/testing";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/pglite";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { authDatabaseAdapter } from "../server/auth-database";
import { authSecrets } from "../server/auth-deployment";

/**
 * The deployment's ways in, the providers `auth.ts` hands Better Auth, stood
 * up over a migrated PGlite database: a Google press and a GitHub press each
 * start their own provider's authorization. Workspaces come from GitHub, and
 * an account made with Google links GitHub to itself rather than losing the
 * sign-in it was made with.
 *
 * Synthetic client ids and secrets; nothing leaves the process, since starting
 * a sign-in only builds the provider's authorize URL.
 */

const BASE_URL = "http://127.0.0.1";

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

const REGISTERED = {
  GOOGLE_CLIENT_ID: "fixture-google-client",
  GOOGLE_CLIENT_SECRET: "fixture-google-secret",
  GITHUB_APP_CLIENT_ID: "Iv1.fixture-app-client",
  GITHUB_APP_CLIENT_SECRET: "fixture-app-client-secret",
} as const;

beforeEach(() => {
  // The module builds the deployment's own service as it loads, which reads these.
  vi.stubEnv("DATABASE_URL", "postgresql://auth:providers@127.0.0.1:5432/luke");
  vi.stubEnv("BETTER_AUTH_SECRET", "fixture-session-secret-of-enough-length");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("a Google press and a GitHub press each start their own provider's sign-in", async () => {
  const { socialProviders } = await import("../server/auth");
  const client = await openMigratedPglite();
  try {
    const auth = betterAuth({
      baseURL: BASE_URL,
      secret: "auth-sign-in-providers-test-secret-of-enough-length",
      database: authDatabaseAdapter(drizzle({ client })),
      socialProviders: socialProviders(authSecrets(REGISTERED)),
    });
    const start = async (provider: string) => {
      const response = await auth.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { origin: BASE_URL, "content-type": "application/json" },
          body: JSON.stringify({ provider, callbackURL: "/" }),
        }),
      );
      assert.equal(response.status, 200, provider);
      const authorize = new URL(decodeStarted(await response.json()).url);
      return { at: authorize.origin, clientId: authorize.searchParams.get("client_id") };
    };

    assert.deepEqual(await start("google"), {
      at: "https://accounts.google.com",
      clientId: REGISTERED.GOOGLE_CLIENT_ID,
    });
    assert.deepEqual(await start("github"), {
      at: "https://github.com",
      clientId: REGISTERED.GITHUB_APP_CLIENT_ID,
    });
  } finally {
    await client.close();
  }
});
