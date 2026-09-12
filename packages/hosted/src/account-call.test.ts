import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HTTP_METHOD, type UnparsedWireValue } from "@sidecar/wire";
import {
  fakeCloudApi,
  fakeHttpClientLayer,
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordedRequest,
  recordingHttpClient,
} from "@sidecar/wire/testing";
import { Deferred, Duration, Effect, Fiber, Schema, TestClock } from "effect";
import { test } from "vitest";
import {
  accountBearer,
  accountCall,
  CALL_FAULT,
  type CallCredential,
  callAnswered,
  createAccountCall,
  fixedBearer,
  NO_CREDENTIAL,
} from "./account-call.js";

const BASE_URL = "https://luke.test";
const PATH = "/api/account/preferences";

const preferencesSchema = Schema.Struct({ voice: Schema.String });

function refusal(): Response {
  return jsonResponse({ error: "invalid-token" }, HTTP_STATUS.UNAUTHORIZED);
}

/** An account whose token the test moves, and whose holder it can move too. */
function account(tokens: (string | undefined)[], holders?: (string | undefined)[]) {
  const renewals: string[] = [];
  let token = tokens.shift();
  let holder = holders?.shift();
  return {
    renewals,
    credential: accountBearer({
      readAccessToken: () => Effect.succeed(token),
      refreshAccount: () =>
        Effect.sync(() => {
          renewals.push("renewed");
          token = tokens.shift() ?? token;
          holder = holders === undefined ? holder : (holders.shift() ?? holder);
        }),
      ...(holders ? { readAccountKey: () => Effect.succeed(holder) } : undefined),
    }),
  };
}

/**
 * The call under a client that answers each request by hand, for a route whose
 * status moves between attempts — what a renewed credential is read by, and
 * what a route table's one status per route cannot say.
 */
function callOn(
  credential: CallCredential,
  respond: (request: RecordedRequest) => Response | Promise<Response>,
  requestTimeoutMs?: number,
) {
  const recording = recordingHttpClient(respond);
  return {
    requests: recording.requests,
    call: accountCall({
      baseUrl: `${BASE_URL}/`,
      credential,
      ...(requestTimeoutMs === undefined ? undefined : { requestTimeoutMs }),
    }),
    client: recording.layer,
  };
}

it.effect("the base address is trimmed once and a body is what names a content type", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`${HTTP_METHOD.PUT} ${PATH}`]: { answer: () => ({}) },
      [`${HTTP_METHOD.GET} ${PATH}`]: { answer: () => ({}) },
    });
    const call = accountCall({ baseUrl: `${BASE_URL}/`, credential: fixedBearer("sk-test") });

    yield* Effect.provide(
      Effect.gen(function* () {
        yield* call.send({ method: HTTP_METHOD.PUT, path: PATH, body: '{"a":1}' });
        yield* call.send({ method: HTTP_METHOD.GET, path: PATH });
      }),
      api.layer,
    );

    const requests = api.requests();
    assert.equal(recordedRequest(requests).url, `${BASE_URL}${PATH}`);
    assert.equal(recordedRequest(requests).method, HTTP_METHOD.PUT);
    assert.equal(recordedRequest(requests).authorization, "Bearer sk-test");
    assert.equal(recordedRequest(requests).contentType, "application/json");
    assert.equal(recordedRequest(requests).body, '{"a":1}');
    assert.equal(recordedRequest(requests, 1).contentType, undefined);
    assert.equal(recordedRequest(requests, 1).body, undefined);
    assert.equal(call.address(PATH), `${BASE_URL}${PATH}`);
  }),
);

it.effect("a header the build fixes travels, and cannot displace the authorization", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ [`${HTTP_METHOD.POST} ${PATH}`]: { answer: () => ({}) } });
    const call = accountCall({ baseUrl: BASE_URL, credential: fixedBearer("sk-test") });

    yield* Effect.provide(
      call.send({
        method: HTTP_METHOD.POST,
        path: PATH,
        body: "{}",
        headers: { "x-luke-client": "desktop", authorization: "Bearer forged" },
      }),
      api.layer,
    );

    const request = recordedRequest(api.requests());
    assert.equal(request.headers.get("x-luke-client"), "desktop");
    assert.equal(request.authorization, "Bearer sk-test");
  }),
);

it.effect("a 401 renews the credential and retries once, on the credential that changed", () =>
  Effect.gen(function* () {
    const { credential, renewals } = account(["stale", "fresh"]);
    const { call, requests, client } = callOn(credential, (request) =>
      request.authorization === "Bearer fresh" ? jsonResponse({ ok: true }) : refusal(),
    );

    const answer = yield* Effect.provide(
      call.send({ method: HTTP_METHOD.GET, path: PATH }),
      client,
    );

    assert.ok(callAnswered(answer) && answer.response.ok);
    assert.deepEqual(
      requests.map((request) => request.authorization),
      ["Bearer stale", "Bearer fresh"],
    );
    assert.equal(renewals.length, 1);
  }),
);

it.effect(
  "a renewal that produced the same credential, or none at all, leaves the refusal standing",
  () =>
    Effect.gen(function* () {
      const unchanged = account(["only"]);
      const stuck = callOn(unchanged.credential, () => refusal());
      const standing = yield* Effect.provide(
        stuck.call.send({ method: HTTP_METHOD.GET, path: PATH }),
        stuck.client,
      );
      assert.ok(callAnswered(standing) && standing.response.status === HTTP_STATUS.UNAUTHORIZED);
      assert.equal(stuck.requests.length, 1);
      assert.equal(unchanged.renewals.length, 1);

      const signedOut = account(["held", undefined]);
      const gone = callOn(signedOut.credential, () => refusal());
      const answer = yield* Effect.provide(
        gone.call.send({ method: HTTP_METHOD.GET, path: PATH }),
        gone.client,
      );
      assert.ok(callAnswered(answer) && answer.response.status === HTTP_STATUS.UNAUTHORIZED);
      assert.equal(gone.requests.length, 1);

      const failing = callOn(
        {
          authorization: () => Effect.succeed("Bearer held"),
          renew: () => Effect.fail(new Error("the network is down")),
        },
        () => refusal(),
      );
      const refused = yield* Effect.provide(
        failing.call.send({ method: HTTP_METHOD.GET, path: PATH }),
        failing.client,
      );
      assert.ok(callAnswered(refused) && refused.response.status === HTTP_STATUS.UNAUTHORIZED);
    }),
);

it.effect("a credential that reads nothing asks the service nothing at all", () =>
  Effect.gen(function* () {
    const { call, requests, client } = callOn(account([undefined]).credential, () =>
      jsonResponse({}),
    );

    const answer = yield* Effect.provide(
      call.send({ method: HTTP_METHOD.GET, path: PATH }),
      client,
    );

    assert.ok(!callAnswered(answer) && answer.fault === CALL_FAULT.NO_CREDENTIAL);
    assert.deepEqual(requests, []);
  }),
);

it.effect(
  "an endpoint that takes no identity is asked without a header, and its own 401 is no fault of a credential",
  () =>
    Effect.gen(function* () {
      const { call, requests, client } = callOn(NO_CREDENTIAL, () => refusal());

      const answer = yield* Effect.provide(
        call.send({ method: HTTP_METHOD.POST, path: PATH, body: "{}" }),
        client,
      );

      assert.ok(callAnswered(answer) && answer.response.status === HTTP_STATUS.UNAUTHORIZED);
      assert.equal(requests.length, 1);
      assert.equal(recordedRequest(requests).authorization, undefined);
    }),
);

it.effect("a holder that changed between the attempt and its retry refuses the retry", () =>
  Effect.gen(function* () {
    const { credential, renewals } = account(
      ["stale", "fresh"],
      ["ada@luke.test", "grace@luke.test"],
    );
    const { call, requests, client } = callOn(credential, () => refusal());

    const answer = yield* Effect.provide(
      call.send({ method: HTTP_METHOD.POST, path: PATH, body: "{}" }),
      client,
    );

    assert.ok(!callAnswered(answer) && answer.fault === CALL_FAULT.HOLDER_CHANGED);
    assert.equal(renewals.length, 1);
    assert.deepEqual(
      requests.map((request) => request.authorization),
      ["Bearer stale"],
    );
  }),
);

it.effect("a holder that stands is retried under the credential that changed", () =>
  Effect.gen(function* () {
    const { credential } = account(["stale", "fresh"], ["ada@luke.test"]);
    const { call, requests, client } = callOn(credential, (request) =>
      request.authorization === "Bearer fresh" ? jsonResponse({ ok: true }) : refusal(),
    );

    const answer = yield* Effect.provide(
      call.send({ method: HTTP_METHOD.GET, path: PATH }),
      client,
    );

    assert.ok(callAnswered(answer) && answer.response.ok);
    assert.equal(requests.length, 2);
  }),
);

it.effect("a client that failed is a network fault named by the error's kind alone", () =>
  Effect.gen(function* () {
    const { call, client } = callOn(fixedBearer("sk-secret-key"), () => {
      throw new TypeError("sk-secret-key was refused by dns");
    });

    const answer = yield* Effect.provide(
      call.send({ method: HTTP_METHOD.GET, path: PATH }),
      client,
    );

    assert.ok(!callAnswered(answer) && answer.fault === CALL_FAULT.NETWORK);
    assert.equal(answer.errorName, "TypeError");
  }),
);

it.effect("an ask answers a body its own schema admitted, and nothing else", () =>
  Effect.gen(function* () {
    const answered = callOn(fixedBearer("sk-test"), () => jsonResponse({ voice: "marin" }));
    assert.deepEqual(
      yield* Effect.provide(
        answered.call.ask({ method: HTTP_METHOD.GET, path: PATH }, preferencesSchema),
        answered.client,
      ),
      { voice: "marin" },
    );

    const refused = callOn(fixedBearer("sk-test"), () => refusal());
    assert.equal(
      yield* Effect.provide(
        refused.call.ask({ method: HTTP_METHOD.GET, path: PATH }, preferencesSchema),
        refused.client,
      ),
      undefined,
    );

    const unreadable = callOn(fixedBearer("sk-test"), () => new Response("not json"));
    assert.equal(
      yield* Effect.provide(
        unreadable.call.ask({ method: HTTP_METHOD.GET, path: PATH }, preferencesSchema),
        unreadable.client,
      ),
      undefined,
    );

    const offline = callOn(fixedBearer("sk-test"), () => {
      throw new Error("offline");
    });
    assert.equal(
      yield* Effect.provide(
        offline.call.ask({ method: HTTP_METHOD.GET, path: PATH }, preferencesSchema),
        offline.client,
      ),
      undefined,
    );

    const refusedBySchema = callOn(fixedBearer("sk-test"), () => jsonResponse({}));
    assert.equal(
      yield* Effect.provide(
        refusedBySchema.call.ask({ method: HTTP_METHOD.GET, path: PATH }, preferencesSchema),
        refusedBySchema.client,
      ),
      undefined,
    );
  }),
);

it.effect("a read answers what a caller's own reader admitted, and nothing else", () =>
  Effect.gen(function* () {
    const read = (payload: UnparsedWireValue) => (payload === undefined ? undefined : { payload });

    const answered = callOn(fixedBearer("sk-test"), () => jsonResponse({ voice: "marin" }));
    assert.deepEqual(
      yield* Effect.provide(
        answered.call.read({ method: HTTP_METHOD.GET, path: PATH }, read),
        answered.client,
      ),
      { payload: { voice: "marin" } },
    );

    const refusedByReader = callOn(fixedBearer("sk-test"), () => jsonResponse({}));
    assert.equal(
      yield* Effect.provide(
        refusedByReader.call.read({ method: HTTP_METHOD.GET, path: PATH }, () => undefined),
        refusedByReader.client,
      ),
      undefined,
    );

    const refused = callOn(fixedBearer("sk-test"), () => refusal());
    assert.equal(
      yield* Effect.provide(
        refused.call.read({ method: HTTP_METHOD.GET, path: PATH }, read),
        refused.client,
      ),
      undefined,
    );
  }),
);

it.effect(
  "the deadline is the one the call was built with, and it ends a request that outlives it",
  () =>
    Effect.gen(function* () {
      assert.equal(
        accountCall({ baseUrl: BASE_URL, credential: fixedBearer("sk-test") }).requestTimeoutMs,
        10_000,
      );

      const held = accountCall({
        baseUrl: BASE_URL,
        credential: fixedBearer("sk-test"),
        requestTimeoutMs: 90_000,
      });
      assert.equal(held.requestTimeoutMs, 90_000);

      const asked = yield* Deferred.make<void>();

      const sending = yield* Effect.fork(
        Effect.provide(
          held.send({ method: HTTP_METHOD.GET, path: PATH }),
          fakeHttpClientLayer(() => {
            Deferred.unsafeDone(asked, Effect.void);
            return new Promise<Response>(() => undefined);
          }),
        ),
      );
      yield* Deferred.await(asked);
      yield* TestClock.adjust(Duration.millis(90_000));
      const answer = yield* Fiber.join(sending);

      assert.ok(!callAnswered(answer) && answer.fault === CALL_FAULT.NETWORK);
      assert.equal(answer.errorName, "TimeoutError");
    }),
);

test("the promise the migration keeps answers a validated body over the caller's own fetch", async () => {
  const recording = recordingHttpClient(() => jsonResponse({ voice: "marin" }));
  const call = createAccountCall({
    baseUrl: BASE_URL,
    credential: fixedBearer("sk-test"),
    httpClient: recording.layer,
  });

  const answer = await call.ask({ method: HTTP_METHOD.GET, path: PATH }, (payload) => payload);

  assert.deepEqual(answer, { voice: "marin" });
  assert.equal(recordedRequest(recording.requests).authorization, "Bearer sk-test");
  assert.equal(call.address(PATH), `${BASE_URL}${PATH}`);
});

test("the caller's own cancellation ends the request, named by the reason it carried", async () => {
  const cancellation = new AbortController();
  const call = createAccountCall({
    baseUrl: BASE_URL,
    credential: fixedBearer("sk-test"),
    httpClient: fakeHttpClientLayer(
      () =>
        new Promise<Response>((_settle, reject) => {
          cancellation.abort();
          cancellation.signal.addEventListener("abort", () => reject(cancellation.signal.reason));
        }),
    ),
  });

  const answer = await call.send({
    method: HTTP_METHOD.GET,
    path: PATH,
    signal: cancellation.signal,
  });

  assert.ok(!callAnswered(answer) && answer.fault === CALL_FAULT.NETWORK);
  assert.equal(answer.errorName, "AbortError");
});
