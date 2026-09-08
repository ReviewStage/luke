import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND,
  type ActionKind,
  type AdvertisedAction,
  type AdvertisedActionKind,
  advertisedActionFor,
  advertisedControl,
  advertisedControls,
  normalizeSession,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type Session,
} from "@sidecar/session";

const TEST_NOW = Date.parse("2026-08-16T12:00:00.000Z");

function advertising(advertises: readonly AdvertisedAction[]): Session {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "Advertised actions",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_NOW,
      advertises,
    },
  );
}

test("the action vocabulary is the advertisable kinds and the two nothing advertises", () => {
  // An open follows an address the observation already reported and a creation
  // is held to a provider's projects, so neither is a session's to advertise —
  // but both are actions, and the vocabulary is one.
  const unadvertisable: readonly ActionKind[] = [ACTION_KIND.OPEN, ACTION_KIND.CREATE_WORKSPACE];
  const advertisable: readonly AdvertisedActionKind[] = [
    ACTION_KIND.MESSAGE,
    ACTION_KIND.CONTROL,
    ACTION_KIND.ADD_AGENT,
    ACTION_KIND.RENAME_SESSION,
    ACTION_KIND.RENAME_WORKSPACE,
  ];
  assert.deepEqual([...advertisable, ...unadvertisable].sort(), Object.values(ACTION_KIND).sort());
});

test("each reader answers for the kind it names and nothing else", () => {
  const session = advertising([
    { kind: ACTION_KIND.MESSAGE },
    { kind: ACTION_KIND.ADD_AGENT, agents: ["claude", "codex"], target: "ws-1" },
    { kind: ACTION_KIND.RENAME_WORKSPACE, target: "ws-1" },
  ]);

  assert.deepEqual(advertisedActionFor(session, ACTION_KIND.MESSAGE), {
    kind: ACTION_KIND.MESSAGE,
  });
  assert.deepEqual(advertisedActionFor(session, ACTION_KIND.ADD_AGENT)?.agents, [
    "claude",
    "codex",
  ]);
  assert.equal(advertisedActionFor(session, ACTION_KIND.ADD_AGENT)?.target, "ws-1");
  assert.equal(advertisedActionFor(session, ACTION_KIND.RENAME_WORKSPACE)?.target, "ws-1");
  assert.equal(advertisedActionFor(session, ACTION_KIND.RENAME_SESSION), undefined);
  assert.deepEqual(advertisedControls(session), []);
});

test("controls keep the order their adapter listed them in", () => {
  const session = advertising([
    { kind: ACTION_KIND.CONTROL, id: "approve", label: "Approve the plan" },
    {
      kind: ACTION_KIND.CONTROL,
      id: "stop",
      label: "Stop",
      controlKind: SESSION_CONTROL_KIND.STOP,
    },
    { kind: ACTION_KIND.MESSAGE },
    {
      kind: ACTION_KIND.CONTROL,
      id: "archive",
      label: "Archive",
      controlKind: SESSION_CONTROL_KIND.ARCHIVE,
    },
  ]);

  assert.deepEqual(
    advertisedControls(session).map((control) => control.id),
    ["approve", "stop", "archive"],
  );
  assert.equal(advertisedControl(session, "stop")?.controlKind, SESSION_CONTROL_KIND.STOP);
  assert.equal(advertisedControl(session, "nothing-here"), undefined);
});

test("an unnormalized observation is read through the same lookup", () => {
  // The advertisement is the same list before normalization, so a reader that
  // had to be told which moment it was looking at would be two readers.
  assert.deepEqual(
    advertisedActionFor({ advertises: [{ kind: ACTION_KIND.MESSAGE }] }, ACTION_KIND.MESSAGE),
    { kind: ACTION_KIND.MESSAGE },
  );
  assert.equal(advertisedActionFor({}, ACTION_KIND.MESSAGE), undefined);
});
