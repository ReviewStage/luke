import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND as ADVERTISED_ACTION_KIND,
  normalizeSession,
  SESSION_APPLICATION_ID,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type Session,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS, type WireRecord } from "@sidecar/wire";
import { ACTION_KIND, type CarriedAction, type SessionActionKind } from "./action-kinds.js";
import {
  ACTION_OUTPUT,
  ACTION_OUTPUT_STATUS,
  acceptedActionOutput,
  actionOutputFromResult,
  actionTargetSnapshot,
  maximumActionOutputSentenceLength,
  refusedActionOutput,
  unknownActionOutput,
} from "./action-output.js";

const NOW = 1_800_000_000_000;
const IDENTITY = { providerId: "conductor", providerSessionId: "chat-1" } as const;
const STOP = {
  kind: ADVERTISED_ACTION_KIND.CONTROL,
  id: "stop",
  label: "Stop",
  controlKind: SESSION_CONTROL_KIND.STOP,
} as const;
const PLAIN = { kind: ADVERTISED_ACTION_KIND.CONTROL, id: "retry", label: "Retry" } as const;
const STOP_ACTION: CarriedAction<typeof ACTION_KIND.CONTROL> = {
  kind: ACTION_KIND.CONTROL,
  identity: IDENTITY,
  control: STOP,
};

const observed: Session = normalizeSession(
  { id: IDENTITY.providerId, displayName: "Conductor" },
  {
    providerSessionId: IDENTITY.providerSessionId,
    title: "Fix the flaky test",
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW,
    agent: { id: "cursor", displayName: "Cursor" },
    advertises: [{ kind: ADVERTISED_ACTION_KIND.MESSAGE }, STOP, PLAIN],
  },
);

/** One admitted action of every session kind, aimed at the observed session or its provider. */
const SESSION_ACTIONS: readonly CarriedAction<SessionActionKind>[] = [
  { kind: ACTION_KIND.MESSAGE, identity: IDENTITY, text: "go ahead" },
  STOP_ACTION,
  { kind: ACTION_KIND.OPEN, identity: IDENTITY, applicationId: SESSION_APPLICATION_ID.CONDUCTOR },
  { kind: ACTION_KIND.ADD_AGENT, identity: IDENTITY, agent: "claude" },
  { kind: ACTION_KIND.RENAME_WORKSPACE, identity: IDENTITY, name: "Flaky test" },
  { kind: ACTION_KIND.RENAME_SESSION, identity: IDENTITY, name: "Flaky test chat" },
  { kind: ACTION_KIND.CREATE_WORKSPACE, providerId: "conductor", providerProjectId: "luke" },
];

test("the target snapshot is the roster's picture at execution: identity, title, and agent for a session action, the provider alone for a creation", () => {
  const session = {
    providerId: "conductor",
    providerSessionId: "chat-1",
    title: "Fix the flaky test",
    agentId: "cursor",
  };
  const snapshots = SESSION_ACTIONS.map((action) => actionTargetSnapshot(action, [observed]));
  assert.deepEqual(snapshots, [
    session,
    { ...session, controlKind: SESSION_CONTROL_KIND.STOP, controlLabel: "Stop" },
    { ...session, applicationId: SESSION_APPLICATION_ID.CONDUCTOR },
    session,
    session,
    session,
    { providerId: "conductor" },
  ]);
});

test("a control with no declared kind names its label alone, and a session the roster let go keeps its identity with no title", () => {
  const plain = actionTargetSnapshot(
    { kind: ACTION_KIND.CONTROL, identity: IDENTITY, control: PLAIN },
    [observed],
  );
  assert.deepEqual(plain, {
    providerId: "conductor",
    providerSessionId: "chat-1",
    title: "Fix the flaky test",
    agentId: "cursor",
    controlLabel: "Retry",
  });
  const departed = actionTargetSnapshot(
    { kind: ACTION_KIND.MESSAGE, identity: IDENTITY, text: "still there?" },
    [],
  );
  assert.deepEqual(departed, { providerId: "conductor", providerSessionId: "chat-1" });
});

test("every envelope the builders make validates, and validation reads it back unchanged", () => {
  const target = actionTargetSnapshot(STOP_ACTION, [observed]);
  const envelopes = [
    acceptedActionOutput(),
    acceptedActionOutput({ target }),
    acceptedActionOutput({
      target: { providerId: "conductor" },
      createdSession: { providerId: "conductor", providerSessionId: "chat-9" },
      warning: "the opening task was not delivered",
    }),
    refusedActionOutput("No observed session matches that identity."),
    refusedActionOutput("That session advertises no such control.", target),
    unknownActionOutput("the node went away", target),
  ];
  for (const envelope of envelopes) {
    assert.deepEqual(ACTION_OUTPUT.read(envelope), { ok: true, value: envelope });
  }
});

test("a refusal or an unknown without a reason, a status outside the set, and a target without a provider are not envelopes, while a key a later build added is", () => {
  const malformed: readonly WireRecord[] = [
    { status: ACTION_OUTPUT_STATUS.REFUSED },
    { status: ACTION_OUTPUT_STATUS.REFUSED, reason: "   " },
    { status: ACTION_OUTPUT_STATUS.UNKNOWN },
    { status: ACTION_RESULT_STATUS.REJECTED, reason: "an adapter's word, not the envelope's" },
    { status: ACTION_OUTPUT_STATUS.ACCEPTED, target: { providerSessionId: "chat-1" } },
    { status: ACTION_OUTPUT_STATUS.ACCEPTED, createdSession: { providerId: "conductor" } },
  ];
  for (const record of malformed) {
    assert.equal(ACTION_OUTPUT.read(record).ok, false);
  }
  assert.deepEqual(ACTION_OUTPUT.parse({ status: ACTION_OUTPUT_STATUS.ACCEPTED, later: true }), {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
  });
});

test("a row's fields are dropped when malformed rather than refusing the envelope, and a sentence past its bound is cut", () => {
  const read = ACTION_OUTPUT.parse({
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
    target: {
      providerId: "conductor",
      providerSessionId: "chat-1",
      title: "",
      agentId: 7,
      controlKind: "detonate",
      applicationId: "notepad",
    },
  });
  assert.deepEqual(read, {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
    target: { providerId: "conductor", providerSessionId: "chat-1" },
  });
  const long = ACTION_OUTPUT.parse(
    refusedActionOutput("x".repeat(maximumActionOutputSentenceLength + 10)),
  );
  assert.equal(long?.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.equal(long?.reason.length, maximumActionOutputSentenceLength);
});

test("a carried result folds into the envelope: accepted keeps the target and the created session, rejected and unsupported are both refused, unknown stays unknown", () => {
  const target = { providerId: "conductor" };
  const createdSession = { providerId: "conductor", providerSessionId: "chat-9" };
  assert.deepEqual(
    actionOutputFromResult(
      { status: ACTION_RESULT_STATUS.ACCEPTED, createdSession, warning: "late" },
      target,
    ),
    { status: ACTION_OUTPUT_STATUS.ACCEPTED, target, createdSession, warning: "late" },
  );
  assert.deepEqual(actionOutputFromResult({ status: ACTION_RESULT_STATUS.ACCEPTED }), {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
  });
  assert.deepEqual(
    actionOutputFromResult({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }, target),
    { status: ACTION_OUTPUT_STATUS.REFUSED, reason: "no", target },
  );
  assert.deepEqual(
    actionOutputFromResult({ status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: "no" }),
    {
      status: ACTION_OUTPUT_STATUS.REFUSED,
      reason: "no",
    },
  );
  assert.deepEqual(
    actionOutputFromResult({ status: UNKNOWN_ACTION_STATUS, reason: "lost" }, target),
    {
      status: ACTION_OUTPUT_STATUS.UNKNOWN,
      reason: "lost",
      target,
    },
  );
});
