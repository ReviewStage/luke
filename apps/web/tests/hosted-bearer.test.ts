import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../server/hosted/bearer";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/voice/mint", { method: "POST", headers });
}

it.effect(
  "a request without a bearer header resolves nobody and asks the auth service nothing",
  () =>
    Effect.gen(function* () {
      let asked = 0;
      const userId = yield* hostedUserId(request(), () => {
        asked += 1;
        return Effect.succeed({ sub: "user-1" });
      });
      assert.deepEqual(userId, Option.none());
      assert.equal(asked, 0);
    }),
);

it.effect("a valid token resolves to the auth service's own subject", () =>
  Effect.gen(function* () {
    let forwarded: string | null = null;
    const userId = yield* hostedUserId(request({ authorization: "Bearer token-1" }), (input) => {
      forwarded = input.headers.get("authorization");
      return Effect.succeed({ sub: "user-1", email: "dev@example.com" });
    });
    assert.deepEqual(userId, Option.some("user-1"));
    assert.equal(forwarded, "Bearer token-1");
  }),
);

it.effect("a rejected, malformed, or subjectless answer is one indistinguishable no", () =>
  Effect.gen(function* () {
    const rejected = yield* hostedUserId(request({ authorization: "Bearer expired" }), () =>
      Effect.tryPromise(() => Promise.reject(new Error("invalid_token"))),
    );
    assert.deepEqual(rejected, Option.none());

    const malformed = yield* hostedUserId(request({ authorization: "Bearer odd" }), () =>
      Effect.succeed(undefined),
    );
    assert.deepEqual(malformed, Option.none());

    const subjectless = yield* hostedUserId(request({ authorization: "Bearer odd" }), () =>
      Effect.succeed({ sub: "" }),
    );
    assert.deepEqual(subjectless, Option.none());
  }),
);

it("oauthUserInfoFromAuthAnswer refuses malformed wire answers", () => {
  assert.equal(oauthUserInfoFromAuthAnswer("not a record"), undefined);
  assert.equal(oauthUserInfoFromAuthAnswer({ sub: "" }), undefined);
  assert.deepEqual(oauthUserInfoFromAuthAnswer({ sub: "user-1" }), { sub: "user-1" });
});
