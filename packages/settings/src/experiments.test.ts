import assert from "node:assert/strict";
import { unparsedWire } from "@repo/wire";
import { describe, test } from "vitest";
import { EXPERIMENT, experimentChoicesFrom } from "./experiments.js";

describe("a choice of experiments read from the store or the wire", () => {
  test("keeps a known experiment's on and off, and passes over a key or a value it does not know", () => {
    const read = experimentChoicesFrom(
      unparsedWire({ [EXPERIMENT.MEMORY]: true, graduated: true, newer: false }),
    );
    assert.deepEqual(read, { [EXPERIMENT.MEMORY]: true });
    assert.deepEqual(experimentChoicesFrom(unparsedWire({ [EXPERIMENT.MEMORY]: false })), {
      [EXPERIMENT.MEMORY]: false,
    });
    assert.deepEqual(experimentChoicesFrom(unparsedWire({ [EXPERIMENT.MEMORY]: "on" })), {});
  });

  test("refuses only what is not a record of choices at all", () => {
    for (const value of [null, "browser", 1, [EXPERIMENT.MEMORY]]) {
      assert.equal(experimentChoicesFrom(unparsedWire(value)), undefined, JSON.stringify(value));
    }
  });
});
