import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_SERVICE_PATH,
  PRODUCT_EVENT,
  PRODUCT_SESSION_COUNT_BUCKET,
  type ProductEvent,
} from "@sidecar/core";
import { Effect } from "effect";
import { ProductEventSender, type ProductEventSenderOptions } from "../src/product-event-sender";
import { runWithHttp } from "./support/effect-http";
import { HTTP_STATUS, type RecordedRequest, recordingFetch } from "./support/http-fake";

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
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    now: () => NOON,
    runEffect: (effect) => runWithHttp(effect, fetch),
    ...overrides,
  });
  const flush = () => runWithHttp(sender.flush(), fetch);
  return { sender, requests, fetch, flush };
}

/** The armed sender every test that is not about arming starts from. */
function sharingSender(
  overrides: Partial<ProductEventSenderOptions> = {},
  respond?: (request: RecordedRequest) => Response,
) {
  const built = senderWith(overrides, respond);
  built.sender.setSharing(true);
  return built;
}

test("a run that sends no network queues nothing and asks for nothing", async () => {
  const { sender, requests, flush } = sharingSender({ sends: false });
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  sender.markDayActive();
  sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  await flush();
  assert.deepEqual(requests, []);
});

test("nothing is queued before the settings file has answered", async () => {
  const { sender, requests, flush } = senderWith();
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await flush();
  assert.deepEqual(requests, []);
});

test("a flush posts one bearer-authenticated batch and empties the queue", async () => {
  const { sender, requests, flush } = sharingSender();
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  await flush();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, ENDPOINT);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].authorization, "Bearer token-1");
  assert.deepEqual(sentEvents(requests[0]), [
    { name: PRODUCT_EVENT.APP_LAUNCH, at: NOON, properties: { app_version: APP_VERSION } },
    { name: PRODUCT_EVENT.ACCOUNT_SIGN_IN, at: NOON, properties: {} },
  ]);

  await flush();
  assert.equal(requests.length, 1);
});

test("arming records no transition; turning it off records one stop and then goes quiet", async () => {
  const { sender, requests, flush } = senderWith();
  sender.setSharing(true);
  sender.setSharing(true);
  await flush();
  assert.deepEqual(requests, []);

  sender.setSharing(false);
  await flush();
  assert.equal(requests.length, 1);
  assert.deepEqual(sentEvents(requests[0]), [
    { name: PRODUCT_EVENT.USAGE_SHARING_STOP, at: NOON, properties: {} },
  ]);

  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  sender.markDayActive();
  await flush();
  assert.equal(requests.length, 1);

  sender.setSharing(true);
  await flush();
  assert.equal(requests.length, 2);
  assert.deepEqual(sentEvents(requests[1]), [
    { name: PRODUCT_EVENT.USAGE_SHARING_RESUME, at: NOON, properties: {} },
  ]);
});

test("a 401 refreshes and retries once, and the same token twice does not", async () => {
  let token = "stale";
  const { fetch, requests } = recordingFetch((request) =>
    request.authorization === "Bearer fresh"
      ? new Response("{}")
      : new Response("{}", { status: HTTP_STATUS.UNAUTHORIZED }),
  );
  let refreshes = 0;
  const sender = new ProductEventSender({
    serviceBaseUrl: BASE_URL,
    appVersion: APP_VERSION,
    sends: true,
    readAccessToken: () => Effect.succeed(token),
    refreshAccount: () =>
      Effect.sync(() => {
        refreshes += 1;
        token = "fresh";
      }),
    now: () => NOON,
    runEffect: (effect) => runWithHttp(effect, fetch),
  });
  const flush = () => runWithHttp(sender.flush(), fetch);
  sender.setSharing(true);
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await flush();

  assert.equal(refreshes, 1);
  assert.deepEqual(
    requests.map((request) => request.authorization),
    ["Bearer stale", "Bearer fresh"],
  );

  const stuck = senderWith(
    { readAccessToken: () => Effect.succeed("same") },
    () => new Response("{}", { status: HTTP_STATUS.UNAUTHORIZED }),
  );
  stuck.sender.setSharing(true);
  stuck.sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await stuck.flush();
  assert.equal(stuck.requests.length, 1);
});

test("a failed send drops its batch rather than retrying it behind the next one", async () => {
  const { fetch, requests } = recordingFetch(() => {
    throw new Error("network down");
  });
  const sender = new ProductEventSender({
    serviceBaseUrl: BASE_URL,
    appVersion: APP_VERSION,
    sends: true,
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    now: () => NOON,
    runEffect: (effect) => runWithHttp(effect, fetch),
  });
  const flush = () => runWithHttp(sender.flush(), fetch);
  sender.setSharing(true);
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await flush();
  assert.equal(requests.length, 1);

  sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  await flush().catch(() => assert.fail("a flush must never throw"));
  assert.equal(requests.length, 2);
  assert.deepEqual(sentEvents(requests[1]), [
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
    readAccessToken: () => Effect.succeed(token),
    refreshAccount: () => Effect.void,
    now: () => NOON,
    runEffect: (effect) => runWithHttp(effect, fetch),
  });
  const flush = () => runWithHttp(sender.flush(), fetch);
  sender.setSharing(true);
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  await flush();
  assert.deepEqual(requests, []);

  token = "token-1";
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(sentEvents(requests[0]).length, 1);
});

test("past the queue limit the oldest go and the newest stay", async () => {
  const { sender, requests, flush } = sharingSender({ queueLimit: 3 });
  for (const providerId of ["claude-code", "codex", "conductor", "cursor"] as const) {
    sender.record(PRODUCT_EVENT.SESSION_ACT_SEND, {
      provider_id: providerId,
      session_act: "message_send",
    });
  }
  await flush();

  assert.deepEqual(
    sentEvents(requests[0]).map((event) => event.properties.provider_id),
    ["codex", "conductor", "cursor"],
  );
});

test("a batch past the wire limit is left for the next flush rather than refused", async () => {
  const { sender, requests, flush } = sharingSender();
  for (let index = 0; index < 60; index += 1) {
    sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  }
  await flush();
  assert.equal(sentEvents(requests[0]).length, 50);
  await flush();
  assert.equal(sentEvents(requests[1]).length, 10);
});

test("the day marker records once a day, and again once the day has turned", async () => {
  let now = NOON;
  const { sender, requests, flush } = sharingSender({ now: () => now });
  sender.markDayActive();
  sender.markDayActive();
  now = NOON + 6 * 60 * 60 * 1000;
  sender.markDayActive();
  await flush();
  assert.equal(sentEvents(requests[0]).length, 1);

  now = NOON + DAY_MS;
  sender.markDayActive();
  await flush();
  assert.deepEqual(sentEvents(requests[1]), [
    {
      name: PRODUCT_EVENT.APP_DAY_ACTIVE,
      at: now,
      properties: { app_version: APP_VERSION },
    },
  ]);
});

test("an observation is counted once per provider per day, in buckets", async () => {
  const { sender, requests, flush } = sharingSender();
  for (const providerId of ["codex", "codex", "claude-code"] as const) {
    sender.recordOncePerDay(PRODUCT_EVENT.SESSION_OBSERVE, providerId, {
      provider_id: providerId,
      session_count: PRODUCT_SESSION_COUNT_BUCKET.FEW,
    });
  }
  await flush();

  assert.deepEqual(
    sentEvents(requests[0]).map((event) => event.properties),
    [
      { provider_id: "codex", session_count: PRODUCT_SESSION_COUNT_BUCKET.FEW },
      { provider_id: "claude-code", session_count: PRODUCT_SESSION_COUNT_BUCKET.FEW },
    ],
  );
});

test("a call site handing a value outside the allowlist queues nothing", async () => {
  const { sender, requests, flush } = sharingSender();
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
  await flush();
  assert.deepEqual(requests, []);
});

test("a run left open marks each day it crosses, not only its launch day", async () => {
  let now = NOON;
  const { sender, requests } = sharingSender({ now: () => now, flushIntervalMs: 10 });
  sender.markDayActive();
  sender.start();

  // Two ticks inside the launch day add nothing: the day is already marked.
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(requests.length, 1);
  assert.deepEqual(sentEvents(requests[0]).length, 1);

  // The day turns while the app stays open, which is the case the marker
  // exists for — without a tick it would be a second copy of app:launch.
  now = NOON + DAY_MS;
  await new Promise((resolve) => setTimeout(resolve, 35));
  sender.stop();

  const marked = requests.flatMap((request) =>
    sentEvents(request).filter((event) => event.name === PRODUCT_EVENT.APP_DAY_ACTIVE),
  );
  assert.equal(marked.length, 2);
  assert.deepEqual(
    marked.map((event) => event.at),
    [NOON, NOON + DAY_MS],
  );
});

test("stopping drops what was queued rather than holding the quit open", async () => {
  const { sender, requests, flush } = sharingSender();
  sender.start();
  sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
  sender.stop();
  await flush();
  assert.deepEqual(requests, []);
});
