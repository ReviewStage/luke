import assert from "node:assert/strict";
import test from "node:test";
import { hostedUserId } from "../server/hosted/bearer";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/voice/mint", { method: "POST", headers });
}

test("a request without a bearer header resolves nobody and asks the auth service nothing", async () => {
  let asked = 0;
  const userId = await hostedUserId(request(), async () => {
    asked += 1;
    return { sub: "user-1" };
  });
  assert.equal(userId, undefined);
  assert.equal(asked, 0);
});

test("a valid token resolves to the auth service's own subject", async () => {
  let forwarded: string | null = null;
  const userId = await hostedUserId(request({ authorization: "Bearer token-1" }), async (input) => {
    forwarded = input.headers.get("authorization");
    return { sub: "user-1", email: "dev@example.com" };
  });
  assert.equal(userId, "user-1");
  assert.equal(forwarded, "Bearer token-1");
});

test("a rejected, malformed, or subjectless answer is one indistinguishable no", async () => {
  const rejected = await hostedUserId(request({ authorization: "Bearer expired" }), async () => {
    throw new Error("invalid_token");
  });
  assert.equal(rejected, undefined);

  const malformed = await hostedUserId(
    request({ authorization: "Bearer odd" }),
    async () => "not a record",
  );
  assert.equal(malformed, undefined);

  const subjectless = await hostedUserId(request({ authorization: "Bearer odd" }), async () => ({
    sub: "",
  }));
  assert.equal(subjectless, undefined);
});
