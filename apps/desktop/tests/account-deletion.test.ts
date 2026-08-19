import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_FAILURE, CloudFailure } from "@sidecar/core/effect-errors";
import { Effect, Layer } from "effect";
import { deleteHostedAccount } from "../src/account-deletion";
import { accessTokenNeedsRefresh } from "../src/account-gate";
import { Http, LoopbackFailure } from "../src/services/http";

function mockHttp(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  return Layer.succeed(Http, {
    request: (url, init) =>
      Effect.tryPromise({
        try: () => fetch(url, init),
        catch: () => new CloudFailure({ failure: CLOUD_FAILURE.TRANSIENT, provider: "http" }),
      }),
    readJson: (response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: () => new CloudFailure({ failure: CLOUD_FAILURE.TRANSIENT, provider: "http" }),
      }),
    listenLoopback: () => Effect.fail(new LoopbackFailure({ reason: "unused" })),
    closeServer: () => Effect.fail(new LoopbackFailure({ reason: "unused" })),
    closeAllConnections: () => Effect.void,
  });
}

test("a delete posts the bearer token at the service's account-delete path", async () => {
  let request: Request | undefined;
  const layer = mockHttp(async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ deleted: true }), { status: 200 });
  });

  await Effect.runPromise(
    deleteHostedAccount({
      serviceBaseUrl: "https://tryluke.dev/",
      accessToken: "access-1",
    }).pipe(Effect.provide(layer)),
  );

  assert.equal(request?.url, "https://tryluke.dev/api/account/delete");
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers.get("authorization"), "Bearer access-1");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("an expired token's refusal reads as refresh-and-retry, a service no does not", async () => {
  const refusal = (status: number) =>
    mockHttp(async () => new Response(JSON.stringify({ error: "invalid-token" }), { status }));

  const expired = await Effect.runPromise(
    deleteHostedAccount({
      serviceBaseUrl: "https://tryluke.dev",
      accessToken: "access-1",
    }).pipe(Effect.provide(refusal(401)), Effect.either),
  );
  assert.equal(expired._tag, "Left");
  if (expired._tag === "Left") {
    assert.equal(accessTokenNeedsRefresh(expired.left), true);
  }

  const refused = await Effect.runPromise(
    deleteHostedAccount({
      serviceBaseUrl: "https://tryluke.dev",
      accessToken: "access-1",
    }).pipe(Effect.provide(refusal(503)), Effect.either),
  );
  assert.equal(refused._tag, "Left");
  if (refused._tag === "Left") {
    assert.equal(accessTokenNeedsRefresh(refused.left), false);
  }
});
