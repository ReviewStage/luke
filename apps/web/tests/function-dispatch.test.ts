import assert from "node:assert/strict";
import { join } from "node:path";
import type { Route } from "@luke/service/route";
import { test } from "vitest";
import { hostedProcedureRoutes, type ProcedureRoute } from "../server/api-callers";
import { DISPATCH_QUERY, dispatchRoutes, ORPC_ROUTE_KEY } from "../server/function-dispatch";
import { webFunctions } from "../server/function-layout";
import { ORPC_FALLBACK_SRC, readApiRewritesTable } from "../server/function-rewrites";
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

test("a request with no route key, the oRPC key, or a key the function does not hold is the oRPC route's, at the path it carried or its own", async () => {
  const orpc = recording();
  const exception = recording();
  const dispatcher = dispatchRoutes(
    new Map([
      ["github/webhook", exception.route],
      [ORPC_ROUTE_KEY, orpc.route],
    ]),
  );
  for (const query of [
    `${DISPATCH_QUERY.ROUTE}=${ORPC_ROUTE_KEY}&${DISPATCH_QUERY.PATH}=plans/p1/board&wait=1`,
    `${DISPATCH_QUERY.ROUTE}=plans/board&${DISPATCH_QUERY.PATH}=plans/p1/board&wait=1`,
    `${DISPATCH_QUERY.PATH}=plans/p1/board&wait=1`,
  ]) {
    await dispatcher.fetch(new Request(`https://luke.test/api/default.js?${query}`));
  }
  await dispatcher.fetch(new Request("https://luke.test/api/default.js?wait=1"));
  assert.deepEqual(
    orpc.requests.map((request) => request.url),
    [
      "https://luke.test/api/plans/p1/board?wait=1",
      "https://luke.test/api/plans/p1/board?wait=1",
      "https://luke.test/api/plans/p1/board?wait=1",
      "https://luke.test/api/default.js?wait=1",
    ],
  );
  assert.equal(exception.requests.length, 0);
});

test("a function that holds no oRPC route answers a key it does not hold 404 with no body", async () => {
  const sweep = recording();
  const dispatcher = dispatchRoutes(new Map([["maintenance/sweep", sweep.route]]));
  const response = await dispatcher.fetch(
    new Request(`https://luke.test/api/maintenance-sweep.js?${DISPATCH_QUERY.ROUTE}=nope`),
  );
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "");
  assert.equal(sweep.requests.length, 0);
});

const WEB = join(import.meta.dirname, "..");

/** Every route of the default function as a recorder, so a landed request names the key it reached and the request that key was handed. */
async function landingOnDefault() {
  const grouped = (await webFunctions(WEB)).find((definition) => definition.file === "default");
  assert.ok(grouped);
  const reached: { readonly key: string; readonly url: URL }[] = [];
  const routes = new Map(
    grouped.routes.map((key): [string, Route] => [
      key,
      {
        async fetch(request) {
          reached.push({ key, url: new URL(request.url) });
          return new Response(null, { status: 204 });
        },
      },
    ]),
  );
  return {
    async land(path: string) {
      reached.length = 0;
      await dispatched(new Request(`https://luke.test${path}`), routes);
      const [only] = reached;
      assert.ok(only, path);
      return { key: only.key, path: only.url.pathname, query: [...only.url.searchParams] };
    },
  };
}

test("every route that stays off the oRPC router is reached at its public URL by the committed table, the fallback shadowing none", async () => {
  const { land } = await landingOnDefault();
  const expected: readonly (readonly [string, string, string, readonly [string, string][]])[] = [
    [
      "/api/auth/callback/github?code=c1",
      "auth/[...all]",
      "/api/auth/callback/github",
      [["code", "c1"]],
    ],
    ["/api/github/webhook", "github/webhook", "/api/github/webhook", []],
    [
      "/api/automations/a1/webhook",
      "automations/webhook",
      "/api/automations/webhook",
      [["id", "a1"]],
    ],
    [
      "/api/maintenance/provider-keys-rewrap",
      "maintenance/provider-keys-rewrap",
      "/api/maintenance/provider-keys-rewrap",
      [],
    ],
    [
      "/api/github/install?workspaceId=w1",
      "github/install",
      "/api/github/install",
      [["workspaceId", "w1"]],
    ],
    ["/api/github/installed", "github/installed", "/api/github/installed", []],
    [
      "/api/github/installed/authorized",
      "github/installed/authorized",
      "/api/github/installed/authorized",
      [],
    ],
    [
      "/api/account/integrations/connected",
      "account/integrations/connected",
      "/api/account/integrations/connected",
      [],
    ],
    [
      "/api/workspaces/linear/connected",
      "workspaces/linear/connected",
      "/api/workspaces/linear/connected",
      [],
    ],
    [
      "/api/plans/p1/attachments/f1",
      "plans/attachment",
      "/api/plans/attachment",
      [
        ["id", "p1"],
        ["attachment", "f1"],
      ],
    ],
    [
      "/api/agents/a1/pictures/i1",
      "agents/picture",
      "/api/agents/picture",
      [
        ["id", "a1"],
        ["picture", "i1"],
      ],
    ],
    [
      "/api/agents/a1/subagents/c1/pictures/i1",
      "agents/picture",
      "/api/agents/picture",
      [
        ["id", "a1"],
        ["call", "c1"],
        ["picture", "i1"],
      ],
    ],
    [
      "/api/agents/a1/github-image?src=x",
      "agents/github-image",
      "/api/agents/github-image",
      [
        ["id", "a1"],
        ["src", "x"],
      ],
    ],
    [
      "/api/inbox/m1/attachments/f1",
      "inbox/attachment",
      "/api/inbox/attachment",
      [
        ["id", "m1"],
        ["attachment", "f1"],
      ],
    ],
    ["/api/workspaces/w1/photo", "workspaces/photo", "/api/workspaces/photo", [["id", "w1"]]],
    [
      "/api/workspaces/chat/attachment?id=c1",
      "workspaces/chat/attachment",
      "/api/workspaces/chat/attachment",
      [["id", "c1"]],
    ],
  ];
  for (const [path, key, restored, query] of expected) {
    assert.deepEqual(await land(path), { key, path: restored, query }, path);
  }
  const table = await readApiRewritesTable(WEB);
  const firstRule = (path: string) =>
    table.find((rule) => new RegExp(`^${rule.src}$`, "u").test(path));
  assert.deepEqual(firstRule("/api/maintenance/sweep"), {
    src: "/api/maintenance/sweep",
    dest: "/api/maintenance-sweep.js?route=maintenance/sweep",
  });
  // The functions that answer by their own name are rewritten onto themselves, which the filesystem then serves as before.
  for (const path of [
    "/api/voice/sessions",
    "/api/voice/sessions.js",
    "/api/terminal/sessions",
    "/api/terminal/sessions.js",
    "/api/feedback",
    "/api/feedback.mjs",
  ]) {
    assert.equal(firstRule(path)?.dest, path, path);
  }
  assert.equal(firstRule("/api/voice/sessionsXjs")?.src, ORPC_FALLBACK_SRC);
});

test("a path of every hosted resource is landed on the oRPC route at its own public path, segments and query kept", async () => {
  const { land } = await landingOnDefault();
  const firstOfResource = new Map<string, ProcedureRoute>();
  for (const procedure of hostedProcedureRoutes()) {
    const [resource = ""] = procedure.key;
    if (!firstOfResource.has(resource)) firstOfResource.set(resource, procedure);
  }
  assert.ok(firstOfResource.size > 20);
  for (const procedure of firstOfResource.values()) {
    const path = procedure.path.replaceAll(/\{\+?[^{}]+\}/gu, "seg-1");
    assert.deepEqual(
      await land(`${path}?wait=1`),
      { key: ORPC_ROUTE_KEY, path, query: [["wait", "1"]] },
      procedure.key.join("."),
    );
  }
  assert.deepEqual(await land("/api/nope"), { key: ORPC_ROUTE_KEY, path: "/api/nope", query: [] });
});
