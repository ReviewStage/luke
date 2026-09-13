import assert from "node:assert/strict";
import { Effect } from "effect";
import { test } from "vitest";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../server/hosted/bearer";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/voice/mint", { method: "POST", headers });
}

test("a request without a bearer header resolves nobody and asks the auth service nothing", async () => {
  let asked = 0;
  const userId = await Effect.runPromise(
    hostedUserId(request(), () => {
      asked += 1;
      return Effect.succeed({ sub: "user-1" });
    }),
  );
  assert.equal(userId, undefined);
  assert.equal(asked, 0);
});

test("a valid token resolves to the auth service's own subject", async () => {
  let forwarded: string | null = null;
  const userId = await Effect.runPromise(
    hostedUserId(request({ authorization: "Bearer token-1" }), (input) => {
      forwarded = input.headers.get("authorization");
      return Effect.succeed({ sub: "user-1", email: "dev@example.com" });
    }),
  );
  assert.equal(userId, "user-1");
  assert.equal(forwarded, "Bearer token-1");
});

test("a rejected, malformed, or subjectless answer is one indistinguishable no", async () => {
  const rejected = await Effect.runPromise(
    hostedUserId(request({ authorization: "Bearer expired" }), () =>
      Effect.tryPromise(() => Promise.reject(new Error("invalid_token"))),
    ),
  );
  assert.equal(rejected, undefined);

  const malformed = await Effect.runPromise(
    hostedUserId(request({ authorization: "Bearer odd" }), () => Effect.succeed(undefined)),
  );
  assert.equal(malformed, undefined);

  const subjectless = await Effect.runPromise(
    hostedUserId(request({ authorization: "Bearer odd" }), () => Effect.succeed({ sub: "" })),
  );
  assert.equal(subjectless, undefined);
});

test("oauthUserInfoFromAuthAnswer refuses malformed wire answers", () => {
  assert.equal(oauthUserInfoFromAuthAnswer("not a record"), undefined);
  assert.equal(oauthUserInfoFromAuthAnswer({ sub: "" }), undefined);
  assert.deepEqual(oauthUserInfoFromAuthAnswer({ sub: "user-1" }), { sub: "user-1" });
});
