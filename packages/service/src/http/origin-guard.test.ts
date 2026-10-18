import assert from "node:assert/strict";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { afterEach, beforeEach, test, vi } from "vitest";
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

/** The Vite dev server, which stands in for the deployment only where nothing names one. */
const DEV_SERVER_ORIGIN = "http://localhost:5173";

const FOREIGN_ORIGIN = "https://evil.example";

const SESSION_COOKIE = "__Secure-better-auth.session_token=session-cookie-value";

/** A route that takes the browser's session today: a workspace renamed by an owner or an admin. */
const COOKIE_ROUTE = HOSTED_SERVICE_PATH.WORKSPACES_RENAME;

const REFUSED = {
  status: HOSTED_HTTP_STATUS.FORBIDDEN,
  body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
} as const;

/** A JSON string literal as a log line quotes a value. */
const QUOTED_VALUE = /"(?:[^"\\]|\\.)*"/g;

// The guard says what it refused at warn; the suite keeps those lines off its own output.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

test("an origin spelled other than a browser spells the deployment's own is refused", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const origin of ["https://TRYLUKE.dev", "https://tryluke.dev:443", "https://tryluke.dev/"]) {
    assert.deepEqual(await verdict(guard, cookiePost(COOKIE_ROUTE, { origin })), REFUSED, origin);
  }
});

test("a cookie POST, PUT, DELETE, or PATCH from the deployment's own origin goes on to its route", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
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

test("a cookie POST is held to its origin whatever Authorization rides beside it", async () => {
  const guard = cookieOriginGuard(PRODUCTION);
  const authorization = "Bearer not-a-signed-session";

  assert.deepEqual(
    await verdict(guard, cookiePost(COOKIE_ROUTE, { authorization, origin: FOREIGN_ORIGIN })),
    REFUSED,
  );
  assert.deepEqual(await verdict(guard, cookiePost(COOKIE_ROUTE, { authorization })), REFUSED);
  assert.equal(
    await verdict(guard, cookiePost(COOKIE_ROUTE, { authorization, origin: PRODUCTION_ORIGIN })),
    undefined,
  );
});

test("a request with no cookie goes on to its route from any page, the desktop's and a webhook's among them", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  assert.equal(
    await verdict(guard, request(COOKIE_ROUTE, { headers: { authorization: "Bearer desktop" } })),
    undefined,
  );
  assert.equal(await verdict(guard, request("/api/github/webhook")), undefined);
  assert.equal(
    await verdict(guard, request(COOKIE_ROUTE, { headers: { origin: FOREIGN_ORIGIN } })),
    undefined,
  );
});

test("a GET, HEAD, or OPTIONS goes on to its route from any page, a provider's return among them", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const path of [COOKIE_ROUTE, HOSTED_SERVICE_PATH.GITHUB_INSTALLED]) {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const sent = request(path, {
        method,
        headers: { cookie: SESSION_COOKIE, origin: FOREIGN_ORIGIN },
      });
      assert.equal(await verdict(guard, sent), undefined, `${method} ${path}`);
    }
  }
});

test("a lowercase or unknown method is guarded as a state-changing one", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const method of ["patch", "PROPFIND"]) {
    const sent = request(COOKIE_ROUTE, {
      method,
      headers: { cookie: SESSION_COOKIE, origin: FOREIGN_ORIGIN },
    });
    assert.deepEqual(await verdict(guard, sent), REFUSED, method);
  }
});

test("Better Auth's own routes take a cookie POST from a foreign page", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const path of ["/api/auth/sign-in/social", "/api/auth/callback/github"]) {
    assert.equal(
      await verdict(guard, cookiePost(path, { origin: FOREIGN_ORIGIN })),
      undefined,
      path,
    );
    assert.equal(await verdict(guard, cookiePost(path)), undefined, path);
  }
});

test("every other path is guarded, a provider's return and another spelling of Better Auth's among them", async () => {
  const guard = cookieOriginGuard(PRODUCTION);

  for (const path of [
    HOSTED_SERVICE_PATH.GITHUB_INSTALLED,
    HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_CONNECTED,
    "/api/auth",
    "/api/authorize",
    "/API/auth/sign-in/social",
    "/api//auth/sign-in/social",
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

  for (const origin of [PREVIEW_ORIGIN, PREVIEW_BRANCH_ORIGIN, DEV_SERVER_ORIGIN]) {
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

test("a production or a preview that names no address of its own owns no origin, the dev server's included", async () => {
  const production = cookieOriginGuard({ VERCEL_ENV: "production" });
  const preview = cookieOriginGuard({ VERCEL_ENV: "preview", BETTER_AUTH_URL: PRODUCTION_ORIGIN });

  for (const origin of [DEV_SERVER_ORIGIN, PRODUCTION_ORIGIN]) {
    assert.deepEqual(
      await verdict(production, cookiePost(COOKIE_ROUTE, { origin })),
      REFUSED,
      origin,
    );
    assert.deepEqual(await verdict(preview, cookiePost(COOKIE_ROUTE, { origin })), REFUSED, origin);
  }
});

test("where no Vercel environment is named, the dev server is the deployment's own", async () => {
  const guard = cookieOriginGuard({});

  assert.equal(
    await verdict(guard, cookiePost(COOKIE_ROUTE, { origin: DEV_SERVER_ORIGIN })),
    undefined,
  );
});

test("an address that is no web page's owns no origin, so an opaque origin is refused", async () => {
  for (const variables of [
    { BETTER_AUTH_URL: "file:///srv/luke" },
    { VERCEL_ENV: "production", BETTER_AUTH_URL: "file:///srv/luke" },
  ]) {
    const guard = cookieOriginGuard(variables);
    assert.deepEqual(await verdict(guard, cookiePost(COOKIE_ROUTE, { origin: "null" })), REFUSED);
  }
});

test("a refusal is logged with its path and origin alone, and nothing of its query or cookie", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const guard = cookieOriginGuard(PRODUCTION);

  guard(cookiePost(`${COOKIE_ROUTE}?token=query-secret`, { origin: FOREIGN_ORIGIN }));

  const logged = warn.mock.calls.flat().join("\n");
  assert.deepEqual(logged.match(QUOTED_VALUE), [
    JSON.stringify(COOKIE_ROUTE),
    JSON.stringify(FOREIGN_ORIGIN),
  ]);
  assert.equal(logged.includes("query-secret"), false, logged);
  assert.equal(logged.includes("session-cookie-value"), false, logged);
});
