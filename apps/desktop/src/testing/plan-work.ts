/**
 * plan-work.ts -- a planning turn's work as the service sends it, built for a test: its journal's parts as the AI SDK stores them, and the workers it started.
 *
 * Each part is the shape the relay journals and the wire carries as it is
 * (`planWorkTurnSchema`), so a test reads the Call tab the way a turn told
 * by the service reaches it.
 */

import { EVE_TOOL } from "@sidecar/hosted/agent-tools";
import {
  PLAN_WORK_STATE,
  type PlanWorkState,
  type PlanWorkTurn,
  type PlanWorkWorker,
} from "@sidecar/hosted/planning-view";
import type { WireRecord, WireValue } from "@sidecar/wire";
import { TOOL_STATE, type ToolState } from "../renderer/ai-elements/tool";

/** The model's words, as a journal stores them. */
export function words(text: string): WireRecord {
  return { type: "text", text };
}

/** The model's reasoning, as a journal stores it. */
export function thought(text: string): WireRecord {
  return { type: "reasoning", text };
}

/**
 * A call of `tool`, as a journal stores it: answered with `output` where one
 * is given, failed with `errorText` where that is, and running otherwise,
 * unless `state` says where it stands.
 */
export function toolCall(
  tool: string,
  id: string,
  input: WireValue,
  answer: { output?: WireValue; errorText?: string; state?: ToolState } = {},
): WireRecord {
  const { output, errorText } = answer;
  const state =
    answer.state ??
    (errorText !== undefined
      ? TOOL_STATE.OUTPUT_ERROR
      : output !== undefined
        ? TOOL_STATE.OUTPUT_AVAILABLE
        : TOOL_STATE.INPUT_AVAILABLE);
  return {
    type: `tool-${tool}`,
    toolCallId: id,
    state,
    input,
    ...(output === undefined ? undefined : { output }),
    ...(errorText === undefined ? undefined : { errorText }),
  };
}

/** eve's receipt on a worker call that started task `taskId`, which the call answers the moment the worker is under way. */
function receipt(taskId: string): string {
  return `Started task ${taskId}. Its result will arrive in a <task_result> message.`;
}

/** A worker the turn started by call `callId`, handed `task`, its session holding `journal`, where it stands as `state` says. */
export function worker(
  callId: string,
  task: string,
  rest: Partial<Omit<PlanWorkWorker, "callId" | "task">> = {},
): PlanWorkWorker {
  return {
    callId,
    task,
    state: PLAN_WORK_STATE.DONE,
    earlierOmitted: false,
    journal: [],
    ...rest,
  };
}

/** The call that started a worker, as the turn's journal stores it: eve's `worker` call, answered with the receipt naming its task where it has one. */
export function workerCall(started: PlanWorkWorker): WireRecord {
  return toolCall(
    EVE_TOOL.WORKER,
    started.callId,
    { message: started.task },
    { output: started.taskId === undefined ? "" : receipt(started.taskId) },
  );
}

/** A turn of `state` whose journal holds `journal`, with the workers and anything else `rest` gives it. */
export function workTurn(
  state: PlanWorkState,
  journal: readonly WireValue[],
  rest: Partial<Omit<PlanWorkTurn, "state" | "journal">> = {},
): PlanWorkTurn {
  return {
    turnId: "turn-1",
    startedAt: 0,
    state,
    earlierOmitted: false,
    journal,
    workers: [],
    ...rest,
  };
}
