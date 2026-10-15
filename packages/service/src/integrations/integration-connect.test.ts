import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { ConnectAuthorizationResponse } from "@vercel/connect";
import { Effect, Redacted, Result } from "effect";
import {
  CONNECT_SIGN_IN_RESULT,
  type ConnectResultAnswer,
  type ConnectSdk,
  INTEGRATION_CONNECT_FAILURE,
  vercelConnector,
} from "./integration-connect.js";

/**
 * A connector's two asks of a sign-in, against a fake Vercel Connect at
 * the SDK's seam: beginning one answers the address and Connect's handle
 * on it, and asking after the handle answers how Connect says it ended,
 * keeping of Connect's sentence only a refusal's first line, bounded, and
 * only where it is shaped like no credential.
 */

const VERIFIER = "connect-verifier-abc";
const SIGN_IN_URL = "https://vercel.com/connect/authorize/req_1";

/** A Connect that begins every sign-in under `VERIFIER` and answers a result read of it with `answer`, and of any other handle with none. */
function fakeConnect(answer: ConnectResultAnswer) {
  const sdk: ConnectSdk = {
    startAuthorization: () =>
      Promise.resolve({
        url: SIGN_IN_URL,
        verifier: VERIFIER,
        request: "req_1",
        expiresAt: 0,
      } satisfies ConnectAuthorizationResponse),
    getTokenResponse: () => Promise.reject(new Error("this suite reads no token")),
    revokeToken: () => Promise.reject(new Error("this suite revokes nothing")),
    readAuthorizationResult: (verifier) =>
      Promise.resolve(verifier === VERIFIER ? answer : { status: 404, body: undefined }),
  };
  return { connector: vercelConnector("oauth/granola", sdk) };
}

/** How the connector reads a sign-in Connect answers `answer` for. */
const resultOf = (answer: ConnectResultAnswer) =>
  Effect.result(fakeConnect(answer).connector.signInResult(Redacted.make(VERIFIER)));

it.effect("beginning a sign-in answers the address and Connect's handle, sealed", () =>
  Effect.gen(function* () {
    const { connector } = fakeConnect({ status: 200, body: { status: "partial" } });
    const begun = yield* connector.authorize("user-1", "https://luke.test/callback");
    assert.equal(begun.url, SIGN_IN_URL);
    assert.equal(Redacted.value(begun.verifier), VERIFIER);
    assert.ok(!String(begun.verifier).includes(VERIFIER), "the handle never prints");
  }),
);

it.effect("a sign-in cancelled on Connect's page reads as cancelled", () =>
  Effect.gen(function* () {
    const read = yield* resultOf({
      status: 200,
      body: { status: "canceled", progress: null, data: null, error: null },
    });
    assert.deepEqual(read, Result.succeed({ kind: CONNECT_SIGN_IN_RESULT.CANCELED }));
  }),
);

it.effect("a refused sign-in keeps the first line of Connect's sentence, bounded", () =>
  Effect.gen(function* () {
    const reason =
      "OAuth token request failed: client_assertion aud must be the authorization server issuer (https://mcp-auth.granola.ai)";
    const read = yield* resultOf({
      status: 200,
      body: {
        status: "error",
        error: { message: `${reason}\nstack: at exchange (connect.ts:12)`, code: "oauth_error" },
      },
    });
    assert.deepEqual(
      read,
      Result.succeed({ kind: CONNECT_SIGN_IN_RESULT.FAILED, message: reason }),
    );

    const long = yield* resultOf({
      status: 200,
      body: { status: "error", error: { message: "The provider said no. ".repeat(40) } },
    });
    assert.ok(Result.isSuccess(long) && long.success.kind === CONNECT_SIGN_IN_RESULT.FAILED);
    assert.ok((long.success.message?.length ?? 0) <= 200);
  }),
);

it.effect("a refusal whose sentence is shaped like a credential keeps none of it", () =>
  Effect.gen(function* () {
    for (const message of [
      "token exchange failed: Bearer gho_abcdefghijklmnop",
      "invalid client_secret 8f3a9c2e7b1d4f6a0e5c9b8a7d6f5e4c3b2a1908",
      "invalid_client: client_secret=hunter2",
      "the provider echoed code: a1b2c3",
      "rejected key sk_live_4f3a9c2e7b1d",
      "",
    ]) {
      const read = yield* resultOf({ status: 200, body: { status: "error", error: { message } } });
      assert.deepEqual(read, Result.succeed({ kind: CONNECT_SIGN_IN_RESULT.FAILED }), message);
    }
    const bare = yield* resultOf({ status: 200, body: { status: "error", error: null } });
    assert.deepEqual(bare, Result.succeed({ kind: CONNECT_SIGN_IN_RESULT.FAILED }));
  }),
);

it.effect(
  "a sign-in Connect knows nothing of yet, or still runs, reads as under way, and a granted one as succeeded",
  () =>
    Effect.gen(function* () {
      const pending = Result.succeed({ kind: CONNECT_SIGN_IN_RESULT.PENDING });
      assert.deepEqual(yield* resultOf({ status: 404, body: undefined }), pending);
      assert.deepEqual(yield* resultOf({ status: 200, body: { status: "partial" } }), pending);
      assert.deepEqual(yield* resultOf({ status: 200, body: { status: "pending" } }), pending);
      assert.deepEqual(
        yield* resultOf({ status: 200, body: { status: "success", data: {} } }),
        Result.succeed({ kind: CONNECT_SIGN_IN_RESULT.SUCCEEDED }),
      );
    }),
);

it.effect(
  "a result Connect could not give is unavailable, with its status and none of its words",
  () =>
    Effect.gen(function* () {
      for (const answer of [
        { status: 500, body: { error: { message: "internal" } } },
        { status: 200, body: "not json at all" },
      ]) {
        const read = yield* resultOf(answer);
        assert.ok(Result.isFailure(read));
        assert.equal(read.failure.reason, INTEGRATION_CONNECT_FAILURE.UNAVAILABLE);
        assert.equal(read.failure.status, answer.status);
      }
    }),
);
