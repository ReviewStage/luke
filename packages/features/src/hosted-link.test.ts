import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  fakeCloudApi,
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingHttpClient,
} from "@repo/wire/testing";
import { Effect, Fiber, Random } from "effect";
import { TestClock } from "effect/testing";
import { accountBearer, CALL_FAULT, type CallCredential } from "./account-call.js";
import {
  askHosted,
  HOSTED_DEADLINE,
  type HostedDeadline,
  type HostedFailure,
  HostedRefused,
  HostedUnanswered,
  hostedClient,
} from "./hosted-link.js";
import { MODEL_PROVIDER } from "./models-wire.js";
import { REPOSITORY_UNREACHED } from "./repository-reach-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const BASE_URL = "https://app.test";
const MODELS_ROUTE = "GET /api/models";
const CHAPTERS_ROUTE = "GET /api/agents/agent-1/chapters";

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

/** A trace id as Effect's tracer mints one: 32 lowercase hex characters. */
const TRACE_ID = /^[0-9a-f]{32}$/;

/** The trace a failure traveled under, checked to be a trace id, since every ask mints its own. */
function traceOf(failure: HostedFailure): string {
  const traceId = failure.traceId ?? "";
  assert.match(traceId, TRACE_ID);
  return traceId;
}

/** A random draw that always lands on `value`, so an ask's sampling is decided by the test. */
function drawing(value: number) {
  return { nextDoubleUnsafe: () => value, nextIntUnsafe: () => 0 };
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

    assert.deepEqual(
      failure,
      new HostedUnanswered({ fault: CALL_FAULT.HOLDER_CHANGED, traceId: traceOf(failure) }),
    );
    assert.equal(recording.requests.length, 1);
  }),
);

it.effect("a 401 that renewal cannot change stands as the refusal it is", () =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() => invalidToken());

    const failure = yield* Effect.flip(
      Effect.provide(askModels(account(["stale"])), recording.layer),
    );

    assert.deepEqual(
      failure,
      new HostedRefused({ refusal: HOSTED_API_ERROR.INVALID_TOKEN, traceId: traceOf(failure) }),
    );
    assert.equal(recording.requests.length, 1);
  }),
);

it.effect("a signed-out account asks nothing and fails as no credential", () =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() => jsonResponse({ models: [MODEL] }));

    const failure = yield* Effect.flip(
      Effect.provide(askModels(account([undefined])), recording.layer),
    );

    assert.deepEqual(
      failure,
      new HostedUnanswered({ fault: CALL_FAULT.NO_CREDENTIAL, traceId: traceOf(failure) }),
    );
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
    const usualFailure = yield* Fiber.join(usual);
    assert.deepEqual(
      usualFailure,
      new HostedUnanswered({
        fault: CALL_FAULT.NETWORK,
        errorName: "TimeoutError",
        traceId: traceOf(usualFailure),
      }),
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
    const heldFailure = yield* Fiber.join(held);
    assert.deepEqual(
      heldFailure,
      new HostedUnanswered({
        fault: CALL_FAULT.NETWORK,
        errorName: "TimeoutError",
        traceId: traceOf(heldFailure),
      }),
    );
  }),
);

it.effect("a body that arrives past what is left of the deadline is let go at the deadline", () =>
  Effect.gen(function* () {
    let answer: (response: Response) => void = () => undefined;
    let bodyAsked = false;
    // Note that the body is pulled only once the link reads it, so the test knows its deadline is armed.
    const body = new ReadableStream<Uint8Array>(
      {
        pull: () => {
          bodyAsked = true;
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 },
    );
    const slow = recordingHttpClient(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );

    const asked = yield* Effect.forkChild(
      Effect.flip(Effect.provide(askModels(account(["token-1"])), slow.layer)),
    );
    yield* untilAsked(slow.requests);
    yield* TestClock.adjust("8 seconds");
    answer(new Response(body, { status: HTTP_STATUS.OK }));
    while (!bodyAsked) yield* Effect.yieldNow;
    yield* TestClock.adjust("1 second");
    assert.equal(asked.pollUnsafe(), undefined, "still reading short of the deadline");
    yield* TestClock.adjust("1 second");
    for (let step = 0; step < 100 && asked.pollUnsafe() === undefined; step++) {
      yield* Effect.yieldNow;
    }
    assert.notEqual(asked.pollUnsafe(), undefined, "let go at the one deadline");
    const failure = yield* Fiber.join(asked);
    assert.deepEqual(
      failure,
      new HostedUnanswered({
        unread: "body-unread",
        status: HTTP_STATUS.OK,
        traceId: traceOf(failure),
      }),
    );
  }),
);

it.effect("a repository out of reach reaches the caller with why", () =>
  Effect.gen(function* () {
    const unreached = { reason: REPOSITORY_UNREACHED.GONE, repository: "Acme/Relay" };
    const api = fakeCloudApi({
      [CHAPTERS_ROUTE]: {
        answer: () => ({ error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached }),
        status: HTTP_STATUS.FORBIDDEN,
      },
    });
    const hosted = hostedClient({ baseUrl: `${BASE_URL}/`, credential: account(["token-1"]) });

    // A pull request's chapters stand in for a procedure that declares the refusal.
    const failure = yield* Effect.flip(
      Effect.provide(
        askHosted(hosted.pullRequestChapters.read, { id: "agent-1", number: "7" }),
        api.layer,
      ),
    );

    assert.deepEqual(
      failure,
      new HostedRefused({
        refusal: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
        data: { unreached },
        traceId: traceOf(failure),
      }),
    );
  }),
);

it.effect("a server error the service declares no refusal for keeps its status and oRPC code", () =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() =>
      jsonResponse(
        { defined: false, code: "INTERNAL_SERVER_ERROR", message: "Internal server error" },
        HTTP_STATUS.SERVER_ERROR,
      ),
    );

    const failure = yield* Effect.flip(
      Effect.provide(askModels(account(["token-1"])), recording.layer),
    );

    assert.deepEqual(
      failure,
      new HostedUnanswered({
        status: HTTP_STATUS.SERVER_ERROR,
        code: "INTERNAL_SERVER_ERROR",
        traceId: traceOf(failure),
      }),
    );
  }),
);

it.effect(
  "an ask sends the trace its failure names, flagged unsampled where the draw says so",
  () =>
    Effect.gen(function* () {
      const recording = recordingHttpClient(
        () => new Response("", { status: HTTP_STATUS.SERVER_ERROR }),
      );

      const failure = yield* Effect.flip(
        Effect.provide(askModels(account(["token-1"])), recording.layer).pipe(
          Effect.provideService(Random.Random, drawing(0.99)),
        ),
      );

      const [, traceId, , flags] = (recording.requests[0]?.headers.get("traceparent") ?? "").split(
        "-",
      );
      assert.equal(traceId, traceOf(failure), "the server continues the trace the report names");
      assert.equal(flags, "00", "an ask past the sample rate is sent unsampled, not untraced");
    }),
);
