import assert from "node:assert/strict";
import { test } from "vitest";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  eveSessions,
} from "../server/hosted/brain-host/eve-sessions";

/**
 * The host's three calls into eve, against a fetch that answers as eve's
 * routes document: the request each makes, and how each answer reads.
 */

const ORIGIN = "https://luke.test";
const AUTHORIZATION = "Bearer token-1";
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

/** A fetch answering the given answers in order and the last of them thereafter, recording each request and each wait. */
function answeringEach(answers: readonly Answer[]) {
  const seen: Seen[] = [];
  const waits: number[] = [];
  const call: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    seen.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: JSON.parse(await request.text()),
    });
    const answer = answers[Math.min(seen.length, answers.length) - 1];
    assert.ok(answer);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  const sessions = eveSessions({
    origin: ORIGIN,
    authorization: AUTHORIZATION,
    fetch: call,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { seen, waits, sessions };
}

function answering(status: number, body: EveAnswer) {
  return answeringEach([{ status, body }]);
}

const NOT_ACTIVE: Answer = { status: 409, body: { ok: false, code: "session_not_active" } };
const ACCEPTED_FOLLOW_UP: Answer = {
  status: 202,
  body: { ok: true, sessionId: SESSION, status: "accepted", deliveryId: "delivery-1" },
};

const MESSAGE = { conversationId: CONVERSATION, turn: BRAIN_HOST_TURN.TYPED, message: "hello" };

test("opening posts the first message under the conversation and turn headers with the caller's bearer, and reads the session eve names", async () => {
  const { seen, sessions } = answering(202, { ok: true, sessionId: SESSION, status: "accepted" });
  assert.deepEqual(await sessions.open(MESSAGE), {
    outcome: EVE_SEND_OUTCOME.ACCEPTED,
    sessionId: SESSION,
  });
  assert.equal(seen.length, 1);
  const [request] = seen;
  assert.ok(request);
  assert.equal(request.url, `${ORIGIN}/eve/v1/session`);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("authorization"), AUTHORIZATION);
  assert.equal(request.headers.get(BRAIN_HOST_HEADER.CONVERSATION), CONVERSATION);
  assert.equal(request.headers.get(BRAIN_HOST_HEADER.TURN), BRAIN_HOST_TURN.TYPED);
  assert.deepEqual(request.body, { message: "hello" });
});

test("a follow-up posts to the session's own route and reads the delivery eve names; anything outside the documented answers reads as failed with its status", async () => {
  const accepted = answeringEach([ACCEPTED_FOLLOW_UP]);
  assert.deepEqual(await accepted.sessions.send(SESSION, MESSAGE), {
    outcome: EVE_SEND_OUTCOME.ACCEPTED,
    sessionId: SESSION,
    deliveryId: "delivery-1",
  });
  assert.equal(accepted.seen.length, 1);
  assert.deepEqual(accepted.waits, []);
  assert.equal(accepted.seen[0]?.url, `${ORIGIN}/eve/v1/session/${SESSION}`);
  assert.equal(accepted.seen[0]?.headers.get(BRAIN_HOST_HEADER.TURN), BRAIN_HOST_TURN.TYPED);

  const refused = answering(403, { ok: false, code: "forbidden" });
  assert.deepEqual(await refused.sessions.send(SESSION, MESSAGE), {
    outcome: EVE_SEND_OUTCOME.FAILED,
    status: 403,
  });

  const unreadable = answering(202, { ok: true });
  assert.deepEqual(await unreadable.sessions.send(SESSION, MESSAGE), {
    outcome: EVE_SEND_OUTCOME.FAILED,
    status: 202,
  });
});

test("a not-active follow-up is tried again on the SDK's own schedule, reads as accepted the moment the session's inbox is up, and as retired only past the last wait", async () => {
  const starting = answeringEach([NOT_ACTIVE, NOT_ACTIVE, ACCEPTED_FOLLOW_UP]);
  assert.deepEqual(await starting.sessions.send(SESSION, MESSAGE), {
    outcome: EVE_SEND_OUTCOME.ACCEPTED,
    sessionId: SESSION,
    deliveryId: "delivery-1",
  });
  assert.equal(starting.seen.length, 3);
  assert.deepEqual(starting.waits, [250, 500]);

  const retired = answeringEach([NOT_ACTIVE]);
  assert.deepEqual(await retired.sessions.send(SESSION, MESSAGE), {
    outcome: EVE_SEND_OUTCOME.RETIRED,
  });
  assert.equal(retired.seen.length, 4);
  assert.deepEqual(retired.waits, [250, 500, 1_000]);
});

test("a cancel posts to the session's cancel route and reads whether eve had a turn to cancel", async () => {
  const accepted = answering(200, { ok: true, sessionId: SESSION, status: "accepted" });
  assert.deepEqual(await accepted.sessions.cancel(SESSION), {
    outcome: EVE_CANCEL_OUTCOME.ACCEPTED,
  });
  assert.equal(accepted.seen[0]?.url, `${ORIGIN}/eve/v1/session/${SESSION}/cancel`);
  assert.deepEqual(accepted.seen[0]?.body, {});

  const idle = answering(200, { ok: true, status: "no_active_turn" });
  assert.deepEqual(await idle.sessions.cancel(SESSION), {
    outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN,
  });

  const failed = answering(500, { ok: false });
  assert.deepEqual(await failed.sessions.cancel(SESSION), {
    outcome: EVE_CANCEL_OUTCOME.FAILED,
    status: 500,
  });
});
