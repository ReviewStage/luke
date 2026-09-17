import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

/**
 * A deployment without `BETTER_AUTH_SECRET` loads the auth service, since
 * every function bundle must load with nothing configured, and then refuses
 * every request to it: Better Auth left to itself would sign sessions under
 * its built-in default secret outside production, so the refusal is Luke's
 * own, ahead of every endpoint, through the handler and through `auth.api`
 * alike. A blank secret is the same absence.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const SESSION_URL = "https://luke.test/api/auth/get-session";

async function authWith(secret: string | undefined) {
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv("DATABASE_URL", undefined);
  vi.resetModules();
  const { auth } = await import("../server/auth");
  return auth;
}

for (const [name, secret] of [
  ["absent", undefined],
  ["blank", "   "],
] as const) {
  test(`with BETTER_AUTH_SECRET ${name} the auth service loads and refuses every request with 503`, async () => {
    const auth = await authWith(secret);

    const answer = await auth.handler(new Request(SESSION_URL));
    assert.equal(answer.status, 503);
    assert.equal(answer.headers.get("set-cookie"), null);

    await assert.rejects(
      auth.api.getSession({ headers: new Headers({ cookie: "luke.session_token=abc" }) }),
      (error: { status?: string }) => error.status === "SERVICE_UNAVAILABLE",
    );
  });
}

test("with BETTER_AUTH_SECRET set the same request is not refused for configuration", async () => {
  const auth = await authWith("test-session-secret-of-adequate-length-1234");
  const answer = await auth.handler(new Request(SESSION_URL));
  assert.notEqual(answer.status, 503);
});
