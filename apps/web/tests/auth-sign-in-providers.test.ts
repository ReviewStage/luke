import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

/**
 * The deployment's own auth service, `auth.ts` as it loads, offers GitHub
 * alone: a workspace is a GitHub App installation, so every account needs a
 * GitHub identity, and a Google sign-in is refused before it leaves for
 * Google even on a deployment that still holds Google's client variables.
 *
 * Synthetic secrets throughout; the request is refused before the database
 * is asked anything.
 */

const BASE_URL = "http://localhost:5173";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("a Google sign-in is refused: the auth service has no Google provider", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://auth:providers@127.0.0.1:5432/luke");
  vi.stubEnv("BETTER_AUTH_SECRET", "fixture-session-secret-of-enough-length");
  vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-google-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-google-secret");
  const { auth } = await import("../server/auth");

  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    }),
  );

  assert.equal(response.status, 404);
  const body = await response.text();
  assert.match(body, /PROVIDER_NOT_FOUND/);
  assert.equal(body.includes("accounts.google.com"), false);
});
