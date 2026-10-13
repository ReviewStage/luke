import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HTTP_STATUS, type RecordedRequest, recordingHttpClient } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { PRODUCT_EVENT } from "./product-events.js";
import { ProductEventSender, type ProductEventSenderOptions } from "./sender.js";

const BASE_URL = "https://luke.test";
const APP_VERSION = "0.2.0";
const NOON = Date.parse("2026-08-19T12:00:00.000Z");

function senderWith(
  overrides: Partial<ProductEventSenderOptions> = {},
  respond: (request: RecordedRequest) => Response = () => new Response("{}"),
) {
  const { layer, requests } = recordingHttpClient(respond);
  return Effect.map(
    Effect.andThen(
      TestClock.setTime(NOON),
      ProductEventSender.make({
        serviceBaseUrl: BASE_URL,
        appVersion: APP_VERSION,
        sends: true,
        readAccessToken: () => Effect.succeed("token-1"),
        refreshAccount: () => Effect.void,
        httpClient: layer,
        now: () => NOON,
        ...overrides,
      }),
    ),
    (sender) => ({ sender, requests }),
  );
}

/** The armed sender every test that is not about arming starts from. */
function sharingSender(
  overrides: Partial<ProductEventSenderOptions> = {},
  respond?: (request: RecordedRequest) => Response,
) {
  return Effect.tap(senderWith(overrides, respond), ({ sender }) =>
    Effect.sync(() => {
      sender.arm();
    }),
  );
}

it.effect("a batch queued under one account is never posted under another's bearer", () =>
  Effect.gen(function* () {
    let account = "ada@luke.test";
    let token = "stale";
    const { sender, requests } = yield* sharingSender(
      {
        readAccessToken: () => Effect.succeed(token),
        readAccountKey: () => Effect.succeed(account),
        // The sign-out and sign-in the refusal was the first sign of: the token
        // the retry would carry answers for somebody else.
        refreshAccount: () =>
          Effect.sync(() => {
            account = "grace@luke.test";
            token = "fresh";
          }),
      },
      () => new Response("{}", { status: HTTP_STATUS.UNAUTHORIZED }),
    );
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    yield* sender.flush;

    assert.deepEqual(
      requests.map((request) => request.authorization),
      ["Bearer stale"],
    );

    // Spent, not requeued: these counts belong to an account this sender can no
    // longer name.
    yield* sender.flush;
    assert.equal(requests.length, 1);
  }),
);
