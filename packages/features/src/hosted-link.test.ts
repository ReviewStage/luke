import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  fakeCloudApi,
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@luke/wire/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { accountBearer, CALL_FAULT, type CallCredential } from "./account-call.js";
import {
  askHosted,
  HOSTED_DEADLINE,
  type HostedDeadline,
  HostedRefused,
  HostedUnanswered,
  hostedClient,
} from "./hosted-link.js";
import { MODEL_PROVIDER } from "./models-wire.js";
import { REPOSITORY_UNREACHED } from "./repository-reach-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const BASE_URL = "https://luke.test";
const MODELS_ROUTE = "GET /api/models";

const MODEL = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "high"],
};

function invalidToken(): Response {
  return jsonResponse({ error: HOSTED_API_ERROR.INVALID_TOKEN }, HTTP_STATUS.UNAUTHORIZED);
}

/** An account whose token and holder the test moves, renewing to the next of each. */
function account(tokens: (string | undefined)[], holders: string[] = ["account-1"]) {
  let token = tokens.shift();
  let holder = holders.shift();
  return accountBearer({
    readAccessToken: () => Effect.succeed(token),
    refreshAccount: () =>
      Effect.sync(() => {
        token = tokens.shift() ?? token;
        holder = holders.shift() ?? holder;
      }),
    readAccountKey: () => Effect.succeed(holder),
  });
}

/** The models procedure asked through the link under the credential and deadline given. */
function askModels(credential: CallCredential, deadline?: HostedDeadline) {
  const hosted = hostedClient({ baseUrl: `${BASE_URL}/`, credential });
  return askHosted(hosted.models.list, undefined, deadline);
}

/** Lets the link's promise steps run until the client has been asked, so the deadline is armed before the clock moves. */
function untilAsked(requests: readonly RecordedRequest[]): Effect.Effect<void> {
  return Effect.gen(function* () {
    while (requests.length === 0) yield* Effect.yieldNow;
  });
}

it.effect("a procedure answers its output as the wire schema reads it, a newer key dropped", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [MODELS_ROUTE]: { answer: () => ({ models: [{ ...MODEL, addedLater: true }] }) },
    });

    const answer = yield* Effect.provide(askModels(account(["token-1"])), api.layer);

    assert.deepEqual(answer, { models: [MODEL] });
    assert.deepEqual(api.credentials(), ["token-1"]);
  }),
);

it.effect("a 401 renews the credential and the one retry carries the renewed one", () =>
  Effect.gen(function* () {
    const recording = recordingHttpClient((request) =>
      request.authorization === "Bearer fresh" ? jsonResponse({ models: [MODEL] }) : invalidToken(),
    );

    const answer = yield* Effect.provide(askModels(account(["stale", "fresh"])), recording.layer);

    assert.deepEqual(answer, { models: [MODEL] });
    assert.deepEqual(
      recording.requests.map((request) => request.authorization),
      ["Bearer stale", "Bearer fresh"],
    );
  }),
);

it.effect("a 401 whose renewal answers for another account is not retried under it", () =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() => invalidToken());

    const failure = yield* Effect.flip(
      Effect.provide(
        askModels(account(["stale", "fresh"], ["account-1", "account-2"])),
        recording.layer,
      ),
    );

    assert.deepEqual(failure, new HostedUnanswered({ fault: CALL_FAULT.HOLDER_CHANGED }));
    assert.equal(recording.requests.length, 1);
  }),
);

it.effect("a 401 that renewal cannot change stands as the refusal it is", () =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() => invalidToken());

    const failure = yield* Effect.flip(
      Effect.provide(askModels(account(["stale"])), recording.layer),
    );

    assert.deepEqual(failure, new HostedRefused({ refusal: HOSTED_API_ERROR.INVALID_TOKEN }));
    assert.equal(recording.requests.length, 1);
  }),
);

it.effect("a signed-out account asks nothing and fails as no credential", () =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() => jsonResponse({ models: [MODEL] }));

    const failure = yield* Effect.flip(
      Effect.provide(askModels(account([undefined])), recording.layer),
    );

    assert.deepEqual(failure, new HostedUnanswered({ fault: CALL_FAULT.NO_CREDENTIAL }));
    assert.equal(recording.requests.length, 0);
  }),
);

it.effect("a procedure is unanswered at the deadline its ask names, and not before", () =>
  Effect.gen(function* () {
    const silent = recordingHttpClient(() => new Promise<Response>(() => undefined));

    const usual = yield* Effect.forkChild(
      Effect.flip(Effect.provide(askModels(account(["token-1"])), silent.layer)),
    );
    yield* untilAsked(silent.requests);
    yield* TestClock.adjust("9 seconds");
    assert.equal(usual.pollUnsafe(), undefined, "still waiting short of the usual deadline");
    yield* TestClock.adjust("1 second");
    assert.deepEqual(
      yield* Fiber.join(usual),
      new HostedUnanswered({ fault: CALL_FAULT.NETWORK, errorName: "TimeoutError" }),
    );

    const heldSilent = recordingHttpClient(() => new Promise<Response>(() => undefined));
    const held = yield* Effect.forkChild(
      Effect.flip(
        Effect.provide(askModels(account(["token-1"]), HOSTED_DEADLINE.HELD), heldSilent.layer),
      ),
    );
    yield* untilAsked(heldSilent.requests);
    yield* TestClock.adjust("34 seconds");
    assert.equal(held.pollUnsafe(), undefined, "a held read outlasts the usual deadline");
    yield* TestClock.adjust("1 second");
    assert.deepEqual(
      yield* Fiber.join(held),
      new HostedUnanswered({ fault: CALL_FAULT.NETWORK, errorName: "TimeoutError" }),
    );
  }),
);

it.effect("a repository out of reach reaches the caller with why", () =>
  Effect.gen(function* () {
    const unreached = { reason: REPOSITORY_UNREACHED.GONE, repository: "Acme/Relay" };
    const api = fakeCloudApi({
      [MODELS_ROUTE]: {
        answer: () => ({ error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached }),
        status: HTTP_STATUS.FORBIDDEN,
      },
    });

    const failure = yield* Effect.flip(Effect.provide(askModels(account(["token-1"])), api.layer));

    assert.deepEqual(
      failure,
      new HostedRefused({
        refusal: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
        data: { unreached },
      }),
    );
  }),
);
