import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_CALLER,
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveCaller,
  type EveSessions,
  type EveUnreachable,
  eveSessions,
} from "../server/hosted/brain-host/eve-sessions";

/**
 * The host's three calls into eve, against an `HttpClient` that answers as
 * eve's routes document: the request each makes, how each answer reads, how
 * each of the two callers — an account's bearer, the deployment for an
 * account — identifies itself on the wire, how the not-active retry steps
 * through its ladder on the clock, and how a call that never reached eve
 * comes back typed.
 */

const ORIGIN = "https://luke.test";
const AUTHORIZATION = "Bearer token-1";
const ACCOUNT_CALLER: EveCaller = { kind: EVE_CALLER.ACCOUNT, authorization: AUTHORIZATION };
const CRON_SECRET = "cron-secret-1";
const ACCOUNT = "user-observed-1";
const DEPLOYMENT_CALLER: EveCaller = {
  kind: EVE_CALLER.DEPLOYMENT,
  secret: Redacted.make(CRON_SECRET),
  account: ACCOUNT,
};
const CONVERSATION = "2b000000-0000-4000-8000-000000000001";
const SESSION = "wrun_01M0000000000000000000001";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

/** An answer as eve's routes write one, in the fields the host reads. */
interface EveAnswer {
  readonly ok?: boolean;
  readonly sessionId?: string;
  readonly status?: string;
  readonly deliveryId?: string;
  readonly code?: string;
}

interface Answer {
  readonly status: number;
  readonly body: EveAnswer;
}

/** The request's body as the fake was handed it: text, or the bytes the client rendered the JSON to. */
async function bodyText(body: RequestInit["body"]): Promise<string> {
  return body === undefined || body === null ? "" : new Response(body).text();
}

/**
 * eve's client over a fake `HttpClient` answering the given answers in
 * order and the last of them thereafter, recording each request, for the
 * caller named. An answer of `undefined` is a transport that never
 * answered: the fake throws where the network would, and the client's
 * error comes back typed.
 */
function answeringEach(
  answers: readonly (Answer | undefined)[],
  caller: EveCaller = ACCOUNT_CALLER,
) {
  const seen: Seen[] = [];
  const client = fakeHttpClientLayer(async (url, init) => {
    seen.push({
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: JSON.parse(await bodyText(init.body)),
    });
    const answer = answers[Math.min(seen.length, answers.length) - 1];
    if (answer === undefined) throw new Error("fixture: connection refused");
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  const sessions: Effect.Effect<EveSessions> = Effect.provide(
    eveSessions({ origin: ORIGIN, caller }),
    client,
  );
  return { seen, sessions };
}

function answering(status: number, body: EveAnswer, caller: EveCaller = ACCOUNT_CALLER) {
  return answeringEach([{ status, body }], caller);
}

const NOT_ACTIVE: Answer = { status: 409, body: { ok: false, code: "session_not_active" } };
const ACCEPTED_FOLLOW_UP: Answer = {
  status: 202,
  body: { ok: true, sessionId: SESSION, status: "accepted", deliveryId: "delivery-1" },
};

const MESSAGE = { conversationId: CONVERSATION, turn: BRAIN_HOST_TURN.TYPED, message: "hello" };

it.effect(
  "opening posts the first message under the conversation and turn headers with the caller's bearer, and reads the session eve names",
  () =>
    Effect.gen(function* () {
      const { seen, sessions } = answering(202, {
        ok: true,
        sessionId: SESSION,
        status: "accepted",
      });
      assert.deepEqual(yield* Effect.flatMap(sessions, (eve) => eve.open(MESSAGE)), {
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId: SESSION,
      });
      assert.equal(seen.length, 1);
      const [request] = seen;
      assert.ok(request);
      assert.equal(request.url, `${ORIGIN}/eve/v1/session`);
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("authorization"), AUTHORIZATION);
      assert.equal(request.headers.get("content-type"), "application/json");
      assert.equal(request.headers.get(BRAIN_HOST_HEADER.ACCOUNT), null);
      assert.equal(request.headers.get(BRAIN_HOST_HEADER.CONVERSATION), CONVERSATION);
      assert.equal(request.headers.get(BRAIN_HOST_HEADER.TURN), BRAIN_HOST_TURN.TYPED);
      assert.deepEqual(request.body, { message: "hello" });
    }),
);

it.effect(
  "the deployment calls under its own secret and names the account it acts for in the account header, on an opening and a follow-up alike",
  () =>
    Effect.gen(function* () {
      const observation = { ...MESSAGE, turn: BRAIN_HOST_TURN.OBSERVATION };
      const opened = answering(
        202,
        { ok: true, sessionId: SESSION, status: "accepted" },
        DEPLOYMENT_CALLER,
      );
      assert.equal(
        (yield* Effect.flatMap(opened.sessions, (eve) => eve.open(observation))).outcome,
        EVE_SEND_OUTCOME.ACCEPTED,
      );
      const followed = answeringEach([ACCEPTED_FOLLOW_UP], DEPLOYMENT_CALLER);
      assert.equal(
        (yield* Effect.flatMap(followed.sessions, (eve) => eve.send(SESSION, observation))).outcome,
        EVE_SEND_OUTCOME.ACCEPTED,
      );
      for (const seen of [opened.seen[0], followed.seen[0]]) {
        assert.ok(seen);
        assert.equal(seen.headers.get("authorization"), `Bearer ${CRON_SECRET}`);
        assert.equal(seen.headers.get(BRAIN_HOST_HEADER.ACCOUNT), ACCOUNT);
        assert.equal(seen.headers.get(BRAIN_HOST_HEADER.TURN), BRAIN_HOST_TURN.OBSERVATION);
        assert.equal(seen.headers.get(BRAIN_HOST_HEADER.CONVERSATION), CONVERSATION);
      }
    }),
);

it.effect(
  "a follow-up posts to the session's own route and reads the delivery eve names; anything outside the documented answers reads as failed with its status",
  () =>
    Effect.gen(function* () {
      const accepted = answeringEach([ACCEPTED_FOLLOW_UP]);
      assert.deepEqual(
        yield* Effect.flatMap(accepted.sessions, (eve) => eve.send(SESSION, MESSAGE)),
        {
          outcome: EVE_SEND_OUTCOME.ACCEPTED,
          sessionId: SESSION,
          deliveryId: "delivery-1",
        },
      );
      assert.equal(accepted.seen.length, 1);
      assert.equal(accepted.seen[0]?.url, `${ORIGIN}/eve/v1/session/${SESSION}`);
      assert.equal(accepted.seen[0]?.headers.get(BRAIN_HOST_HEADER.TURN), BRAIN_HOST_TURN.TYPED);

      const refused = answering(403, { ok: false, code: "forbidden" });
      assert.deepEqual(
        yield* Effect.flatMap(refused.sessions, (eve) => eve.send(SESSION, MESSAGE)),
        {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: 403,
        },
      );

      const unreadable = answering(202, { ok: true });
      assert.deepEqual(
        yield* Effect.flatMap(unreadable.sessions, (eve) => eve.send(SESSION, MESSAGE)),
        { outcome: EVE_SEND_OUTCOME.FAILED, status: 202 },
      );
    }),
);

it.effect(
  "a not-active follow-up is tried again on the SDK's own schedule, reads as accepted the moment the session's inbox is up, and as retired only past the last wait",
  () =>
    Effect.gen(function* () {
      const starting = answeringEach([NOT_ACTIVE, NOT_ACTIVE, ACCEPTED_FOLLOW_UP]);
      const sending = yield* Effect.forkChild(
        Effect.flatMap(starting.sessions, (eve) => eve.send(SESSION, MESSAGE)),
        { startImmediately: true },
      );
      // The first try goes at once; the second waits 250 ms, the third 500 ms more.
      yield* TestClock.adjust("249 millis");
      assert.equal(starting.seen.length, 1);
      yield* TestClock.adjust("1 millis");
      assert.equal(starting.seen.length, 2);
      yield* TestClock.adjust("500 millis");
      assert.deepEqual(yield* Fiber.join(sending), {
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId: SESSION,
        deliveryId: "delivery-1",
      });
      assert.equal(starting.seen.length, 3);

      const retired = answeringEach([NOT_ACTIVE]);
      const retiring = yield* Effect.forkChild(
        Effect.flatMap(retired.sessions, (eve) => eve.send(SESSION, MESSAGE)),
        { startImmediately: true },
      );
      yield* TestClock.adjust("250 millis");
      yield* TestClock.adjust("500 millis");
      assert.equal(retired.seen.length, 3);
      yield* TestClock.adjust("1000 millis");
      assert.deepEqual(yield* Fiber.join(retiring), { outcome: EVE_SEND_OUTCOME.RETIRED });
      assert.equal(retired.seen.length, 4);
    }),
);

it.effect(
  "a cancel posts to the session's cancel route naming eve's turn id, and reads whether eve had that turn to cancel",
  () =>
    Effect.gen(function* () {
      const accepted = answering(200, { ok: true, sessionId: SESSION, status: "accepted" });
      assert.deepEqual(
        yield* Effect.flatMap(accepted.sessions, (eve) => eve.cancel(SESSION, "turn_4")),
        {
          outcome: EVE_CANCEL_OUTCOME.ACCEPTED,
        },
      );
      assert.equal(accepted.seen[0]?.url, `${ORIGIN}/eve/v1/session/${SESSION}/cancel`);
      assert.deepEqual(accepted.seen[0]?.body, { turnId: "turn_4" });

      const idle = answering(200, { ok: true, status: "no_active_turn" });
      assert.deepEqual(
        yield* Effect.flatMap(idle.sessions, (eve) => eve.cancel(SESSION, "turn_4")),
        {
          outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN,
        },
      );

      const failed = answering(500, { ok: false });
      assert.deepEqual(
        yield* Effect.flatMap(failed.sessions, (eve) => eve.cancel(SESSION, "turn_4")),
        {
          outcome: EVE_CANCEL_OUTCOME.FAILED,
          status: 500,
        },
      );
    }),
);

it.effect(
  "a call the transport never answered is the typed unreachable failure on every route, carrying the client's own error, and is retried nowhere",
  () =>
    Effect.gen(function* () {
      const down = answeringEach([undefined]);
      const eve = yield* down.sessions;
      const calls: Effect.Effect<unknown, EveUnreachable>[] = [
        eve.open(MESSAGE),
        eve.send(SESSION, MESSAGE),
        eve.cancel(SESSION, "turn_4"),
      ];
      for (const call of calls) {
        const failure = yield* Effect.flip(call);
        assert.equal(failure._tag, "EveUnreachable");
        assert.equal(failure.cause._tag, "HttpClientError");
        assert.equal(failure.cause.reason._tag, "TransportError");
      }
      assert.equal(down.seen.length, 3);
    }),
);
