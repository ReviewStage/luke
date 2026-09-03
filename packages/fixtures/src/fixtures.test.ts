import assert from "node:assert/strict";
import test from "node:test";
import { fixtureSnapshot } from "@sidecar/fixtures";
import { FIXTURE_SESSION_IDS_BY_PROVIDER, urgentSessionCount } from "./fixtures.js";

test("the smoke fixture is stable and contains no duplicate identities", () => {
  const snapshot = fixtureSnapshot("smoke");
  const identities = snapshot.sessions.map((session) => session.id);

  assert.equal(snapshot.scenario, "smoke");
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(urgentSessionCount(snapshot), 1);
});

test("registered fixture rows are the smoke fixture's provider rows", () => {
  const snapshot = fixtureSnapshot("smoke");
  const registered = Object.values(FIXTURE_SESSION_IDS_BY_PROVIDER).flat();
  assert.deepEqual(new Set(registered), new Set(snapshot.sessions.map((session) => session.id)));
});

test("unknown fixtures remain explicit", () => {
  assert.throws(() => fixtureSnapshot("missing"), /Unknown fixture scenario/);
});
