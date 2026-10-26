import type {
  CodingAgentLatestTurn,
  CodingAgentLine,
} from "@luke/database/models/coding-agent-store";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CODING_AGENT_KIND,
  CODING_AGENT_MACHINE,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
} from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { Duration } from "effect";
import { expect, test } from "vitest";
import { BRAIN_REQUEST_FAILURE, TURN_STATUS } from "../../core.js";
import { CODER } from "./bounds.js";
import {
  codingAgentActivityAt,
  codingAgentFailureOf,
  codingAgentStatusOf,
  codingAgentSummary,
} from "./status.js";

/**
 * status.test.ts -- when a coding agent last did something settled: started,
 * handed a message, or its turn ended, and never a moment a turn streams;
 * how long a line of the developer's awaiting its turn reads it running; and
 * why a failed turn failed, a prompt past the model's window told apart;
 * and the Mac a local agent's summary names, and when it last beat.
 */

const LINE_GRACE_MS = Duration.toMillis(CODER.LINE_GRACE);

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

test("a line sent to an idle agent reads it running for the grace its turn opens in, and failed past it, unanswered", () => {
  const settled = turn({ queuedAt: 2_000, startedAt: 2_500, settledAt: 3_000 });
  const awaitingLineAt = new Date(10_000);
  const at = (now: number) =>
    codingAgentStatusOf(settled, { createdAt: STARTED, now, awaitingLineAt });
  expect(at(10_000 + LINE_GRACE_MS)).toBe(CODING_AGENT_STATUS.RUNNING);
  expect(at(10_001 + LINE_GRACE_MS)).toBe(CODING_AGENT_STATUS.FAILED);
});

test("a line sent before the first turn reads the agent failed past the grace rather than running", () => {
  const awaitingLineAt = new Date(2_000);
  const now = 2_001 + LINE_GRACE_MS;
  expect(codingAgentStatusOf(undefined, { createdAt: STARTED, now, awaitingLineAt })).toBe(
    CODING_AGENT_STATUS.FAILED,
  );
});

test("a line sent while a turn runs reads the agent running however long the turn's step runs", () => {
  const running = turn({ queuedAt: 2_000, startedAt: 2_500 });
  const awaitingLineAt = new Date(3_000);
  const now = 3_000 + 10 * LINE_GRACE_MS;
  expect(codingAgentStatusOf(running, { createdAt: STARTED, now, awaitingLineAt })).toBe(
    CODING_AGENT_STATUS.RUNNING,
  );
});

test("a line's grace counts from when the turn it was sent during ended, since nothing ran to take it only after", () => {
  const settled = turn({ queuedAt: 2_000, startedAt: 2_500, settledAt: 2_500 + LINE_GRACE_MS });
  const awaitingLineAt = new Date(3_000);
  const now = 3_000 + LINE_GRACE_MS;
  expect(codingAgentStatusOf(settled, { createdAt: STARTED, now, awaitingLineAt })).toBe(
    CODING_AGENT_STATUS.RUNNING,
  );
});

test("a line older than the newest turn's queueing that the turn never took reads the agent as that turn ended", () => {
  const settled = turn({ queuedAt: 4_000, startedAt: 4_500, settledAt: 9_000 });
  const awaitingLineAt = new Date(3_000);
  expect(codingAgentStatusOf(settled, { createdAt: STARTED, now: 9_001, awaitingLineAt })).toBe(
    CODING_AGENT_STATUS.COMPLETED,
  );
});

test("a line sent while the newest turn was queued, and never taken, reads the agent failed past the grace from that turn's end", () => {
  const settled = turn({ queuedAt: 4_000, startedAt: 6_000, settledAt: 9_000 });
  const awaitingLineAt = new Date(5_000);
  const at = (now: number) =>
    codingAgentStatusOf(settled, { createdAt: STARTED, now, awaitingLineAt });
  expect(at(9_000 + LINE_GRACE_MS)).toBe(CODING_AGENT_STATUS.RUNNING);
  expect(at(9_001 + LINE_GRACE_MS)).toBe(CODING_AGENT_STATUS.FAILED);
});

/** A turn the model call failed, eve's detail as given. */
const failedOnModel = (failureDetail: string) => ({
  status: TURN_STATUS.FAILED,
  failure: BRAIN_REQUEST_FAILURE.MODEL,
  failureDetail,
});

test("a prompt the provider refused as longer than the window reads as a context overflow, any other model failure as the model's", () => {
  // The words of the continue Anthropic refused in production, as eve keeps them.
  const refused = failedOnModel(
    "MODEL_CALL_FAILED [statusCode] prompt is too long: 1368155 tokens > 1000000 maximum",
  );
  const openAi = failedOnModel(
    "MODEL_CALL_FAILED [code] context_length_exceeded This model's maximum context length is 272000 tokens.",
  );
  const overloaded = failedOnModel("MODEL_CALL_FAILED [statusCode] Overloaded");

  expect(codingAgentFailureOf(refused)).toBe(CODING_AGENT_FAILURE.CONTEXT_OVERFLOW);
  expect(codingAgentFailureOf(openAi)).toBe(CODING_AGENT_FAILURE.CONTEXT_OVERFLOW);
  expect(codingAgentFailureOf(overloaded)).toBe(CODING_AGENT_FAILURE.MODEL);
});

test("a local agent's summary names its Mac and when it last beat; an agent in a sandbox names none", () => {
  const DEVICE = "device-1";
  const line: CodingAgentLine = {
    id: "agent-1",
    userId: "user-1",
    taskId: null,
    organizationId: "workspace-1",
    automationId: null,
    automationName: null,
    startedFrom: null,
    conversationId: "conversation-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    contextWindow: CONTEXT_WINDOW.LONG,
    brief: CODING_AGENT_BRIEF.BLANK,
    repository: null,
    branch: null,
    startBranch: null,
    title: null,
    archivedAt: null,
    archivedBy: null,
    disabledServers: [],
    author: null,
    githubAccess: GITHUB_ACCESS.APP,
    kind: CODING_AGENT_KIND.CODER,
    createdAt: STARTED,
    machine: CODING_AGENT_MACHINE.MAC,
    deviceId: DEVICE,
  };
  const now = 100_000;
  const seen = (lastSeenAt: number) =>
    codingAgentSummary(
      line,
      { turn: undefined, awaitingLineAt: undefined },
      now,
      new Map(),
      [],
      new Map([
        [DEVICE, { id: DEVICE, name: "Charles's MacBook Pro", lastSeenAt: new Date(lastSeenAt) }],
      ]),
    ).mac;

  expect(seen(now - 44_000)).toEqual({ name: "Charles's MacBook Pro", seenAt: now - 44_000 });
});
