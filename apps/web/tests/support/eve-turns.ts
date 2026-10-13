import type { MessageStreamEvent } from "eve/client";
import {
  EVE_DELEGATION_TOOL,
  PLANNER_DELEGATE_TOOL,
} from "../../server/hosted/brain-host/planning";
import { END_CALL_TOOL } from "../../server/hosted/end-call";
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

/** A goodbye's turn: the planning model ends the call first, then returns a line Luke is not to say over the goodbye. */
export function goodbyeTurn(turnId: string, now: number): readonly MessageStreamEvent[] {
  const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, now);
  const sequence = 0;
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: "bye!" } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          { kind: "tool-call", callId: "call-end", toolName: END_CALL_TOOL.name, input: {} },
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
          callId: "call-end",
          toolName: END_CALL_TOOL.name,
          output: { status: "accepted" },
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
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop", message: "Call ended." },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

/** The task the parked turn's worker call starts, which the steered turn sends more work to by its id. */
const WORKER_TASK = "worker-ha1bbn";

/** One call to the worker as a turn makes it: its id, what it carries, and eve's receipt for it. */
interface WorkerCall {
  readonly callId: string;
  readonly input: { readonly message: string; readonly taskId?: string };
  readonly receipt: string;
}

/** The id of the parked turn's call, whose child conversation records the worker's session. */
export const STARTING_WORKER_CALL = "call-delegate";

/** The parked turn's call, which starts the worker's task. */
const STARTING_CALL: WorkerCall = {
  callId: STARTING_WORKER_CALL,
  input: { message: "Compare the two queue libraries." },
  receipt: `Started task ${WORKER_TASK}. Its result will arrive in a <task_result> message.`,
};

/** The steered turn's call, which sends more work to the task the parked turn started. */
const STEERING_CALL: WorkerCall = {
  callId: "call-steer",
  input: { message: "Also check whether either library batches.", taskId: WORKER_TASK },
  receipt: `Sent to task ${WORKER_TASK}. Its reply will arrive in a <task_result> message.`,
};

/**
 * A turn in which the planning model calls the worker, as eve streams it up
 * to the park: the call eve announces as its own kind of action, the receipt
 * as the call's result, the words before the wait, and the park on the task.
 * Every event is stamped with the deliveries the turn's start named.
 */
function delegatingTurn(
  call: WorkerCall,
  turnId: string,
  sequence: number,
  now: number,
  deliveryIds: readonly string[] | undefined,
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
            callId: call.callId,
            name: EVE_DELEGATION_TOOL.WORKER,
            subagentName: EVE_DELEGATION_TOOL.WORKER,
            description: "Do one job in the background.",
            nodeId: "subagents/worker",
            input: call.input,
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
        callId: call.callId,
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
          callId: call.callId,
          toolName: EVE_DELEGATION_TOOL.WORKER,
          output: call.receipt,
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
        callId: call.callId,
        taskId: WORKER_TASK,
        name: EVE_DELEGATION_TOOL.WORKER,
        sessionId: "wrun_child",
        streamPath: "/eve/v1/session/wrun_child/stream",
      },
    }),
  ];
}

/** A turn that hands work to the worker, starting its task, up to the park. */
export function parkedTurn(
  turnId: string,
  sequence: number,
  now: number,
  deliveryIds?: readonly string[],
): readonly MessageStreamEvent[] {
  return delegatingTurn(STARTING_CALL, turnId, sequence, now, deliveryIds);
}

/** A later turn that sends more work to the task the parked turn started, up to the park. */
export function steeredTurn(
  turnId: string,
  sequence: number,
  now: number,
  deliveryIds?: readonly string[],
): readonly MessageStreamEvent[] {
  return delegatingTurn(STEERING_CALL, turnId, sequence, now, deliveryIds);
}

/** The task the planning model's own \`delegate\` starts, by eve's id for it. */
const DELEGATE_TASK = "delegate-7k2m9q";

/**
 * A turn that hands work to the worker through the planning model's own
 * \`delegate\`, a resumable task, up to the park: the call eve announces as a
 * tool call, the receipt as its result, the words before the wait, and the
 * park on the task.
 */
export function parkedDelegateTurn(
  turnId: string,
  sequence: number,
  now: number,
): readonly MessageStreamEvent[] {
  const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, now);
  const callId = STARTING_WORKER_CALL;
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({
      type: "message.received",
      data: { turnId, sequence, message: "compare the two queue libraries" },
    }),
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
            callId,
            toolName: PLANNER_DELEGATE_TOOL.name,
            input: { task: "Compare the two queue libraries." },
          },
        ],
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "tool-calls" },
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
          callId,
          toolName: PLANNER_DELEGATE_TOOL.name,
          output: `Started task ${DELEGATE_TASK}. Its result will arrive in a <task_result> message.`,
        },
      },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        message: "The worker is on it.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stamped({ type: "turn.waiting", data: { turnId, sequence, on: "tasks" } }),
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
        callId: STARTING_CALL.callId,
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
