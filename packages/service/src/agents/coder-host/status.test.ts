import type { CodingAgentLatestTurn } from "@luke/database/models/coding-agent-store";
import { expect, test } from "vitest";
import { codingAgentActivityAt } from "./status.js";

/**
 * status.test.ts -- when a coding agent last did something settled: started,
 * handed a message, or its turn ended, and never a moment a turn streams.
 */

const STARTED = new Date(1_000);

/** A turn of the agent's, queued at `queuedAt`, begun at `startedAt`, and settled at `settledAt` where it has. */
function turn(times: {
  queuedAt: number;
  startedAt?: number;
  settledAt?: number;
}): CodingAgentLatestTurn {
  return {
    conversationId: "conversation-1",
    id: "turn-1",
    status: times.settledAt === undefined ? "running" : "settled",
    eveTurnId: null,
    failure: null,
    failureDetail: null,
    cancelRequestedAt: null,
    queuedAt: new Date(times.queuedAt),
    startedAt: times.startedAt === undefined ? null : new Date(times.startedAt),
    settledAt: times.settledAt === undefined ? null : new Date(times.settledAt),
    model: null,
    usage: null,
    fastRefused: false,
  };
}

test("an agent with no turn yet last did something when it was started", () => {
  expect(codingAgentActivityAt(undefined, { createdAt: STARTED })).toBe(1_000);
});

test("an agent at work last did something when its turn was handed the message, however long it streams", () => {
  const running = turn({ queuedAt: 4_000, startedAt: 4_500 });
  expect(codingAgentActivityAt(running, { createdAt: STARTED })).toBe(4_500);
});

test("an agent whose turn ended last did something when it ended", () => {
  const settled = turn({ queuedAt: 4_000, startedAt: 4_500, settledAt: 9_000 });
  expect(codingAgentActivityAt(settled, { createdAt: STARTED })).toBe(9_000);
});
