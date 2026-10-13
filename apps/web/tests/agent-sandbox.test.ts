import assert from "node:assert/strict";
import { Duration } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { test } from "vitest";
import { environment as codingEnvironment } from "../coder/sandbox";
import { environment as planningEnvironment } from "../eve/sandbox";
import { AGENT_ROLE } from "../server/hosted/agent-runtime/role";
import {
  renewsCredential,
  type SandboxRecord,
  stopsAtTurnEnd,
} from "../server/hosted/agent-runtime/sandbox";
import { CODER } from "../server/hosted/coder-host/bounds";
import { stampedEveEvent } from "./support/eve-events";

/**
 * Every role's sandbox lifecycle as its root's store hook reads it: the
 * coding agent's sandbox stopped at each turn's end and its credential
 * renewed as it ages, the planning sandbox never stopped by Luke so a call
 * never waits on a resume, and a worker never touching the sandbox it shares
 * with its parent. Both roots open from one image.
 */

const OPENED_AT = Date.UTC(2026, 9, 13, 9);
const OPENED: SandboxRecord = { openedAt: OPENED_AT };
const NEVER_OPENED: SandboxRecord = {};
const TURN = { turnId: "turn_0", sequence: 0 } as const;

const TURN_COMPLETED = stampedEveEvent({ type: "turn.completed", data: TURN }, OPENED_AT);

const TURN_ENDS: readonly MessageStreamEvent[] = [
  TURN_COMPLETED,
  stampedEveEvent({ type: "turn.cancelled", data: TURN }, OPENED_AT),
  stampedEveEvent(
    { type: "turn.failed", data: { ...TURN, code: "model_error", message: "upstream failed" } },
    OPENED_AT,
  ),
];

const STEP_STARTED = stampedEveEvent(
  { type: "step.started", data: { ...TURN, stepIndex: 1, modelId: "m" } },
  OPENED_AT,
);

const REFRESH_MS = Duration.toMillis(CODER.GITHUB_TOKEN_REFRESH);

const OTHER_ROLES = [
  AGENT_ROLE.PLANNER,
  AGENT_ROLE.PLANNER_WORKER,
  AGENT_ROLE.CODER_WORKER,
] as const;

test("a coding agent's sandbox is stopped at a turn's end however the turn ended, once a sandbox tool has opened it", () => {
  for (const end of TURN_ENDS) {
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, OPENED), true, end.type);
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, NEVER_OPENED), false, end.type);
  }
  assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, STEP_STARTED, OPENED), false);
});

test("a planning sandbox and a worker's shared one are never stopped at a turn's end, so a call never waits on a resume", () => {
  for (const role of OTHER_ROLES) {
    for (const end of TURN_ENDS) {
      assert.equal(stopsAtTurnEnd(role, end, OPENED), false, `${role} ${end.type}`);
    }
  }
});

test("a coding agent's credential is renewed at the first step past its age, counted from the open or the last renewal", () => {
  const aged = OPENED_AT + REFRESH_MS;
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, OPENED, aged - 1), false);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, OPENED, aged), true);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, TURN_COMPLETED, OPENED, aged), false);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, NEVER_OPENED, aged), false);
  const renewed: SandboxRecord = { ...OPENED, credentialAt: aged };
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, renewed, aged + 1), false);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, renewed, aged + REFRESH_MS), true);
});

test("no role but the coding agent renews a credential at its sandbox's firewall", () => {
  for (const role of OTHER_ROLES) {
    assert.equal(renewsCredential(role, STEP_STARTED, OPENED, OPENED_AT + REFRESH_MS), false, role);
  }
});

test("both roots open their sandboxes from the one image", () => {
  assert.equal(planningEnvironment, codingEnvironment);
});
