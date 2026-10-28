import { TASK_STATUS, TASK_STATUS_ORDER } from "@luke/features/task-wire";
import { countWords, TERM } from "@luke/features/words";
import { type SelectionAct, selectionMenu, TaskStatusMark } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import {
  placeAllWrites,
  restoreWrites,
  sectionEntries,
  unplaceAllWrites,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import { createContext, useId, useRef, useState } from "react";
import { TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { undoToast, useToast } from "../toast.js";
import { sectionGlyph } from "./section-icon-picker.js";

/**
 * tasks-selection.tsx -- the tasks chosen together on a page of them, the Tasks page's List and Board and the sidebar alike, and what the selection bar and a chosen row's menu do to them all.
 *
 * Each page keeps its own selection (`useTasksSelection`): which tasks are
 * chosen, only those it still draws, so a task the filter, a fold, or the
 * service took away is never acted on and is not chosen again once back;
 * and the acts the bar offers on them all, Mark done, Set status, and, while
 * the account keeps sections in the workspace, Move to section, each answered
 * by one toast whose Undo puts every task back where it stood. A row chosen
 * among several offers those same acts from its ⋯, a right-click, and the
 * menu key, under how many it acts on (`chosenRowMenu`), as a Mac's list
 * does; one chosen alone keeps its own menu. The sidebar, whose rows stand
 * deep under its groups and sections, hands each row its selection through
 * `ChosenTasksContext` rather than through every group between.
 */

/** What the selection bar's acts say. */
const SELECTION_ACT = {
  MARK_DONE: "Mark done",
  SET_STATUS: "Set status",
  MOVE_TO_SECTION: "Move to section",
  NO_SECTION: "Remove from section",
} as const;

/** What the toast says once tasks were moved into the section titled, or out of every section where there is none. */
function movedNote(count: number, title: string | null): string {
  if (title === null) {
    return count === 1
      ? "Removed from its section"
      : `${countWords(count, TERM.TASK)} removed from their sections`;
  }
  return count === 1 ? `Moved to ${title}` : `${countWords(count, TERM.TASK)} moved to ${title}`;
}

/**
 * Moves tasks into a section, on top of it in their order, or out of every
 * section where `sectionId` is null, and answers with one toast whose Undo
 * puts each back in the section it stood in, under the rows it stood under,
 * or in none. A task already where it is sent is left as it stands, and the
 * Undo leaves one moved again since where it was moved, reading the tab as
 * it stands when Undo is pressed (`latest`).
 */
function moveToSection(
  tasks: TasksControl,
  latest: () => TasksControl,
  taskIds: readonly string[],
  sectionId: string | null,
  toast: (notice: ReturnType<typeof undoToast>) => void,
): void {
  const before = tasks.taskSections;
  const entries = sectionEntries(before);
  const moving = taskIds.filter((taskId) => (entries.get(taskId)?.sectionId ?? null) !== sectionId);
  if (moving.length === 0) return;
  const members = moving.map((id) => ({ agent: false, id }));
  tasks.onWriteSections(
    sectionId === null
      ? unplaceAllWrites(members)
      : placeAllWrites(before, members, sectionId, Date.now()),
  );
  const title =
    sectionId === null
      ? null
      : (before.sections.find((section) => section.id === sectionId)?.title ?? "");
  const undo = () => {
    const now = latest();
    const writes = restoreWrites(before, now.taskSections, members, sectionId, Date.now());
    if (writes.length > 0) now.onWriteSections(writes);
  };
  toast(undoToast(movedNote(moving.length, title), undo));
}

/** A selection of several tasks as a chosen row's menu reads it: how many, and the bar's acts on them all. */
export interface ChosenTasks {
  readonly count: number;
  readonly acts: readonly SelectionAct[];
}

/**
 * What the selection bar offers the tasks chosen: Mark done; Set status,
 * each status by its mark; and, while the account keeps sections in the
 * workspace, Move to section, each by its glyph, and out of every section.
 * Each acts on them all at once, then lets the selection go.
 */
function selectionActs(
  tasks: TasksControl,
  latest: () => TasksControl,
  taskIds: readonly string[],
  toast: (notice: ReturnType<typeof undoToast>) => void,
  onActed: () => void,
): SelectionAct[] {
  const acted = (act: () => void) => () => {
    act();
    onActed();
  };
  const setStatus = SELECTION_ACT.SET_STATUS;
  const statuses = TASK_STATUS_ORDER.map((status) => ({
    label: TASK_STATUS_WORDS[status],
    icon: <TaskStatusMark status={status} />,
    onSelect: acted(() => tasks.onSettleTasks(taskIds, status)),
  }));
  const workspaceId = tasks.workspace?.id;
  const sections =
    workspaceId === undefined ? [] : workspaceSections(tasks.taskSections, workspaceId);
  const move = (sectionId: string | null) =>
    acted(() => moveToSection(tasks, latest, taskIds, sectionId, toast));
  const sectionMenu = [
    sections.map((section) => ({
      label: section.title,
      icon: sectionGlyph(section.icon) ?? <GLYPH.SECTION />,
      onSelect: move(section.id),
    })),
    [{ label: SELECTION_ACT.NO_SECTION, onSelect: move(null) }],
  ];
  return [
    {
      label: SELECTION_ACT.MARK_DONE,
      icon: <GLYPH.DONE />,
      onAct: acted(() => tasks.onSettleTasks(taskIds, TASK_STATUS.DONE)),
    },
    { label: setStatus, icon: <TaskStatusMark status={TASK_STATUS.TODO} />, menu: [statuses] },
    ...(sections.length === 0
      ? []
      : [{ label: SELECTION_ACT.MOVE_TO_SECTION, icon: <GLYPH.MOVE />, menu: sectionMenu }]),
  ];
}

/** A page's selection of its tasks, as `useTasksSelection` keeps it. */
export interface TasksSelection {
  /** The id its `SelectionRegion` and the bar that names it share. */
  readonly regionId: string;
  /** The tasks chosen, only those the page draws. */
  readonly selected: ReadonlySet<string>;
  readonly onChange: (selected: ReadonlySet<string>) => void;
  /** Chooses none. */
  readonly onClear: () => void;
  /** What the bar does to every task chosen. */
  readonly acts: readonly SelectionAct[];
  /** The selection a row of the task stands in, where it is one of several chosen; none otherwise. */
  readonly chosenOf: (taskId: string) => ChosenTasks | undefined;
}

/**
 * The tasks a page has chosen of those it draws (`drawn`), and what its bar
 * and its chosen rows do to them all. Note that a task no longer drawn leaves
 * the selection for good, so one coming back is not chosen again unasked.
 */
export function useTasksSelection(tasks: TasksControl, drawn: ReadonlySet<string>): TasksSelection {
  // The tab as it stands, which an Undo pressed or a refusal answered renders after its act reads.
  const latest = useRef(tasks);
  latest.current = tasks;
  const toast = useToast();
  const regionId = useId();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const selected: ReadonlySet<string> = new Set([...chosen].filter((id) => drawn.has(id)));
  if (selected.size !== chosen.size) setChosen(selected);
  const onClear = () => setChosen(new Set());
  const acts = selectionActs(tasks, () => latest.current, [...selected], toast, onClear);
  // Note that a row is offered the selection's acts only among several chosen, as one chosen alone is the row's own menu already.
  const several: ChosenTasks | undefined =
    selected.size > 1 ? { count: selected.size, acts } : undefined;
  return {
    regionId,
    selected,
    onChange: setChosen,
    onClear,
    acts,
    chosenOf: (taskId) => (several !== undefined && selected.has(taskId) ? several : undefined),
  };
}

/** The menu a row chosen among several opens: the bar's acts on every task chosen, under how many. */
export function chosenRowMenu(thing: string, chosen: ChosenTasks, shown: boolean) {
  return {
    thing,
    groups: selectionMenu(chosen.acts),
    heading: countWords(chosen.count, TERM.TASK),
    shown,
  };
}

/** The selection a sidebar task row stands in, where it is one of several chosen (`TasksSelection.chosenOf`); none outside a choosing sidebar. */
export const ChosenTasksContext = createContext<(taskId: string) => ChosenTasks | undefined>(
  () => undefined,
);
