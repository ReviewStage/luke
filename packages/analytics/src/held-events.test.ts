import assert from "node:assert/strict";
import { Schema } from "effect";
import { test } from "vitest";
import {
  adoptableHeldProductEvents,
  HELD_PRODUCT_EVENTS_VERSION,
  HeldProductEventsRecordSchema,
} from "./held-events.js";
import { PRODUCT_EVENT, PRODUCT_EVENT_MAXIMUM_AGE_MS } from "./product-events.js";

const NOW = Date.parse("2026-09-12T12:00:00.000Z");
const APP_VERSION = "0.5.0";

const readsRecord = Schema.is(HeldProductEventsRecordSchema);

test("the record reads only its own version, with an event list of loose shapes", () => {
  assert.equal(readsRecord({ version: HELD_PRODUCT_EVENTS_VERSION, events: [] }), true);
  assert.equal(
    readsRecord({
      version: HELD_PRODUCT_EVENTS_VERSION,
      events: [{ name: "anything", at: 1, properties: { key: "value", count: 2 } }],
    }),
    true,
  );
  assert.equal(readsRecord({ version: HELD_PRODUCT_EVENTS_VERSION + 1, events: [] }), false);
  assert.equal(readsRecord({ events: [] }), false);
  assert.equal(readsRecord({ version: HELD_PRODUCT_EVENTS_VERSION }), false);
  assert.equal(
    readsRecord({
      version: HELD_PRODUCT_EVENTS_VERSION,
      events: [{ name: "anything", at: 1, properties: { nested: { deep: true } } }],
    }),
    false,
  );
});

test("adoption keeps events inside the age window, newest-limited, in held order", () => {
  const adopted = adoptableHeldProductEvents(
    {
      version: HELD_PRODUCT_EVENTS_VERSION,
      events: [
        {
          name: PRODUCT_EVENT.APP_LAUNCH,
          at: NOW - PRODUCT_EVENT_MAXIMUM_AGE_MS - 1,
          properties: { app_version: APP_VERSION },
        },
        {
          name: PRODUCT_EVENT.APP_LAUNCH,
          at: NOW - PRODUCT_EVENT_MAXIMUM_AGE_MS,
          properties: { app_version: APP_VERSION },
        },
        { name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: NOW - 2, properties: {} },
        { name: "introduction:retired", at: NOW - 1, properties: {} },
        { name: PRODUCT_EVENT.ACCOUNT_SIGN_IN, at: NOW, properties: {} },
      ],
    },
    NOW,
    2,
  );
  assert.deepEqual(
    adopted.map((event) => [event.name, event.at]),
    [
      [PRODUCT_EVENT.INTRODUCTION_COMPLETE, NOW - 2],
      [PRODUCT_EVENT.ACCOUNT_SIGN_IN, NOW],
    ],
  );
});

test("adoption builds each event from the allowlist rather than copying the held record", () => {
  const [adopted] = adoptableHeldProductEvents(
    {
      version: HELD_PRODUCT_EVENTS_VERSION,
      events: [
        {
          name: PRODUCT_EVENT.APP_LAUNCH,
          at: NOW,
          properties: { app_version: APP_VERSION, distinct_id: "somebody", title: "a real title" },
        },
      ],
    },
    NOW,
    10,
  );
  assert.deepEqual(adopted, {
    name: PRODUCT_EVENT.APP_LAUNCH,
    at: NOW,
    properties: { app_version: APP_VERSION },
  });
});
