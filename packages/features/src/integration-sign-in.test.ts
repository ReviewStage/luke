import assert from "node:assert/strict";
import { test } from "vitest";
import { SIGN_IN, signInAfterRead, signInBegun, signInLine } from "./integration-sign-in.js";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_SIGN_IN_FAILURE,
  INTEGRATION_STATUS,
} from "./integration-wire.js";

const GRANOLA = INTEGRATION_PROVIDER.GRANOLA;
const DISCONNECTED = INTEGRATION_STATUS.DISCONNECTED;

test("a slow read from before a sign-in began again leaves that sign-in's own reason standing", () => {
  const retried = signInBegun(5, 0, true);
  const canceled = signInAfterRead(retried, {
    status: DISCONNECTED,
    failure: { reason: INTEGRATION_SIGN_IN_FAILURE.CANCELED },
    mark: 6,
    at: 1,
  });
  assert.equal(canceled?.kind, SIGN_IN.FAILED);

  const late = signInAfterRead(canceled, {
    status: DISCONNECTED,
    failure: { reason: INTEGRATION_SIGN_IN_FAILURE.ERROR, message: "The provider said no." },
    mark: 3,
    at: 2,
  });
  assert.ok(late !== undefined);
  assert.equal(signInLine(GRANOLA, late).text, "You canceled connecting Granola.");
});

test("a sign-in given up on still learns why from a later read that names it", () => {
  const waiting = signInBegun(5, 0, true);
  const unfinished = signInAfterRead(waiting, {
    status: INTEGRATION_STATUS.PENDING,
    mark: 6,
    at: Infinity,
  });
  assert.equal(unfinished?.kind, SIGN_IN.UNFINISHED);

  const named = signInAfterRead(unfinished, {
    status: DISCONNECTED,
    failure: { reason: INTEGRATION_SIGN_IN_FAILURE.ERROR, message: "The provider said no." },
    mark: 7,
    at: 1,
  });
  assert.ok(named !== undefined);
  assert.deepEqual(signInLine(GRANOLA, named), {
    text: "Granola could not be connected.",
    problem: true,
    said: "Granola's sign-in said: “The provider said no.”",
  });
});
