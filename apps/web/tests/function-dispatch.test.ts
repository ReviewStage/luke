import assert from "node:assert/strict";
import { test } from "vitest";
import { DISPATCH_QUERY, dispatchRoutes } from "../server/function-dispatch";
import type { Route } from "../server/route";
import { dispatched } from "./support/platform-landing";

/** A File tab's read as a released desktop sends it: the file named in a `path` query. */
const FILE_READ_PATH = "/api/plans/p1/file?path=apps%2Fweb%2Fcoder%2Fagent.ts&first=1&last=500";

function recording() {
  const requests: Request[] = [];
  const route: Route = {
    async fetch(request) {
      requests.push(request);
      return new Response(await request.text(), { status: 200 });
    },
  };
  return { route, requests };
}

test("the route key picks the member and the request is restored to the route's own path", async () => {
  const plan = recording();
  const dispatcher = dispatchRoutes(new Map([["plans/plan", plan.route]]));
  const response = await dispatcher.fetch(
    new Request(
      `https://luke.test/api/default.js?${DISPATCH_QUERY.ROUTE}=plans/plan&id=t1&wait=1`,
      { method: "POST", body: "hello", headers: { "content-type": "text/plain" } },
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "hello");
  const seen = plan.requests[0];
  assert.ok(seen);
  const url = new URL(seen.url);
  assert.equal(url.pathname, "/api/plans/plan");
  assert.deepEqual(
    [...url.searchParams.entries()],
    [
      ["id", "t1"],
      ["wait", "1"],
    ],
  );
  assert.equal(seen.method, "POST");
  assert.equal(seen.headers.get("content-type"), "text/plain");
});

test("a path parameter replaces the key in the restored path, for the auth catch-all", async () => {
  const auth = recording();
  const dispatcher = dispatchRoutes(new Map([["auth/[...all]", auth.route]]));
  await dispatcher.fetch(
    new Request(
      `https://luke.test/api/default.js?${DISPATCH_QUERY.ROUTE}=auth/[...all]&${DISPATCH_QUERY.PATH}=auth/sign-in/social&x=1`,
    ),
  );
  const url = new URL(auth.requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/auth/sign-in/social");
  assert.deepEqual([...url.searchParams.entries()], [["x", "1"]]);
});

test("a caller's own query reaches the route whatever it names, the File tab's file path among them", async () => {
  const file = recording();
  const response = await dispatched(
    new Request(new URL(FILE_READ_PATH, "https://luke.test")),
    new Map([["plans/file", file.route]]),
  );
  assert.equal(response.status, 200);
  const url = new URL(file.requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/plans/file");
  assert.deepEqual(
    [...url.searchParams.entries()],
    [
      ["id", "p1"],
      ["path", "apps/web/coder/agent.ts"],
      ["first", "1"],
      ["last", "500"],
    ],
  );
});

test("an OAuth callback is landed by the committed table on the auth catch-all at its own path, its query kept", async () => {
  const auth = recording();
  await dispatched(
    new Request("https://luke.test/api/auth/callback/github?code=c1&state=s1"),
    new Map([["auth/[...all]", auth.route]]),
  );
  const url = new URL(auth.requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/auth/callback/github");
  assert.deepEqual(
    [...url.searchParams.entries()],
    [
      ["code", "c1"],
      ["state", "s1"],
    ],
  );
});

test("a key the function does not hold, or no key at all, is a 404 and reaches no member", async () => {
  const member = recording();
  const dispatcher = dispatchRoutes(new Map([["changes", member.route]]));
  const unknown = await dispatcher.fetch(
    new Request(`https://luke.test/api/default.js?${DISPATCH_QUERY.ROUTE}=devices`),
  );
  const missing = await dispatcher.fetch(new Request("https://luke.test/api/default.js"));
  assert.equal(unknown.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(member.requests.length, 0);
});
