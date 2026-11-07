import assert from "node:assert/strict";
import { TURN_STATUS } from "@repo/wire";
import { test } from "vitest";
import { AGENT_STATUS } from "./agent-wire.js";
import { automationWorkspaceRunsOfLiveRows } from "./automation-live.js";
import { AUTOMATION_FIRING, AUTOMATION_RUN_STATUS } from "./automation-wire.js";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

/** A scheduled run fired `hoursAgo` that went to `agentId`, whose newest turn is still running. */
function runTo(id: string, agentId: string, hoursAgo: number) {
  const firedAt = NOW - hoursAgo * HOUR;
  return {
    id,
    firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: firedAt },
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    firedAt,
    settledAt: firedAt,
    automationId: `automation-of-${agentId}`,
    automationName: `Automation of ${agentId}`,
    agentId,
    agentTitle: null,
    agentCreatedAt: NOW - 24 * HOUR,
    ownKey: true,
    turnId: `turn-of-${agentId}`,
    turnStatus: TURN_STATUS.RUNNING,
    cancelRequested: false,
    turnQueuedAt: NOW - 1_000,
    turnSettledAt: null,
    turnSessionEnded: false,
    awaitingLineAt: null,
    failureWord: null,
  };
}

test("an agent every run of a same-agent automation went to is at work on its latest run alone", () => {
  const runs = automationWorkspaceRunsOfLiveRows(
    {
      runs: [
        runTo("earliest", "shared-agent", 2),
        runTo("other", "own-agent", 1),
        runTo("latest", "shared-agent", 0),
        runTo("middle", "shared-agent", 1),
      ],
    },
    NOW,
  );
  assert.deepEqual(
    runs.map((run) => [run.id, run.agent?.status]),
    [
      ["latest", AGENT_STATUS.RUNNING],
      ["other", AGENT_STATUS.RUNNING],
      ["middle", AGENT_STATUS.COMPLETED],
      ["earliest", AGENT_STATUS.COMPLETED],
    ],
  );
});
