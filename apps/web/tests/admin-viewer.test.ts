import assert from "node:assert/strict";
import { Cause, Effect, Layer, Logger } from "effect";
import { HttpEffect } from "effect/unstable/http";
import { test } from "vitest";
import type { AdminViewer } from "../server/admin/admin-access";
import { adminViewerGate } from "../server/admin/gate";
import { ADMIN_ERROR } from "../server/admin/http";
import { unavailableSeam } from "../server/admin/seam";
import { noDatabase } from "./support/no-database";

const ADMIN_VIEWER: AdminViewer = { userId: "admin-1", role: "admin" };

function adminRequest(method = "GET"): Request {
  return new Request("https://luke.test/api/admin/metrics", { method });
}

/**
 * The gate as one function answers it, which is the web handler an `HttpApp`
 * builds, with every line it logs kept in `logged`.
 */
function gate(
  overrides: Partial<Parameters<typeof adminViewerGate>[0]> = {},
  logged: string[] = [],
) {
  const app = adminViewerGate({
    methods: ["GET"],
    resolveViewer: () => Effect.succeed(ADMIN_VIEWER),
    handler: () => Effect.succeed(new Response("{}", { status: 200 })),
    ...overrides,
  });
  const capture = Logger.make((options) => {
    logged.push(JSON.stringify(options.message), String(options.cause));
  });
  const services = Layer.merge(noDatabase, Logger.layer([capture]));
  return { fetch: HttpEffect.toWebHandler(Effect.provide(app, services)) };
}

/** Words an outage's error may carry that no log line may: a credential and an account's own. */
const SECRET = "sk-admin-leaked-0123456789abcdef and the developer said ship it";

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

test("an auth seam or a read that died is logged by its kind, and nothing its error said", async () => {
  const logged: string[] = [];
  const auth = await gate({ resolveViewer: () => Effect.die(new TypeError(SECRET)) }, logged).fetch(
    adminRequest(),
  );
  assert.equal(auth.status, 503);
  const read = await gate(
    { handler: () => unavailableSeam("an admin read failed", Cause.die(new RangeError(SECRET))) },
    logged,
  ).fetch(adminRequest());
  assert.equal(read.status, 503);

  assert.ok(
    logged.some((line) => line.includes("TypeError")),
    logged.join("\n"),
  );
  assert.ok(
    logged.some((line) => line.includes("RangeError")),
    logged.join("\n"),
  );
  for (const line of logged) assert.ok(!line.includes(SECRET), line);
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
