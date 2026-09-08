import assert from "node:assert/strict";
import test from "node:test";
import {
  ACT_KIND,
  type ActKind,
  type AdvertisedAct,
  type AdvertisedActKind,
  advertisedActFor,
  advertisedControl,
  advertisedControls,
  normalizeSession,
  observedActFor,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type Session,
} from "@sidecar/session";

const TEST_NOW = Date.parse("2026-08-16T12:00:00.000Z");

function advertising(advertises: readonly AdvertisedAct[]): Session {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "Advertised acts",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_NOW,
      advertises,
    },
  );
}

test("the act vocabulary is the advertisable kinds and the two nothing advertises", () => {
  // An open follows an address the observation already reported and a creation
  // is held to a provider's projects, so neither is a session's to advertise —
  // but both are acts, and the vocabulary is one.
  const unadvertisable: readonly ActKind[] = [ACT_KIND.OPEN, ACT_KIND.CREATE_WORKSPACE];
  const advertisable: readonly AdvertisedActKind[] = [
    ACT_KIND.MESSAGE,
    ACT_KIND.CONTROL,
    ACT_KIND.ADD_AGENT,
    ACT_KIND.RENAME_SESSION,
    ACT_KIND.RENAME_WORKSPACE,
  ];
  assert.deepEqual([...advertisable, ...unadvertisable].sort(), Object.values(ACT_KIND).sort());
});

test("each reader answers for the kind it names and nothing else", () => {
  const session = advertising([
    { kind: ACT_KIND.MESSAGE },
    { kind: ACT_KIND.ADD_AGENT, agents: ["claude", "codex"], target: "ws-1" },
    { kind: ACT_KIND.RENAME_WORKSPACE, target: "ws-1" },
  ]);

  assert.deepEqual(advertisedActFor(session, ACT_KIND.MESSAGE), { kind: ACT_KIND.MESSAGE });
  assert.deepEqual(advertisedActFor(session, ACT_KIND.ADD_AGENT)?.agents, ["claude", "codex"]);
  assert.equal(advertisedActFor(session, ACT_KIND.ADD_AGENT)?.target, "ws-1");
  assert.equal(advertisedActFor(session, ACT_KIND.RENAME_WORKSPACE)?.target, "ws-1");
  assert.equal(advertisedActFor(session, ACT_KIND.RENAME_SESSION), undefined);
  assert.deepEqual(advertisedControls(session), []);
});

test("controls keep the order their adapter listed them in", () => {
  const session = advertising([
    { kind: ACT_KIND.CONTROL, id: "approve", label: "Approve the plan" },
    { kind: ACT_KIND.CONTROL, id: "stop", label: "Stop", controlKind: SESSION_CONTROL_KIND.STOP },
    { kind: ACT_KIND.MESSAGE },
    {
      kind: ACT_KIND.CONTROL,
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

test("an observation is read through the same lookup, advertisement or none", () => {
  assert.deepEqual(observedActFor({ advertises: [{ kind: ACT_KIND.MESSAGE }] }, ACT_KIND.MESSAGE), {
    kind: ACT_KIND.MESSAGE,
  });
  assert.equal(observedActFor({}, ACT_KIND.MESSAGE), undefined);
});
