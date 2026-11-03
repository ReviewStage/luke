import assert from "node:assert/strict";
import { test } from "vitest";
import { SETUP_AUDIENCE, SETUP_GATE, SETUP_STEP, setupGate, setupSteps } from "./setup-model.js";

const NEW = {
  id: "user-ada",
  fresh: true,
  finished: [],
  started: false,
  personalOnly: true,
  agent: false,
} as const;

test.each([
  { case: "a new account with no agent", account: NEW, gate: SETUP_GATE.OWED },
  {
    case: "a new account whose agent read is out",
    account: { ...NEW, agent: undefined },
    gate: SETUP_GATE.WAIT,
  },
  {
    case: "an account with an agent connected, as every account that has worked has",
    account: { ...NEW, agent: true },
    gate: SETUP_GATE.NONE,
  },
  {
    case: "an account in a team's workspace",
    account: { ...NEW, personalOnly: false },
    gate: SETUP_GATE.NONE,
  },
  { case: "an account with tasks", account: { ...NEW, fresh: false }, gate: SETUP_GATE.NONE },
  {
    case: "an account that finished on this machine",
    account: { ...NEW, finished: ["user-ada"] },
    gate: SETUP_GATE.NONE,
  },
  {
    case: "an account midway, its agent and team made",
    account: { ...NEW, started: true, agent: true, personalOnly: false },
    gate: SETUP_GATE.OWED,
  },
  { case: "no account signed in", account: { ...NEW, id: undefined }, gate: SETUP_GATE.NONE },
])("setup for $case: $gate", ({ account, gate }) => {
  assert.equal(setupGate(account), gate);
});

test("a team's workspace is made before GitHub, which is installed on it", () => {
  const steps = setupSteps(SETUP_AUDIENCE.TEAM);
  assert.ok(steps.indexOf(SETUP_STEP.TEAM) < steps.indexOf(SETUP_STEP.GITHUB));
  assert.ok(
    !setupSteps(SETUP_AUDIENCE.ME).includes(SETUP_STEP.TEAM),
    "an account set up for itself makes no team",
  );
});
