import { AGENT_TOOL } from "@sidecar/hosted/agent-tools";
import {
  type CodingAgentMessage,
  TURN_ENDING,
  type TurnRecord,
} from "@sidecar/hosted/coding-agent-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import {
  PLAN_WORK_STATE,
  type PlanWorkState,
  type PlanWorkTurn,
  type PlanWorkWorker,
} from "@sidecar/hosted/planning-view";
import {
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import { TOOL_STATE, type ToolState } from "../ai-elements/tool";
import { cardTitle } from "./tool-call-model";
import { CALL_KIND, CALL_WORDS, type CallKind } from "./turn-rows";

/**
 * work-model.ts -- the open plan's Call tab as an agent's transcript reads: each planning turn one of Luke's messages, in the agent tab's own parts.
 *
 * The service sends each planning turn's journal as the AI SDK stored it,
 * every string cut to the wire's bound, and beside it the workers the turn
 * started. Each turn is turned here into the message a coding agent's turn
 * is (`CodingAgentMessage`), its parts the journal's own, so the Call tab
 * draws it with the agent tab's own component (`agent-tab.tsx`), each call
 * read by its tool's name as an agent's is. A worker is a delegation's
 * part, which the agent tab draws as a subagent's row; it stands where the
 * worker's own session does, and the pair that session ran on is the
 * part's answer, as a coding agent's delegation answers it. A stop names
 * the subagent it stopped by that subagent's job (`workerJobs`), wherever
 * among the turns its start stands.
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
  /** The whole message the subagent was handed, which its line cuts to its job. */
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
  return (turns ?? []).flatMap((turn) => turn.workers.map((worker) => worker.callId));
}

/** How the AI SDK spells a tool part's type: the tool's name behind this prefix. */
const TOOL_PART_TYPE_PREFIX = "tool-";

/** The tool states of a call that has not answered, in the AI SDK's words. */
const UNANSWERED: ReadonlySet<string> = new Set([
  TOOL_STATE.INPUT_STREAMING,
  TOOL_STATE.INPUT_AVAILABLE,
]);

/**
 * The calls of the open plan's work by which Luke started a coding agent
 * and which have answered, by call id, so the plan's agents are read again
 * as one lands and the agent's tab appears as it does after a Start; none
 * where the plan has had no turn or its work is unread.
 */
export function startedAgentCallIds(turns: readonly PlanWorkTurn[] | undefined): readonly string[] {
  const start = `${TOOL_PART_TYPE_PREFIX}${AGENT_TOOL.START_CODING_AGENT}`;
  return (turns ?? []).flatMap((turn) =>
    turn.journal.flatMap((part) =>
      isRecord(part) &&
      part.type === start &&
      isWireString(part.toolCallId) &&
      isWireString(part.state) &&
      !UNANSWERED.has(part.state)
        ? [part.toolCallId]
        : [],
    ),
  );
}

/** A call's state as the agent tab marks it, in the AI SDK's words: running only while it still moves. */
function toolStateOf(call: WorkCallRow): ToolState {
  if (call.running) return TOOL_STATE.INPUT_AVAILABLE;
  return call.state === PLAN_WORK_STATE.FAILED
    ? TOOL_STATE.OUTPUT_ERROR
    : TOOL_STATE.OUTPUT_AVAILABLE;
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
    // SAFETY: every part is the wire's stored part or one built from it, a JSON object either way.
    parts: parts as CodingAgentMessage["parts"],
    ...(startedAt === undefined ? undefined : { startedAt }),
    ...(endedAt === undefined ? undefined : { finishedAt: endedAt }),
    ...record,
  };
}

/**
 * A journal's parts as the turn draws them: as the AI SDK stored them while
 * the turn moves, and once it stopped moving with no call still turning,
 * since nothing more of it will be told. Note that a call the turn ended
 * without answering is never called failed, because it may have run.
 */
function settledJournal(journal: readonly WireValue[], moving: boolean): readonly WireValue[] {
  if (moving) return journal;
  return journal.map((part) =>
    isRecord(part) && isWireString(part.state) && UNANSWERED.has(part.state)
      ? { ...part, state: TOOL_STATE.OUTPUT_AVAILABLE }
      : part,
  );
}

/** A worker's call row: its job as its subject, and where the worker stands as its own session reads, moving only while the call stands. */
function workerCall(worker: PlanWorkWorker, callLive: boolean): WorkCallRow {
  return {
    id: worker.callId,
    kind: CALL_KIND.WORKER,
    subject: worker.task,
    state: worker.state,
    running: callLive && worker.state === PLAN_WORK_STATE.RUNNING,
  };
}

/** The task a call sent more work to, as its input names it; nothing for a call that started one. */
function sentTask(journal: readonly WireValue[], callId: string): string | undefined {
  const call = journal.find((part) => isRecord(part) && part.toolCallId === callId);
  const input = isRecord(call) ? call.input : undefined;
  return isRecord(input) && isWireString(input.taskId) ? input.taskId : undefined;
}

/**
 * The job of each subagent the turns started, by eve's id for its task, so
 * a stop in any of the turns names the subagent it stopped as its line
 * does. Note that only a start names a task's job, never a call that sent
 * the task more work, whose message is no job of the subagent's, so a task
 * whose start is on a page not read names none.
 */
export function workerJobs(
  turns: readonly PlanWorkTurn[] | undefined,
): ReadonlyMap<string, string> {
  const jobs = new Map<string, string>();
  for (const turn of turns ?? []) {
    for (const worker of turn.workers) {
      if (worker.taskId === undefined || sentTask(turn.journal, worker.callId) !== undefined) {
        continue;
      }
      jobs.set(worker.taskId, workerJob(workerCall(worker, false)));
    }
  }
  return jobs;
}

/**
 * A worker as the wire sends it beside the call that started it: its job,
 * where it stands as its own session reads, and that session as a journal.
 * Note that it moves while the call stands whether or not its turn still
 * does, because a worker in the background outlives the turn that started it.
 */
function workerOfWire(worker: PlanWorkWorker, callLive: boolean): WorkWorkerBlock {
  const call = workerCall(worker, callLive);
  const record = recordOf(worker);
  return {
    call,
    task: worker.task,
    session: {
      earlierOmitted: worker.earlierOmitted,
      message: messageOf({
        id: worker.callId,
        parts: settledJournal(worker.journal, call.running),
        startedAt: worker.startedAt,
        endedAt: call.running ? undefined : worker.endedAt,
        record,
      }),
      ...(worker.startedAt === undefined ? undefined : { startedAt: worker.startedAt }),
      ...(worker.endedAt === undefined ? undefined : { endedAt: worker.endedAt }),
      ...(worker.title === undefined ? undefined : { title: worker.title }),
      record,
    },
  };
}

/**
 * A worker's call as the turn's journal draws it: where the worker stands
 * as its own session reads rather than where the call stood, since a call
 * that delegates to the background answers the moment the worker is under
 * way, and answering the pair its session ran on, as a coding agent's
 * delegation answers it, so its row names the pair.
 */
function workerCallPart(part: WireRecord, worker: WorkWorkerBlock): WireValue {
  const choice = workerChoice(worker);
  const { output: _receipt, ...call } = part;
  return {
    ...call,
    state: toolStateOf(worker.call),
    ...(choice === undefined
      ? undefined
      : { output: { model: choice.model, effort: choice.effort } }),
  };
}

/** A turn's journal as its message carries it, each worker's call standing where that worker does. */
function journalParts(
  journal: readonly WireValue[],
  workers: readonly WorkWorkerBlock[],
  moving: boolean,
): readonly WireValue[] {
  const byCall = new Map(workers.map((worker) => [worker.call.id, worker]));
  return settledJournal(journal, moving).map((part) => {
    if (!isRecord(part) || !isWireString(part.toolCallId)) return part;
    const worker = byCall.get(part.toolCallId);
    return worker === undefined ? part : workerCallPart(part, worker);
  });
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
  return (turns ?? []).map((turn) => {
    const moving = callLive && turn.state === PLAN_WORK_STATE.RUNNING;
    const left = turn.state === PLAN_WORK_STATE.RUNNING && !moving;
    const workers = turn.workers.map((worker) => workerOfWire(worker, callLive));
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
        parts: journalParts(turn.journal, workers, moving),
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
