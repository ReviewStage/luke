import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Redacted, Stream } from "effect";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "./bounds.js";
import {
  EVE_MOUNT,
  EVE_SEND_OUTCOME,
  type EveCaller,
  type EveMount,
  type EveSessions,
  eveSessions,
} from "./eve-sessions.js";

/**
 * The host's three calls into eve, against an `HttpClient` that answers as
 * eve's routes document: the request each makes, how each answer reads, how
 * the deployment acting for an account identifies itself on the wire, how
 * the not-active retry steps through its ladder on the clock, and how a call
 * that never reached eve comes back typed.
 */

const ORIGIN = "https://luke.test";
const DEPLOYMENT_SECRET = "eve-deployment-secret-1";
const ACCOUNT = "user-1";
const CALLER: EveCaller = { secret: Redacted.make(DEPLOYMENT_SECRET), account: ACCOUNT };
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
  options: { readonly caller?: EveCaller; readonly mount?: EveMount } = {},
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
    eveSessions({
      origin: ORIGIN,
      caller: options.caller ?? CALLER,
      mount: options.mount ?? EVE_MOUNT.TASKS,
    }),
    client,
  );
  return { seen, sessions };
}

function answering(status: number, body: EveAnswer) {
  return answeringEach([{ status, body }]);
}

const MESSAGE = { conversationId: CONVERSATION, turn: BRAIN_HOST_TURN.TYPED, message: "hello" };

it.effect(
  "opening posts the first message under the conversation and turn headers with the deployment's bearer and the account it acts for, and reads the session eve names",
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
      assert.equal(request.headers.get("authorization"), `Bearer ${DEPLOYMENT_SECRET}`);
      assert.equal(request.headers.get("content-type"), "application/json");
      assert.equal(request.headers.get(BRAIN_HOST_HEADER.ACCOUNT), ACCOUNT);
      assert.equal(request.headers.get(BRAIN_HOST_HEADER.CONVERSATION), CONVERSATION);
      assert.equal(request.headers.get(BRAIN_HOST_HEADER.TURN), BRAIN_HOST_TURN.TYPED);
      assert.equal(request.headers.get(BRAIN_HOST_HEADER.TIME_ZONE), null);
      assert.deepEqual(request.body, { message: "hello", capabilities: { requestInput: false } });
    }),
);

it.effect(
  "a message naming its sender's time zone carries it as the header the door reads, opening and following up alike",
  () =>
    Effect.gen(function* () {
      const accepted = { ok: true, sessionId: SESSION, status: "accepted" } as const;
      const { seen, sessions } = answeringEach([
        { status: 202, body: accepted },
        { status: 202, body: { ...accepted, deliveryId: "delivery-1" } },
      ]);
      const zoned = { ...MESSAGE, timeZone: "Asia/Tokyo" };
      yield* Effect.flatMap(sessions, (eve) => eve.open(zoned));
      yield* Effect.flatMap(sessions, (eve) => eve.send(SESSION, zoned));
      assert.deepEqual(
        seen.map((request) => request.headers.get(BRAIN_HOST_HEADER.TIME_ZONE)),
        ["Asia/Tokyo", "Asia/Tokyo"],
      );
    }),
);

it.effect(
  "the account's own bearer reaches the coding-agent service at eve's named mount, as it came and with no account beside it",
  () =>
    Effect.gen(function* () {
      const { seen, sessions } = answeringEach(
        [{ status: 202, body: { ok: true, sessionId: SESSION, status: "accepted" } }],
        {
          caller: { authorization: Redacted.make("Bearer developer-token-1") },
          mount: EVE_MOUNT.CODER,
        },
      );
      const opened = yield* Effect.flatMap(sessions, (eve) => eve.open(MESSAGE));
      assert.deepEqual(opened, { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: SESSION });
      yield* Effect.flatMap(sessions, (eve) => eve.cancel(SESSION, "turn_0"));
      assert.deepEqual(
        seen.map((request) => request.url),
        [`${ORIGIN}/eve/coder/v1/session`, `${ORIGIN}/eve/coder/v1/session/${SESSION}/cancel`],
      );
      for (const request of seen) {
        assert.equal(request.headers.get("authorization"), "Bearer developer-token-1");
        assert.equal(request.headers.get(BRAIN_HOST_HEADER.ACCOUNT), null);
      }
    }),
);

/** eve's client over a fake `HttpClient` that answers every request with the status and NDJSON body given, recording each URL and bearer. */
function streaming(status: number, lines: readonly string[]) {
  const seen: {
    readonly url: string;
    readonly method: string;
    readonly authorization: string | null;
  }[] = [];
  const client = fakeHttpClientLayer(async (url, init) => {
    seen.push({
      url,
      method: init.method ?? "GET",
      authorization: new Headers(init.headers).get("authorization"),
    });
    return new Response(lines.join("\n"), { status });
  });
  const sessions: Effect.Effect<EveSessions> = Effect.provide(
    eveSessions({ origin: ORIGIN, caller: CALLER, mount: EVE_MOUNT.TASKS }),
    client,
  );
  return { seen, sessions };
}

it.effect(
  "a session's stream is read from its tail under the deployment's bearer, as each event's type and turn, with a line that is no event skipped",
  () =>
    Effect.gen(function* () {
      const { seen, sessions } = streaming(200, [
        JSON.stringify({
          type: "message.appended",
          data: { turnId: "turn_1", messageDelta: "Hi" },
        }),
        "not json",
        JSON.stringify({ $eve: "stream.lease-ended", version: 1 }),
        "",
        JSON.stringify({ type: "turn.completed", data: { turnId: "turn_1" }, meta: { id: "e1" } }),
        JSON.stringify({ type: "session.waiting", data: {} }),
      ]);
      const events = yield* Effect.flatMap(sessions, (eve) =>
        Stream.runCollect(eve.stream(SESSION)),
      );
      assert.deepEqual(events, [
        { type: "message.appended", turnId: "turn_1" },
        { type: "turn.completed", turnId: "turn_1" },
        { type: "session.waiting", turnId: undefined },
      ]);
      assert.deepEqual(seen, [
        {
          url: `${ORIGIN}/eve/v1/session/${SESSION}/stream?startIndex=-1`,
          method: "GET",
          authorization: `Bearer ${DEPLOYMENT_SECRET}`,
        },
      ]);
    }),
);

it.effect(
  "a stream eve refuses is no event at all, so the follower falls back to reading the record",
  () =>
    Effect.gen(function* () {
      const { sessions } = streaming(403, [JSON.stringify({ error: "not_owner" })]);
      const events = yield* Effect.flatMap(sessions, (eve) =>
        Stream.runCollect(eve.stream(SESSION)),
      );
      assert.deepEqual(events, []);
    }),
);
