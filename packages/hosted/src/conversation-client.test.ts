import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CloudFetch, MESSAGE_RATING, type WireValue } from "@sidecar/wire";
import { test } from "vitest";
import {
  CONVERSATION_RATE_REFUSAL,
  CONVERSATION_READ_FAILURE,
  HostedConversationClient,
  type ReadPageQuery,
} from "./conversation-client.js";
import { conversationMessageRatingPath, HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const FIXTURE_DIRECTORY = path.join(fileURLToPath(import.meta.url), "../../fixtures/reads");
const BASE_URL = "https://luke.test";
const OPENED = "3c000000-0000-4000-8000-000000000009";

interface Seen {
  url: string;
  method: string | undefined;
  authorization: string | undefined;
  body: BodyInit | undefined;
}

function harness(answer: (seen: Seen) => Response) {
  const seen: Seen[] = [];
  const fetch: CloudFetch = async (input, init) => {
    const request: Seen = {
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization") ?? undefined,
      body: init?.body ?? undefined,
    };
    seen.push(request);
    return answer(request);
  };
  const client = new HostedConversationClient({
    serviceBaseUrl: BASE_URL,
    fetch,
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    readAccountKey: async () => "person",
  });
  return { client, seen };
}

function json(status: number, body: WireValue): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fixture(name: string): Promise<WireValue> {
  // SAFETY: the fixture files are JSON this repository commits; the client's schema read is the validation.
  return JSON.parse(await readFile(path.join(FIXTURE_DIRECTORY, name), "utf8")) as WireValue;
}

test("each read asks its own path with the cursor and bound as the wire's query, under the account's bearer", async () => {
  const messages = await fixture("conversation-messages-answer.json");
  const events = await fixture("conversation-events-answer.json");
  const turns = await fixture("brain-turns-answer.json");
  const { client, seen } = harness((request) => {
    const url = new URL(request.url);
    if (url.pathname === HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES) return json(200, messages);
    if (url.pathname === HOSTED_SERVICE_PATH.CONVERSATION_EVENTS) return json(200, events);
    if (url.pathname === HOSTED_SERVICE_PATH.BRAIN_TURNS) return json(200, turns);
    return json(404, { error: HOSTED_API_ERROR.NOT_FOUND });
  });
  const page: ReadPageQuery = { after: "c3VyZQ", limit: 50 };
  const [read, eventsRead, turnsRead] = await Promise.all([
    client.messages(page),
    client.events(),
    client.turns({ after: "dHVybg" }),
  ]);
  assert.ok(read.ok && eventsRead.ok && turnsRead.ok);
  assert.equal(read.answer.groups.length, 2);
  assert.equal(eventsRead.answer.events.length > 0, true);
  assert.equal(turnsRead.answer.turns.length > 0, true);
  assert.deepEqual(
    seen.map((request) => [
      request.method,
      new URL(request.url).pathname,
      new URL(request.url).search,
    ]),
    [
      ["GET", HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES, "?after=c3VyZQ&limit=50"],
      ["GET", HOSTED_SERVICE_PATH.CONVERSATION_EVENTS, ""],
      ["GET", HOSTED_SERVICE_PATH.BRAIN_TURNS, "?after=dHVybg"],
    ],
  );
  assert.ok(seen.every((request) => request.authorization === "Bearer token-1"));
});

test("the unreadable-row refusal is surfaced with the row it names; every other short answer is unanswered", async () => {
  const row = { conversationId: "3c000000-0000-4000-8000-000000000001", seq: 4 };
  let status = 500;
  let body: WireValue = { error: HOSTED_API_ERROR.UNREADABLE_ROW, unreadableRow: row };
  const { client } = harness(() => json(status, body));
  assert.deepEqual(await client.messages(), {
    ok: false,
    failure: CONVERSATION_READ_FAILURE.UNREADABLE_ROW,
    row,
  });
  status = 503;
  body = { error: HOSTED_API_ERROR.UNAVAILABLE };
  assert.deepEqual(await client.messages(), {
    ok: false,
    failure: CONVERSATION_READ_FAILURE.UNANSWERED,
  });
  status = 200;
  body = { groups: "not a page" };
  assert.deepEqual(await client.events(), {
    ok: false,
    failure: CONVERSATION_READ_FAILURE.UNANSWERED,
  });
  const faulted = new HostedConversationClient({
    serviceBaseUrl: BASE_URL,
    fetch: async () => {
      throw new TypeError("offline");
    },
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    readAccountKey: async () => "person",
  });
  assert.deepEqual(await faulted.turns(), {
    ok: false,
    failure: CONVERSATION_READ_FAILURE.UNANSWERED,
  });
});

test("Clear posts nothing but the bearer, and reads the main it opened", async () => {
  const { client, seen } = harness((request) => {
    const url = new URL(request.url);
    if (url.pathname === HOSTED_SERVICE_PATH.CONVERSATION_CLEAR) {
      return json(200, { opened: OPENED, openedAt: 1_757_505_600_000, cleared: 2 });
    }
    return json(404, { error: HOSTED_API_ERROR.NOT_FOUND });
  });
  assert.deepEqual(await client.clear(), {
    opened: OPENED,
    openedAt: 1_757_505_600_000,
    cleared: 2,
  });
  assert.deepEqual(
    seen.map((request) => [request.method, new URL(request.url).pathname, request.body]),
    [["POST", HOSTED_SERVICE_PATH.CONVERSATION_CLEAR, undefined]],
  );
});

const RATED_MESSAGE = "2b000000-0000-4000-8000-000000000002";
const RATING_EVENT = "4d000000-0000-4000-8000-000000000001";
const DEVICE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

test("a rating puts the verdict and the device to the message's own path under the bearer, and reads back the event it made", async () => {
  const { client, seen } = harness((request) => {
    const url = new URL(request.url);
    if (url.pathname === conversationMessageRatingPath(RATED_MESSAGE)) {
      return json(200, { id: RATING_EVENT, seq: 7 });
    }
    return json(404, { error: HOSTED_API_ERROR.NOT_FOUND });
  });
  const written = await client.rate(RATED_MESSAGE, {
    rating: MESSAGE_RATING.DOWN,
    deviceId: DEVICE,
  });
  assert.deepEqual(written, { ok: true, answer: { id: RATING_EVENT, seq: 7 } });
  assert.equal(seen.length, 1);
  const [request] = seen;
  assert.equal(request?.method, "PUT");
  assert.equal(request?.authorization, "Bearer token-1");
  assert.deepEqual(JSON.parse(String(request?.body)), {
    rating: MESSAGE_RATING.DOWN,
    deviceId: DEVICE,
  });
});

test("the service's two refusals of a rating are answered apart, and every other short answer is unanswered", async () => {
  let status = 404;
  let body: WireValue = { error: HOSTED_API_ERROR.NOT_FOUND };
  const { client, seen } = harness(() => json(status, body));
  const request = { rating: MESSAGE_RATING.UP, deviceId: DEVICE } as const;
  assert.deepEqual(await client.rate(RATED_MESSAGE, request), {
    ok: false,
    refusal: CONVERSATION_RATE_REFUSAL.NOT_FOUND,
  });
  status = 403;
  body = { error: HOSTED_API_ERROR.NOT_RATEABLE };
  assert.deepEqual(await client.rate(RATED_MESSAGE, request), {
    ok: false,
    refusal: CONVERSATION_RATE_REFUSAL.NOT_RATEABLE,
  });
  status = 503;
  body = { error: HOSTED_API_ERROR.UNAVAILABLE };
  assert.deepEqual(await client.rate(RATED_MESSAGE, request), {
    ok: false,
    refusal: CONVERSATION_RATE_REFUSAL.UNANSWERED,
  });
  status = 200;
  body = { id: RATING_EVENT };
  assert.deepEqual(await client.rate(RATED_MESSAGE, request), {
    ok: false,
    refusal: CONVERSATION_RATE_REFUSAL.UNANSWERED,
  });
  assert.equal(seen.length, 4);
  // A request the wire's own schema refuses never travels.
  assert.deepEqual(await client.rate(RATED_MESSAGE, { rating: MESSAGE_RATING.UP, deviceId: "" }), {
    ok: false,
    refusal: CONVERSATION_RATE_REFUSAL.UNANSWERED,
  });
  assert.equal(seen.length, 4);
});
