import assert from "node:assert/strict";
import { unparsedWire } from "@repo/wire";
import { describe, test } from "vitest";
import {
  EXPERIMENT,
  experimentChoicesFrom,
  experimentOn,
  experimentsIn,
  workspaceExperimentChoicesFrom,
} from "./experiments.js";

/**
 * A choice of experiments as the account's store and the wire hand it over:
 * what an older or newer build's answer carries beyond this build's
 * experiments is passed over rather than refused, so no Mac loses the
 * choices it knows to one it does not.
 */
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

describe("the experiments on where a member works in a workspace", () => {
  test("take the account's own from the account and a workspace experiment only from the workspace, whatever the account's store still holds", () => {
    const account = { [EXPERIMENT.SKILLS]: true, [EXPERIMENT.DESCRIPTIONS]: true };
    const workspace = workspaceExperimentChoicesFrom([
      { experiment: EXPERIMENT.MEMORY, on: true },
      { experiment: EXPERIMENT.SKILLS, on: true },
    ]);

    const choices = experimentsIn(account, workspace);

    assert.equal(experimentOn(choices, EXPERIMENT.SKILLS), true);
    assert.equal(experimentOn(choices, EXPERIMENT.MEMORY), true);
    assert.equal(experimentOn(choices, EXPERIMENT.DESCRIPTIONS), false);
    assert.equal(experimentOn(experimentsIn({}, workspace), EXPERIMENT.SKILLS), false);
  });
});
