import type {
  SpokenAskRow,
  StoredMessageRecord,
  StoredTurnRecord,
} from "@luke/database/models/message-reads";
import { LOOK_AT_BOARD_TOOL_NAME } from "@luke/features/board-vocabulary";
import { TURN_ENDING, type TurnRecord } from "@luke/features/coding-agent-wire";
import { SHOW_PAGE_TOOL_NAME } from "@luke/features/page-wire";
import {
  TASK_WORK_BOUNDS,
  TASK_WORK_STATE,
  type TaskWorkState,
  type TaskWorkTurn,
  type TaskWorkWorker,
} from "@luke/features/tasks-view";
import { isRecord, isWireString, type WireRecord, type WireValue } from "@luke/wire";
import { Schema } from "effect";
import {
  BRAIN_DELEGATE_TOOL,
  BRAIN_DELEGATION_TOOLS,
  EVE_DELEGATION_INPUT,
  EVE_DELEGATION_TOOL,
} from "../agents/brain-host/brain.js";
import { turnRecordOf } from "../agents/turn-record.js";
import {
  isStoredToolPart,
  type StoredToolPart,
  type StoredUIMessage,
  storedToolName,
  TOOL_PART_STATE,
  TURN_STATUS,
  UI_PART_TYPE,
} from "../core.js";

/**
 * task-work.ts -- one brain turn as the Work tab draws it, read from the turn's row and its journal.
 *
 * The journal is the AI SDK message the relay writes as eve runs the turn:
 * a step marker per model step, the model's words, its reasoning, and each
 * tool call with its input and, once it answered, its output. The tab reads
 * it as the agent tab reads a coding agent's, so it travels as it was
 * stored: the step markers left out, the newest parts kept, and every
 * string cut to the wire's bound so a turn that read a large file still
 * travels small. Beside it stands each worker the turn started, with where
 * it stands and its own session, which the journal alone cannot say.
 *
 * Note that the output does travel. A repository command's output is text
 * the service read in the task's repository sandbox for the developer who
 * owns the task, and a page or search is the public web's; the frame hands
 * it to that developer's own Mac and nowhere else.
 */

/** The most of a subagent's turns one read of its session takes, the newest: a worker's task is a turn, and each follow-up it was handed another. */
export const SUBAGENT_JOURNALS = 10;

const isWorkerInput = Schema.is(EVE_DELEGATION_INPUT[EVE_DELEGATION_TOOL.WORKER]);
const isDelegateInput = Schema.is(BRAIN_DELEGATE_TOOL.storedInputSchema);
const isText = Schema.is(Schema.String);

/** What a worker call carries, in one shape: the message the worker was handed, and the task a call sent more to. */
type WorkerInput = { readonly message: string; readonly taskId?: string | null };

/**
 * A worker call's input in that shape, whichever name the call was made
 * under: eve's own `worker` carries it as it is, and the brain's
 * `delegate` names the message its task.
 */
function workerInputOf(input: StoredToolPart["input"]): WorkerInput | undefined {
  if (isWorkerInput(input)) return input;
  if (!isDelegateInput(input)) return undefined;
  return {
    message: input.task,
    ...(input.taskId === undefined ? undefined : { taskId: input.taskId }),
  };
}

/** The text cut to the bound, marked where it was cut. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * A call's state as the tab says it. Note that a call the turn ended
 * without answering is never called failed, because it may have run: the
 * writer settles it with an unknown outcome that says so, shown as its
 * output, and a look between the end and that write sees it done already.
 */
function callStateOf(part: StoredToolPart, turnState: TaskWorkState): TaskWorkState {
  if (part.state === TOOL_PART_STATE.OUTPUT_ERROR) return TASK_WORK_STATE.FAILED;
  if (part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE) return TASK_WORK_STATE.DONE;
  return turnState === TASK_WORK_STATE.RUNNING ? TASK_WORK_STATE.RUNNING : TASK_WORK_STATE.DONE;
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
function turnStateOf(turn: StoredTurnRecord): TaskWorkState {
  if (turn.status === TURN_STATUS.QUEUED || turn.status === TURN_STATUS.RUNNING) {
    return TASK_WORK_STATE.RUNNING;
  }
  return turn.status === TURN_STATUS.SETTLED ? TASK_WORK_STATE.DONE : TASK_WORK_STATE.FAILED;
}

/** Whether a call started a worker or sent one more work, under either name. */
function isWorkerCall(part: StoredToolPart): boolean {
  return BRAIN_DELEGATION_TOOLS.has(storedToolName(part));
}

/**
 * Where the worker of each of the journal's worker calls stands, by the
 * call: as its call stood, but one whose call answered stands as the turn
 * does until a later step shows its findings arrived (`workerAnswered`).
 * The parts are split at each step marker, so those steps can be read.
 */
function workerStatesOf(
  journal: StoredUIMessage | undefined,
  turnState: TaskWorkState,
): ReadonlyMap<string, TaskWorkState> {
  const steps: StoredUIMessage["parts"][number][][] = [[]];
  for (const part of journal?.parts ?? []) {
    if (part.type === UI_PART_TYPE.STEP_START) steps.push([]);
    else steps.at(-1)?.push(part);
  }
  const states = new Map<string, TaskWorkState>();
  steps.forEach((step, index) => {
    for (const part of step.filter(isStoredToolPart).filter(isWorkerCall)) {
      const called = callStateOf(part, turnState);
      const answered = called !== TASK_WORK_STATE.DONE || workerAnswered(steps, index);
      states.set(part.toolCallId, answered ? called : turnState);
    }
  });
  return states;
}

type ShownPart = StoredUIMessage["parts"][number];

/**
 * A `show_page` call as the tab reads it: its title and the page it
 * revises, never the page's HTML, which only the frame drawing the page
 * reads (`page-tool.ts`).
 */
function withoutPageHtml(part: ShownPart): ShownPart {
  if (!isStoredToolPart(part)) return part;
  const { input } = part;
  if (!(input instanceof Object) || !("html" in input)) return part;
  const { html: _html, ...rest } = input;
  return { ...part, input: rest };
}

function isWireArray(value: WireValue): value is readonly WireValue[] {
  return Array.isArray(value);
}

/** A value with every string in it cut to the text bound, its shape kept, so a call's input and answer still read as what they are. */
function boundedValue(value: WireValue): WireValue {
  if (isWireString(value)) return cut(value, TASK_WORK_BOUNDS.TEXT_CHARS);
  if (isWireArray(value)) return value.map(boundedValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, boundedValue(inner)]),
  );
}

/** The parts of journals a reader is shown, in the order they were written: the words, the reasoning, and the calls, the step markers left out. */
function shownParts(messages: readonly StoredUIMessage[]): ShownPart[] {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part) =>
        isStoredToolPart(part) ||
        part.type === UI_PART_TYPE.TEXT ||
        part.type === UI_PART_TYPE.REASONING,
    ),
  );
}

/** The newest parts a frame carries, and whether older ones were left out. */
function newest(parts: readonly ShownPart[]) {
  return {
    earlierOmitted: parts.length > TASK_WORK_BOUNDS.PARTS,
    parts: parts.slice(-TASK_WORK_BOUNDS.PARTS),
  };
}

/**
 * A part as the Mac is sent it: a `show_page` call without its page's HTML
 * (`withoutPageHtml`), and a board look without the image it answered with,
 * which is nothing to read; any other part as it was stored.
 */
function sentPart(part: ShownPart) {
  if (!isStoredToolPart(part)) return part;
  const name = storedToolName(part);
  if (name === SHOW_PAGE_TOOL_NAME) return withoutPageHtml(part);
  if (name !== LOOK_AT_BOARD_TOOL_NAME) return part;
  const { output: _image, ...call } = part;
  return call;
}

/** Parts as the wire carries them: what the Mac is not sent left out and every string cut to the bound. */
function wireJournal(parts: readonly ShownPart[]): WireRecord[] {
  // SAFETY: a stored part is the JSON object the writer held to the wire, and bounding a JSON object keeps it one.
  return parts.map((part) => boundedValue(sentPart(part) as WireValue) as WireRecord);
}

/** Journals as the agent tab reads them, the newest of their parts kept, and whether older parts were left out. */
function journalOf(messages: readonly StoredUIMessage[]) {
  const { earlierOmitted, parts } = newest(shownParts(messages));
  return { earlierOmitted, journal: wireJournal(parts) };
}

/**
 * eve's receipt on the call that started a task, which names the task. Note
 * that the receipt is the one place a journal keeps a task's id, because
 * the relay records a call and its answer, not eve's task events.
 */
const STARTED_TASK = /^Started task (\S+)\. /u;

/** The brain's worker calls in the journals. */
function workerCallsIn(journals: readonly (StoredUIMessage | undefined)[]): StoredToolPart[] {
  return journals.flatMap((journal) =>
    (journal?.parts ?? []).filter(isStoredToolPart).filter(isWorkerCall),
  );
}

/** The task a worker call sent more work to, which its input names; nothing for a call that started one. */
function sentTaskOf(part: StoredToolPart): string | undefined {
  const { input } = part;
  return workerInputOf(input)?.taskId ?? undefined;
}

/** The task a worker call started, read off its receipt; nothing before it answered or where it started none. */
function startedTaskOf(part: StoredToolPart): string | undefined {
  if (part.state !== TOOL_PART_STATE.OUTPUT_AVAILABLE || !isText(part.output)) {
    return undefined;
  }
  return STARTED_TASK.exec(part.output)?.[1];
}

/** The subagent task a worker call started or sent work to, so a stop of it names its worker; nothing for a start that has not answered, or an id past the wire's bound. */
function taskOf(part: StoredToolPart): string | undefined {
  const task = sentTaskOf(part) ?? startedTaskOf(part);
  return task === undefined || task.length > TASK_WORK_BOUNDS.NAME_CHARS ? undefined : task;
}

/**
 * The worker calls of a journal that send work to a task the journal did not
 * start, whose start only the conversation's other journals hold: a worker
 * redirected in a later turn than the one that started it.
 */
export function callsSendingToEarlierTasks(journal: StoredUIMessage | undefined): string[] {
  const calls = workerCallsIn([journal]);
  const started = new Set(calls.map(startedTaskOf));
  return calls
    .filter((part) => {
      const sent = sentTaskOf(part);
      return sent !== undefined && !started.has(sent);
    })
    .map((part) => part.toolCallId);
}

/**
 * The brain's `worker` calls in a journal, each with the call whose
 * child conversation records its subagent's session. A call that started a
 * task reads its own. A call that sent more work to a task already started
 * reads the starting call's, because eve hands that work to the task's
 * standing session, whose turns are all recorded under the call that opened
 * it; the start is looked for in the journal, then in `earlier`, the
 * conversation's other journals, and a start found in neither leaves the
 * call its own.
 */
export function workerSessionCallsOf(
  journal: StoredUIMessage | undefined,
  earlier: readonly StoredUIMessage[] = [],
): ReadonlyMap<string, string> {
  const startedBy = new Map<string, string>();
  for (const part of workerCallsIn([...earlier, journal])) {
    const started = startedTaskOf(part);
    if (started !== undefined) startedBy.set(started, part.toolCallId);
  }
  return new Map(
    workerCallsIn([journal]).map((part) => {
      const sent = sentTaskOf(part);
      const starter = sent === undefined ? undefined : startedBy.get(sent);
      return [part.toolCallId, starter ?? part.toolCallId];
    }),
  );
}

/** One of a subagent's turn journals as its session is read: the message, when it opened, and when it closed. */
export type SubagentJournal = Pick<
  StoredMessageRecord,
  "message" | "createdAt" | "finishedAt" | "turnId"
>;

/**
 * When a subagent's newest task began and ended, read off that task's
 * journal: opened as the task began writing, and closed as it answered or
 * ended; nothing before it opened, and no end while it is still written.
 */
function sessionSpanOf(journals: readonly SubagentJournal[]) {
  const task = journals.at(-1);
  if (task === undefined) return undefined;
  return {
    startedAt: task.createdAt.getTime(),
    ...(task.finishedAt === undefined ? undefined : { endedAt: task.finishedAt.getTime() }),
  };
}

/**
 * Where a worker stands as its own session reads, rather than as the call
 * that started it does, since that call answers the moment the worker is
 * under way: running while its newest task is still written, failed where
 * that task failed or ran past its bound, and done once it answered or
 * ended any other way, however the turn that started it ended. A worker
 * whose session has written nothing yet stands as its call reads off the
 * turn's steps, a call that failed included.
 */
function workerStateOf(
  call: TaskWorkState,
  journals: readonly SubagentJournal[],
  record: TurnRecord | undefined,
): TaskWorkState {
  const task = journals.at(-1);
  if (task === undefined) return call;
  if (record?.ending === TURN_ENDING.FAILED || record?.ending === TURN_ENDING.ABANDONED) {
    return TASK_WORK_STATE.FAILED;
  }
  const ended = task.finishedAt !== undefined || record?.ending !== undefined;
  return ended ? TASK_WORK_STATE.DONE : TASK_WORK_STATE.RUNNING;
}

/** The spoken lines a turn took as its ask, as the wire holds them: the newest it carries, each id within its bound, and where each began where its row says; nothing where none stands. */
function askedOf(asked: readonly SpokenAskRow[]): Pick<TaskWorkTurn, "asked" | "askedAt"> {
  const rows = asked
    .filter((row) => row.clientId.length <= TASK_WORK_BOUNDS.LINE_ID_CHARS)
    .slice(-TASK_WORK_BOUNDS.ASKED_LINES);
  if (rows.length === 0) return {};
  const askedAt = rows.flatMap(({ voiceSessionId, fromMs }) =>
    voiceSessionId === null ||
    fromMs === null ||
    voiceSessionId.length > TASK_WORK_BOUNDS.LINE_ID_CHARS
      ? []
      : [{ voiceSessionId, fromMs }],
  );
  return {
    asked: rows.map((row) => row.clientId),
    ...(askedAt.length === 0 ? undefined : { askedAt }),
  };
}

/**
 * One brain turn's work, from its row and its journal (absent before the
 * turn wrote any): its state, when it started and, once it ended, when, and
 * the newest of its words, reasoning, and calls as the journal holds them.
 * Beside them stands each worker the newest of its calls started or sent
 * work to: the message it was handed, the task eve runs it as, where it
 * stands as its own session reads (`workerStateOf`, or `workerStatesOf`
 * before that session wrote anything), and its own session, read from the
 * journals of its child conversation (`subagents`, by the call's id), with
 * when its newest task began and ended, its title where one landed on that
 * child (`titles`, by the call's id), and what its newest task ran on and
 * spent as its turn row recorded them (`records`, by the call's id,
 * `tasks/child-models.ts`). The turn carries what it ran on and spent too,
 * as its own row recorded them, and the developer's spoken lines it took as
 * its ask (`asked`, by the ids the voice's ledger minted, and `askedAt`, by
 * where on its call each began), the newest the wire carries, where it took
 * any.
 */
export function taskWorkOf(
  turn: StoredTurnRecord,
  journal: StoredUIMessage | undefined,
  subagents: ReadonlyMap<string, readonly SubagentJournal[]> = new Map(),
  titles: ReadonlyMap<string, string> = new Map(),
  records: ReadonlyMap<string, TurnRecord> = new Map(),
  asked: readonly SpokenAskRow[] = [],
): TaskWorkTurn {
  const turnState = turnStateOf(turn);
  const ended = turnState === TASK_WORK_STATE.RUNNING ? null : turn.settledAt;
  const shown = newest(shownParts(journal === undefined ? [] : [journal]));
  const states = workerStatesOf(journal, turnState);
  const workers: TaskWorkWorker[] = shown.parts
    .filter(isStoredToolPart)
    .filter(isWorkerCall)
    .map((part) => {
      const journals = subagents.get(part.toolCallId) ?? [];
      const taskId = taskOf(part);
      const title = titles.get(part.toolCallId);
      return {
        callId: part.toolCallId,
        ...(taskId === undefined ? undefined : { taskId }),
        task: cut(workerInputOf(part.input)?.message ?? "", TASK_WORK_BOUNDS.TEXT_CHARS),
        state: workerStateOf(
          states.get(part.toolCallId) ?? turnState,
          journals,
          records.get(part.toolCallId),
        ),
        ...journalOf(journals.map((each) => each.message)),
        ...sessionSpanOf(journals),
        ...(title === undefined ? undefined : { title }),
        ...records.get(part.toolCallId),
      };
    });
  return {
    turnId: turn.id,
    startedAt: (turn.startedAt ?? turn.queuedAt).getTime(),
    ...(ended === null ? undefined : { endedAt: ended.getTime() }),
    state: turnState,
    earlierOmitted: shown.earlierOmitted,
    journal: wireJournal(shown.parts),
    workers,
    ...askedOf(asked),
    ...turnRecordOf(turn),
  };
}
