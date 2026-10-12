import type { TurnRecord } from "@sidecar/hosted/coding-agent-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
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
import { Option, Schema } from "effect";
import { TOOL_BLOCK, type ToolBlock } from "../ai-elements/tool";
import { cardTitle } from "./tool-call-model";
import {
  CALL_KIND,
  CALL_WORDS,
  type CallKind,
  commandDescription,
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
 * it runs on after its call. A stop names the subagent it stopped by that
 * subagent's job, wherever among the turns its start stands. The rows those blocks fold into are
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
  /** For a command, the plain words the model said it is for, which its line says in place of the verb and the command; absent where it said none. */
  description?: string;
  state: PlanWorkState;
  /** Whether the row still moves: the call runs on a call that still stands. */
  running: boolean;
  input: ToolBlock;
  output?: string;
  /** For a call that started a coding agent, the agent it started, which its row opens; absent before the start answered, for a start refused, and for any other call. */
  agent?: string;
}

export type WorkBlock =
  | { kind: typeof WORK_BLOCK.TEXT; text: string }
  | { kind: typeof WORK_BLOCK.REASONING; text: string }
  | { kind: typeof WORK_BLOCK.CALL; call: WorkCallRow }
  | {
      kind: typeof WORK_BLOCK.WORKER;
      call: WorkCallRow;
      /** The whole message the subagent was handed, which its line cuts to its job; the subject where the input carries none. */
      task: string;
      /** The subagent's own session as rows, drawn the way a turn is; absent before any of it was read. */
      session?: WorkSessionRow;
    };

export type WorkWorkerBlock = Extract<WorkBlock, { kind: typeof WORK_BLOCK.WORKER }>;

/** A subagent's session as the tab draws it when opened: its rows, whether older ones were left out, when its newest task began and ended, its title, and what that task ran on and spent, as far as the service said. */
interface WorkSessionRow {
  earlierOmitted: boolean;
  rows: readonly TurnRow<WorkBlock>[];
  title?: string;
  startedAt?: number;
  endedAt?: number;
  record: TurnRecord;
}

/** One turn as the tab draws it. */
export interface WorkTurnRow {
  key: string;
  startedAt: number;
  /** When the turn ended, where the service said; none while it runs or was left running. */
  endedAt?: number;
  /** Running only while the turn moves; a turn its call left running is drawn as stopped, since nothing more of it will be told. */
  state: PlanWorkState;
  earlierOmitted: boolean;
  rows: readonly TurnRow<WorkBlock>[];
  /** What the turn ran on and spent, as far as the service said. */
  record: TurnRecord;
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
  [PLAN_WORK_TOOL.WITHDRAW_QUESTION]: CALL_KIND.WITHDRAW_QUESTION,
  [PLAN_WORK_TOOL.WORKER]: CALL_KIND.WORKER,
  [PLAN_WORK_TOOL.WORKER_WAIT]: CALL_KIND.WORKER_WAIT,
  [PLAN_WORK_TOOL.WORKER_CANCEL]: CALL_KIND.WORKER_CANCEL,
  [PLAN_WORK_TOOL.LIST_AGENTS]: CALL_KIND.LIST_AGENTS,
  [PLAN_WORK_TOOL.READ_AGENT]: CALL_KIND.READ_AGENT,
  [PLAN_WORK_TOOL.MESSAGE_AGENT]: CALL_KIND.MESSAGE_AGENT,
  [PLAN_WORK_TOOL.START_AGENT]: CALL_KIND.START_AGENT,
  [PLAN_WORK_TOOL.END_CALL]: CALL_KIND.END_CALL,
  [PLAN_WORK_TOOL.OTHER]: CALL_KIND.OTHER,
} as const satisfies Record<PlanWorkTool, CallKind>;

/** How the fold reads a block: a worker on a row of its own, every other call grouped, a start that began a coding agent counted apart. */
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
        return block.call.agent === undefined ? ROW_PART.CALL : ROW_PART.CODING_AGENT;
      case WORK_BLOCK.WORKER:
        return ROW_PART.SUBAGENT;
    }
  },
  running: (block) =>
    (block.kind === WORK_BLOCK.CALL || block.kind === WORK_BLOCK.WORKER) && block.call.running,
};

/** What a subagent is named by, on its line, its task card, and its tab: its job, the first line of its task as plain words, or what was asked of it where no job was said. */
export function workerJob(call: WorkCallRow): string {
  const job = cardTitle(call.subject ?? "");
  return job === "" ? CALL_WORDS[call.kind].verb : job;
}

/** What a turn or a subagent's task ran on and spent, as the service said, apart from the rest the wire carries beside it. */
function recordOf({ model, effort, tokens, ending }: TurnRecord): TurnRecord {
  return {
    ...(model === undefined ? undefined : { model }),
    ...(effort === undefined ? undefined : { effort }),
    ...(tokens === undefined ? undefined : { tokens }),
    ...(ending === undefined ? undefined : { ending }),
  };
}

/** The effort a worker's pair says: none, because the planning model's turns record none, which the label leaves unsaid. */
const UNRECORDED_EFFORT = "";

/** What a subagent runs on, as its row and its tab's card name it, an agent's subagent alike: the model its session ran on; none where the service named none. */
export function workerChoice(worker: WorkWorkerBlock): ModelChoice | undefined {
  const model = worker.session?.record.model;
  return model === undefined ? undefined : { model, effort: UNRECORDED_EFFORT };
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

/**
 * The calls of the open plan's work by which Luke started a coding agent
 * and which have answered, by call id, so the plan's agents are read again
 * as one lands and the agent's tab appears as it does after a Start; none
 * where the plan has had no turn or its work is unread.
 */
export function startedAgentCallIds(turns: readonly PlanWorkTurn[] | undefined): readonly string[] {
  return (turns ?? []).flatMap((turn) =>
    turn.parts.flatMap((part) =>
      part.type === PLAN_WORK_PART.TOOL &&
      part.tool === PLAN_WORK_TOOL.START_AGENT &&
      part.state !== PLAN_WORK_STATE.RUNNING
        ? [part.id]
        : [],
    ),
  );
}

/** What a coding agent's start answers, read for the one field that says it began one: the agent it started. */
const decodeStartedAgent = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ agent: Schema.Struct({ id: Schema.String }) })),
);

/** The agent a call started, read off its answer; nothing for any other call, or a start refused, which answers no agent. */
function startedAgentOf(kind: CallKind, output: string | undefined): string | undefined {
  if (kind !== CALL_KIND.START_AGENT || output === undefined) return undefined;
  return Option.getOrUndefined(Option.map(decodeStartedAgent(output), (answer) => answer.agent.id));
}

/** The fields of a call's input the tab reads apart from the rest. */
const INPUT_FIELD = {
  COMMAND: "command",
  DESCRIPTION: "description",
  MESSAGE: "message",
  TASK: "taskId",
} as const;

type InputField = (typeof INPUT_FIELD)[keyof typeof INPUT_FIELD];

/**
 * One string field of a call's input: the command a repository call runs,
 * which its body draws behind a prompt, and the plain words it is for,
 * which its line says where the model gave them; or the message a subagent was
 * handed, which the service cuts to a subject on its line but carries
 * whole in the input. Nothing where the text is not that JSON.
 */
function inputField(input: string, field: InputField): string | undefined {
  try {
    // SAFETY: the text is the JSON the service rendered the call's input to, which is a wire value or nothing.
    const parsed = JSON.parse(input) as UnparsedWireValue;
    if (!isRecord(parsed)) return undefined;
    const value = parsed[field];
    return isWireString(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A call's input as its body draws it: a command behind its prompt, anything else as the words the frame carried. */
function inputBlock(kind: CallKind, input: string): ToolBlock {
  const command = kind === CALL_KIND.COMMAND ? inputField(input, INPUT_FIELD.COMMAND) : undefined;
  return command === undefined
    ? { kind: TOOL_BLOCK.TEXT, text: input }
    : { kind: TOOL_BLOCK.COMMAND, text: command };
}

/** The job of each subagent the turns started, by eve's id for its task, as its line names it; the first call naming a task is its start. */
type JobsByTask = ReadonlyMap<string, string>;

function callRowOf(
  part: Extract<PlanWorkPart, { type: typeof PLAN_WORK_PART.TOOL }>,
  moving: boolean,
  jobs: JobsByTask,
): WorkCallRow {
  const kind = CALL_KIND_OF_TOOL[part.tool];
  const stopped =
    part.tool === PLAN_WORK_TOOL.WORKER_CANCEL && part.task !== undefined
      ? jobs.get(part.task)
      : undefined;
  const subject =
    part.tool === PLAN_WORK_TOOL.OTHER
      ? part.name
      : kind === CALL_KIND.WEB_PAGE && part.subject !== undefined
        ? pageName(part.subject)
        : (stopped ?? part.subject);
  const agent = startedAgentOf(kind, part.output);
  const description =
    kind === CALL_KIND.COMMAND
      ? commandDescription(inputField(part.input, INPUT_FIELD.DESCRIPTION))
      : undefined;
  return {
    id: part.id,
    kind,
    ...(subject === undefined ? undefined : { subject }),
    ...(description === undefined ? undefined : { description }),
    state: part.state,
    running: moving && part.state === PLAN_WORK_STATE.RUNNING,
    input: inputBlock(kind, part.input),
    ...(part.output === undefined ? undefined : { output: part.output }),
    ...(agent === undefined ? undefined : { agent }),
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
  jobs: JobsByTask,
): readonly TurnRow<WorkBlock>[] {
  const blocks: WorkBlock[] = parts.map((part) => {
    if (part.type === PLAN_WORK_PART.TEXT) return { kind: WORK_BLOCK.TEXT, text: part.text };
    if (part.type === PLAN_WORK_PART.REASONING) {
      return { kind: WORK_BLOCK.REASONING, text: part.text };
    }
    const call = callRowOf(part, moving, jobs);
    if (part.tool !== PLAN_WORK_TOOL.WORKER) return { kind: WORK_BLOCK.CALL, call };
    return {
      kind: WORK_BLOCK.WORKER,
      call,
      task: inputField(part.input, INPUT_FIELD.MESSAGE) ?? call.subject ?? workerJob(call),
      ...(part.session === undefined
        ? undefined
        : {
            session: {
              earlierOmitted: part.session.earlierOmitted,
              rows: rowsOf(part.session.parts, part.id, call.running, false, false, jobs),
              ...(part.session.startedAt === undefined
                ? undefined
                : { startedAt: part.session.startedAt }),
              ...(part.session.endedAt === undefined
                ? undefined
                : { endedAt: part.session.endedAt }),
              ...(part.session.title === undefined ? undefined : { title: part.session.title }),
              record: recordOf(part.session),
            },
          }),
    };
  });
  return turnRows(blocks, WORK_READING, { key, moving, done, grouped });
}

/**
 * The job of each subagent the turns started, by its task, so a stop in a
 * later turn still names it. Note that only a start names a task's job,
 * never a call that sent the task more work, whose message is no job of the
 * subagent's, so a task whose start is on a page not read names none.
 */
function jobsOf(turns: readonly PlanWorkTurn[]): JobsByTask {
  const jobs = new Map<string, string>();
  for (const part of turns.flatMap((turn) => turn.parts)) {
    if (part.type !== PLAN_WORK_PART.TOOL || part.tool !== PLAN_WORK_TOOL.WORKER) continue;
    if (part.task === undefined || inputField(part.input, INPUT_FIELD.TASK) !== undefined) continue;
    jobs.set(part.task, workerJob(callRowOf(part, false, jobs)));
  }
  return jobs;
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
  const jobs = jobsOf(turns ?? []);
  return (turns ?? []).map((turn) => {
    const moving = callLive && turn.state === PLAN_WORK_STATE.RUNNING;
    const left = turn.state === PLAN_WORK_STATE.RUNNING && !moving;
    return {
      key: turn.turnId,
      startedAt: turn.startedAt,
      ...(turn.endedAt === undefined ? undefined : { endedAt: turn.endedAt }),
      state: left ? PLAN_WORK_STATE.FAILED : turn.state,
      earlierOmitted: turn.earlierOmitted,
      record: recordOf(turn),
      rows: rowsOf(
        turn.parts,
        turn.turnId,
        moving,
        turn.state === PLAN_WORK_STATE.DONE,
        true,
        jobs,
      ),
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
 * The worker a call id names among the turns, at a turn's level or inside
 * a finished turn's fold; nothing once the turns no longer hold it, so a
 * subagent's tab stands for a session the work has let go of.
 */
export function workerOf(
  turns: readonly WorkTurnRow[],
  callId: string,
): WorkWorkerBlock | undefined {
  return workerNamed(
    turns.flatMap((turn) => turn.rows),
    callId,
  );
}
