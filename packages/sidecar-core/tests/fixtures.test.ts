import assert from "node:assert/strict";
import test from "node:test";
import { fixtureSnapshot } from "../src";
import { attentionCount } from "../src/fixtures";

test("the smoke fixture is stable and contains no duplicate identities", () => {
  const snapshot = fixtureSnapshot("smoke");
  const identities = snapshot.sessions.map((session) => session.id);

  assert.equal(snapshot.scenario, "smoke");
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(attentionCount(snapshot), 1);
});

test("unknown fixtures remain explicit", () => {
  assert.throws(() => fixtureSnapshot("missing"), /Unknown fixture scenario/);
});
