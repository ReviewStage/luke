import assert from "node:assert/strict";
import test from "node:test";
import { ISSUE_TRACKER_ID, ISSUE_TRACKER_ID_LIST } from "@sidecar/issues";
import { issueTrackerRegistrations } from "./registrations.js";

const registrations = issueTrackerRegistrations({
  readGrant: async () => undefined,
  writeGrant: async () => undefined,
  forgetGrant: async () => undefined,
  openExternal: () => undefined,
  environment: {},
});

test("registers every tracker exactly once under its own id", () => {
  assert.deepEqual(Object.keys(registrations).sort(), [...ISSUE_TRACKER_ID_LIST].sort());
  for (const trackerId of ISSUE_TRACKER_ID_LIST) {
    assert.equal(registrations[trackerId].adapter.tracker.id, trackerId);
    assert.equal(registrations[trackerId].credential.id, trackerId);
  }
});

test("a disconnected tracker observes nothing and offers the sign-in this build carries", async () => {
  const linear = registrations[ISSUE_TRACKER_ID.LINEAR];
  assert.equal(await linear.adapter.observe(), undefined);
  assert.equal(linear.signInAvailable(), true);
});
