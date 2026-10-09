import { DRAW_ON_BOARD_TOOL_NAME, LOOK_AT_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import { planCommandResultSchema } from "@sidecar/hosted/plan-wire";
import {
  PLAN_WORK_BOUNDS,
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkPart,
  type PlanWorkState,
  type PlanWorkTool,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { Schema } from "effect";
import {
  isStoredToolPart,
  type StoredToolPart,
  type StoredUIMessage,
  storedToolName,
  TOOL_PART_STATE,
  TURN_STATUS,
  UI_PART_TYPE,
} from "../core.js";
import { EVE_DELEGATION_INPUT, EVE_DELEGATION_TOOL } from "../hosted/brain-host/planning.js";
import { READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL } from "../hosted/public-research.js";
import { QUEUE_QUESTION_TOOL } from "../hosted/queue-question.js";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../hosted/repository-shell.js";
import { SHOW_CODE_TOOL } from "../hosted/show-code.js";
import type { StoredTurnRecord } from "../hosted/store/message-reads.js";

/**
 * plan-work.ts -- one planning turn as the Work tab draws it, projected from the turn's row and its journal.
 *
 * The journal is the AI SDK message the relay writes as eve runs the turn:
 * a step marker per model step, the model's words, its reasoning, and each
 * tool call with its input and, once it answered, its output. The projection
 * keeps the words, the reasoning that has any, and every call, each named by
 * kind with the one input a reader looks for first, and cuts every text to
 * the wire's bound so a turn that read a large file still travels small.
 *
 * Note that the output does travel. A repository command's output is text
 * the developer's own Mac read for the service a moment before, and a page
 * or search is the public web's; the frame returns it to that same Mac and
 * nowhere else.
 */

const TOOL_OF_NAME: ReadonlyMap<string, PlanWorkTool> = new Map([
  [RUN_IN_REPOSITORY_TOOL.name, PLAN_WORK_TOOL.REPOSITORY],
  [SEARCH_WEB_TOOL.name, PLAN_WORK_TOOL.SEARCH_WEB],
  [READ_WEB_PAGE_TOOL.name, PLAN_WORK_TOOL.READ_WEB_PAGE],
  [SHOW_CODE_TOOL.name, PLAN_WORK_TOOL.SHOW_CODE],
  [DRAW_ON_BOARD_TOOL_NAME, PLAN_WORK_TOOL.DRAW_ON_BOARD],
  [LOOK_AT_BOARD_TOOL_NAME, PLAN_WORK_TOOL.LOOK_AT_BOARD],
  [QUEUE_QUESTION_TOOL.name, PLAN_WORK_TOOL.QUEUE_QUESTION],
  [EVE_DELEGATION_TOOL.WORKER, PLAN_WORK_TOOL.WORKER],
  [EVE_DELEGATION_TOOL.TASK_WAIT, PLAN_WORK_TOOL.WORKER_WAIT],
  [EVE_DELEGATION_TOOL.TASK_CANCEL, PLAN_WORK_TOOL.WORKER_CANCEL],
]);

const isRepositoryInput = Schema.is(RUN_IN_REPOSITORY_TOOL.inputSchema);
const isSearchInput = Schema.is(SEARCH_WEB_TOOL.inputSchema);
const isPageInput = Schema.is(READ_WEB_PAGE_TOOL.inputSchema);
const isCodeInput = Schema.is(SHOW_CODE_TOOL.inputSchema);
const isQuestionInput = Schema.is(QUEUE_QUESTION_TOOL.inputSchema);
const isWorkerInput = Schema.is(EVE_DELEGATION_INPUT[EVE_DELEGATION_TOOL.WORKER]);

/** What `run_in_repository` answers, as its call's output is journaled. */
const isRepositoryOutput = Schema.is(
  Schema.Union([
    Schema.Struct({
      status: Schema.Literal(REPOSITORY_SHELL_STATUS.RAN),
      ...planCommandResultSchema.fields,
    }),
    Schema.Struct({
      status: Schema.Literal(REPOSITORY_SHELL_STATUS.NOT_RUN),
      reason: Schema.String,
    }),
  ]),
);

/** The text cut to the bound, marked where it was cut. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** The one input of a call a reader looks for first, or nothing for a tool whose input has none. */
function subjectOf(tool: PlanWorkTool, part: StoredToolPart): string | undefined {
  const { input } = part;
  if (tool === PLAN_WORK_TOOL.REPOSITORY && isRepositoryInput(input)) return input.command;
  if (tool === PLAN_WORK_TOOL.SEARCH_WEB && isSearchInput(input)) return input.query;
  if (tool === PLAN_WORK_TOOL.READ_WEB_PAGE && isPageInput(input)) return input.url;
  if (tool === PLAN_WORK_TOOL.QUEUE_QUESTION && isQuestionInput(input)) return input.question;
  if (tool === PLAN_WORK_TOOL.WORKER && isWorkerInput(input)) return input.message;
  if (tool === PLAN_WORK_TOOL.SHOW_CODE && isCodeInput(input)) {
    if (input.startLine === undefined) return input.path;
    const end = input.endLine ?? input.startLine;
    return end === input.startLine
      ? `${input.path}:${input.startLine}`
      : `${input.path}:${input.startLine}-${end}`;
  }
  return undefined;
}

/**
 * A call's output as text: a command's own output with its exit code where
 * it failed, why it was not run, or the answer as JSON. A board look answers
 * with an image of the board, which is nothing to read, so it shows none.
 */
function outputOf(tool: PlanWorkTool, part: StoredToolPart): string | undefined {
  if (part.state === TOOL_PART_STATE.OUTPUT_ERROR) return part.errorText;
  if (part.state !== TOOL_PART_STATE.OUTPUT_AVAILABLE) return undefined;
  if (tool === PLAN_WORK_TOOL.LOOK_AT_BOARD) return undefined;
  const { output } = part;
  if (tool === PLAN_WORK_TOOL.REPOSITORY && isRepositoryOutput(output)) {
    if (output.status === REPOSITORY_SHELL_STATUS.NOT_RUN) return `Not run: ${output.reason}`;
    const text = [output.stdout, output.stderr].filter((stream) => stream !== "").join("\n");
    return output.exitCode === 0 ? text : `${text}\nExit code ${output.exitCode}`.trimStart();
  }
  return JSON.stringify(output, null, 2);
}

/**
 * A call's state as the tab says it. Note that a call the turn ended
 * without answering is never called failed, because it may have run: the
 * writer settles it with an unknown outcome that says so, shown as its
 * output, and a look between the end and that write sees it done already.
 */
function callStateOf(part: StoredToolPart, turnState: PlanWorkState): PlanWorkState {
  if (part.state === TOOL_PART_STATE.OUTPUT_ERROR) return PLAN_WORK_STATE.FAILED;
  if (part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE) return PLAN_WORK_STATE.DONE;
  return turnState === PLAN_WORK_STATE.RUNNING ? PLAN_WORK_STATE.RUNNING : PLAN_WORK_STATE.DONE;
}

/**
 * Whether the worker the call in step `index` started has answered. eve's
 * call settles the moment the task starts, so its own state says nothing:
 * the turn's steps do. After the call the model keeps answering until a
 * step calls no tool, and the turn parks there on the task; the task's
 * findings are what start the next step. So a step without a call after the
 * worker's own, followed by another step, is the worker answering. Note that
 * a follow-up the developer said while the turn was parked resumes it the
 * same way, so this can call a worker done early; the turn's end settles it.
 */
function workerAnswered(
  steps: readonly (readonly StoredUIMessage["parts"][number][])[],
  index: number,
) {
  for (let later = index + 1; later < steps.length - 1; later += 1) {
    if (!(steps[later] ?? []).some(isStoredToolPart)) return true;
  }
  return false;
}

/** The turn's state as the tab says it: still running, settled, or ended any other way. */
function turnStateOf(turn: StoredTurnRecord): PlanWorkState {
  if (turn.status === TURN_STATUS.QUEUED || turn.status === TURN_STATUS.RUNNING) {
    return PLAN_WORK_STATE.RUNNING;
  }
  return turn.status === TURN_STATUS.SETTLED ? PLAN_WORK_STATE.DONE : PLAN_WORK_STATE.FAILED;
}

/** One tool part as the tab draws it, a worker's state read off the turn's steps. */
function toolPartOf(
  part: StoredToolPart,
  turnState: PlanWorkState,
  answered: boolean,
): PlanWorkPart {
  const name = storedToolName(part);
  const tool = TOOL_OF_NAME.get(name) ?? PLAN_WORK_TOOL.OTHER;
  const called = callStateOf(part, turnState);
  const state =
    tool === PLAN_WORK_TOOL.WORKER && called === PLAN_WORK_STATE.DONE && !answered
      ? turnState
      : called;
  const subject = subjectOf(tool, part);
  const output = outputOf(tool, part);
  return {
    type: PLAN_WORK_PART.TOOL,
    id: part.toolCallId,
    tool,
    name: cut(name, PLAN_WORK_BOUNDS.NAME_CHARS),
    state,
    ...(subject === undefined
      ? undefined
      : { subject: cut(subject, PLAN_WORK_BOUNDS.SUBJECT_CHARS) }),
    input: cut(JSON.stringify(part.input ?? {}, null, 2), PLAN_WORK_BOUNDS.TEXT_CHARS),
    ...(output === undefined ? undefined : { output: cut(output, PLAN_WORK_BOUNDS.TEXT_CHARS) }),
  };
}

/**
 * One planning turn's work, from its row and its journal (absent before the
 * turn wrote any): its state, when it started, and the newest of its words,
 * reasoning, and calls in the order the model wrote them.
 */
export function planWorkOf(
  turn: StoredTurnRecord,
  journal: StoredUIMessage | undefined,
): PlanWorkTurn {
  const turnState = turnStateOf(turn);
  // The parts are split at each step marker, which is no part of the work, so a worker's answer can be read off the steps after its call.
  const steps: StoredUIMessage["parts"][number][][] = [[]];
  for (const part of journal?.parts ?? []) {
    if (part.type === UI_PART_TYPE.STEP_START) steps.push([]);
    else steps.at(-1)?.push(part);
  }
  const parts: PlanWorkPart[] = [];
  steps.forEach((step, index) => {
    for (const part of step) {
      if (isStoredToolPart(part)) {
        parts.push(toolPartOf(part, turnState, workerAnswered(steps, index)));
      } else if (part.type === UI_PART_TYPE.TEXT && part.text.trim() !== "") {
        parts.push({
          type: PLAN_WORK_PART.TEXT,
          text: cut(part.text, PLAN_WORK_BOUNDS.TEXT_CHARS),
        });
      } else if (part.type === UI_PART_TYPE.REASONING && part.text.trim() !== "") {
        parts.push({
          type: PLAN_WORK_PART.REASONING,
          text: cut(part.text, PLAN_WORK_BOUNDS.TEXT_CHARS),
        });
      }
    }
  });
  return {
    turnId: turn.id,
    startedAt: (turn.startedAt ?? turn.queuedAt).getTime(),
    state: turnState,
    earlierOmitted: parts.length > PLAN_WORK_BOUNDS.PARTS,
    parts: parts.slice(-PLAN_WORK_BOUNDS.PARTS),
  };
}
