import assert from "node:assert/strict";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { test } from "vitest";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";
import { type CookieOriginGuard, cookieOriginGuard } from "./origin-guard.js";

const PRODUCTION_ORIGIN = "https://tryluke.dev";

const PRODUCTION = {
  VERCEL_ENV: "production",
  VERCEL_URL: "luke-abc123-stage-review.vercel.app",
  BETTER_AUTH_URL: PRODUCTION_ORIGIN,
} as const;

const PREVIEW_ORIGIN = "https://luke-def456-stage-review.vercel.app";
const PREVIEW_BRANCH_ORIGIN = "https://luke-web-git-feature-stage-review.vercel.app";

const PREVIEW = {
  VERCEL_ENV: "preview",
  VERCEL_URL: "luke-def456-stage-review.vercel.app",
  VERCEL_BRANCH_URL: "luke-web-git-feature-stage-review.vercel.app",
  BETTER_AUTH_URL: PRODUCTION_ORIGIN,
} as const;

const FOREIGN_ORIGIN = "https://evil.example";

const SESSION_COOKIE = "__Secure-better-auth.session_token=fixture";

/** A route that takes the browser's session today: a workspace renamed by an owner or an admin. */
const COOKIE_ROUTE = HOSTED_SERVICE_PATH.WORKSPACES_RENAME;

const REFUSED = {
  status: HOSTED_HTTP_STATUS.FORBIDDEN,
  body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
} as const;

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(new URL(path, PRODUCTION_ORIGIN), {
    method: init.method ?? "POST",
    headers: init.headers ?? {},
  });
}

/** A POST carrying the browser's session cookie, with whatever else the case names. */
function cookiePost(path: string, headers: Record<string, string> = {}): Request {
  return request(path, { headers: { cookie: SESSION_COOKIE, ...headers } });
}

/** What the guard answered: nothing where the request goes on to its route, the refusal's status and body otherwise. */
async function verdict(guard: CookieOriginGuard, sent: Request) {
  const refusal = guard(sent);
  if (refusal === undefined) return undefined;
  return { status: refusal.status, body: await refusal.json() };
}

test("a cookie POST that names no origin is refused with the hosted vocabulary's not-permitted", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  assert.deepEqual(await verdict(guard, cookiePost(COOKIE_ROUTE)), REFUSED);
  assert.deepEqual(
    await verdict(guard, cookiePost(COOKIE_ROUTE, { "sec-fetch-site": "cross-site" })),
    REFUSED,
  );
  assert.deepEqual(
    await verdict(guard, cookiePost(COOKIE_ROUTE, { "sec-fetch-site": "same-site" })),
    REFUSED,
  );
});

test("a cookie POST from a foreign origin is refused, whatever else it says", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const origin of [
    FOREIGN_ORIGIN,
    "null",
    "http://tryluke.dev",
    "https://tryluke.dev.evil.example",
  ]) {
    assert.deepEqual(await verdict(guard, cookiePost(COOKIE_ROUTE, { origin })), REFUSED, origin);
  }
  assert.deepEqual(
    await verdict(
      guard,
      cookiePost(COOKIE_ROUTE, { origin: FOREIGN_ORIGIN, "sec-fetch-site": "same-origin" }),
    ),
    REFUSED,
  );
});

test("a cookie POST, PUT, or DELETE from the deployment's own origin goes on to its route", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  assert.equal(
    await verdict(guard, cookiePost(COOKIE_ROUTE, { origin: PRODUCTION_ORIGIN })),
    undefined,
  );
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const sent = request(COOKIE_ROUTE, {
      method,
      headers: { cookie: SESSION_COOKIE, origin: PRODUCTION_ORIGIN },
    });
    assert.equal(await verdict(guard, sent), undefined, method);
  }
});

test("a cookie POST that names no origin goes on where the browser says its page was the same origin's", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  assert.equal(
    await verdict(guard, cookiePost(COOKIE_ROUTE, { "sec-fetch-site": "same-origin" })),
    undefined,
  );
});

test("a bearer POST goes on to its route, whatever cookie or origin rides beside it", async () => {
  const guard = cookieOriginGuard(PRODUCTION);
  const authorization = "Bearer desktop-token";

  assert.equal(
    await verdict(guard, request(COOKIE_ROUTE, { headers: { authorization } })),
    undefined,
  );
  assert.equal(await verdict(guard, cookiePost(COOKIE_ROUTE, { authorization })), undefined);
  assert.equal(
    await verdict(guard, cookiePost(COOKIE_ROUTE, { authorization, origin: FOREIGN_ORIGIN })),
    undefined,
  );
});

test("a blank Authorization header is no bearer", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  assert.deepEqual(await verdict(guard, cookiePost(COOKIE_ROUTE, { authorization: " " })), REFUSED);
});

test("a GET, HEAD, or OPTIONS goes on to its route from any page", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const sent = request(COOKIE_ROUTE, {
      method,
      headers: { cookie: SESSION_COOKIE, origin: FOREIGN_ORIGIN },
    });
    assert.equal(await verdict(guard, sent), undefined, method);
  }
});

test("a POST that carries no cookie goes on to its route from any page", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  assert.equal(await verdict(guard, request("/api/github/webhook")), undefined);
  assert.equal(
    await verdict(guard, request(COOKIE_ROUTE, { headers: { origin: FOREIGN_ORIGIN } })),
    undefined,
  );
});

test("Better Auth's own routes and the provider returns take a cookie POST from a foreign page", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const path of [
    "/api/auth/sign-in/social",
    "/api/auth/callback/github",
    HOSTED_SERVICE_PATH.GITHUB_INSTALLED,
    HOSTED_SERVICE_PATH.GITHUB_INSTALLED_AUTHORIZED,
    HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_CONNECTED,
    HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECTED,
  ]) {
    assert.equal(
      await verdict(guard, cookiePost(path, { origin: FOREIGN_ORIGIN })),
      undefined,
      path,
    );
    assert.equal(await verdict(guard, cookiePost(path)), undefined, path);
  }
});

test("an exempt path spelled any other way is guarded like every other path", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const path of [
    "/api/auth",
    "/api/authorize",
    "/API/auth/sign-in/social",
    `${HOSTED_SERVICE_PATH.GITHUB_INSTALLED}/`,
    HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECTED.replace("/api/", "/api//"),
  ]) {
    assert.deepEqual(
      await verdict(guard, cookiePost(path, { origin: FOREIGN_ORIGIN })),
      REFUSED,
      path,
    );
  }
});

test("production holds foreign every origin Better Auth trusts beyond its own", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const origin of [PREVIEW_ORIGIN, PREVIEW_BRANCH_ORIGIN, "http://localhost:5173"]) {
    assert.deepEqual(await verdict(guard, cookiePost(COOKIE_ROUTE, { origin })), REFUSED, origin);
  }
});

test("a preview's own origins are both its hostnames, and production's is foreign to it", async () => {
  const guard = cookieOriginGuard(PREVIEW);

  for (const origin of [PREVIEW_ORIGIN, PREVIEW_BRANCH_ORIGIN]) {
    assert.equal(await verdict(guard, cookiePost(COOKIE_ROUTE, { origin })), undefined, origin);
  }
  assert.deepEqual(
    await verdict(guard, cookiePost(COOKIE_ROUTE, { origin: PRODUCTION_ORIGIN })),
    REFUSED,
  );
});
