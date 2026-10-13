import assert from "node:assert/strict";
import { test } from "vitest";
import { PRODUCT_EVENT, PRODUCT_EVENT_PROPERTY, productEventFromWire } from "./product-events.js";

const AT = Date.parse("2026-08-19T12:00:00.000Z");

test("prose cannot pass as a property value", () => {
  const prose = "codex — /Users/me/luke on feature/x";
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.SESSION_OBSERVE,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: prose,
        [PRODUCT_EVENT_PROPERTY.SESSION_COUNT]: 1,
      },
    }),
    undefined,
  );
  // A version reader is not a string reader: a path is not `x.y.z`.
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.APP_LAUNCH,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "/Users/me/luke" },
    }),
    undefined,
  );
});

test("nothing on the envelope survives except what the allowlist names", () => {
  const event = productEventFromWire({
    name: PRODUCT_EVENT.APP_LAUNCH,
    at: AT,
    distinct_id: "someone-else",
    $ip: "203.0.113.7",
    email: "someone@example.test",
    properties: {
      [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "0.2.0",
      distinct_id: "someone-else",
      $set: { email: "someone@example.test" },
      $ip: "203.0.113.7",
    },
  });
  assert.deepEqual(event, {
    name: PRODUCT_EVENT.APP_LAUNCH,
    at: AT,
    properties: { [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "0.2.0" },
  });
});
