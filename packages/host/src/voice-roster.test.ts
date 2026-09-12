import assert from "node:assert/strict";
import { SESSION_LOCATION, SESSION_STATUS, type Session } from "@sidecar/session";
import { test } from "vitest";
import { voiceRoster } from "./voice-roster.js";

const OBSERVED_AT = 1_800_000_000_000;

const FULL: Session = {
  providerId: "conductor",
  providerSessionId: "chat-1",
  provider: { id: "conductor", displayName: "Conductor" },
  title: "Fix the roster test",
  status: SESSION_STATUS.WAITING,
  holdingForDeveloper: true,
  lastActivityAt: OBSERVED_AT,
  location: SESSION_LOCATION.CLOUD,
  applications: [],
  advertises: [],
  detail: {
    activity: "bash",
    error: "the build failed on line 40",
    branch: "conductor/roster",
    repository: "luke",
    model: "claude-opus-5",
    link: "https://conductor.example/chat-1",
  },
};

test("the voice is handed the summary fields and no other, whatever else a session carries", () => {
  const [mapped] = voiceRoster([FULL]);
  assert.ok(mapped);
  assert.deepEqual(Object.keys(mapped).sort(), [
    "activity",
    "holdingForDeveloper",
    "identity",
    "lastActivityAt",
    "provider",
    "status",
    "title",
  ]);
  assert.deepEqual(mapped.identity, { providerId: "conductor", providerSessionId: "chat-1" });
  assert.deepEqual(mapped.provider, { displayName: "Conductor" });
  assert.equal(mapped.title, FULL.title);
  assert.equal(mapped.status, FULL.status);
  assert.equal(mapped.holdingForDeveloper, true);
  assert.equal(mapped.activity, "bash");
  assert.equal(mapped.lastActivityAt, OBSERVED_AT);
});

test("the two fields a provider may leave unsaid are absent rather than empty", () => {
  const { holdingForDeveloper: _holding, ...rest } = FULL;
  const [mapped] = voiceRoster([{ ...rest, status: SESSION_STATUS.WORKING, detail: {} }]);
  assert.ok(mapped);
  assert.deepEqual(Object.keys(mapped).sort(), [
    "identity",
    "lastActivityAt",
    "provider",
    "status",
    "title",
  ]);
});
