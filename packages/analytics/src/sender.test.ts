import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import {
  HTTP_STATUS,
  type RecordedRequest,
  recordedRequest,
  recordingFetch,
} from "@sidecar/wire/testing";
import { Effect, TestClock } from "effect";
import { test } from "vitest";
import {
  PRODUCT_EVENT,
  PRODUCT_EVENT_CLIENT,
  PRODUCT_EVENT_CLIENT_HEADER,
  PRODUCT_SESSION_COUNT_BUCKET,
  type ProductEvent,
} from "./product-events.js";
import { ProductEventSender, type ProductEventSenderOptions } from "./sender.js";

const BASE_URL = "https://luke.test";
const ENDPOINT = `${BASE_URL}${HOSTED_SERVICE_PATH.EVENTS}`;
const APP_VERSION = "0.2.0";
const NOON = Date.parse("2026-08-19T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function sentEvents(request: RecordedRequest): ProductEvent[] {
  return JSON.parse(request.body ?? "{}").events;
}

function senderWith(
  overrides: Partial<ProductEventSenderOptions> = {},
  respond: (request: RecordedRequest) => Response = () => new Response("{}"),
) {
  const { fetch, requests } = recordingFetch(respond);
  const sender = new ProductEventSender({
    serviceBaseUrl: BASE_URL,
    appVersion: APP_VERSION,
    sends: true,
    readAccessToken: async () => "token-1",
    refreshAccount: () => Effect.void,
    httpClient: layerFromCloudFetch(fetch),
    now: () => NOON,
    ...overrides,
  });
  return { sender, requests };
}

/** The armed sender every test that is not about arming starts from. */
function sharingSender(
  overrides: Partial<ProductEventSenderOptions> = {},
  respond?: (request: RecordedRequest) => Response,
) {
  const built = senderWith(overrides, respond);
  built.sender.arm();
  return built;
}

test("a run that sends no network queues nothing and asks for nothing", async () => {
  const { sender, requests } = sharingSender({ sends: false });
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  sender.markDayActive();
  sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  await sender.flush();
  assert.deepEqual(requests, []);
});

test("nothing is queued before the settings file has answered", async () => {
  const { sender, requests } = senderWith();
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await sender.flush();
  assert.deepEqual(requests, []);
});

test("a flush posts one bearer-authenticated batch and empties the queue", async () => {
  const { sender, requests } = sharingSender();
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  await sender.flush();

  assert.equal(requests.length, 1);
  assert.equal(recordedRequest(requests).url, ENDPOINT);
  assert.equal(recordedRequest(requests).method, "POST");
  assert.equal(recordedRequest(requests).authorization, "Bearer token-1");
  assert.equal(
    recordedRequest(requests).headers.get(PRODUCT_EVENT_CLIENT_HEADER),
    PRODUCT_EVENT_CLIENT.DESKTOP,
  );
  assert.deepEqual(sentEvents(recordedRequest(requests)), [
    { name: PRODUCT_EVENT.APP_LAUNCH, at: NOON, properties: { app_version: APP_VERSION } },
    { name: PRODUCT_EVENT.ACCOUNT_SIGN_IN, at: NOON, properties: {} },
  ]);

  await sender.flush();
  assert.equal(requests.length, 1);
});

test("a sender that was never armed sends nothing", async () => {
  const { sender, requests } = senderWith();
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  sender.markDayActive();
  await sender.flush();
  assert.deepEqual(requests, []);
});

test("a batch queued under one account is never posted under another's bearer", async () => {
  let account = "ada@luke.test";
  let token = "stale";
  const { fetch, requests } = recordingFetch(
    () => new Response("{}", { status: HTTP_STATUS.UNAUTHORIZED }),
  );
  const { sender } = sharingSender({
    httpClient: layerFromCloudFetch(fetch),
    readAccessToken: async () => token,
    readAccountKey: async () => account,
    // The sign-out and sign-in the refusal was the first sign of: the token
    // the retry would carry answers for somebody else.
    refreshAccount: () =>
      Effect.sync(() => {
        account = "grace@luke.test";
        token = "fresh";
      }),
  });
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await sender.flush();

  assert.deepEqual(
    requests.map((request) => request.authorization),
    ["Bearer stale"],
  );

  // Spent, not requeued: these counts belong to an account this sender can no
  // longer name.
  await sender.flush();
  assert.equal(requests.length, 1);
});

test("a failed send drops its batch rather than retrying it behind the next one", async () => {
  const { fetch, requests } = recordingFetch(() => {
    throw new Error("network down");
  });
  const sender = new ProductEventSender({
    serviceBaseUrl: BASE_URL,
    appVersion: APP_VERSION,
    sends: true,
    readAccessToken: async () => "token-1",
    refreshAccount: () => Effect.void,
    httpClient: layerFromCloudFetch(fetch),
    now: () => NOON,
  });
  sender.arm();
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await sender.flush();
  assert.equal(requests.length, 1);

  sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  await sender.flush().catch(() => assert.fail("a flush must never throw"));
  assert.equal(requests.length, 2);
  assert.deepEqual(sentEvents(recordedRequest(requests, 1)), [
    { name: PRODUCT_EVENT.ACCOUNT_SIGN_IN, at: NOON, properties: {} },
  ]);
});

test("signed out the queue waits rather than being spent", async () => {
  let token: string | undefined;
  const { fetch, requests } = recordingFetch(() => new Response("{}"));
  const sender = new ProductEventSender({
    serviceBaseUrl: BASE_URL,
    appVersion: APP_VERSION,
    sends: true,
    readAccessToken: async () => token,
    refreshAccount: () => Effect.void,
    httpClient: layerFromCloudFetch(fetch),
    now: () => NOON,
  });
  sender.arm();
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await sender.flush();
  assert.deepEqual(requests, []);

  token = "token-1";
  await sender.flush();
  assert.equal(requests.length, 1);
  assert.equal(sentEvents(recordedRequest(requests)).length, 1);
});

test("a token the settings file could not answer leaves the batch queued", async () => {
  let readable = false;
  const { sender, requests } = sharingSender({
    readAccessToken: async () => {
      if (!readable) throw new Error("the settings file could not be read");
      return "token-1";
    },
  });
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await sender.flush();
  assert.deepEqual(requests, []);

  readable = true;
  await sender.flush();
  assert.equal(sentEvents(recordedRequest(requests)).length, 1);
});

test("past the queue limit the oldest go and the newest stay", async () => {
  const { sender, requests } = sharingSender({ queueLimit: 3 });
  for (const providerId of ["claude-code", "codex", "conductor", "omp"] as const) {
    sender.record(PRODUCT_EVENT.SESSION_ACTION_SEND, {
      provider_id: providerId,
      session_action: "message_send",
    });
  }
  await sender.flush();

  assert.deepEqual(
    sentEvents(recordedRequest(requests)).map((event) => event.properties.provider_id),
    ["codex", "conductor", "omp"],
  );
});

test("a batch past the wire limit is left for the next flush rather than refused", async () => {
  const { sender, requests } = sharingSender();
  for (let index = 0; index < 60; index += 1) {
    sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  }
  await sender.flush();
  assert.equal(sentEvents(recordedRequest(requests)).length, 50);
  await sender.flush();
  assert.equal(sentEvents(recordedRequest(requests, 1)).length, 10);
});

test("the day marker records once a day, and again once the day has turned", async () => {
  let now = NOON;
  const { sender, requests } = sharingSender({ now: () => now });
  sender.markDayActive();
  sender.markDayActive();
  now = NOON + 6 * 60 * 60 * 1000;
  sender.markDayActive();
  await sender.flush();
  assert.equal(sentEvents(recordedRequest(requests)).length, 1);

  now = NOON + DAY_MS;
  sender.markDayActive();
  await sender.flush();
  assert.deepEqual(sentEvents(recordedRequest(requests, 1)), [
    {
      name: PRODUCT_EVENT.APP_DAY_ACTIVE,
      at: now,
      properties: { app_version: APP_VERSION },
    },
  ]);
});

test("an observation is counted once per provider per day, in buckets", async () => {
  const { sender, requests } = sharingSender();
  for (const providerId of ["codex", "codex", "claude-code"] as const) {
    sender.recordOncePerDay(PRODUCT_EVENT.SESSION_OBSERVE, providerId, {
      provider_id: providerId,
      session_count: PRODUCT_SESSION_COUNT_BUCKET.FEW,
    });
  }
  await sender.flush();

  assert.deepEqual(
    sentEvents(recordedRequest(requests)).map((event) => event.properties),
    [
      { provider_id: "codex", session_count: PRODUCT_SESSION_COUNT_BUCKET.FEW },
      { provider_id: "claude-code", session_count: PRODUCT_SESSION_COUNT_BUCKET.FEW },
    ],
  );
});

test("a call site handing a value outside the allowlist queues nothing", async () => {
  const { sender, requests } = sharingSender();
  // SAFETY: the point of the test is the runtime guard, so the compile-time
  // one is stepped around exactly as a mis-typed emitter would step around it.
  const smuggler = sender as unknown as {
    record(name: string, properties: Readonly<Record<string, string | number>>): void;
  };
  smuggler.record(PRODUCT_EVENT.SESSION_OBSERVE, {
    provider_id: "codex — /Users/me/luke on feature/x",
    session_count: 137,
  });
  smuggler.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: "/Users/me/luke" });
  await sender.flush();
  assert.deepEqual(requests, []);
});

it.effect("a run left open marks each day it crosses, not only its launch day", () =>
  Effect.gen(function* () {
    let now = NOON;
    const runtime = yield* Effect.runtime<never>();
    const { sender, requests } = sharingSender({ now: () => now, flushIntervalMs: 10, runtime });
    sender.markDayActive();
    sender.start();

    // Two ticks inside the launch day add nothing: the day is already marked.
    yield* TestClock.adjust("10 millis");
    yield* TestClock.adjust("10 millis");
    yield* TestClock.adjust("10 millis");
    assert.equal(requests.length, 1);
    assert.deepEqual(sentEvents(recordedRequest(requests)).length, 1);

    // The day turns while the app stays open, which is the case the marker
    // exists for — without a tick it would be a second copy of app:launch.
    now = NOON + DAY_MS;
    yield* TestClock.adjust("10 millis");
    yield* TestClock.adjust("10 millis");
    sender.stop();

    const marked = requests.flatMap((request) =>
      sentEvents(request).filter((event) => event.name === PRODUCT_EVENT.APP_DAY_ACTIVE),
    );
    assert.equal(marked.length, 2);
    assert.deepEqual(
      marked.map((event) => event.at),
      [NOON, NOON + DAY_MS],
    );
  }),
);

it.effect("stopping drops what was queued rather than holding the quit open", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const { sender, requests } = sharingSender({ runtime });
    sender.start();
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    sender.stop();
    yield* Effect.promise(() => sender.flush());
    assert.deepEqual(requests, []);
  }),
);
