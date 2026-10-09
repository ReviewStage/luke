import type { MessageStreamEvent } from "eve/client";
import { EVE_DELEGATION_TOOL } from "../../server/hosted/brain-host/planning";
import {
  REPOSITORY_SHELL_STATUS,
  RUN_IN_REPOSITORY_TOOL,
} from "../../server/hosted/repository-shell";
import { stampedEveEvent } from "./eve-events";

/**
 * Whole turns as eve emits them, for the tests that drive one through the
 * relay into the store: a spoken ask's turn that reads the repository and
 * answers in two sentences, and a turn that hands work to the worker and
 * parks on the task until its findings come back. Synthetic throughout; one
 * spelling shared by every suite that plays a turn rather than a copy per
 * file.
 */

/** eve's id for a session's first turn. */
export const FIRST_EVE_TURN = "turn_0";

/** The command the turn runs in the repository. */
const REPOSITORY_COMMAND = "git log --oneline -5";

/** One spoken ask's turn: a repository read, which is a slow step, then a two-sentence answer. */
export function spokenTurn(
  turnId: string,
  now: number,
  deliveryIds?: readonly string[],
): readonly MessageStreamEvent[] {
  const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, now);
  const sequence = 0;
  return [
    stampedEveEvent({ type: "turn.started", data: { turnId, sequence } }, now, deliveryIds),
    stamped({ type: "message.received", data: { turnId, sequence, message: "what changed?" } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          {
            kind: "tool-call",
            callId: "call-1",
            toolName: RUN_IN_REPOSITORY_TOOL.name,
            input: { command: REPOSITORY_COMMAND },
          },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-1",
          toolName: RUN_IN_REPOSITORY_TOOL.name,
          output: { status: REPOSITORY_SHELL_STATUS.NOT_RUN, reason: "No sandbox." },
        },
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "tool-calls" },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        message: "One agent finished. Another is waiting on you.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

/** The worker's receipt, as eve answers a subagent call the moment its task starts. */
const WORKER_RECEIPT =
  "Started task worker-ha1bbn. Its result will arrive in a <task_result> message.";

const DELEGATION_CALL = "call-delegate";
const WORKER_TASK = "worker-ha1bbn";

/**
 * A turn in which the planning model hands work to the worker, as eve streams
 * it up to the park: the call eve announces as its own kind of action, the
 * receipt as the call's result, the words before the wait, and the park on
 * the task. Every event is stamped with the deliveries the turn's start named.
 */
export function parkedTurn(
  turnId: string,
  sequence: number,
  now: number,
  deliveryIds?: readonly string[],
): readonly MessageStreamEvent[] {
  const stampedWith = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, now, deliveryIds);
  return [
    stampedWith({ type: "turn.started", data: { turnId, sequence } }),
    stampedWith({
      type: "message.received",
      data: { turnId, sequence, message: "compare the two queue libraries" },
    }),
    stampedWith({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stampedWith({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          {
            kind: "subagent-call",
            callId: DELEGATION_CALL,
            name: EVE_DELEGATION_TOOL.WORKER,
            subagentName: EVE_DELEGATION_TOOL.WORKER,
            description: "Do one job in the background.",
            nodeId: "subagents/worker",
            input: { message: "Compare the two queue libraries." },
          },
        ],
      },
    }),
    stampedWith({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "tool-calls" },
    }),
    stampedWith({
      type: "task.started",
      data: {
        turnId,
        callId: DELEGATION_CALL,
        kind: "agent",
        name: EVE_DELEGATION_TOOL.WORKER,
        taskId: WORKER_TASK,
      },
    }),
    stampedWith({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: DELEGATION_CALL,
          toolName: EVE_DELEGATION_TOOL.WORKER,
          output: WORKER_RECEIPT,
        },
      },
    }),
    stampedWith({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stampedWith({
      type: "message.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        message: "The worker is on it.",
      },
    }),
    stampedWith({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stampedWith({ type: "turn.waiting", data: { turnId, sequence, on: "tasks" } }),
    stampedWith({
      type: "agent.started",
      data: {
        turnId,
        callId: DELEGATION_CALL,
        taskId: WORKER_TASK,
        name: EVE_DELEGATION_TOOL.WORKER,
        sessionId: "wrun_child",
        streamPath: "/eve/v1/session/wrun_child/stream",
      },
    }),
  ];
}

/** The rest of a parked turn: the task's result, the words after it, and the end, stamped with the turn's deliveries. */
export function resumedTurn(
  turnId: string,
  sequence: number,
  stepIndex: number,
  now: number,
  deliveryIds?: readonly string[],
): readonly MessageStreamEvent[] {
  const stampedWith = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, now, deliveryIds);
  return [
    stampedWith({
      type: "task.settled",
      data: {
        turnId,
        callId: DELEGATION_CALL,
        kind: "agent",
        name: EVE_DELEGATION_TOOL.WORKER,
        taskId: WORKER_TASK,
        status: "completed",
        output: "Three sources agree.",
      },
    }),
    stampedWith({ type: "step.started", data: { turnId, sequence, stepIndex, modelId: "m" } }),
    stampedWith({
      type: "message.completed",
      data: { turnId, sequence, stepIndex, finishReason: "stop", message: "Found it." },
    }),
    stampedWith({
      type: "step.completed",
      data: { turnId, sequence, stepIndex, finishReason: "stop" },
    }),
    stampedWith({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}
