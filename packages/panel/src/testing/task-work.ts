/**
 * task-work.ts -- a brain turn's work as the service sends it, built for a test: its journal's parts as the AI SDK stores them, and the workers it started.
 *
 * Each part is the shape the relay journals and the wire carries as it is
 * (`taskWorkTurnSchema`), so a test reads the Call tab the way a turn told
 * by the service reaches it.
 */

import { EVE_TOOL } from "@luke/features/agent-tools";
import {
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentMessagesAnswer,
  type CodingAgentStatus,
  TURN_ENDING,
} from "@luke/features/coding-agent-wire";
import {
  TASK_WORK_STATE,
  type TaskWorkState,
  type TaskWorkTurn,
  type TaskWorkWorker,
} from "@luke/features/tasks-view";
import { MESSAGE_ROLE, type TurnOrigin, type WireRecord, type WireValue } from "@luke/wire";
import { TOOL_STATE, type ToolState } from "../ai-elements/tool.js";

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
  rest: Partial<Omit<TaskWorkWorker, "callId" | "task">> = {},
): TaskWorkWorker {
  return {
    callId,
    task,
    state: TASK_WORK_STATE.DONE,
    earlierOmitted: false,
    journal: [],
    ...rest,
  };
}

/** The call that started a worker, as the turn's journal stores it: eve's `worker` call, answered with the receipt naming its task where it has one. */
export function workerCall(started: TaskWorkWorker): WireRecord {
  return toolCall(
    EVE_TOOL.WORKER,
    started.callId,
    { message: started.task },
    { output: started.taskId === undefined ? "" : receipt(started.taskId) },
  );
}

/** A brain turn as a test builds it: the frame's shape, and what opened the turn where the test says, which the brain's page carries and the frame does not. */
export interface TestTaskWorkTurn extends TaskWorkTurn {
  readonly origin?: TurnOrigin;
}

/** A turn of `state` whose journal holds `journal`, with the workers and anything else `rest` gives it. */
export function workTurn(
  state: TaskWorkState,
  journal: readonly WireValue[],
  rest: Partial<Omit<TestTaskWorkTurn, "state" | "journal">> = {},
): TestTaskWorkTurn {
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

/** Where a worker's own session stands, as a brain's page says it, by where the test's worker stands. */
const STATUS_OF_STATE = {
  [TASK_WORK_STATE.RUNNING]: CODING_AGENT_STATUS.RUNNING,
  [TASK_WORK_STATE.DONE]: CODING_AGENT_STATUS.COMPLETED,
  [TASK_WORK_STATE.FAILED]: CODING_AGENT_STATUS.FAILED,
} as const satisfies Record<TaskWorkState, CodingAgentStatus>;

/** A turn's journal as a brain's page carries it: its parts, its turn, what opened it and the lines that asked for it, and its span and record; a turn that ended without answering says it stopped where it says nothing else. */
function messageOfTurn(turn: TestTaskWorkTurn): CodingAgentMessage {
  const { model, effort, tokens } = turn;
  const ending =
    turn.state === TASK_WORK_STATE.FAILED ? (turn.ending ?? TURN_ENDING.STOPPED) : turn.ending;
  return {
    id: turn.turnId,
    role: MESSAGE_ROLE.ASSISTANT,
    // SAFETY: a test's journal holds the stored parts the builders above make, JSON objects each.
    parts: turn.journal as CodingAgentMessage["parts"],
    turnId: turn.turnId,
    ...(turn.origin === undefined ? undefined : { origin: turn.origin }),
    ...(turn.earlierOmitted ? { earlierOmitted: true } : undefined),
    ...(turn.asked === undefined ? undefined : { asked: turn.asked }),
    ...(turn.askedAt === undefined ? undefined : { askedAt: turn.askedAt }),
    startedAt: turn.startedAt,
    ...(turn.state === TASK_WORK_STATE.RUNNING
      ? undefined
      : { finishedAt: turn.endedAt ?? turn.startedAt }),
    ...(model === undefined ? undefined : { model }),
    ...(effort === undefined ? undefined : { effort }),
    ...(tokens === undefined ? undefined : { tokens }),
    ...(ending === undefined ? undefined : { ending }),
  };
}

/**
 * The turns as the task's conversation with the brain reads them, as the window
 * holds it (`planning.conversation`): each turn's journal one message, and
 * where each worker stands and its title beside them, as the brain's pages
 * say them; with the turn the page before is read before, where one is.
 */
export function conversationOf(
  turns: readonly TestTaskWorkTurn[],
  earlier?: string,
): CodingAgentMessagesAnswer {
  const workers = turns.flatMap((turn) => turn.workers.map((worker) => ({ turn, worker })));
  const titles = workers.flatMap(({ worker }) =>
    worker.title === undefined ? [] : [{ callId: worker.callId, title: worker.title }],
  );
  return {
    messages: turns.map(messageOfTurn),
    cursor: CODING_AGENT_CURSOR_START,
    ...(earlier === undefined ? undefined : { earlier }),
    status: turns.some((turn) => turn.state === TASK_WORK_STATE.RUNNING)
      ? CODING_AGENT_STATUS.RUNNING
      : CODING_AGENT_STATUS.COMPLETED,
    subagents: workers.map(({ turn, worker }) => ({
      callId: worker.callId,
      status: STATUS_OF_STATE[worker.state],
      model: worker.model ?? "",
      effort: worker.effort ?? "",
      startedAt: worker.startedAt ?? turn.startedAt,
    })),
    ...(titles.length === 0 ? undefined : { subagentTitles: titles }),
    title: null,
  };
}
