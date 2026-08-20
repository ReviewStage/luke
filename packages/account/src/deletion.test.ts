import assert from "node:assert/strict";
import test from "node:test";
import { AccountClientError, type FetchLike } from "./client.js";
import { deleteHostedAccount } from "./deletion.js";
import { accessTokenNeedsRefresh } from "./gate.js";

test("a delete posts the bearer token at the service's account-delete path", async () => {
  let request: Request | undefined;
  const fetch: FetchLike = async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ deleted: true }), { status: 200 });
  };

  await deleteHostedAccount({
    serviceBaseUrl: "https://tryluke.dev/",
    accessToken: "access-1",
    fetch,
  });

  assert.equal(request?.url, "https://tryluke.dev/api/account/delete");
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers.get("authorization"), "Bearer access-1");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("an expired token's refusal reads as refresh-and-retry, a service no does not", async () => {
  const refusal = (status: number): FetchLike => {
    return async () => new Response(JSON.stringify({ error: "invalid-token" }), { status });
  };

  const expired = await deleteHostedAccount({
    serviceBaseUrl: "https://tryluke.dev",
    accessToken: "access-1",
    fetch: refusal(401),
  }).catch((error) => error);
  assert.equal(expired instanceof AccountClientError, true);
  assert.equal(accessTokenNeedsRefresh(expired), true);

  const refused = await deleteHostedAccount({
    serviceBaseUrl: "https://tryluke.dev",
    accessToken: "access-1",
    fetch: refusal(503),
  }).catch((error) => error);
  assert.equal(refused instanceof AccountClientError, true);
  assert.equal(accessTokenNeedsRefresh(refused), false);
});
