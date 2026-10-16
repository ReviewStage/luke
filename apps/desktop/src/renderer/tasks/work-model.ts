import { AGENT_TOOL, EVE_TOOL, RETIRED_TOOL } from "@luke/features/agent-tools";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentMessagesAnswer,
  type CodingAgentStatus,
  type CodingAgentSubagentStanding,
  TURN_ENDING,
  type TurnRecord,
} from "@luke/features/coding-agent-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import { TASK_WORK_STATE, type TaskWorkState } from "@luke/features/tasks-view";
import { CALL_KIND, CALL_WORDS, type CallKind } from "@luke/features/turn-rows";
import { isRecord, isWireString, TURN_ORIGIN, type WireRecord, type WireValue } from "@luke/wire";
import { TOOL_STATE, type ToolState } from "../ai-elements/tool";
import { cardTitle } from "./tool-call-model";

/**
 * work-model.ts -- the open plan's Call tab as an agent's transcript reads: each planning turn one of Luke's messages, in the agent tab's own parts.
 *
 * The plan's planning conversation is read as a coding agent's transcript
 * is (`planning.conversation`): each planning turn's journal one message, its
 * parts as the AI SDK stored them, every string cut to the wire's bound,
 * naming its turn and the spoken lines that asked for it, and beside the
 * messages where each of the planner's workers stands, read from its own
 * session. Each journal is drawn with the agent tab's own component
 * (`agent-tab.tsx`), each call read by its tool's name as an agent's is. A
 * worker is a delegation's part, which the agent tab draws as a subagent's
 * row; it stands where the worker's own session does, and the pair that
 * session ran on is the part's answer, as a coding agent's delegation
 * answers it. A stop names the subagent it stopped by that subagent's job
 * (`workerJobs`), wherever among the turns its start stands.
 */

/** A worker's call: its kind, its subject apart, its state, and whether it still moves. */
export interface WorkCallRow {
  id: string;
  kind: CallKind;
  /** The input a reader looks for first; absent for a call that has none. */
  subject?: string;
  state: TaskWorkState;
  /** Whether the row still moves: the call runs on a call that still stands. */
  running: boolean;
}

/** A subagent's session as the plan's pages say it: its title, when its newest task began, and the pair it ran on, as far as the service said. Its transcript is its own tab's read. */
interface WorkSessionRow {
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
  state: TaskWorkState;
  /** Whether the turn still moves: it runs on a call that still stands. */
  moving: boolean;
  earlierOmitted: boolean;
  /** The turn as one of Luke's messages, in the agent tab's own parts. */
  message: CodingAgentMessage;
  /** What the turn ran on and spent, as far as the service said. */
  record: TurnRecord;
  /** The subagents the turn started, in the order it started them. */
  workers: readonly WorkWorkerBlock[];
  /** The spoken lines the turn took as its ask, by the ids the voice's ledger minted, and where on its call each began. */
  asked: readonly string[];
  askedAt: NonNullable<CodingAgentMessage["askedAt"]>;
  /** Whether the voice asked for the turn, so Luke says its words aloud whether or not a line on screen asked for it; false from a service older than the word. */
  spoken: boolean;
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

/** The open plan's planning conversation as the window holds it; none before the first read lands. */
export type TaskConversation = CodingAgentMessagesAnswer | undefined;

/**
 * The subagents the open plan's work holds, by the call that started each,
 * in the order started; none where the plan has had no turn or its work is
 * unread. A subagent's tab is held to them, as an agent's is to the plan's
 * agents.
 */
export function workerCallIds(rows: readonly WorkTurnRow[]): readonly string[] {
  return rows.flatMap((row) => row.workers.map((worker) => worker.call.id));
}

/** How the AI SDK spells a tool part's type: the tool's name behind this prefix. */
const TOOL_PART_TYPE_PREFIX = "tool-";

/** The tool parts a delegation to the worker is stored as, under every name one was made under. */
const DELEGATION_PART_TYPES: ReadonlySet<string> = new Set([
  `${TOOL_PART_TYPE_PREFIX}${AGENT_TOOL.DELEGATE}`,
  `${TOOL_PART_TYPE_PREFIX}${EVE_TOOL.WORKER}`,
]);

/** The tool states of a call that has not answered, in the AI SDK's words. */
const UNANSWERED: ReadonlySet<string> = new Set([
  TOOL_STATE.INPUT_STREAMING,
  TOOL_STATE.INPUT_AVAILABLE,
]);

/**
 * The calls of the open plan's work by which Luke started, archived, or
 * brought back a coding agent and which have answered, by call id, so the
 * plan's agents are read again as one lands and the agent's tab appears or
 * leaves as it does after a Start or an Archive; none where the plan has
 * had no turn or its work is unread.
 */
export function agentListCallIds(conversation: TaskConversation): readonly string[] {
  // A start is read under the tool's name and the one it had before every agent was offered it.
  const starts = new Set(
    [
      AGENT_TOOL.START_AGENT,
      RETIRED_TOOL.START_CODING_AGENT,
      AGENT_TOOL.ARCHIVE_AGENT,
      AGENT_TOOL.UNARCHIVE_AGENT,
    ].map((tool) => `${TOOL_PART_TYPE_PREFIX}${tool}`),
  );
  return (conversation?.messages ?? []).flatMap((message) =>
    message.parts.flatMap((part) =>
      isRecord(part) &&
      isWireString(part.type) &&
      starts.has(part.type) &&
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
  return call.state === TASK_WORK_STATE.FAILED
    ? TOOL_STATE.OUTPUT_ERROR
    : TOOL_STATE.OUTPUT_AVAILABLE;
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

/** Where a worker stands on the plan's work, by where its own session's page says it does. */
const WORK_STATE_OF_STATUS = {
  [CODING_AGENT_STATUS.STARTING]: TASK_WORK_STATE.RUNNING,
  [CODING_AGENT_STATUS.RUNNING]: TASK_WORK_STATE.RUNNING,
  [CODING_AGENT_STATUS.COMPLETED]: TASK_WORK_STATE.DONE,
  [CODING_AGENT_STATUS.FAILED]: TASK_WORK_STATE.FAILED,
  [CODING_AGENT_STATUS.CANCELLED]: TASK_WORK_STATE.DONE,
} as const satisfies Record<CodingAgentStatus, TaskWorkState>;

/** A delegation's part's input as a field of words, where it carries one. */
function inputText(part: WireRecord, field: string): string | undefined {
  const { input } = part;
  if (!isRecord(input)) return undefined;
  const value = input[field];
  return isWireString(value) ? value : undefined;
}

/** How eve's receipt names the task a delegation started. */
const STARTED_TASK = /^Started task (\S+)\./u;

/** The task a delegation started, read off eve's receipt; nothing for one that sent a task more work, or before it answered. */
function startedTaskOf(part: WireRecord): string | undefined {
  if (inputText(part, "taskId") !== undefined || !isWireString(part.output)) return undefined;
  return STARTED_TASK.exec(part.output)?.[1];
}

/**
 * A delegation's worker as its turn's journal holds it, where its own
 * session's page says it stands; one the pages say nothing of yet stands as
 * its call does, running while the turn moves.
 */
function workerOfPart(
  part: WireRecord & { readonly toolCallId: string },
  standing: CodingAgentSubagentStanding | undefined,
  title: string | undefined,
  moving: boolean,
  callLive: boolean,
): WorkWorkerBlock {
  const task = inputText(part, "task") ?? inputText(part, "message") ?? "";
  const failed = part.state === TOOL_STATE.OUTPUT_ERROR;
  const state =
    standing !== undefined
      ? WORK_STATE_OF_STATUS[standing.status]
      : failed
        ? TASK_WORK_STATE.FAILED
        : moving
          ? TASK_WORK_STATE.RUNNING
          : TASK_WORK_STATE.DONE;
  // A failed session is recorded as failed, as its own transcript ends, rather than as one that stopped.
  const ended =
    standing?.status === CODING_AGENT_STATUS.FAILED ? { ending: TURN_ENDING.FAILED } : {};
  const record: TurnRecord =
    standing === undefined || standing.model === ""
      ? ended
      : {
          model: standing.model,
          ...(standing.effort === "" ? undefined : { effort: standing.effort }),
          ...ended,
        };
  return {
    call: {
      id: part.toolCallId,
      kind: CALL_KIND.WORKER,
      subject: task,
      state,
      running: callLive && state === TASK_WORK_STATE.RUNNING,
    },
    task,
    session: {
      ...(title === undefined ? undefined : { title }),
      ...(standing === undefined ? undefined : { startedAt: standing.startedAt }),
      record,
    },
  };
}

/** The call a job is read off, which only its subject tells apart. */
const JOB_CALL: WorkCallRow = {
  id: "",
  kind: CALL_KIND.WORKER,
  state: TASK_WORK_STATE.DONE,
  running: false,
};

/**
 * The job of each subagent the turns started, by eve's id for its task, so
 * a stop in any of the turns names the subagent it stopped as its line
 * does. Note that only a start names a task's job, never a call that sent
 * the task more work, whose message is no job of the subagent's, so a task
 * whose start is on a page not read names none.
 */
export function workerJobs(conversation: TaskConversation): ReadonlyMap<string, string> {
  const jobs = new Map<string, string>();
  for (const message of conversation?.messages ?? []) {
    for (const part of message.parts) {
      if (!isRecord(part) || !isWireString(part.type) || !DELEGATION_PART_TYPES.has(part.type)) {
        continue;
      }
      const task = startedTaskOf(part);
      const words = inputText(part, "task") ?? inputText(part, "message") ?? "";
      if (task !== undefined) jobs.set(task, workerJob({ ...JOB_CALL, subject: words }));
    }
  }
  return jobs;
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

/** A turn's state as its journal says it: running until it closed, ended without answering where its record says how it ended (stopped, failed, or past its bound), and done otherwise. */
function turnStateOf(message: CodingAgentMessage): TaskWorkState {
  if (message.ending !== undefined) return TASK_WORK_STATE.FAILED;
  return message.finishedAt === undefined ? TASK_WORK_STATE.RUNNING : TASK_WORK_STATE.DONE;
}

/** One turn's journal as the tab draws it: its parts, each worker's call standing where that worker does, and the workers beside it. */
function rowOf(
  message: CodingAgentMessage & { readonly turnId: string },
  standings: ReadonlyMap<string, CodingAgentSubagentStanding>,
  titles: ReadonlyMap<string, string>,
  callLive: boolean,
): WorkTurnRow {
  const state = turnStateOf(message);
  const moving = callLive && state === TASK_WORK_STATE.RUNNING;
  const left = state === TASK_WORK_STATE.RUNNING && !moving;
  const workers: WorkWorkerBlock[] = [];
  const parts = settledJournal(message.parts, moving).map((part) => {
    if (!isRecord(part) || !isWireString(part.toolCallId) || !isWireString(part.type)) return part;
    if (!DELEGATION_PART_TYPES.has(part.type)) return part;
    const { toolCallId } = part;
    const standing = standings.get(toolCallId);
    const worker = workerOfPart(
      { ...part, toolCallId },
      standing,
      titles.get(toolCallId),
      moving,
      callLive,
    );
    workers.push(worker);
    return workerCallPart(part, worker);
  });
  const record = recordOf(message);
  return {
    key: message.turnId,
    startedAt: message.startedAt ?? 0,
    ...(message.finishedAt === undefined ? undefined : { endedAt: message.finishedAt }),
    state: left ? TASK_WORK_STATE.FAILED : state,
    moving,
    earlierOmitted: message.earlierOmitted ?? false,
    message: {
      id: message.id,
      role: message.role,
      // SAFETY: every part is the wire's stored part or one built from it, a JSON object either way.
      parts: parts as CodingAgentMessage["parts"],
      ...(message.startedAt === undefined ? undefined : { startedAt: message.startedAt }),
      ...(state === TASK_WORK_STATE.RUNNING || message.finishedAt === undefined
        ? undefined
        : { finishedAt: message.finishedAt }),
      ...record,
    },
    record,
    workers,
    asked: message.asked ?? [],
    askedAt: message.askedAt ?? [],
    spoken: message.origin === TURN_ORIGIN.SPOKEN,
  };
}

/**
 * The open plan's turns as the tab draws them, oldest first, each one of
 * Luke's messages. A turn moves only while the call it ran on stands: a
 * call that ended leaves its last turn as it was last told, with nothing on
 * it still turning, and drawn as stopped. A worker moves while the call
 * stands whether or not its turn still does, because a worker in the
 * background outlives the turn that started it.
 */
export function workRowsOf(
  conversation: TaskConversation,
  callLive: boolean,
): readonly WorkTurnRow[] {
  const standings = new Map(
    (conversation?.subagents ?? []).map((standing) => [standing.callId, standing]),
  );
  const titles = new Map(
    (conversation?.subagentTitles ?? []).map((each) => [each.callId, each.title]),
  );
  return (conversation?.messages ?? []).flatMap((message) => {
    const { turnId } = message;
    return turnId === undefined ? [] : [rowOf({ ...message, turnId }, standings, titles, callLive)];
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
