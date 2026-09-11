import assert from "node:assert/strict";
import { conversationMessageRatingPath } from "@sidecar/hosted";
import { MESSAGE_RATING, type WireBoundaryInput } from "@sidecar/wire";
import { test } from "vitest";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { handleMessageRating, type MessageRatingOptions } from "../server/hosted/message-rating";
import { RATING_REFUSAL, type RatingWriteResult } from "../server/hosted/store";

const MESSAGE_ID = "2b000000-0000-4000-8000-000000000012";
const DEVICE_ID = "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50";

/** The request as the route rewrite hands it over: the path's id moved into the query, the body already text. */
function rawRequest(
  text: string | undefined,
  init: { method?: string; messageId?: string } = {},
): Request {
  const messageId = init.messageId ?? MESSAGE_ID;
  const url = new URL("https://luke.test/api/conversation/messages/rating.ts");
  if (messageId !== "") url.searchParams.set("id", messageId);
  return new Request(url, {
    method: init.method ?? "PUT",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: text,
  });
}

function ratingRequest(
  body: WireBoundaryInput = { rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID },
  init: { method?: string; messageId?: string } = {},
): Request {
  return rawRequest(JSON.stringify(body), init);
}

function options(overrides: Partial<MessageRatingOptions> = {}): MessageRatingOptions {
  return {
    request: ratingRequest(),
    resolveUserId: async () => "user-1",
    rate: async () => ({ ok: true, id: "event-1", seq: 7 }),
    ...overrides,
  };
}

async function errorOf(response: Response): Promise<[number, string]> {
  // SAFETY: the handler's own JSON answer, read back for its status and slug.
  const body = (await response.json()) as { error: string };
  return [response.status, body.error];
}

test("the path names the hosted rating route with the message's id encoded inside it", () => {
  assert.equal(
    conversationMessageRatingPath("2b000000-0000-4000-8000-000000000012"),
    "/api/conversation/messages/2b000000-0000-4000-8000-000000000012/rating",
  );
  assert.equal(conversationMessageRatingPath("a/b"), "/api/conversation/messages/a%2Fb/rating");
});

test("each gate refuses on its own: method, the path's id, the token, then the body", async () => {
  assert.deepEqual(
    await errorOf(
      await handleMessageRating(options({ request: ratingRequest(undefined, { method: "POST" }) })),
    ),
    [405, HOSTED_API_ERROR.METHOD_NOT_ALLOWED],
  );
  assert.deepEqual(
    await errorOf(
      await handleMessageRating(
        options({
          request: ratingRequest(undefined, { messageId: "" }),
          resolveUserId: async () => undefined,
        }),
      ),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(await handleMessageRating(options({ resolveUserId: async () => undefined }))),
    [401, HOSTED_API_ERROR.INVALID_TOKEN],
  );
  const doubled = new URL(ratingRequest().url);
  doubled.searchParams.append("id", "2b000000-0000-4000-8000-000000000013");
  assert.deepEqual(
    await errorOf(
      await handleMessageRating(
        options({
          request: new Request(doubled, {
            method: "PUT",
            headers: { authorization: "Bearer token-1", "content-type": "application/json" },
            body: JSON.stringify({ rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID }),
          }),
        }),
      ),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(await handleMessageRating(options({ request: rawRequest("not json") }))),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(
      await handleMessageRating(
        options({
          request: ratingRequest({ rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID, extra: 1 }),
        }),
      ),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(
      await handleMessageRating(
        options({
          request: rawRequest(
            `{"rating":"up","deviceId":"${DEVICE_ID}","note":"${"n".repeat(9_000)}"}`,
          ),
        }),
      ),
    ),
    [413, HOSTED_API_ERROR.REQUEST_TOO_LARGE],
  );
});

test("an id that is not a UUID names no row: not found, and the store is never asked", async () => {
  let asked = 0;
  const response = await handleMessageRating(
    options({
      request: ratingRequest(undefined, { messageId: "not-a-uuid" }),
      rate: async () => {
        asked += 1;
        return { ok: true, id: "event-1", seq: 1 };
      },
    }),
  );
  assert.deepEqual(await errorOf(response), [404, HOSTED_API_ERROR.NOT_FOUND]);
  assert.equal(asked, 0);
});

test("the path's id reaches the store case folded", async () => {
  const seen: string[] = [];
  await handleMessageRating(
    options({
      request: ratingRequest(undefined, { messageId: MESSAGE_ID.toUpperCase() }),
      rate: async (_userId, messageId) => {
        seen.push(messageId);
        return { ok: true, id: "event-1", seq: 1 };
      },
    }),
  );
  assert.deepEqual(seen, [MESSAGE_ID]);
});

test("an admitted rating reaches the store with the caller, the path's message, and the body as read, and answers the event", async () => {
  const seen: unknown[] = [];
  const response = await handleMessageRating(
    options({
      request: ratingRequest({
        rating: MESSAGE_RATING.DOWN,
        note: "  wrong session  ",
        deviceId: DEVICE_ID.toUpperCase(),
      }),
      rate: async (userId, messageId, rating) => {
        seen.push([userId, messageId, rating]);
        return { ok: true, id: "event-9", seq: 3 };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "event-9", seq: 3 });
  assert.deepEqual(seen, [
    [
      "user-1",
      MESSAGE_ID,
      { rating: MESSAGE_RATING.DOWN, note: "wrong session", deviceId: DEVICE_ID },
    ],
  ]);
});

test("the store's two refusals are two statuses: not found for a message the account does not hold, forbidden for one Luke did not write", async () => {
  const refused = async (refusal: Extract<RatingWriteResult, { ok: false }>["refusal"]) =>
    errorOf(await handleMessageRating(options({ rate: async () => ({ ok: false, refusal }) })));
  assert.deepEqual(await refused(RATING_REFUSAL.NOT_FOUND), [404, HOSTED_API_ERROR.NOT_FOUND]);
  assert.deepEqual(await refused(RATING_REFUSAL.NOT_LUKES), [403, HOSTED_API_ERROR.NOT_RATEABLE]);
});
