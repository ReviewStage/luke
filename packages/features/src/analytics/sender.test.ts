import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HTTP_STATUS, type RecordedRequest, recordingHttpClient } from "@luke/wire/testing";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { PRODUCT_EVENT } from "./product-events.js";
import {
  ProductEventSender,
  type ProductEventSenderOptions,
  type RecordedDayStore,
} from "./sender.js";

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

const NEXT_NOON = Date.parse("2026-08-20T12:00:00.000Z");

/** The host's settings file as the sender sees it: kept across launches by event, discriminator, and account. */
function keptDays(): RecordedDayStore {
  const days = new Map<string, Map<string, Map<string, string>>>();
  return {
    lastRecordedDay: (name, discriminator, account) =>
      Effect.sync(() => days.get(name)?.get(discriminator)?.get(account)),
    keepRecordedDay: ({ name, discriminator, account, day }) =>
      Effect.sync(() => {
        const byDiscriminator = days.get(name) ?? new Map<string, Map<string, string>>();
        const byAccount = byDiscriminator.get(discriminator) ?? new Map<string, string>();
        byAccount.set(account, day);
        byDiscriminator.set(discriminator, byAccount);
        days.set(name, byDiscriminator);
      }),
  };
}

/** How many day markers the requests a launch made carried. */
function dayMarkers(requests: readonly RecordedRequest[]): number {
  return requests
    .flatMap((request) => JSON.parse(request.body ?? "{}").events ?? [])
    .filter((event: { name: string }) => event.name === PRODUCT_EVENT.APP_DAY_ACTIVE).length;
}

/**
 * One launch of the app: a sender of its own over the kept days, which marks
 * the day as the host does at launch and on its first tick, flushes, and
 * answers how many day markers it sent.
 */
function launch(
  options: Partial<ProductEventSenderOptions>,
  respond?: (request: RecordedRequest) => Response,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const { sender, requests } = yield* sharingSender(options, respond);
      yield* sender.markDayActive();
      yield* sender.flush;
      yield* sender.markDayActive();
      yield* sender.flush;
      return dayMarkers(requests);
    }),
  );
}

it.effect("the day is counted once across launches, and again on the next UTC day", () =>
  Effect.gen(function* () {
    let now = NOON;
    const options = {
      recordedDays: keptDays(),
      readAccountKey: () => Effect.succeed("ada@luke.test"),
      now: () => now,
    };

    assert.equal(yield* launch(options), 1);
    assert.equal(yield* launch(options), 0);

    now = NEXT_NOON;
    assert.equal(yield* launch(options), 1);
    assert.equal(yield* launch(options), 0);
  }),
);

it.effect("another account signing in the same day has its own day counted, once", () =>
  Effect.gen(function* () {
    let account = "ada@luke.test";
    const options = {
      recordedDays: keptDays(),
      readAccountKey: () => Effect.succeed(account),
    };

    assert.equal(yield* launch(options), 1);
    account = "grace@luke.test";
    assert.equal(yield* launch(options), 1);
    account = "ada@luke.test";
    assert.equal(yield* launch(options), 0);
  }),
);

it.effect("a day marked while nobody is signed in is marked once an account signs in", () =>
  Effect.gen(function* () {
    let account: string | undefined;
    const { sender, requests } = yield* sharingSender({
      recordedDays: keptDays(),
      readAccountKey: () => Effect.succeed(account),
    });
    yield* sender.markDayActive();
    yield* sender.flush;
    assert.equal(dayMarkers(requests), 0);

    account = "ada@luke.test";
    yield* sender.markDayActive();
    yield* sender.flush;
    assert.equal(dayMarkers(requests), 1);
  }),
);

it.effect("a day whose batch never reached the service is counted on the next launch", () =>
  Effect.gen(function* () {
    const options = {
      recordedDays: keptDays(),
      readAccountKey: () => Effect.succeed("ada@luke.test"),
    };

    yield* launch(options, () => {
      throw new TypeError("fetch failed");
    });
    assert.equal(yield* launch(options), 1);
  }),
);

it.effect("a day marked for one account is never sent under the next account's bearer", () =>
  Effect.gen(function* () {
    let account = "ada@luke.test";
    const options = {
      recordedDays: keptDays(),
      readAccountKey: () => Effect.succeed(account),
    };
    const { sender, requests } = yield* sharingSender(options);
    yield* sender.markDayActive();
    // Ada signs out and Grace signs in before the minute's flush.
    account = "grace@luke.test";
    yield* sender.flush;
    assert.equal(dayMarkers(requests), 0);

    // Grace's own day is hers to count, once; Ada's is counted when she is back.
    yield* sender.markDayActive();
    yield* sender.flush;
    yield* sender.markDayActive();
    yield* sender.flush;
    assert.equal(dayMarkers(requests), 1);
    account = "ada@luke.test";
    assert.equal(yield* launch(options), 1);
  }),
);
