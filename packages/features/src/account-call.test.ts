import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HTTP_METHOD } from "@repo/wire";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordedRequest,
  recordingHttpClient,
} from "@repo/wire/testing";
import { Effect, Fiber, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import {
  accountBearer,
  accountCall,
  CALL_FAULT,
  type CallCredential,
  callAnswered,
  lateCredential,
  NO_CREDENTIAL,
  ServiceReach,
  type ServiceReachState,
} from "./account-call.js";

const BASE_URL = "https://app.test";

const REACHABLE: ServiceReachState = { reachable: true, answeredAt: 0 };
const PATH = "/api/account/preferences";

function refusal(): Response {
  return jsonResponse({ error: "invalid-token" }, HTTP_STATUS.UNAUTHORIZED);
}

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

it.effect(
  "a late credential goes out as the credential it resolves: no header where that one has none",
  () =>
    Effect.gen(function* () {
      const { call, requests, client } = callOn(lateCredential(Effect.succeed({})), () =>
        jsonResponse({ ok: true }),
      );

      const answer = yield* Effect.provide(
        call.send({ method: HTTP_METHOD.GET, path: PATH }),
        client,
      );

      assert.ok(callAnswered(answer) && answer.response.ok);
      assert.equal(recordedRequest(requests).authorization, undefined);
    }),
);

it.effect("a late credential renews and retries on the bearer it resolves", () =>
  Effect.gen(function* () {
    const { credential } = account(["stale", "fresh"]);
    const { call, requests, client } = callOn(
      lateCredential(Effect.succeed(credential)),
      (request) =>
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
  }),
);

it.effect(
  "silence past 45 seconds, then a call that ends with no answer, sets the service unreachable, and the next answer, a refusal among them, sets it back",
  () =>
    Effect.gen(function* () {
      const reach = yield* SubscriptionRef.make<ServiceReachState>(REACHABLE);
      let asked = 0;
      const { call, client } = callOn(NO_CREDENTIAL, () => {
        asked += 1;
        if (asked === 1) throw new TypeError("Load failed");
        return refusal();
      });
      const send = Effect.provideService(
        Effect.provide(call.send({ method: HTTP_METHOD.GET, path: PATH }), client),
        ServiceReach,
        reach,
      );

      yield* TestClock.adjust("46 seconds");
      const unanswered = yield* send;
      assert.deepEqual(unanswered, { fault: CALL_FAULT.NETWORK, errorName: "TypeError" });
      assert.equal((yield* SubscriptionRef.get(reach)).reachable, false);

      const refused = yield* send;
      assert.ok(callAnswered(refused) && refused.response.status === HTTP_STATUS.UNAUTHORIZED);
      assert.equal((yield* SubscriptionRef.get(reach)).reachable, true);
    }),
);

it.effect(
  "a call that runs out its deadline within 45 seconds of the last answer leaves the service reachable",
  () =>
    Effect.gen(function* () {
      const reach = yield* SubscriptionRef.make<ServiceReachState>(REACHABLE);
      let asked = 0;
      const { call, client } = callOn(NO_CREDENTIAL, () => {
        asked += 1;
        return asked === 1 ? jsonResponse({ ok: true }) : new Promise<Response>(() => undefined);
      });
      const send = Effect.provideService(
        Effect.provide(call.send({ method: HTTP_METHOD.GET, path: PATH }), client),
        ServiceReach,
        reach,
      );

      yield* TestClock.adjust("30 seconds");
      assert.ok(callAnswered(yield* send));
      yield* TestClock.adjust("25 seconds");
      const silent = yield* Effect.forkChild(send);
      while (asked < 2) yield* Effect.yieldNow;
      yield* TestClock.adjust("10 seconds");
      const unanswered = yield* Fiber.join(silent);

      assert.deepEqual(unanswered, { fault: CALL_FAULT.NETWORK, errorName: "TimeoutError" });
      assert.equal((yield* SubscriptionRef.get(reach)).reachable, true);
    }),
);
