import assert from "node:assert/strict";
import { test } from "vitest";
import {
  PRODUCT_EVENT,
  PRODUCT_EVENT_PROPERTY,
  PRODUCT_EXPERIMENT,
  PRODUCT_SETTING_VALUE,
  productEventBuildFromWire,
  productEventFromWire,
} from "./product-events.js";

const AT = Date.parse("2026-08-19T12:00:00.000Z");

test("prose cannot pass as a property value", () => {
  const prose = "codex — /Users/me/luke on feature/x";
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.SEARCH_OPEN,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: prose },
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

test("an experiment's switch is counted by its key and on or off, and by nothing it does not list", () => {
  const toggled = {
    [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: PRODUCT_EXPERIMENT.FACTORY,
    [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: PRODUCT_SETTING_VALUE.ON,
  };
  assert.deepEqual(
    productEventFromWire({ name: PRODUCT_EVENT.EXPERIMENT_TOGGLE, at: AT, properties: toggled }),
    { name: PRODUCT_EVENT.EXPERIMENT_TOGGLE, at: AT, properties: toggled },
  );
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.EXPERIMENT_TOGGLE,
      at: AT,
      properties: { ...toggled, [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: "a feature nobody listed" },
    }),
    undefined,
  );
});

test("a batch's build is read as strictly as an event's, and is never a reason to refuse the batch", () => {
  // A field the build does not name is not copied forward.
  assert.deepEqual(
    productEventBuildFromWire({
      events: [],
      build: { app_version: "0.18.0", packaged: true, email: "me@luke.test" },
    }),
    { app_version: "0.18.0", packaged: true },
  );
  // A version that is not `x.y.z` or a flag that is not a boolean leaves the
  // whole build off rather than forwarding it.
  assert.deepEqual(
    productEventBuildFromWire({
      events: [],
      build: { app_version: "/Users/me/luke", packaged: true },
    }),
    {},
  );
  assert.deepEqual(
    productEventBuildFromWire({ events: [], build: { app_version: "0.18.0", packaged: "yes" } }),
    {},
  );
  // Builds 0.7 to 0.17 send no build at all.
  assert.deepEqual(productEventBuildFromWire({ events: [] }), {});
});
