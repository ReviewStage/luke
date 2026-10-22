import assert from "node:assert/strict";
import { unparsedWire } from "@luke/wire";
import { describe, test } from "vitest";
import { EXPERIMENT, experimentChoicesFrom, experimentOn, NO_EXPERIMENTS } from "./experiments.js";

/**
 * A choice of experiments as the account's store and the wire hand it over:
 * what an older or newer build's answer carries beyond this build's
 * experiments is passed over rather than refused, so no Mac loses the
 * choices it knows to one it does not.
 */
describe("a choice of experiments read from the store or the wire", () => {
  test("keeps a known experiment's on and off, and passes over a key or a value it does not know", () => {
    const read = experimentChoicesFrom(
      unparsedWire({ [EXPERIMENT.CODE_REVIEW]: true, graduated: true, newer: false }),
    );
    assert.deepEqual(read, { [EXPERIMENT.CODE_REVIEW]: true });
    assert.deepEqual(experimentChoicesFrom(unparsedWire({ [EXPERIMENT.CODE_REVIEW]: false })), {
      [EXPERIMENT.CODE_REVIEW]: false,
    });
    assert.deepEqual(experimentChoicesFrom(unparsedWire({ [EXPERIMENT.CODE_REVIEW]: "on" })), {});
  });

  test("refuses only what is not a record of choices at all", () => {
    for (const value of [null, "code-review", 1, [EXPERIMENT.CODE_REVIEW]]) {
      assert.equal(experimentChoicesFrom(unparsedWire(value)), undefined, JSON.stringify(value));
    }
  });

  test("an experiment never chosen, or turned back off, is off", () => {
    assert.equal(experimentOn(NO_EXPERIMENTS, EXPERIMENT.CODE_REVIEW), false);
    assert.equal(experimentOn({ [EXPERIMENT.CODE_REVIEW]: false }, EXPERIMENT.CODE_REVIEW), false);
    assert.equal(experimentOn({ [EXPERIMENT.CODE_REVIEW]: true }, EXPERIMENT.CODE_REVIEW), true);
  });
});
