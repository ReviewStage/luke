import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fixedBearer, HOSTED_SERVICE_PATH } from "@repo/features";
import { type LiveSocketAsk, liveSocketAskSchema } from "@repo/features/live-wire";
import { type Cause, Deferred, Duration, Effect, Exit, Fiber, Queue, Schema, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import type {
  OpenTerminalSocket,
  TerminalSocketArrival,
  TerminalSocketOpening,
} from "./compose-terminals.js";
import { liveSocketClient } from "./live-socket.js";

/**
 * The host's client with its live reads over one socket, on a scripted
 * relay, a scripted HTTP client, and the test clock: a read goes over HTTP
 * while a socket opens, and once one stands, a live read's GET travels over
 * it as its path and query and is answered with what the socket answered,
 * while a write goes over HTTP; a 401 closes the socket and is asked again
 * over HTTP; a socket past its time takes no new asks while the ones it
 * holds are still answered; and an ask left unanswered closes its socket and
 * fails before the deadline it travels under, so the read is asked again on
 * a fresh connection rather than over HTTP with too little time left.
 */

const SERVICE = "https://app.test";
const TASKS_POLL = `${SERVICE}/api/live/tasks?userId=user-1&poll=true&after=d1`;
const HTTP_BODY = JSON.stringify({ over: "http" });
const INBOX_READ = `${SERVICE}${HOSTED_SERVICE_PATH.INBOX_READ}`;
/** A live read the service answers at once, past no digest, so it travels under the usual deadline. */
const TASKS_READ = `${SERVICE}/api/live/tasks?userId=user-1&poll=true`;

/** How long a socket takes new asks, how long it then drains, and how long an ask waits, as the plan sets them. */
const ROTATE_AFTER = Duration.minutes(12);
const DRAIN = Duration.seconds(40);

/** The account call's usual deadline, which an ordinary live read travels under. */
const USUAL_DEADLINE = Duration.seconds(10);

/** One relay socket as a test drives it: once the host reads it, the asks it sent read in order, answers pushed in, and whether its scope closed. */
const scriptedSocket = Effect.gen(function* () {
  const arrivals = yield* Queue.unbounded<TerminalSocketArrival, Cause.Done>();
  const asked = yield* Queue.unbounded<LiveSocketAsk>();
  const read = yield* Deferred.make<void>();
  const state = { closed: false };
  const opening: TerminalSocketOpening = {
    socket: {
      arrivals: Stream.unwrap(
        Effect.as(Deferred.succeed(read, undefined), Stream.fromQueue(arrivals)),
      ),
      send: (frame) =>
        "text" in frame
          ? Effect.asVoid(
              Queue.offer(
                asked,
                Schema.decodeUnknownSync(liveSocketAskSchema)(JSON.parse(frame.text)),
              ),
            )
          : Effect.void,
      pause: Effect.void,
      resume: Effect.void,
    },
  };
  return {
    opening,
    state,
    /** Done once the host reads the socket, which it does from the moment the socket takes asks. */
    reading: Deferred.await(read),
    asked: Queue.take(asked),
    answer: (id: number, status: number, body: string) =>
      Queue.offer(arrivals, { text: JSON.stringify({ id, status, body }) }),
    closing: Effect.andThen(Queue.offer(arrivals, { close: 1000 }), Queue.end(arrivals)),
  };
});

type Scripted = Effect.Success<typeof scriptedSocket>;

/** A relay whose every open stands a new scripted socket, read in order, its scope's close marking it closed. */
const scriptedRelay = Effect.gen(function* () {
  const opened = yield* Queue.unbounded<Scripted>();
  const addresses: string[] = [];
  const open: OpenTerminalSocket = (url, headers) =>
    Effect.gen(function* () {
      addresses.push(`${url} ${headers.authorization ?? ""}`);
      const scripted = yield* scriptedSocket;
      yield* Effect.addFinalizer(() =>
        Effect.andThen(
          Effect.sync(() => {
            scripted.state.closed = true;
          }),
          scripted.closing,
        ),
      );
      yield* Queue.offer(opened, scripted);
      return scripted.opening;
    });
  return { open, opened: Queue.take(opened), addresses };
});

/** An HTTP client that answers every request itself, keeping what it was asked. */
function scriptedHttp() {
  const asked: string[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      asked.push(`${request.method} ${request.url}`);
      return HttpClientResponse.fromWeb(request, new Response(HTTP_BODY, { status: 200 }));
    }),
  );
  return { client, asked };
}

/** The client under test, over a scripted relay and HTTP client. */
const subject = Effect.gen(function* () {
  const relay = yield* scriptedRelay;
  const http = scriptedHttp();
  const client = yield* liveSocketClient({
    http: http.client,
    openSocket: relay.open,
    credential: fixedBearer("token-1"),
    serviceBaseUrl: SERVICE,
  });
  /** A live poll asked, as a fiber its answer is joined from. */
  const poll = Effect.forkChild(
    Effect.flatMap(client.execute(HttpClientRequest.get(TASKS_POLL)), (response) =>
      Effect.map(response.text, (text) => ({ status: response.status, text })),
    ),
  );
  return { relay, http, client, poll };
});

it.effect(
  "a live read travels over the socket as its path and query, a write over HTTP, and a 401 closes the socket and asks again over HTTP",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { relay, http, client, poll } = yield* subject;

        // The first read goes over HTTP while the socket opens, so no read waits on an open.
        assert.deepEqual(yield* Fiber.join(yield* poll), { status: 200, text: HTTP_BODY });
        const socket = yield* relay.opened;
        assert.deepEqual(relay.addresses, ["wss://app.test/api/live/socket Bearer token-1"]);
        yield* socket.reading;

        const polled = yield* poll;
        const ask = yield* socket.asked;
        assert.equal(ask.path, "/api/live/tasks?userId=user-1&poll=true&after=d1");
        yield* socket.answer(ask.id, 200, JSON.stringify({ rows: [] }));
        assert.deepEqual(yield* Fiber.join(polled), {
          status: 200,
          text: JSON.stringify({ rows: [] }),
        });

        const wrote = yield* client.execute(HttpClientRequest.put(INBOX_READ));
        assert.equal(wrote.status, 200);
        assert.deepEqual(
          http.asked,
          [`GET ${TASKS_POLL}`, `PUT ${INBOX_READ}`],
          "a write never rides the socket",
        );

        const refused = yield* poll;
        const stale = yield* socket.asked;
        yield* socket.answer(stale.id, 401, JSON.stringify({ error: "invalid-token" }));
        assert.deepEqual(yield* Fiber.join(refused), { status: 200, text: HTTP_BODY });
        assert.deepEqual(http.asked, [
          `GET ${TASKS_POLL}`,
          `PUT ${INBOX_READ}`,
          `GET ${TASKS_POLL}`,
        ]);
        assert.equal(
          socket.state.closed,
          true,
          "the socket whose credential was refused is closed",
        );
      }),
    ),
);

it.effect(
  "a socket past its time takes no new asks while one it holds is still answered, and an ask left unanswered closes its socket and fails before its deadline",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { relay, http, client, poll } = yield* subject;
        yield* Fiber.join(yield* poll);
        const older = yield* relay.opened;
        yield* older.reading;

        // An ask held on the first socket as its time runs out.
        yield* TestClock.adjust(Duration.subtract(ROTATE_AFTER, Duration.seconds(10)));
        const held = yield* poll;
        const heldAsk = yield* older.asked;
        yield* TestClock.adjust(Duration.seconds(15));

        // Past its time, a read goes over HTTP while the next socket opens.
        yield* Fiber.join(yield* poll);
        const newer = yield* relay.opened;
        yield* newer.reading;
        const next = yield* poll;
        const nextAsk = yield* newer.asked;
        yield* older.answer(heldAsk.id, 200, JSON.stringify({ held: true }));
        assert.deepEqual(yield* Fiber.join(held), {
          status: 200,
          text: JSON.stringify({ held: true }),
        });
        yield* newer.answer(nextAsk.id, 200, "{}");
        yield* Fiber.join(next);
        assert.equal(older.state.closed, false, "the older socket drains before it closes");
        yield* TestClock.adjust(DRAIN);
        assert.equal(older.state.closed, true);

        const askedOverHttp = http.asked.length;
        const stalled = yield* Effect.forkChild(
          Effect.exit(client.execute(HttpClientRequest.get(TASKS_READ))),
        );
        yield* newer.asked;
        yield* TestClock.adjust(Duration.subtract(USUAL_DEADLINE, Duration.millis(1)));
        const ended = stalled.pollUnsafe();
        assert.ok(
          ended !== undefined && Exit.isSuccess(ended) && Exit.isFailure(ended.value),
          "an ask its socket never answered fails before the deadline it travels under",
        );
        assert.equal(http.asked.length, askedOverHttp, "a stalled ask is not asked over HTTP");
        assert.equal(newer.state.closed, true, "a socket that stalled is closed");
      }),
    ),
);
