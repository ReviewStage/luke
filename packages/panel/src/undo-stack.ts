import { useAtomValue } from "@effect/atom-react";
import type { AgentAgentAnswer } from "@repo/features/agent-view";
import type { AgentSummary } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { FAILURE_SURFACE, type FailureSurface } from "@repo/features/shown-failure";
import type { TaskPriority, TaskStatus, TaskSummary } from "@repo/features/task-wire";
import type { TasksView } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActKind } from "@repo/host/contract";
import { STATUS_TONE } from "@repo/ui";
import * as Atom from "effect/reactivity/Atom";
import {
  type ActResult,
  type ActVariables,
  askKept,
  firstRefusal,
  KEPT,
  type Kept,
  notKept,
} from "./act.js";
import { priorityOf, statusOf } from "./desktop/task-row-parts.js";
import type { ShownFailure } from "./failure-report.js";
import { rendererRegistry } from "./renderer-runtime.js";
import { showToast, TOAST_HOLD } from "./toast.js";
import { appStateNow } from "./use-app-state.js";

const MAX_ENTRIES = 50;

export const UNDO_RAN = {
  APPLIED: "applied",
  CHANGED: "changed",
  REFUSED: "refused",
} as const;

export type UndoRan = (typeof UNDO_RAN)[keyof typeof UNDO_RAN];

type UndoRun =
  | { readonly ran: typeof UNDO_RAN.APPLIED | typeof UNDO_RAN.CHANGED }
  | { readonly ran: typeof UNDO_RAN.REFUSED; readonly failure: ShownFailure };

interface UndoEntry {
  readonly words: string;
  readonly undo: () => Promise<UndoRun>;
  readonly redo: () => Promise<UndoRun>;
}

interface UndoLine {
  readonly undo: readonly UndoEntry[];
  readonly redo: readonly UndoEntry[];
}

const UNDO_WAY = {
  UNDO: "undo",
  REDO: "redo",
} as const satisfies Record<string, keyof UndoLine & keyof UndoEntry>;

type UndoWay = (typeof UNDO_WAY)[keyof typeof UNDO_WAY];

const BACK_WAY = {
  [UNDO_WAY.UNDO]: UNDO_WAY.REDO,
  [UNDO_WAY.REDO]: UNDO_WAY.UNDO,
} as const satisfies Record<UndoWay, UndoWay>;

const DONE_WORDS = {
  [UNDO_WAY.UNDO]: "Undone",
  [UNDO_WAY.REDO]: "Redone",
} as const satisfies Record<UndoWay, string>;

const CHANGED_WORDS = {
  [UNDO_WAY.UNDO]: "Not undone, as it has changed since.",
  [UNDO_WAY.REDO]: "Not redone, as it has changed since.",
} as const satisfies Record<UndoWay, string>;

const REFUSED_WORDS = {
  [UNDO_WAY.UNDO]: "The change could not be undone. Try again.",
  [UNDO_WAY.REDO]: "The change could not be redone. Try again.",
} as const satisfies Record<UndoWay, string>;

const EMPTY_LINE: UndoLine = { undo: [], redo: [] };

const undoLineAtom = Atom.keepAlive(Atom.make<UndoLine>(EMPTY_LINE));

let turn: Promise<unknown> = Promise.resolve();

let generation = 0;

function lineNow(): UndoLine {
  return rendererRegistry.get(undoLineAtom);
}

function stacked(entries: readonly UndoEntry[], entry: UndoEntry): readonly UndoEntry[] {
  return [...entries, entry].slice(-MAX_ENTRIES);
}

function said(entry: UndoEntry, way: UndoWay, run: UndoRun, keyed: boolean): void {
  if (run.ran === UNDO_RAN.REFUSED) {
    showToast({
      words: REFUSED_WORDS[way],
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: run.failure,
    });
    return;
  }
  if (run.ran === UNDO_RAN.CHANGED) {
    showToast({ words: CHANGED_WORDS[way], tone: STATUS_TONE.ATTENTION, hold: TOAST_HOLD.DONE });
    return;
  }
  if (!keyed) return;
  showToast({
    words: `${DONE_WORDS[way]}: ${entry.words}`,
    tone: STATUS_TONE.COMPLETE,
    hold: TOAST_HOLD.DONE,
  });
}

function ran(entry: UndoEntry, way: UndoWay, keyed: boolean): Promise<UndoRan | undefined> {
  const line = lineNow();
  if (!line[way].includes(entry)) return Promise.resolve(undefined);
  rendererRegistry.set(undoLineAtom, {
    ...line,
    [way]: line[way].filter((each) => each !== entry),
  });
  const asked = generation;
  const run = turn
    .then(() => entry[way]())
    .then((answered) => {
      if (asked !== generation) return answered.ran;
      if (answered.ran === UNDO_RAN.APPLIED) {
        const back = BACK_WAY[way];
        const now = lineNow();
        rendererRegistry.set(undoLineAtom, { ...now, [back]: stacked(now[back], entry) });
      }
      said(entry, way, answered, keyed);
      return answered.ran;
    });
  turn = run.catch(() => undefined);
  return run;
}

function ranNewest(way: UndoWay): Promise<UndoRan | undefined> {
  const newest = lineNow()[way].at(-1);
  return newest === undefined ? Promise.resolve(undefined) : ran(newest, way, true);
}

function undoable(entry: UndoEntry): () => void {
  rendererRegistry.set(undoLineAtom, { undo: stacked(lineNow().undo, entry), redo: [] });
  return () => void ran(entry, UNDO_WAY.UNDO, false);
}

export function undoLast(): Promise<UndoRan | undefined> {
  return ranNewest(UNDO_WAY.UNDO);
}

export function redoLast(): Promise<UndoRan | undefined> {
  return ranNewest(UNDO_WAY.REDO);
}

export interface UndoWaits {
  readonly undoes: boolean;
  readonly redoes: boolean;
}

export function useUndoWaits(): UndoWaits {
  const line = useAtomValue(undoLineAtom);
  return { undoes: line.undo.length > 0, redoes: line.redo.length > 0 };
}

export function forgetUndo(): void {
  generation += 1;
  rendererRegistry.set(undoLineAtom, EMPTY_LINE);
}

export type RowSend<Kind extends PortActKind> = (
  variables: ActVariables<Kind>,
) => Promise<ActResult<Kind>>;

export interface RowWrite<Rows, Fields extends object, Kind extends PortActKind> {
  readonly read: (rows: Rows, id: string) => Fields | undefined;
  readonly holds: (now: Fields, wanted: Fields) => boolean;
  readonly kind: Kind;
  readonly send: (send: RowSend<Kind>, id: string, fields: Fields) => Promise<Kept>;
  readonly surface: FailureSurface;
}

export interface RowDoors<Rows, Kind extends PortActKind> {
  readonly rows: () => Rows;
  readonly send: RowSend<Kind>;
}

export interface RowAsked<Fields extends object> {
  readonly id: string;
  readonly after: Fields;
}

interface RowChange<Fields extends object> {
  readonly id: string;
  readonly before: Fields;
  readonly after: Fields;
}

export interface PressedRows {
  readonly keep: (words: string, kept?: (id: string) => boolean) => (() => void) | undefined;
}

function fieldsLike<Fields extends object>(whole: Fields, like: Fields): Fields {
  return Object.fromEntries(
    Object.keys(like).map((key) => [key, Reflect.get(whole, key)]),
  ) as Fields;
}

function holdsEach<Fields extends object>(now: Fields, wanted: Fields): boolean {
  return Object.entries(wanted).every(([key, value]) => Object.is(Reflect.get(now, key), value));
}

function rowsRun<Rows, Fields extends object, Kind extends PortActKind>(
  write: RowWrite<Rows, Fields, Kind>,
  doors: RowDoors<Rows, Kind>,
  changes: readonly RowChange<Fields>[],
  from: (change: RowChange<Fields>) => Fields,
  to: (change: RowChange<Fields>) => Fields,
): Promise<UndoRun> {
  const rows = doors.rows();
  const due = changes.filter((change) => {
    const now = write.read(rows, change.id);
    return now !== undefined && write.holds(now, from(change));
  });
  if (due.length === 0) return Promise.resolve({ ran: UNDO_RAN.CHANGED });
  return Promise.all(due.map((change) => write.send(doors.send, change.id, to(change)))).then(
    (answers) =>
      answers.every((answer) => answer.kept)
        ? { ran: UNDO_RAN.APPLIED }
        : {
            ran: UNDO_RAN.REFUSED,
            failure: { surface: write.surface, cause: firstRefusal(answers) },
          },
  );
}

export function pressRows<Rows, Fields extends object, Kind extends PortActKind>(
  write: RowWrite<Rows, Fields, Kind>,
  doors: RowDoors<Rows, Kind>,
  asked: readonly RowAsked<Fields>[],
): PressedRows {
  const rows = doors.rows();
  const changes = asked.flatMap(({ id, after }): readonly RowChange<Fields>[] => {
    const now = write.read(rows, id);
    return now === undefined ? [] : [{ id, before: fieldsLike(now, after), after }];
  });
  return {
    keep: (words, kept = () => true) => {
      const landed = changes.filter((change) => kept(change.id));
      if (landed.length === 0) return undefined;
      return undoable({
        words,
        undo: () =>
          rowsRun(
            write,
            doors,
            landed,
            (each) => each.after,
            (each) => each.before,
          ),
        redo: () =>
          rowsRun(
            write,
            doors,
            landed,
            (each) => each.before,
            (each) => each.after,
          ),
      });
    },
  };
}

function taskRow(tasks: TasksView, taskId: string): TaskSummary | undefined {
  const listed = tasks.tasks.find((task) => task.id === taskId);
  if (listed !== undefined) return listed;
  const held = appStateNow()?.[LIVE_READ.DESCRIPTION_DOCUMENT][taskId]?.rows;
  return held !== undefined && "task" in held ? held.task : undefined;
}

interface PinFields {
  readonly pinned: boolean;
  readonly position: string | null;
}

interface StandingFields {
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly assignee?: NonNullable<TaskSummary["assignee"]> | null;
}

function agentKept(asked: Promise<AgentAgentAnswer>): Promise<Kept> {
  return asked.then((answer) => ("agent" in answer ? KEPT : notKept(answer)), notKept);
}

function agentPin(tasks: TasksView, agentId: string): PinFields | undefined {
  const { tasklessAgents = [], taskAgents = [], taskAgentPins = [] } = tasks;
  const taskless = tasklessAgents.find((agent) => agent.id === agentId);
  if (taskless !== undefined) {
    return { pinned: taskless.pinnedAt !== undefined, position: taskless.pinPosition ?? null };
  }
  if (!taskAgents.some((agent) => agent.id === agentId)) return undefined;
  const pin = taskAgentPins.find((each) => each.agentId === agentId);
  return { pinned: pin !== undefined, position: pin?.pinPosition ?? null };
}

function pinSent({ pinned, position }: PinFields): { pinned: boolean; position?: string } {
  return pinned && position !== null ? { pinned, position } : { pinned };
}

export const ROW_WRITE = {
  TASK_RENAME: {
    read: (tasks, taskId) => {
      const task = taskRow(tasks, taskId);
      return task === undefined ? undefined : { name: task.name };
    },
    holds: holdsEach,
    kind: ACT_KIND.TASKS_RENAME,
    send: (send, taskId, { name }) => askKept(send({ taskId, name })),
    surface: FAILURE_SURFACE.TASK_RENAME,
  } satisfies RowWrite<TasksView, { readonly name: string }, typeof ACT_KIND.TASKS_RENAME>,
  TASK_STANDING: {
    read: (tasks, taskId) => {
      const task = taskRow(tasks, taskId);
      if (task === undefined) return undefined;
      return {
        status: statusOf(task),
        priority: priorityOf(task),
        assignee: task.assignee ?? null,
      };
    },
    holds: ({ assignee, ...now }, { assignee: wanted, ...rest }) =>
      holdsEach(now, rest) &&
      (wanted === undefined || (assignee?.userId ?? null) === (wanted?.userId ?? null)),
    kind: ACT_KIND.TASKS_SET_STANDING,
    send: (send, taskId, { assignee, ...standing }) =>
      askKept(
        send({
          taskId,
          ...standing,
          ...(assignee === undefined
            ? undefined
            : assignee === null
              ? { assigneeId: null }
              : { assigneeId: assignee.userId, assigneeName: assignee.name }),
        }),
      ),
    surface: FAILURE_SURFACE.TASK_STANDING,
  } satisfies RowWrite<TasksView, StandingFields, typeof ACT_KIND.TASKS_SET_STANDING>,
  TASK_PIN: {
    read: (tasks, taskId) => {
      const task = taskRow(tasks, taskId);
      if (task === undefined) return undefined;
      return { pinned: task.pinnedAt !== undefined, position: task.pinPosition ?? null };
    },
    holds: holdsEach,
    kind: ACT_KIND.TASKS_PIN,
    send: (send, taskId, pin) => askKept(send({ taskId, ...pinSent(pin) })),
    surface: FAILURE_SURFACE.TASK_MARK,
  } satisfies RowWrite<TasksView, PinFields, typeof ACT_KIND.TASKS_PIN>,
  AGENT_PIN: {
    read: agentPin,
    holds: holdsEach,
    kind: ACT_KIND.AGENTS_PIN,
    send: (send, agentId, pin) => agentKept(send({ agentId, ...pinSent(pin) })),
    surface: FAILURE_SURFACE.AGENT_PIN,
  } satisfies RowWrite<TasksView, PinFields, typeof ACT_KIND.AGENTS_PIN>,
  AGENT_ARCHIVE: {
    read: (agents, agentId) => {
      const agent = agents.find((each) => each.id === agentId);
      return agent === undefined ? undefined : { archived: agent.archivedAt !== undefined };
    },
    holds: holdsEach,
    kind: ACT_KIND.AGENTS_ARCHIVE,
    send: (send, agentId, { archived }) => agentKept(send({ agentId, archived })),
    surface: FAILURE_SURFACE.AGENT_ARCHIVE,
  } satisfies RowWrite<
    readonly AgentSummary[],
    { readonly archived: boolean },
    typeof ACT_KIND.AGENTS_ARCHIVE
  >,
} as const;
