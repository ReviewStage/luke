import assert from "node:assert/strict";
import type { Route } from "@luke/service/route";
import { test } from "vitest";
import { DISPATCH_QUERY, dispatchRoutes } from "../server/function-dispatch";
import { dispatched } from "./support/platform-landing";

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
  const task = recording();
  const dispatcher = dispatchRoutes(new Map([["plans/plan", task.route]]));
  const response = await dispatcher.fetch(
    new Request(
      `https://luke.test/api/default.js?${DISPATCH_QUERY.ROUTE}=plans/plan&id=t1&wait=1`,
      { method: "POST", body: "hello", headers: { "content-type": "text/plain" } },
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "hello");
  const seen = task.requests[0];
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
