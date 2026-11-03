import assert from "node:assert/strict";
import { test } from "vitest";
import { SETUP_AUDIENCE, SETUP_STEP, setupOwed, setupSteps } from "./setup-model.js";

test.each([
  {
    case: "a fresh account that has not finished",
    id: "user-ada",
    fresh: true,
    finished: [],
    owed: true,
  },
  {
    case: "a fresh account that finished on this machine",
    id: "user-ada",
    fresh: true,
    finished: ["user-ada"],
    owed: false,
  },
  {
    case: "another account finished here, not this one",
    id: "user-ada",
    fresh: true,
    finished: ["user-theo"],
    owed: true,
  },
  { case: "an account with tasks", id: "user-ada", fresh: false, finished: [], owed: false },
  { case: "no account signed in", id: undefined, fresh: true, finished: [], owed: false },
])("setup is owed to $case: $owed", ({ id, fresh, finished, owed }) => {
  assert.equal(setupOwed({ id, fresh, finished }), owed);
});

test("a team's workspace is made before GitHub, which is installed on it", () => {
  const steps = setupSteps(SETUP_AUDIENCE.TEAM);
  assert.ok(steps.indexOf(SETUP_STEP.TEAM) < steps.indexOf(SETUP_STEP.GITHUB));
  assert.ok(
    !setupSteps(SETUP_AUDIENCE.ME).includes(SETUP_STEP.TEAM),
    "an account set up for itself makes no team",
  );
});
