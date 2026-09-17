import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import {
  HTTP_STATUS,
  type RecordedRequest,
  recordedRequest,
  recordingHttpClient,
} from "@sidecar/wire/testing";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import {
  HELD_PRODUCT_EVENTS_VERSION,
  type HeldProductEvents,
  type HeldProductEventsRecord,
} from "./held-events.js";
import {
  PRODUCT_EVENT,
  PRODUCT_EVENT_CLIENT,
  PRODUCT_EVENT_CLIENT_HEADER,
  PRODUCT_SESSION_COUNT_BUCKET,
  PRODUCT_VOICE_SESSION_SOURCE,
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

it.effect("a run that sends no network queues nothing and asks for nothing", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* sharingSender({ sends: false });
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    sender.markDayActive();
    sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
    yield* sender.flush;
    assert.deepEqual(requests, []);
  }),
);

it.effect("nothing is queued before the settings file has answered", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* senderWith();
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    yield* sender.flush;
    assert.deepEqual(requests, []);
  }),
);

it.effect("a flush posts one bearer-authenticated batch and empties the queue", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* sharingSender();
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
    yield* sender.flush;

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

    yield* sender.flush;
    assert.equal(requests.length, 1);
  }),
);

it.effect("a sender that was never armed sends nothing", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* senderWith();
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    sender.markDayActive();
    yield* sender.flush;
    assert.deepEqual(requests, []);
  }),
);

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

it.effect("a failed send drops its batch rather than retrying it behind the next one", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* sharingSender({}, () => {
      throw new Error("network down");
    });
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    yield* sender.flush;
    assert.equal(requests.length, 1);

    sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
    yield* sender.flush;
    assert.equal(requests.length, 2);
    assert.deepEqual(sentEvents(recordedRequest(requests, 1)), [
      { name: PRODUCT_EVENT.ACCOUNT_SIGN_IN, at: NOON, properties: {} },
    ]);
  }),
);

it.effect("signed out the queue waits rather than being spent", () =>
  Effect.gen(function* () {
    let token: string | undefined;
    const { sender, requests } = yield* sharingSender({
      readAccessToken: () => Effect.succeed(token),
      refreshAccount: () => Effect.void,
    });
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    yield* sender.flush;
    assert.deepEqual(requests, []);

    token = "token-1";
    yield* sender.flush;
    assert.equal(requests.length, 1);
    assert.equal(sentEvents(recordedRequest(requests)).length, 1);
  }),
);

it.effect("a token the settings file could not answer leaves the batch queued", () =>
  Effect.gen(function* () {
    let readable = false;
    const { sender, requests } = yield* sharingSender({
      readAccessToken: () =>
        Effect.try(() => {
          if (!readable) throw new Error("the settings file could not be read");
          return "token-1";
        }).pipe(Effect.orElseSucceed(() => undefined)),
    });
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    yield* sender.flush;
    assert.deepEqual(requests, []);

    readable = true;
    yield* sender.flush;
    assert.equal(sentEvents(recordedRequest(requests)).length, 1);
  }),
);

it.effect("past the queue limit the oldest go and the newest stay", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* sharingSender({ queueLimit: 3 });
    for (const providerId of ["claude-code", "codex", "conductor", "omp"] as const) {
      sender.record(PRODUCT_EVENT.SESSION_ACTION_SEND, {
        provider_id: providerId,
        session_action: "message_send",
      });
    }
    yield* sender.flush;

    assert.deepEqual(
      sentEvents(recordedRequest(requests)).map((event) => event.properties.provider_id),
      ["codex", "conductor", "omp"],
    );
  }),
);

it.effect("a batch past the wire limit is left for the next flush rather than refused", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* sharingSender();
    for (let index = 0; index < 60; index += 1) {
      sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
    }
    yield* sender.flush;
    assert.equal(sentEvents(recordedRequest(requests)).length, 50);
    yield* sender.flush;
    assert.equal(sentEvents(recordedRequest(requests, 1)).length, 10);
  }),
);

it.effect("the day marker records once a day, and again once the day has turned", () =>
  Effect.gen(function* () {
    let now = NOON;
    const { sender, requests } = yield* sharingSender({ now: () => now });
    sender.markDayActive();
    sender.markDayActive();
    now = NOON + 6 * 60 * 60 * 1000;
    sender.markDayActive();
    yield* sender.flush;
    assert.equal(sentEvents(recordedRequest(requests)).length, 1);

    now = NOON + DAY_MS;
    sender.markDayActive();
    yield* sender.flush;
    assert.deepEqual(sentEvents(recordedRequest(requests, 1)), [
      {
        name: PRODUCT_EVENT.APP_DAY_ACTIVE,
        at: now,
        properties: { app_version: APP_VERSION },
      },
    ]);
  }),
);

it.effect("an observation is counted once per provider per day, in buckets", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* sharingSender();
    for (const providerId of ["codex", "codex", "claude-code"] as const) {
      sender.recordOncePerDay(PRODUCT_EVENT.SESSION_OBSERVE, providerId, {
        provider_id: providerId,
        session_count: PRODUCT_SESSION_COUNT_BUCKET.FEW,
      });
    }
    yield* sender.flush;

    assert.deepEqual(
      sentEvents(recordedRequest(requests)).map((event) => event.properties),
      [
        { provider_id: "codex", session_count: PRODUCT_SESSION_COUNT_BUCKET.FEW },
        { provider_id: "claude-code", session_count: PRODUCT_SESSION_COUNT_BUCKET.FEW },
      ],
    );
  }),
);

it.effect("a call site handing a value outside the allowlist queues nothing", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* sharingSender();
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
    yield* sender.flush;
    assert.deepEqual(requests, []);
  }),
);

it.effect("a run left open marks each day it crosses, not only its launch day", () =>
  Effect.gen(function* () {
    let now = NOON;
    const { sender, requests } = yield* sharingSender({ now: () => now, flushIntervalMs: 10 });
    sender.markDayActive();

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
    yield* sender.drop;

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

it.effect("dropping the queue leaves nothing to post rather than holding the quit open", () =>
  Effect.gen(function* () {
    const { sender, requests } = yield* sharingSender();
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    yield* sender.drop;
    yield* sender.flush;
    assert.deepEqual(requests, []);
  }),
);

const HELD_AT = NOON - 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** A hold in memory: what an earlier run left, and every record this one writes over it, in order. */
function memoryHold(initial?: HeldProductEventsRecord) {
  const writes: HeldProductEventsRecord[] = [];
  let record = initial;
  const seam: HeldProductEvents = {
    read: Effect.sync(() => record),
    write: (next) =>
      Effect.sync(() => {
        record = next;
        writes.push(next);
      }),
  };
  return { seam, writes, current: () => record };
}

function heldRecord(events: readonly ProductEvent[]): HeldProductEventsRecord {
  return { version: HELD_PRODUCT_EVENTS_VERSION, events };
}

it.effect("a flush that found no credential writes its batch to the hold", () =>
  Effect.gen(function* () {
    const hold = memoryHold();
    const { sender, requests } = yield* sharingSender({
      held: hold.seam,
      readAccessToken: () => Effect.succeed(undefined),
    });
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    sender.record(PRODUCT_EVENT.VOICE_CALL_START, {
      session_source: PRODUCT_VOICE_SESSION_SOURCE.INTRODUCTION,
    });
    sender.record(PRODUCT_EVENT.INTRODUCTION_COMPLETE, {});
    yield* sender.flush;

    assert.deepEqual(requests, []);
    assert.deepEqual(hold.writes, [
      heldRecord([
        { name: PRODUCT_EVENT.APP_LAUNCH, at: NOON, properties: { app_version: APP_VERSION } },
        {
          name: PRODUCT_EVENT.VOICE_CALL_START,
          at: NOON,
          properties: { session_source: PRODUCT_VOICE_SESSION_SOURCE.INTRODUCTION },
        },
        { name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: NOON, properties: {} },
      ]),
    ]);
  }),
);

it.effect("a later run posts the hold ahead of its own events and then clears it", () =>
  Effect.gen(function* () {
    const hold = memoryHold(
      heldRecord([
        {
          name: PRODUCT_EVENT.VOICE_CALL_START,
          at: HELD_AT,
          properties: { session_source: PRODUCT_VOICE_SESSION_SOURCE.INTRODUCTION },
        },
        { name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: HELD_AT, properties: {} },
      ]),
    );
    const { sender, requests } = yield* sharingSender({ held: hold.seam });
    sender.record(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
    yield* sender.flush;

    assert.deepEqual(
      sentEvents(recordedRequest(requests)).map((event) => [event.name, event.at]),
      [
        [PRODUCT_EVENT.VOICE_CALL_START, HELD_AT],
        [PRODUCT_EVENT.INTRODUCTION_COMPLETE, HELD_AT],
        [PRODUCT_EVENT.ACCOUNT_SIGN_IN, NOON],
      ],
    );
    assert.deepEqual(hold.writes, [heldRecord([])]);

    // A hold already cleared is not written again by a quiet flush.
    yield* sender.flush;
    assert.equal(hold.writes.length, 1);
  }),
);

it.effect(
  "a hold waits through a run that never signs in, emptied ahead of each attempt and refilled by its refusal",
  () =>
    Effect.gen(function* () {
      const hold = memoryHold(
        heldRecord([{ name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: HELD_AT, properties: {} }]),
      );
      const { sender, requests } = yield* sharingSender({
        held: hold.seam,
        readAccessToken: () => Effect.succeed(undefined),
      });
      sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
      yield* sender.flush;
      yield* sender.flush;

      assert.deepEqual(requests, []);
      assert.deepEqual(
        hold.writes.map((record) => record.events.map((event) => event.name)),
        [
          [],
          [PRODUCT_EVENT.INTRODUCTION_COMPLETE, PRODUCT_EVENT.APP_LAUNCH],
          [],
          [PRODUCT_EVENT.INTRODUCTION_COMPLETE, PRODUCT_EVENT.APP_LAUNCH],
        ],
      );
    }),
);

it.effect(
  "the hold is emptied before the request leaves, so a quit after the post cannot replay it",
  () =>
    Effect.gen(function* () {
      const hold = memoryHold(
        heldRecord([{ name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: HELD_AT, properties: {} }]),
      );
      const heldWhenPosted: number[] = [];
      const { sender, requests } = yield* sharingSender({ held: hold.seam }, () => {
        heldWhenPosted.push(hold.current()?.events.length ?? 0);
        return new Response("{}");
      });
      yield* sender.flush;

      assert.equal(requests.length, 1);
      assert.deepEqual(heldWhenPosted, [0]);
      assert.deepEqual(hold.writes, [heldRecord([])]);
    }),
);

it.effect("a held event older than the service's age window is dropped, one inside it stays", () =>
  Effect.gen(function* () {
    const hold = memoryHold(
      heldRecord([
        { name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: NOON - WEEK_MS - 1, properties: {} },
        { name: PRODUCT_EVENT.ACCOUNT_SIGN_IN, at: NOON - WEEK_MS, properties: {} },
      ]),
    );
    const { sender, requests } = yield* sharingSender({ held: hold.seam });
    yield* sender.flush;

    assert.deepEqual(
      sentEvents(recordedRequest(requests)).map((event) => event.name),
      [PRODUCT_EVENT.ACCOUNT_SIGN_IN],
    );
  }),
);

it.effect("a hold past the queue limit keeps the newest, and this run's events after them", () =>
  Effect.gen(function* () {
    const hold = memoryHold(
      heldRecord(
        Array.from({ length: 5 }, (_, index) => ({
          name: PRODUCT_EVENT.ACCOUNT_SIGN_IN,
          at: HELD_AT + index,
          properties: {},
        })),
      ),
    );
    const { sender, requests } = yield* sharingSender({ held: hold.seam, queueLimit: 3 });
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    yield* sender.flush;

    assert.deepEqual(
      sentEvents(recordedRequest(requests)).map((event) => [event.name, event.at]),
      [
        [PRODUCT_EVENT.ACCOUNT_SIGN_IN, HELD_AT + 3],
        [PRODUCT_EVENT.ACCOUNT_SIGN_IN, HELD_AT + 4],
        [PRODUCT_EVENT.APP_LAUNCH, NOON],
      ],
    );
  }),
);

it.effect("a held event the allowlist no longer reads is dropped rather than posted", () =>
  Effect.gen(function* () {
    const hold = memoryHold({
      version: HELD_PRODUCT_EVENTS_VERSION,
      events: [
        { name: "introduction:retired", at: HELD_AT, properties: {} },
        {
          name: PRODUCT_EVENT.VOICE_CALL_START,
          at: HELD_AT,
          properties: { session_source: "cli" },
        },
        { name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: HELD_AT, properties: {} },
      ],
    });
    const { sender, requests } = yield* sharingSender({ held: hold.seam });
    yield* sender.flush;

    assert.deepEqual(
      sentEvents(recordedRequest(requests)).map((event) => event.name),
      [PRODUCT_EVENT.INTRODUCTION_COMPLETE],
    );
  }),
);

it.effect("a held day marker for the day this run already marked is one day, not two", () =>
  Effect.gen(function* () {
    const hold = memoryHold(
      heldRecord([
        {
          name: PRODUCT_EVENT.APP_DAY_ACTIVE,
          at: NOON - DAY_MS,
          properties: { app_version: APP_VERSION },
        },
        {
          name: PRODUCT_EVENT.APP_DAY_ACTIVE,
          at: HELD_AT,
          properties: { app_version: APP_VERSION },
        },
      ]),
    );
    const { sender, requests } = yield* sharingSender({ held: hold.seam });
    sender.markDayActive();
    yield* sender.flush;

    assert.deepEqual(
      sentEvents(recordedRequest(requests)).map((event) => event.at),
      [NOON - DAY_MS, NOON],
    );
  }),
);

it.effect("a run that sends no network neither reads nor writes the hold", () =>
  Effect.gen(function* () {
    let reads = 0;
    const hold = memoryHold(
      heldRecord([{ name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: HELD_AT, properties: {} }]),
    );
    const counted: HeldProductEvents = {
      read: Effect.tap(hold.seam.read, () =>
        Effect.sync(() => {
          reads += 1;
        }),
      ),
      write: hold.seam.write,
    };
    const { sender, requests } = yield* sharingSender({ sends: false, held: counted });
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    yield* sender.flush;

    assert.deepEqual(requests, []);
    assert.equal(reads, 0);
    assert.deepEqual(hold.writes, []);
  }),
);

it.effect("a sender not yet armed leaves the hold unread", () =>
  Effect.gen(function* () {
    let reads = 0;
    const hold = memoryHold(
      heldRecord([{ name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: HELD_AT, properties: {} }]),
    );
    const { sender, requests } = yield* senderWith({
      held: {
        read: Effect.tap(hold.seam.read, () =>
          Effect.sync(() => {
            reads += 1;
          }),
        ),
        write: hold.seam.write,
      },
    });
    yield* sender.flush;

    assert.deepEqual(requests, []);
    assert.equal(reads, 0);
    assert.deepEqual(hold.writes, []);
  }),
);

it.effect("dropping before the first flush leaves the earlier hold as it was", () =>
  Effect.gen(function* () {
    const hold = memoryHold(
      heldRecord([{ name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: HELD_AT, properties: {} }]),
    );
    const { sender } = yield* sharingSender({ held: hold.seam });
    sender.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: APP_VERSION });
    yield* sender.drop;
    assert.deepEqual(hold.writes, []);
    assert.deepEqual(
      hold.current()?.events.map((event) => event.name),
      [PRODUCT_EVENT.INTRODUCTION_COMPLETE],
    );
  }),
);
