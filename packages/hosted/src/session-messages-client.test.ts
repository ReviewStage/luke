import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CLOUD_AGENT_PROVIDER_ID, CONVERSATION_MESSAGE_AUTHOR } from "@sidecar/session";
import type { CloudFetch } from "@sidecar/wire";
import { fakeCloudApi, HTTP_STATUS, recordedRoutes } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedSessionMessagesClient } from "./session-messages-client.js";

const SESSION = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerSessionId: "chat-1",
} as const;

function client(fetch: CloudFetch) {
  return new HostedSessionMessagesClient({
    serviceBaseUrl: "https://tryluke.dev/",
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    fetch,
  });
}

it.effect("the newest page is a bearer GET naming the session, and a cursor rides as `after`", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/sessions/messages": {
        answer: () => ({
          messages: [
            { id: "m-1", author: CONVERSATION_MESSAGE_AUTHOR.USER, text: "Fix the flaky test" },
            { id: "m-2", author: CONVERSATION_MESSAGE_AUTHOR.AGENT, text: "On it.", receivedAt: 5 },
            { id: "m-3", author: "tool", text: "dropped" },
          ],
          lastMessageId: "m-2",
          hasMore: false,
          hasOlder: true,
        }),
      },
    });
    const reader = client(api.fetch);

    const tail = yield* Effect.promise(() => reader.read(SESSION));
    const since = yield* Effect.promise(() => reader.read({ ...SESSION, afterMessageId: "m-2" }));

    assert.deepEqual(tail, {
      messages: [
        { id: "m-1", author: CONVERSATION_MESSAGE_AUTHOR.USER, text: "Fix the flaky test" },
        { id: "m-2", author: CONVERSATION_MESSAGE_AUTHOR.AGENT, text: "On it.", receivedAt: 5 },
      ],
      lastMessageId: "m-2",
      hasMore: false,
      hasOlder: true,
    });
    assert.equal(since?.messages.length, 2);
    assert.deepEqual(recordedRoutes(api.requests()), [
      "GET /api/sessions/messages?providerId=conductor&providerSessionId=chat-1",
      "GET /api/sessions/messages?after=m-2&providerId=conductor&providerSessionId=chat-1",
    ]);
    assert.deepEqual(api.credentials(), ["token-1", "token-1"]);
  }),
);

it.effect("a refusal, a fault, and a body outside the contract are each no answer", () =>
  Effect.gen(function* () {
    const refused = fakeCloudApi({
      "GET /api/sessions/messages": { answer: () => ({}), status: HTTP_STATUS.SERVER_ERROR },
    });
    assert.equal(yield* Effect.promise(() => client(refused.fetch).read(SESSION)), undefined);

    const lost = client(() => {
      throw new TypeError("fetch failed");
    });
    assert.equal(yield* Effect.promise(() => lost.read(SESSION)), undefined);

    const unreadable = fakeCloudApi({
      "GET /api/sessions/messages": { answer: () => ({ messages: "none" }) },
    });
    assert.equal(yield* Effect.promise(() => client(unreadable.fetch).read(SESSION)), undefined);
  }),
);
