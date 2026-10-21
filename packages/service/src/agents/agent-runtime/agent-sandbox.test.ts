import assert from "node:assert/strict";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import { Duration } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { test } from "vitest";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { CODER } from "../coder-host/bounds.js";
import { AGENT_ROLE } from "./role.js";
import {
  lapsesCredential,
  parksForLongSleep,
  renewsCredential,
  type SandboxRecord,
  stopsAtTurnEnd,
  withdrawsCredential,
  withdrawsCredentialForSleep,
} from "./sandbox.js";

/**
 * The coding agent's sandbox lifecycle as its root's store hook reads it:
 * the sandbox stopped at each turn's end unless a developer's terminal holds
 * it, and its credential renewed as it ages, or, where it is a member's own
 * token, taken off as the sandbox stops and set again at the next turn.
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

test("a coding agent's sandbox is stopped at a turn's end however the turn ended, once a sandbox tool has opened it", () => {
  for (const end of TURN_ENDS) {
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, OPENED, false), true, end.type);
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, NEVER_OPENED, false), false, end.type);
  }
  assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, STEP_STARTED, OPENED, false), false);
});

test("a coding agent's sandbox a developer's terminal holds is left running at a turn's end", () => {
  for (const end of TURN_ENDS) {
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, OPENED, true), false, end.type);
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

test("a member's own token is withdrawn at a turn's end that stops the sandbox, kept for a terminal that holds it, and set again at the next turn's first step, never for its age", () => {
  const onToken: SandboxRecord = { ...OPENED, memberToken: true };
  for (const end of TURN_ENDS) {
    assert.equal(withdrawsCredential(AGENT_ROLE.CODER, end, onToken, false), true, end.type);
    assert.equal(withdrawsCredential(AGENT_ROLE.CODER, end, onToken, true), false, end.type);
    assert.equal(lapsesCredential(AGENT_ROLE.CODER, end, onToken), true, end.type);
    assert.equal(withdrawsCredential(AGENT_ROLE.CODER, end, OPENED, false), false, end.type);
    assert.equal(lapsesCredential(AGENT_ROLE.CODER, end, OPENED), false, end.type);
  }
  const aged = OPENED_AT + REFRESH_MS;
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, onToken, aged), false);
  const lapsed: SandboxRecord = { ...onToken, credentialLapsed: true };
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, lapsed, OPENED_AT), true);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, TURN_COMPLETED, lapsed, OPENED_AT), false);
});

test("a sandbox opened on a shallow checkout holds no credential: none is renewed, lapsed, or withdrawn until the first write deepens it, and its age counts from the deepen", () => {
  const shallow: SandboxRecord = { openedAt: OPENED_AT, openedShallow: true };
  const shallowOnToken: SandboxRecord = { ...shallow, memberToken: true, credentialLapsed: true };
  const aged = OPENED_AT + REFRESH_MS;
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, shallow, aged * 2), false);
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, shallowOnToken, aged), false);
  for (const end of TURN_ENDS) {
    assert.equal(lapsesCredential(AGENT_ROLE.CODER, end, shallowOnToken), false, end.type);
    assert.equal(
      withdrawsCredential(AGENT_ROLE.CODER, end, shallowOnToken, false),
      false,
      end.type,
    );
    // The sandbox itself is still stopped at the turn's end, shallow or not.
    assert.equal(stopsAtTurnEnd(AGENT_ROLE.CODER, end, shallow, false), true, end.type);
  }

  const deepenedAt = OPENED_AT + REFRESH_MS / 2;
  const deepened: SandboxRecord = { ...shallow, deepenedAt };
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, deepened, aged), false);
  assert.equal(
    renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, deepened, deepenedAt + REFRESH_MS),
    true,
  );
  const deepenedOnToken: SandboxRecord = { ...shallowOnToken, deepenedAt };
  assert.equal(renewsCredential(AGENT_ROLE.CODER, STEP_STARTED, deepenedOnToken, deepenedAt), true);
  for (const end of TURN_ENDS) {
    assert.equal(lapsesCredential(AGENT_ROLE.CODER, end, deepenedOnToken), true, end.type);
  }
});

const STOPS_AT_SECONDS = Duration.toSeconds(CODER.SLEEP_STOPS_AT);

/** A step's requested calls, each a tool by its name with its input. */
function stepCalling(...calls: readonly { toolName: string; input: object }[]): MessageStreamEvent {
  return stampedEveEvent(
    {
      type: "actions.requested",
      data: {
        ...TURN,
        stepIndex: 1,
        actions: calls.map((call, index) => ({
          kind: "tool-call" as const,
          callId: `call-${index}`,
          ...call,
        })),
      },
    },
    OPENED_AT,
  );
}

const pause = (seconds: number) => ({ toolName: AGENT_TOOL.SLEEP, input: { seconds } });

test("a coding agent's sandbox is stopped for a step whose one call is a pause of the bound or longer, once a sandbox tool has opened it", () => {
  assert.equal(
    parksForLongSleep(AGENT_ROLE.CODER, stepCalling(pause(STOPS_AT_SECONDS)), OPENED),
    true,
  );
  assert.equal(parksForLongSleep(AGENT_ROLE.CODER, stepCalling(pause(480)), OPENED), true);
  assert.equal(
    parksForLongSleep(AGENT_ROLE.CODER, stepCalling(pause(STOPS_AT_SECONDS - 1)), OPENED),
    false,
  );
  assert.equal(parksForLongSleep(AGENT_ROLE.CODER, stepCalling(pause(480)), NEVER_OPENED), false);
  for (const end of TURN_ENDS) {
    assert.equal(parksForLongSleep(AGENT_ROLE.CODER, end, OPENED), false, end.type);
  }
});

test("a long pause beside another call leaves the sandbox up, since that call may use it", () => {
  const command = {
    toolName: AGENT_TOOL.BASH,
    input: { command: "pnpm test", description: "Run the tests" },
  };
  assert.equal(
    parksForLongSleep(AGENT_ROLE.CODER, stepCalling(pause(480), command), OPENED),
    false,
  );
  assert.equal(parksForLongSleep(AGENT_ROLE.CODER, stepCalling(command), OPENED), false);
});

test("a worker's long pause stops nothing, since the sandbox it reads is its parent's", () => {
  assert.equal(parksForLongSleep(AGENT_ROLE.CODER_WORKER, stepCalling(pause(480)), OPENED), false);
});

test("a stop for a long pause takes a member's own token off, once it stands, and never an installation's", () => {
  assert.equal(
    withdrawsCredentialForSleep(AGENT_ROLE.CODER, { ...OPENED, memberToken: true }),
    true,
  );
  assert.equal(withdrawsCredentialForSleep(AGENT_ROLE.CODER, OPENED), false);
  const shallow: SandboxRecord = { ...OPENED, openedShallow: true, memberToken: true };
  assert.equal(withdrawsCredentialForSleep(AGENT_ROLE.CODER, shallow), false);
  assert.equal(
    withdrawsCredentialForSleep(AGENT_ROLE.CODER, { ...shallow, deepenedAt: OPENED_AT }),
    true,
  );
});
