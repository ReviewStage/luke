import {
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkPart,
  type PlanWorkState,
  type PlanWorkTool,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { isRecord, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { TOOL_BLOCK, type ToolBlock } from "../ai-elements/tool";
import {
  CALL_KIND,
  CALL_WORDS,
  type CallKind,
  pageName,
  ROW_PART,
  type RowReading,
  TURN_ROW,
  type TurnRow,
  turnRows,
} from "./turn-rows";

/**
 * work-model.ts -- the open plan's Work tab as rows: each planning turn's words, reasoning, and calls, folded the way every transcript folds them.
 *
 * The parts the service sends are read into blocks: the model's words as
 * they are, reasoning only where it has any, each call named by its kind
 * (`turn-rows.ts`) with the one input a reader looks for first set apart
 * as its subject, and a worker on its own row, never in a group, because
 * it runs on after its call. The rows those blocks fold into are
 * `turn-rows.ts`'s, the same an agent's tab folds its turns into.
 */

/** What the tab says while no turn has worked on the open plan. */
export const WORK_EMPTY_LINE = "When Luke works on a call, what he reads and runs appears here.";

/** The kinds of block a turn is read into. */
export const WORK_BLOCK = {
  TEXT: "text",
  REASONING: "reasoning",
  CALL: "call",
  WORKER: "worker",
} as const;

/** One call: its kind, its subject apart, its state, and what opens under it. */
export interface WorkCallRow {
  id: string;
  kind: CallKind;
  /** The input a reader looks for first; absent for a call that has none. */
  subject?: string;
  state: PlanWorkState;
  /** Whether the row still moves: the call runs on a call that still stands. */
  running: boolean;
  input: ToolBlock;
  output?: string;
}

export type WorkBlock =
  | { kind: typeof WORK_BLOCK.TEXT; text: string }
  | { kind: typeof WORK_BLOCK.REASONING; text: string }
  | { kind: typeof WORK_BLOCK.CALL; call: WorkCallRow }
  | {
      kind: typeof WORK_BLOCK.WORKER;
      call: WorkCallRow;
      /** The subagent's own session as rows, drawn the way a turn is; absent before any of it was read. */
      session?: WorkSessionRow;
    };

export type WorkWorkerBlock = Extract<WorkBlock, { kind: typeof WORK_BLOCK.WORKER }>;

/** A subagent's session as the tab draws it when opened: its rows, and whether older ones were left out. */
interface WorkSessionRow {
  earlierOmitted: boolean;
  rows: readonly TurnRow<WorkBlock>[];
}

/** One turn as the tab draws it. */
export interface WorkTurnRow {
  key: string;
  startedAt: number;
  /** Running only while the turn moves; a turn its call left running is drawn as stopped, since nothing more of it will be told. */
  state: PlanWorkState;
  earlierOmitted: boolean;
  rows: readonly TurnRow<WorkBlock>[];
}

/** Each of the planning model's tools as a kind of call. */
const CALL_KIND_OF_TOOL = {
  [PLAN_WORK_TOOL.REPOSITORY]: CALL_KIND.COMMAND,
  [PLAN_WORK_TOOL.SEARCH_WEB]: CALL_KIND.WEB_SEARCH,
  [PLAN_WORK_TOOL.READ_WEB_PAGE]: CALL_KIND.WEB_PAGE,
  [PLAN_WORK_TOOL.SHOW_CODE]: CALL_KIND.SHOW_CODE,
  [PLAN_WORK_TOOL.DRAW_ON_BOARD]: CALL_KIND.DRAW_ON_BOARD,
  [PLAN_WORK_TOOL.LOOK_AT_BOARD]: CALL_KIND.LOOK_AT_BOARD,
  [PLAN_WORK_TOOL.QUEUE_QUESTION]: CALL_KIND.QUEUE_QUESTION,
  [PLAN_WORK_TOOL.WORKER]: CALL_KIND.WORKER,
  [PLAN_WORK_TOOL.WORKER_WAIT]: CALL_KIND.WORKER_WAIT,
  [PLAN_WORK_TOOL.WORKER_CANCEL]: CALL_KIND.WORKER_CANCEL,
  [PLAN_WORK_TOOL.OTHER]: CALL_KIND.OTHER,
} as const satisfies Record<PlanWorkTool, CallKind>;

/** How the fold reads a block: a worker on a row of its own, every other call grouped. */
const WORK_READING: RowReading<WorkBlock> = {
  key: (block, index) =>
    block.kind === WORK_BLOCK.CALL || block.kind === WORK_BLOCK.WORKER
      ? block.call.id
      : String(index),
  part: (block) => {
    switch (block.kind) {
      case WORK_BLOCK.TEXT:
        return ROW_PART.WORDS;
      case WORK_BLOCK.REASONING:
        return ROW_PART.NOTE;
      case WORK_BLOCK.CALL:
        return ROW_PART.CALL;
      case WORK_BLOCK.WORKER:
        return ROW_PART.LONE_CALL;
    }
  },
  running: (block) =>
    (block.kind === WORK_BLOCK.CALL || block.kind === WORK_BLOCK.WORKER) && block.call.running,
};

/** What a subagent is named by, on its line and on its tab: its job, or what was asked of it where no job was said. */
export function workerJob(call: WorkCallRow): string {
  return call.subject ?? CALL_WORDS[call.kind].verb;
}

/**
 * The subagents the open plan's work holds, by the call that started each;
 * none where the plan has had no turn or its work is unread. A subagent's
 * tab is held to them, as an agent's is to the plan's agents.
 */
export function workerCallIds(turns: readonly PlanWorkTurn[] | undefined): readonly string[] {
  return (turns ?? []).flatMap((turn) =>
    turn.parts.flatMap((part) =>
      part.type === PLAN_WORK_PART.TOOL && part.tool === PLAN_WORK_TOOL.WORKER ? [part.id] : [],
    ),
  );
}

/** The command a repository call's input carries, which its body draws behind a prompt; nothing where the text is not that JSON. */
function commandOf(input: string): string | undefined {
  try {
    // SAFETY: the text is the JSON the service rendered the call's input to, which is a wire value or nothing.
    const parsed = JSON.parse(input) as UnparsedWireValue;
    return isRecord(parsed) && isWireString(parsed.command) ? parsed.command : undefined;
  } catch {
    return undefined;
  }
}

/** A call's input as its body draws it: a command behind its prompt, anything else as the words the frame carried. */
function inputBlock(kind: CallKind, input: string): ToolBlock {
  const command = kind === CALL_KIND.COMMAND ? commandOf(input) : undefined;
  return command === undefined
    ? { kind: TOOL_BLOCK.TEXT, text: input }
    : { kind: TOOL_BLOCK.COMMAND, text: command };
}

function callRowOf(
  part: Extract<PlanWorkPart, { type: typeof PLAN_WORK_PART.TOOL }>,
  moving: boolean,
): WorkCallRow {
  const kind = CALL_KIND_OF_TOOL[part.tool];
  const subject =
    part.tool === PLAN_WORK_TOOL.OTHER
      ? part.name
      : kind === CALL_KIND.WEB_PAGE && part.subject !== undefined
        ? pageName(part.subject)
        : part.subject;
  return {
    id: part.id,
    kind,
    ...(subject === undefined ? undefined : { subject }),
    state: part.state,
    running: moving && part.state === PLAN_WORK_STATE.RUNNING,
    input: inputBlock(kind, part.input),
    ...(part.output === undefined ? undefined : { output: part.output }),
  };
}

/**
 * One turn's parts as rows: the words and reasoning as they are, a worker
 * on its own row with its session walked by this same walk, and the calls
 * folded as every transcript folds them. An opened session is read for its
 * detail, so its calls stand each on a line of its own.
 */
function rowsOf(
  parts: readonly PlanWorkPart[],
  key: string,
  moving: boolean,
  done: boolean,
  grouped: boolean,
): readonly TurnRow<WorkBlock>[] {
  const blocks: WorkBlock[] = parts.map((part) => {
    if (part.type === PLAN_WORK_PART.TEXT) return { kind: WORK_BLOCK.TEXT, text: part.text };
    if (part.type === PLAN_WORK_PART.REASONING) {
      return { kind: WORK_BLOCK.REASONING, text: part.text };
    }
    const call = callRowOf(part, moving);
    if (part.tool !== PLAN_WORK_TOOL.WORKER) return { kind: WORK_BLOCK.CALL, call };
    return {
      kind: WORK_BLOCK.WORKER,
      call,
      ...(part.session === undefined
        ? undefined
        : {
            session: {
              earlierOmitted: part.session.earlierOmitted,
              rows: rowsOf(part.session.parts, part.id, call.running, false, false),
            },
          }),
    };
  });
  return turnRows(blocks, WORK_READING, { key, moving, done, grouped });
}

/**
 * The open plan's turns as rows, oldest first. A turn moves only while the
 * call it ran on stands: a call that ended leaves its last turn as it was
 * last told, with nothing on it still turning.
 */
export function workRowsOf(
  turns: readonly PlanWorkTurn[] | undefined,
  callLive: boolean,
): readonly WorkTurnRow[] {
  return (turns ?? []).map((turn) => {
    const moving = callLive && turn.state === PLAN_WORK_STATE.RUNNING;
    const left = turn.state === PLAN_WORK_STATE.RUNNING && !moving;
    return {
      key: turn.turnId,
      startedAt: turn.startedAt,
      state: left ? PLAN_WORK_STATE.FAILED : turn.state,
      earlierOmitted: turn.earlierOmitted,
      rows: rowsOf(turn.parts, turn.turnId, moving, turn.state === PLAN_WORK_STATE.DONE, true),
    };
  });
}

/** The worker block a call id names among the rows, at their level or inside a finished turn's fold. */
function workerNamed(
  rows: readonly TurnRow<WorkBlock>[],
  callId: string,
): WorkWorkerBlock | undefined {
  for (const row of rows) {
    if (row.kind === TURN_ROW.BLOCK && row.block.kind === WORK_BLOCK.WORKER && row.key === callId) {
      return row.block;
    }
    const inner = row.kind === TURN_ROW.FOLDED ? workerNamed(row.rows, callId) : undefined;
    if (inner !== undefined) return inner;
  }
  return undefined;
}

/**
 * The subagent the developer opened, by the calls that lead to it,
 * outermost first: the worker the first names in the turns, then the one the
 * next names in that worker's session, and so on. Nothing once the rows no
 * longer hold one of them, so the tab falls back to every turn.
 */
export function openedWorker(
  turns: readonly WorkTurnRow[],
  opened: readonly string[],
): WorkWorkerBlock | undefined {
  let rows: readonly TurnRow<WorkBlock>[] = turns.flatMap((turn) => turn.rows);
  let worker: WorkWorkerBlock | undefined;
  for (const callId of opened) {
    worker = workerNamed(rows, callId);
    if (worker === undefined) return undefined;
    rows = worker.session?.rows ?? [];
  }
  return worker;
}
