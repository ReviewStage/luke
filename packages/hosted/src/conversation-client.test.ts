import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { MESSAGE_RATING, type WireValue } from "@sidecar/wire";
import {
  fakeCloudApi,
  fakeHttpClientLayer,
  HTTP_STATUS,
  recordedRoutes,
} from "@sidecar/wire/testing";
import { Effect } from "effect";
import {
  CONVERSATION_RATE_REFUSAL,
  CONVERSATION_READ_FAILURE,
  HostedConversationClient,
  type ReadPageQuery,
} from "./conversation-client.js";
import { conversationMessageRatingPath, HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const FIXTURE_DIRECTORY = path.join(fileURLToPath(import.meta.url), "../../fixtures/reads");
const OPENED = "3c000000-0000-4000-8000-000000000009";

function client(options: Partial<ConstructorParameters<typeof HostedConversationClient>[0]> = {}) {
  return new HostedConversationClient({
    serviceBaseUrl: "https://luke.test",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("person"),
    ...options,
  });
}

async function fixture(name: string): Promise<WireValue> {
  // SAFETY: the fixture files are JSON this repository commits; the client's schema read is the validation.
  return JSON.parse(await readFile(path.join(FIXTURE_DIRECTORY, name), "utf8")) as WireValue;
}

it.effect(
  "each read asks its own path with the cursor and bound as the wire's query, under the account's bearer",
  () =>
    Effect.gen(function* () {
      const messages = yield* Effect.promise(() => fixture("conversation-messages-answer.json"));
      const events = yield* Effect.promise(() => fixture("conversation-events-answer.json"));
      const turns = yield* Effect.promise(() => fixture("brain-turns-answer.json"));
      const api = fakeCloudApi({
        [`GET ${HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES}`]: { answer: () => messages },
        [`GET ${HOSTED_SERVICE_PATH.CONVERSATION_EVENTS}`]: { answer: () => events },
        [`GET ${HOSTED_SERVICE_PATH.BRAIN_TURNS}`]: { answer: () => turns },
      });
      const page: ReadPageQuery = { after: "c3VyZQ", limit: 50 };

      const [read, eventsRead, turnsRead] = yield* Effect.provide(
        Effect.all([
          client().messages(page),
          client().events(),
          client().turns({ after: "dHVybg" }),
        ]),
        api.layer,
      );

      assert.ok(read.ok && eventsRead.ok && turnsRead.ok);
      assert.equal(read.answer.groups.length, 2);
      assert.equal(eventsRead.answer.events.length > 0, true);
      assert.equal(turnsRead.answer.turns.length > 0, true);
      assert.deepEqual(recordedRoutes(api.requests()), [
        `GET ${HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES}?after=c3VyZQ&limit=50`,
        `GET ${HOSTED_SERVICE_PATH.CONVERSATION_EVENTS}`,
        `GET ${HOSTED_SERVICE_PATH.BRAIN_TURNS}?after=dHVybg`,
      ]);
      assert.deepEqual(api.credentials(), ["token-1", "token-1", "token-1"]);
    }),
);

it.effect(
  "the unreadable-row refusal is surfaced with the row it names; every other short answer is unanswered",
  () =>
    Effect.gen(function* () {
      const row = { conversationId: "3c000000-0000-4000-8000-000000000001", seq: 4 };

      const unreadable = fakeCloudApi({
        [`GET ${HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES}`]: {
          answer: () => ({ error: HOSTED_API_ERROR.UNREADABLE_ROW, unreadableRow: row }),
          status: HTTP_STATUS.SERVER_ERROR,
        },
      });
      assert.deepEqual(yield* Effect.provide(client().messages(), unreadable.layer), {
        ok: false,
        failure: CONVERSATION_READ_FAILURE.UNREADABLE_ROW,
        row,
      });

      const unavailable = fakeCloudApi({
        [`GET ${HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES}`]: {
          answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
          status: HTTP_STATUS.SERVER_ERROR,
        },
      });
      assert.deepEqual(yield* Effect.provide(client().messages(), unavailable.layer), {
        ok: false,
        failure: CONVERSATION_READ_FAILURE.UNANSWERED,
      });

      const malformed = fakeCloudApi({
        [`GET ${HOSTED_SERVICE_PATH.CONVERSATION_EVENTS}`]: {
          answer: () => ({ groups: "not a page" }),
        },
      });
      assert.deepEqual(yield* Effect.provide(client().events(), malformed.layer), {
        ok: false,
        failure: CONVERSATION_READ_FAILURE.UNANSWERED,
      });

      assert.deepEqual(
        yield* Effect.provide(
          client().turns(),
          fakeHttpClientLayer(() => {
            throw new TypeError("offline");
          }),
        ),
        {
          ok: false,
          failure: CONVERSATION_READ_FAILURE.UNANSWERED,
        },
      );
    }),
);

it.effect("Clear posts nothing but the bearer, and reads the main it opened", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`POST ${HOSTED_SERVICE_PATH.CONVERSATION_CLEAR}`]: {
        answer: () => ({ opened: OPENED, openedAt: 1_757_505_600_000, cleared: 2 }),
      },
    });

    const answer = yield* Effect.provide(client().clear(), api.layer);

    assert.deepEqual(answer, { opened: OPENED, openedAt: 1_757_505_600_000, cleared: 2 });
    assert.deepEqual(recordedRoutes(api.requests()), [
      `POST ${HOSTED_SERVICE_PATH.CONVERSATION_CLEAR}`,
    ]);
    assert.equal(api.requests()[0]?.body, undefined);
  }),
);

const RATED_MESSAGE = "2b000000-0000-4000-8000-000000000002";
const RATING_EVENT = "4d000000-0000-4000-8000-000000000001";
const DEVICE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

it.effect(
  "a rating puts the verdict and the device to the message's own path under the bearer, and reads back the event it made",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`PUT ${conversationMessageRatingPath(RATED_MESSAGE)}`]: {
          answer: () => ({ id: RATING_EVENT, seq: 7 }),
        },
      });

      const written = yield* Effect.provide(
        client().rate(RATED_MESSAGE, { rating: MESSAGE_RATING.DOWN, deviceId: DEVICE }),
        api.layer,
      );

      assert.deepEqual(written, { ok: true, answer: { id: RATING_EVENT, seq: 7 } });
      assert.deepEqual(recordedRoutes(api.requests()), [
        `PUT ${conversationMessageRatingPath(RATED_MESSAGE)}`,
      ]);
      assert.deepEqual(api.credentials(), ["token-1"]);
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
        rating: MESSAGE_RATING.DOWN,
        deviceId: DEVICE,
      });
    }),
);

it.effect(
  "the service's two refusals of a rating are answered apart, and every other short answer is unanswered",
  () =>
    Effect.gen(function* () {
      const request = { rating: MESSAGE_RATING.UP, deviceId: DEVICE } as const;

      const notFound = fakeCloudApi({
        [`PUT ${conversationMessageRatingPath(RATED_MESSAGE)}`]: {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.SERVER_ERROR,
        },
      });
      assert.deepEqual(
        yield* Effect.provide(client().rate(RATED_MESSAGE, request), notFound.layer),
        {
          ok: false,
          refusal: CONVERSATION_RATE_REFUSAL.NOT_FOUND,
        },
      );

      const notRateable = fakeCloudApi({
        [`PUT ${conversationMessageRatingPath(RATED_MESSAGE)}`]: {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_RATEABLE }),
          status: HTTP_STATUS.SERVER_ERROR,
        },
      });
      assert.deepEqual(
        yield* Effect.provide(client().rate(RATED_MESSAGE, request), notRateable.layer),
        { ok: false, refusal: CONVERSATION_RATE_REFUSAL.NOT_RATEABLE },
      );

      const unavailable = fakeCloudApi({
        [`PUT ${conversationMessageRatingPath(RATED_MESSAGE)}`]: {
          answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
          status: HTTP_STATUS.SERVER_ERROR,
        },
      });
      assert.deepEqual(
        yield* Effect.provide(client().rate(RATED_MESSAGE, request), unavailable.layer),
        { ok: false, refusal: CONVERSATION_RATE_REFUSAL.UNANSWERED },
      );

      const admittedButUnread = fakeCloudApi({
        [`PUT ${conversationMessageRatingPath(RATED_MESSAGE)}`]: {
          answer: () => ({ id: RATING_EVENT }),
        },
      });
      assert.deepEqual(
        yield* Effect.provide(client().rate(RATED_MESSAGE, request), admittedButUnread.layer),
        { ok: false, refusal: CONVERSATION_RATE_REFUSAL.UNANSWERED },
      );

      // A request the wire's own schema refuses never travels.
      const untouched = fakeCloudApi({});
      assert.deepEqual(
        yield* Effect.provide(
          client().rate(RATED_MESSAGE, { rating: MESSAGE_RATING.UP, deviceId: "" }),
          untouched.layer,
        ),
        { ok: false, refusal: CONVERSATION_RATE_REFUSAL.UNANSWERED },
      );
      assert.deepEqual(untouched.requests(), []);
    }),
);
