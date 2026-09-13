import assert from "node:assert/strict";
import { HttpApp } from "@effect/platform";
import { Effect } from "effect";
import { test } from "vitest";
import type { AdminViewer } from "../server/admin/admin-access";
import { adminViewerGate } from "../server/admin/gate";
import { ADMIN_ERROR } from "../server/admin/http";
import { noDatabase } from "./support/no-database";

const ADMIN_VIEWER: AdminViewer = { userId: "admin-1", role: "admin" };

function adminRequest(method = "GET"): Request {
  return new Request("https://luke.test/api/admin/metrics", { method });
}

/** The gate as one function answers it, which is the web handler an `HttpApp` builds. */
function gate(overrides: Partial<Parameters<typeof adminViewerGate>[0]> = {}) {
  const app = adminViewerGate({
    methods: ["GET"],
    resolveViewer: () => Effect.succeed(ADMIN_VIEWER),
    handler: () => Effect.succeed(new Response("{}", { status: 200 })),
    ...overrides,
  });
  return { fetch: HttpApp.toWebHandler(Effect.provide(app, noDatabase)) };
}

test("the gate answers 405, 503, 401, 403, and the handler as distinct outcomes", async () => {
  const wrongMethod = await gate().fetch(adminRequest("POST"));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("cache-control"), "no-store");
  assert.equal((await wrongMethod.json()).error, ADMIN_ERROR.METHOD_NOT_ALLOWED);

  const outage = await gate({
    resolveViewer: () => Effect.die(new Error("auth is down")),
  }).fetch(adminRequest());
  assert.equal(outage.status, 503);
  assert.equal((await outage.json()).error, ADMIN_ERROR.UNAVAILABLE);

  const anonymous = await gate({ resolveViewer: () => Effect.succeed(undefined) }).fetch(
    adminRequest(),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, ADMIN_ERROR.NOT_SIGNED_IN);

  const forbidden = await gate({
    resolveViewer: () => Effect.succeed({ ...ADMIN_VIEWER, role: "user" }),
  }).fetch(adminRequest());
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, ADMIN_ERROR.NOT_AUTHORIZED);

  assert.equal((await gate().fetch(adminRequest())).status, 200);
});

test("nothing behind the gate runs for a request the gate refuses", async () => {
  const seen: string[] = [];
  const handled = (overrides: Partial<Parameters<typeof adminViewerGate>[0]>) =>
    gate({
      ...overrides,
      handler: (viewer, request) =>
        Effect.sync(() => {
          seen.push(`${viewer.userId}:${request.method}`);
          return new Response("{}");
        }),
    });

  await handled({}).fetch(adminRequest("PATCH"));
  await handled({ resolveViewer: () => Effect.succeed(undefined) }).fetch(adminRequest());
  await handled({ resolveViewer: () => Effect.succeed({ ...ADMIN_VIEWER, role: "user" }) }).fetch(
    adminRequest(),
  );
  assert.deepEqual(seen, []);

  await handled({}).fetch(adminRequest());
  assert.deepEqual(seen, ["admin-1:GET"]);
});

test("a route naming two methods answers both and refuses the rest", async () => {
  const methods: string[] = [];
  const route = gate({
    methods: ["PUT", "DELETE"],
    handler: (_viewer, request) =>
      Effect.sync(() => {
        methods.push(request.method);
        return new Response("{}");
      }),
  });

  for (const method of ["GET", "POST", "PATCH"]) {
    assert.equal((await route.fetch(adminRequest(method))).status, 405);
  }
  assert.equal((await route.fetch(adminRequest("PUT"))).status, 200);
  assert.equal((await route.fetch(adminRequest("DELETE"))).status, 200);
  assert.deepEqual(methods, ["PUT", "DELETE"]);
});
