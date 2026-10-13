import { AGENT_TOOL } from "@sidecar/hosted/agent-tools";
import {
  type CodingAgentMessage,
  TURN_ENDING,
  type TurnRecord,
} from "@sidecar/hosted/coding-agent-wire";
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
import { isRecord, isWireString, MESSAGE_ROLE, type WireValue } from "@sidecar/wire";
import { TOOL_STATE, type ToolState } from "../ai-elements/tool";
import { cardTitle } from "./tool-call-model";
import {
  CALL_KIND,
  CALL_WORDS,
  type CallKind,
  commandDescription,
  isCommandKind,
  pageName,
  type SaidCall,
} from "./turn-rows";

/**
 * work-model.ts -- the open plan's Call tab as an agent's transcript reads: each planning turn one of Luke's messages, in the agent tab's own parts.
 *
 * The service sends the planning model's turns already read: each call
 * named by kind with the one input a reader looks for first set apart as
 * its subject, and every text cut to the wire's bound. Each turn is turned
 * here into the message a coding agent's turn is (`CodingAgentMessage`),
 * its parts in the AI SDK's own words, so the Call tab draws it with the
 * agent tab's own component (`agent-tab.tsx`), and a call says beside its
 * part what the wire read it as (`SaidCall`), which its row draws. A worker
 * is a delegation's part, which the agent tab draws as a subagent's row,
 * and the pair its session ran on is the part's answer, as a coding agent's
 * delegation answers it. A stop names the subagent it stopped by that
 * subagent's job, wherever among the turns its start stands.
 */

/** A worker's call: its kind, its subject apart, its state, and whether it still moves. */
export interface WorkCallRow {
  id: string;
  kind: CallKind;
  /** The input a reader looks for first; absent for a call that has none. */
  subject?: string;
  state: PlanWorkState;
  /** Whether the row still moves: the call runs on a call that still stands. */
  running: boolean;
}

/** A subagent's session as its tab draws it: one message of its, whether older parts were left out, when its newest task began and ended, its title, and what that task ran on and spent, as far as the service said. */
interface WorkSessionRow {
  earlierOmitted: boolean;
  message: CodingAgentMessage;
  title?: string;
  startedAt?: number;
  endedAt?: number;
  record: TurnRecord;
}

/** A subagent the planning model started: its call, the whole message it was handed, and its own session where any of it was read. */
export interface WorkWorkerBlock {
  call: WorkCallRow;
  /** The whole message the subagent was handed, which its line cuts to its job; the subject where the input carries none. */
  task: string;
  session?: WorkSessionRow;
}

/** One turn as the tab draws it. */
export interface WorkTurnRow {
  key: string;
  startedAt: number;
  /** When the turn ended, where the service said; none while it runs or was left running. */
  endedAt?: number;
  /** Running only while the turn moves; a turn its call left running is drawn as stopped, since nothing more of it will be told. */
  state: PlanWorkState;
  /** Whether the turn still moves: it runs on a call that still stands. */
  moving: boolean;
  earlierOmitted: boolean;
  /** The turn as one of Luke's messages, in the agent tab's own parts. */
  message: CodingAgentMessage;
  /** What the turn ran on and spent, as far as the service said. */
  record: TurnRecord;
  /** The subagents the turn started, in the order it started them. */
  workers: readonly WorkWorkerBlock[];
}

/** Each of the planning model's tools as a kind of call. */
const CALL_KIND_OF_TOOL = {
  [PLAN_WORK_TOOL.REPOSITORY]: CALL_KIND.COMMAND,
  [PLAN_WORK_TOOL.MAC_COMMAND]: CALL_KIND.MAC_COMMAND,
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
  [PLAN_WORK_TOOL.SHOW_PAGE]: CALL_KIND.SHOW_PAGE,
  [PLAN_WORK_TOOL.OTHER]: CALL_KIND.OTHER,
} as const satisfies Record<PlanWorkTool, CallKind>;

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

/**
 * Whether a turn or a subagent's task that ended without answering failed,
 * which is said "Failed" as an agent's failed turn is, rather than
 * "Stopped": where the service recorded that it failed or ran past its
 * bound. Note that one recorded as stopped, one the call it ran on ended
 * under (`workRowsOf`), and one from a service older than the record all
 * stopped, since none of them failed of its own that anyone said.
 */
export function workFailed(record: TurnRecord | undefined): boolean {
  return record?.ending === TURN_ENDING.FAILED || record?.ending === TURN_ENDING.ABANDONED;
}

/** The effort a worker's pair says where its session's row recorded none, as a turn recorded before efforts were, which the label leaves unsaid. */
const UNRECORDED_EFFORT = "";

/** What a subagent runs on, as its row and its tab's card name it, an agent's subagent alike: the model and effort its session ran on; none where the service named no model. */
export function workerChoice(worker: WorkWorkerBlock): ModelChoice | undefined {
  const record = worker.session?.record;
  if (record?.model === undefined) return undefined;
  return { model: record.model, effort: record.effort ?? UNRECORDED_EFFORT };
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

/** The fields of a call's input the tab reads apart from the rest. */
const INPUT_FIELD = {
  DESCRIPTION: "description",
  MESSAGE: "message",
  TASK: "taskId",
} as const;

type InputField = (typeof INPUT_FIELD)[keyof typeof INPUT_FIELD];

/**
 * The text the service rendered a call's input or answer to, read back as
 * the value it was: JSON where it is, and the words as they are where they
 * are not, as a command's output is, or where the bound cut the JSON short.
 */
function wireValueOf(text: string): WireValue {
  try {
    // SAFETY: the text is the JSON the service rendered a wire value to, or words that throw here.
    return JSON.parse(text) as WireValue;
  } catch {
    return text;
  }
}

/** One string field of a call's input; nothing where the input does not read as an object holding it. */
function inputField(input: WireValue, field: InputField): string | undefined {
  if (!isRecord(input)) return undefined;
  const value = input[field];
  return isWireString(value) ? value : undefined;
}

/** The job of each subagent the turns started, by eve's id for its task, as its line names it; the first call naming a task is its start. */
type JobsByTask = ReadonlyMap<string, string>;

type WorkToolPart = Extract<PlanWorkPart, { type: typeof PLAN_WORK_PART.TOOL }>;

/** A call's kind and subject, its stop naming the subagent it stopped and a page by its name. */
function callRowOf(part: WorkToolPart, moving: boolean, jobs: JobsByTask): WorkCallRow {
  // A skill load travels as `other`, which every desktop reads, named by the tool it ran.
  const loaded = part.tool === PLAN_WORK_TOOL.OTHER && part.name === AGENT_TOOL.LOAD_SKILL;
  const kind = loaded ? CALL_KIND.LOAD_SKILL : CALL_KIND_OF_TOOL[part.tool];
  const stopped =
    part.tool === PLAN_WORK_TOOL.WORKER_CANCEL && part.task !== undefined
      ? jobs.get(part.task)
      : undefined;
  const subject =
    part.tool === PLAN_WORK_TOOL.OTHER && !loaded
      ? part.name
      : kind === CALL_KIND.WEB_PAGE && part.subject !== undefined
        ? pageName(part.subject)
        : (stopped ?? part.subject);
  return {
    id: part.id,
    kind,
    ...(subject === undefined ? undefined : { subject }),
    state: part.state,
    running: moving && part.state === PLAN_WORK_STATE.RUNNING,
  };
}

/** A call's state as the agent tab marks it, in the AI SDK's words: running only while it still moves. */
function toolStateOf(call: WorkCallRow): ToolState {
  if (call.running) return TOOL_STATE.INPUT_AVAILABLE;
  return call.state === PLAN_WORK_STATE.FAILED
    ? TOOL_STATE.OUTPUT_ERROR
    : TOOL_STATE.OUTPUT_AVAILABLE;
}

/** How the AI SDK spells a tool part's type: the tool's name behind this prefix. */
const TOOL_PART_TYPE_PREFIX = "tool-";

/**
 * A call as the AI SDK's tool part, saying beside it what the wire read it
 * as. A failed call's answer is its error's text. A worker's answer is the
 * pair its session ran on, as a coding agent's delegation answers it, so its
 * row names the pair; a worker whose session named no model answers none.
 */
function toolPartOf(part: WorkToolPart, call: WorkCallRow, worker?: WorkWorkerBlock): WireValue {
  const input = wireValueOf(part.input);
  const description = isCommandKind(call.kind)
    ? commandDescription(inputField(input, INPUT_FIELD.DESCRIPTION))
    : undefined;
  const said: SaidCall = {
    kind: call.kind,
    ...(call.subject === undefined ? undefined : { subject: call.subject }),
    ...(description === undefined ? undefined : { description }),
  };
  const state = toolStateOf(call);
  const choice = worker === undefined ? undefined : workerChoice(worker);
  const output: WireValue | undefined =
    worker !== undefined
      ? choice && { model: choice.model, effort: choice.effort }
      : part.output === undefined || state === TOOL_STATE.OUTPUT_ERROR
        ? undefined
        : wireValueOf(part.output);
  return {
    type: `${TOOL_PART_TYPE_PREFIX}${part.name}`,
    toolCallId: part.id,
    state,
    input,
    ...(output === undefined ? undefined : { output }),
    ...(state === TOOL_STATE.OUTPUT_ERROR && part.output !== undefined
      ? { errorText: part.output }
      : undefined),
    said: { ...said },
  };
}

/** A part of the planning model's turn, or of a subagent's session, as the AI SDK's own part. */
function sdkPartOf(
  part: PlanWorkPart,
  moving: boolean,
  jobs: JobsByTask,
  worker?: WorkWorkerBlock,
): WireValue {
  if (part.type === PLAN_WORK_PART.TEXT || part.type === PLAN_WORK_PART.REASONING) {
    return { type: part.type, text: part.text };
  }
  return toolPartOf(part, callRowOf(part, moving, jobs), worker);
}

/** The turn's or the session's end and record as a message carries them: an end only once it ended. */
function messageOf(input: {
  id: string;
  parts: readonly WireValue[];
  startedAt: number | undefined;
  endedAt: number | undefined;
  record: TurnRecord;
}): CodingAgentMessage {
  const { id, parts, startedAt, endedAt, record } = input;
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    // SAFETY: every part is built above as a JSON object, which is what the wire's stored part is.
    parts: parts as CodingAgentMessage["parts"],
    ...(startedAt === undefined ? undefined : { startedAt }),
    ...(endedAt === undefined ? undefined : { finishedAt: endedAt }),
    ...record,
  };
}

/** A worker the turn started: its call, its task, and its session as one message of its, the session's calls kept running only while the worker still moves. */
function workerOfPart(part: WorkToolPart, moving: boolean, jobs: JobsByTask): WorkWorkerBlock {
  const call = callRowOf(part, moving, jobs);
  const task = inputField(wireValueOf(part.input), INPUT_FIELD.MESSAGE) ?? call.subject;
  const { session } = part;
  return {
    call,
    task: task ?? workerJob(call),
    ...(session === undefined
      ? undefined
      : {
          session: {
            earlierOmitted: session.earlierOmitted,
            message: messageOf({
              id: part.id,
              parts: session.parts.map((each) => sdkPartOf(each, call.running, jobs)),
              startedAt: session.startedAt,
              endedAt: call.running ? undefined : session.endedAt,
              record: recordOf(session),
            }),
            ...(session.startedAt === undefined ? undefined : { startedAt: session.startedAt }),
            ...(session.endedAt === undefined ? undefined : { endedAt: session.endedAt }),
            ...(session.title === undefined ? undefined : { title: session.title }),
            record: recordOf(session),
          },
        }),
  };
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
    if (part.task === undefined) continue;
    if (inputField(wireValueOf(part.input), INPUT_FIELD.TASK) !== undefined) continue;
    jobs.set(part.task, workerJob(callRowOf(part, false, jobs)));
  }
  return jobs;
}

/**
 * The open plan's turns as the tab draws them, oldest first, each one of
 * Luke's messages. A turn moves only while the call it ran on stands: a
 * call that ended leaves its last turn as it was last told, with nothing on
 * it still turning, and drawn as stopped.
 */
export function workRowsOf(
  turns: readonly PlanWorkTurn[] | undefined,
  callLive: boolean,
): readonly WorkTurnRow[] {
  const jobs = jobsOf(turns ?? []);
  return (turns ?? []).map((turn) => {
    const moving = callLive && turn.state === PLAN_WORK_STATE.RUNNING;
    const left = turn.state === PLAN_WORK_STATE.RUNNING && !moving;
    const workers: WorkWorkerBlock[] = [];
    const parts = turn.parts.map((part) => {
      if (part.type !== PLAN_WORK_PART.TOOL || part.tool !== PLAN_WORK_TOOL.WORKER) {
        return sdkPartOf(part, moving, jobs);
      }
      const worker = workerOfPart(part, moving, jobs);
      workers.push(worker);
      return sdkPartOf(part, moving, jobs, worker);
    });
    const record = recordOf(turn);
    return {
      key: turn.turnId,
      startedAt: turn.startedAt,
      ...(turn.endedAt === undefined ? undefined : { endedAt: turn.endedAt }),
      state: left ? PLAN_WORK_STATE.FAILED : turn.state,
      moving,
      earlierOmitted: turn.earlierOmitted,
      message: messageOf({
        id: turn.turnId,
        parts,
        startedAt: turn.startedAt,
        endedAt: turn.state === PLAN_WORK_STATE.RUNNING ? undefined : turn.endedAt,
        record,
      }),
      record,
      workers,
    };
  });
}

/**
 * The worker a call id names among the turns; nothing once the turns no
 * longer hold it, so a subagent's tab stands for a session the work has let
 * go of.
 */
export function workerOf(
  turns: readonly WorkTurnRow[],
  callId: string,
): WorkWorkerBlock | undefined {
  for (const turn of turns) {
    const worker = turn.workers.find((each) => each.call.id === callId);
    if (worker !== undefined) return worker;
  }
  return undefined;
}
