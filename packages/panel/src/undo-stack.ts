/**
 * undo-stack.ts -- ⌘Z and ⇧⌘Z for the reader's row writes in this window: the entries each takes back and puts back, run one at a time, and the row entries whose fields before are read off the rows the window shows.
 *
 * An entry is one press's write: what it did, in a toast's words, and how
 * to take it back and put it back, each run answering whether it applied.
 * ⌘Z runs the newest entry waiting to be taken back and, where it applied,
 * keeps it for ⇧⌘Z, which mirrors it; a new entry leaves nothing to put
 * back, since what it would put back has been replaced. A toast's Undo runs
 * its own entry through the same lists, so a write is never taken back
 * twice, once by the toast and once by the key. Every run waits for the one
 * before it, so two quick presses never send their writes out of order.
 * The lists are this window's alone, on its own registry, and go when the
 * account signed in changes, since a write is its presser's own.
 *
 * A row entry (`pressRows`) is built from a declaration of its write's kind
 * (`ROW_WRITE`): the fields the act sets, read off the rows its caller
 * draws, and the act that sets them, so no caller builds an inverse of its
 * own. Its fields before are read as the press is made, before the act is
 * sent, so they are what the reader saw: the window's rows are the sync
 * engine's, every write still standing drawn over them at once
 * (`@repo/sync`), so an earlier write still in flight is read too. Note
 * that each row is taken back only while it still holds what the act set,
 * because a row changed since, here, on another Mac, or by a teammate, was
 * chosen anew, and an undo must not take that choice back.
 */

import { useAtomValue } from "@effect/atom-react";
import type { AgentAgentAnswer } from "@repo/features/agent-view";
import type { AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE, type FailureSurface } from "@repo/features/shown-failure";
import type { TaskPriority, TaskStatus, TaskSummary } from "@repo/features/task-wire";
import type { TasksView } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import * as Atom from "effect/reactivity/Atom";
import { type ActHandle, askKept, firstRefusal, KEPT, type Kept, notKept } from "./act.js";
import { priorityOf, statusOf } from "./desktop/task-row-parts.js";
import type { ShownFailure } from "./failure-report.js";
import { rendererRegistry } from "./renderer-runtime.js";
import { showToast, TOAST_HOLD } from "./toast.js";

/** The most entries each list keeps; an older one leaves as a newer one comes. */
const MAX_ENTRIES = 50;

/** What a run of an entry came to. */
export const UNDO_RAN = {
  /** The write was sent and the service kept it. */
  APPLIED: "applied",
  /** No row still held what the entry set, so nothing was sent. */
  CHANGED: "changed",
  /** The service refused the write. */
  REFUSED: "refused",
} as const;

export type UndoRan = (typeof UNDO_RAN)[keyof typeof UNDO_RAN];

/** A run's answer: whether it applied, and the failure where the service refused it. */
type UndoRun =
  | { readonly ran: typeof UNDO_RAN.APPLIED | typeof UNDO_RAN.CHANGED }
  | { readonly ran: typeof UNDO_RAN.REFUSED; readonly failure: ShownFailure };

/** One press's write: what it did, in a toast's words, and how to take it back and put it back. */
interface UndoEntry {
  readonly words: string;
  readonly undo: () => Promise<UndoRun>;
  readonly redo: () => Promise<UndoRun>;
}

/** The entries waiting on each key, oldest first. */
interface UndoLine {
  /** What ⌘Z takes back. */
  readonly undo: readonly UndoEntry[];
  /** What ⇧⌘Z puts back. */
  readonly redo: readonly UndoEntry[];
}

/** Which way a run goes, named as the list it runs from and the entry's run it calls. */
const UNDO_WAY = {
  UNDO: "undo",
  REDO: "redo",
} as const satisfies Record<string, keyof UndoLine & keyof UndoEntry>;

type UndoWay = (typeof UNDO_WAY)[keyof typeof UNDO_WAY];

/** The way a run that applied leaves its entry to go next. */
const BACK_WAY = {
  [UNDO_WAY.UNDO]: UNDO_WAY.REDO,
  [UNDO_WAY.REDO]: UNDO_WAY.UNDO,
} as const satisfies Record<UndoWay, UndoWay>;

/** What a toast says once a key's run applied, before the entry's own words. */
const DONE_WORDS = {
  [UNDO_WAY.UNDO]: "Undone",
  [UNDO_WAY.REDO]: "Redone",
} as const satisfies Record<UndoWay, string>;

/** What a toast says where a run found no row still holding what it would change. */
const CHANGED_WORDS = {
  [UNDO_WAY.UNDO]: "Not undone, as it has changed since.",
  [UNDO_WAY.REDO]: "Not redone, as it has changed since.",
} as const satisfies Record<UndoWay, string>;

/** What a toast says where the service refused a run's write. */
const REFUSED_WORDS = {
  [UNDO_WAY.UNDO]: "The change could not be undone. Try again.",
  [UNDO_WAY.REDO]: "The change could not be redone. Try again.",
} as const satisfies Record<UndoWay, string>;

const EMPTY_LINE: UndoLine = { undo: [], redo: [] };

/** This window's lists, kept alive as its toasts are, since a press's entry outlives the menu that pushed it. */
const undoLineAtom = Atom.keepAlive(Atom.make<UndoLine>(EMPTY_LINE));

/** The run every next run waits for: the newest asked. */
let turn: Promise<unknown> = Promise.resolve();

/** How many times the lists were emptied, so a run that settles after its account left keeps nothing. */
let generation = 0;

/** The lists as they stand. */
function lineNow(): UndoLine {
  return rendererRegistry.get(undoLineAtom);
}

/** `entry` laid on top of `entries`, the oldest leaving past the bound. */
function stacked(entries: readonly UndoEntry[], entry: UndoEntry): readonly UndoEntry[] {
  return [...entries, entry].slice(-MAX_ENTRIES);
}

/** Says what a run came to: a refusal and a row changed since, always; a key's run that applied names its entry, and one from its own toast says nothing more. */
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

/**
 * Takes `entry` off the list `way` runs from and runs it once every run
 * asked before it has settled, keeping it for the other way where it
 * applied and dropping it where it did not. Answers what it came to, or
 * nothing where that list no longer held it: a toast's Undo for an entry a
 * key already took back.
 */
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

/** The newest entry waiting on `way`'s list, run; nothing where none waits. */
function ranNewest(way: UndoWay): Promise<UndoRan | undefined> {
  const newest = lineNow()[way].at(-1);
  return newest === undefined ? Promise.resolve(undefined) : ran(newest, way, true);
}

/** Keeps `entry` as the newest for ⌘Z, leaving nothing for ⇧⌘Z, and answers its toast's Undo, which runs it through the lists. */
function undoable(entry: UndoEntry): () => void {
  rendererRegistry.set(undoLineAtom, { undo: stacked(lineNow().undo, entry), redo: [] });
  return () => void ran(entry, UNDO_WAY.UNDO, false);
}

/** ⌘Z: takes back the newest entry, answering what it came to, or nothing where none waits. */
export function undoLast(): Promise<UndoRan | undefined> {
  return ranNewest(UNDO_WAY.UNDO);
}

/** ⇧⌘Z: puts back the entry taken back last, answering what it came to, or nothing where none waits. */
export function redoLast(): Promise<UndoRan | undefined> {
  return ranNewest(UNDO_WAY.REDO);
}

/** Which keys have an entry waiting on them. */
export interface UndoWaits {
  readonly undoes: boolean;
  readonly redoes: boolean;
}

/** Which keys have an entry waiting, for the window to offer their commands by. */
export function useUndoWaits(): UndoWaits {
  const line = useAtomValue(undoLineAtom);
  return { undoes: line.undo.length > 0, redoes: line.redo.length > 0 };
}

/** Both lists emptied, as the account signed in changes, so no write is taken back under another account. */
export function forgetUndo(): void {
  generation += 1;
  rendererRegistry.set(undoLineAtom, EMPTY_LINE);
}

/**
 * A kind of row write, as an entry takes it back and puts it back: the
 * fields it sets as the rows a caller draws (`Rows`) show them on one row,
 * whether a row still holds some, and the act that sets them. `Fields`
 * names every field the act may set; one press sets those its `after` names.
 */
export interface RowWrite<Rows, Fields extends object> {
  /** The fields of `id`'s row as `rows` show it; none where they show no such row. */
  readonly read: (rows: Rows, id: string) => Fields | undefined;
  /** Whether `now` holds what `wanted` names, of the fields it names. */
  readonly holds: (now: Fields, wanted: Fields) => boolean;
  /** Sends `id`'s row the fields `fields` names on `act`, with the act that sets them, answering whether the service kept it. */
  readonly send: (act: ActHandle["act"], id: string, fields: Fields) => Promise<Kept>;
  /** What a refusal of it is reported as. */
  readonly surface: FailureSurface;
}

/**
 * Where a press's rows are read and its writes sent, for as long as its
 * entry waits: the rows its caller draws, as they stand at each call, which
 * are the window's own (`app:state`), and the caller's act.
 */
export interface RowDoors<Rows> {
  readonly rows: () => Rows;
  readonly act: ActHandle["act"];
}

/** One row a press writes: its id, and the fields the act sets on it, as it sets them. */
export interface RowAsked<Fields extends object> {
  readonly id: string;
  readonly after: Fields;
}

/** One row a press wrote: its id, and the fields the act set, as they stood before and as it set them. */
interface RowChange<Fields extends object> {
  readonly id: string;
  readonly before: Fields;
  readonly after: Fields;
}

/** A press's rows as they stood before its act was drawn, for an entry to keep once the service answers. */
export interface PressedRows {
  /**
   * Keeps the rows the service kept, those `kept` says it kept or every one
   * where it says nothing, as the newest entry for ⌘Z, called `words`. Keep
   * it once the act answers kept, never at the press, so a write the
   * service refused is never offered back. Answers the Undo its toast hands
   * `undoToast`, which runs the entry through the lists, or none where no
   * row is left to change.
   */
  readonly keep: (words: string, kept?: (id: string) => boolean) => (() => void) | undefined;
}

/** Of `whole`, the fields `like` names. */
function fieldsLike<Fields extends object>(whole: Fields, like: Fields): Fields {
  // SAFETY: each key is one of `like`'s own, so the fields kept are of `Fields`, as `like` is.
  return Object.fromEntries(
    Object.keys(like).map((key) => [key, Reflect.get(whole, key)]),
  ) as Fields;
}

/** Whether `now` holds each field `wanted` names, by value. */
function holdsEach<Fields extends object>(now: Fields, wanted: Fields): boolean {
  return Object.entries(wanted).every(([key, value]) => Object.is(Reflect.get(now, key), value));
}

/**
 * Each row of `changes` still holding what `from` names sent what `to`
 * names, as one run: it applied where every row sent was kept, and changed
 * where no row still held it.
 */
function rowsRun<Rows, Fields extends object>(
  write: RowWrite<Rows, Fields>,
  doors: RowDoors<Rows>,
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
  return Promise.all(due.map((change) => write.send(doors.act, change.id, to(change)))).then(
    (answers) =>
      answers.every((answer) => answer.kept)
        ? { ran: UNDO_RAN.APPLIED }
        : {
            ran: UNDO_RAN.REFUSED,
            failure: { surface: write.surface, cause: firstRefusal(answers) },
          },
  );
}

/**
 * The rows of a press as `doors` show them before its act is drawn, each
 * with the fields the act sets as they stand now. Read it as the press is
 * made, before the act is sent, so what it holds before is what the reader
 * saw. A row the doors show none of is left out, since there is nothing to
 * put back on it. Each row is taken back to its fields before, and put back
 * to its fields after, only while it still holds the other.
 */
export function pressRows<Rows, Fields extends object>(
  write: RowWrite<Rows, Fields>,
  doors: RowDoors<Rows>,
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

/** A task's row as the tasks drawn show it: the list's, else the open document's. */
function taskRow(tasks: TasksView, taskId: string): TaskSummary | undefined {
  const listed = tasks.tasks.find((task) => task.id === taskId);
  if (listed !== undefined) return listed;
  const open = tasks.document.task;
  return open?.id === taskId ? open : undefined;
}

/** A pin as an entry reads and sends it: whether it stands, and where it was dragged, none while it stands by when it was pinned. */
interface PinFields {
  readonly pinned: boolean;
  readonly position: string | null;
}

/** Where a task stands, as an entry reads and sends it: a member assigned by id and the name the window knows them by. */
interface StandingFields {
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly assignee?: NonNullable<TaskSummary["assignee"]> | null;
}

/** An agent's answer to a write as whether it was kept, with what refused it where it was not. */
function agentKept(asked: Promise<AgentAgentAnswer>): Promise<Kept> {
  return asked.then((answer) => ("agent" in answer ? KEPT : notKept(answer)), notKept);
}

/** An agent's pin as the tasks drawn show it: on its own row for one with no plan, else among its plan's pins; none where they show no such agent. */
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

/** The pin a write sends: a place only with a pin that was dragged to one. */
function pinSent({ pinned, position }: PinFields): { pinned: boolean; position?: string } {
  return pinned && position !== null ? { pinned, position } : { pinned };
}

/**
 * The row writes an entry takes back and puts back, one for each act that
 * changes a row's fields at once and asks nothing first (`CLAUDE.md`'s
 * Confirms): a task's name, where it stands, and its pin, read off the
 * tasks drawn, and an agent's pin, read there too, and its archive, read
 * off the agents drawn.
 */
export const ROW_WRITE = {
  TASK_RENAME: {
    read: (tasks, taskId) => {
      const task = taskRow(tasks, taskId);
      return task === undefined ? undefined : { name: task.name };
    },
    holds: holdsEach,
    send: (act, taskId, { name }) => askKept(act(ACT_KIND.TASKS_RENAME, { taskId, name })),
    surface: FAILURE_SURFACE.TASK_RENAME,
  } satisfies RowWrite<TasksView, { readonly name: string }>,
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
    // Note that a member assigned is compared by id alone, because the name the window drew them by gives way to the service's.
    holds: ({ assignee, ...now }, { assignee: wanted, ...rest }) =>
      holdsEach(now, rest) &&
      (wanted === undefined || (assignee?.userId ?? null) === (wanted?.userId ?? null)),
    send: (act, taskId, { assignee, ...standing }) =>
      askKept(
        act(ACT_KIND.TASKS_SET_STANDING, {
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
  } satisfies RowWrite<TasksView, StandingFields>,
  TASK_PIN: {
    read: (tasks, taskId) => {
      const task = taskRow(tasks, taskId);
      if (task === undefined) return undefined;
      return { pinned: task.pinnedAt !== undefined, position: task.pinPosition ?? null };
    },
    holds: holdsEach,
    send: (act, taskId, pin) => askKept(act(ACT_KIND.TASKS_PIN, { taskId, ...pinSent(pin) })),
    surface: FAILURE_SURFACE.TASK_MARK,
  } satisfies RowWrite<TasksView, PinFields>,
  AGENT_PIN: {
    read: agentPin,
    holds: holdsEach,
    send: (act, agentId, pin) => agentKept(act(ACT_KIND.AGENTS_PIN, { agentId, ...pinSent(pin) })),
    surface: FAILURE_SURFACE.AGENT_PIN,
  } satisfies RowWrite<TasksView, PinFields>,
  AGENT_ARCHIVE: {
    read: (agents, agentId) => {
      const agent = agents.find((each) => each.id === agentId);
      return agent === undefined ? undefined : { archived: agent.archivedAt !== undefined };
    },
    holds: holdsEach,
    send: (act, agentId, { archived }) =>
      agentKept(act(ACT_KIND.AGENTS_ARCHIVE, { agentId, archived })),
    surface: FAILURE_SURFACE.AGENT_ARCHIVE,
  } satisfies RowWrite<readonly AgentSummary[], { readonly archived: boolean }>,
} as const;
