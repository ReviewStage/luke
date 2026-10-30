import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { countWords, IRREVERSIBLE_WORDS, TERM } from "@luke/features/words";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  type SelectionAct,
  selectionMenu,
  useConfirmDialog,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import {
  placeAllWrites,
  restoreWrites,
  sectionEntries,
  unplaceAllWrites,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { createContext, useId, useRef, useState } from "react";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { confirmFailure } from "../failure-report.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { undoToast, useToast } from "../toast.js";
import { sectionGlyph } from "./section-icon-picker.js";
import { newSectionAction, type SectionDialogs, useSectionDialogs } from "./sidebar-sections.js";
import { sharedStatus, statusSubmenu } from "./standing-submenus.js";

/**
 * tasks-selection.tsx -- the tasks chosen together on a page of them, the Tasks page's List and Board and the sidebar alike, and what the selection bar and a chosen row's menu do to them all.
 *
 * Each page keeps its own selection (`useTasksSelection`): which tasks are
 * chosen, only those it still draws, so a task the filter, a fold, or the
 * service took away is never acted on and is not chosen again once back;
 * and the acts the bar offers on them all, as a task row's menu offers them
 * for one: Status and Move to section, each answered by one toast whose Undo
 * puts every task back where it stood, and Permanently delete, which asks
 * first, naming how many. A row chosen
 * among several offers those same acts from its ⋯, a right-click, and the
 * menu key, under how many it acts on (`chosenRowMenu`), as a Mac's list
 * does; one chosen alone keeps its own menu. The sidebar, whose rows stand
 * deep under its groups and sections, hands each row its selection through
 * `ChosenTasksContext` rather than through every group between.
 */

/** What the selection bar's Move to section says beyond the sections. */
const SELECTION_ACT = {
  NO_SECTION: "Remove from section",
} as const;

/** What a delete of every task chosen answers once the service deleted them all. */
const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

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
 * What the selection bar offers the tasks chosen, as a task row's menu offers
 * them for one: Status, each status by its mark, the one they all stand at
 * checked; Move to section, each of the workspace's sections by its glyph,
 * New section to make one holding them, and out of every section; and
 * Permanently delete, which asks first. Each acts on them all at once, then
 * lets the selection go.
 */
function selectionActs(
  tasks: TasksControl,
  latest: () => TasksControl,
  taskIds: readonly string[],
  toast: (notice: ReturnType<typeof undoToast>) => void,
  doors: {
    onActed: () => void;
    askNew: SectionDialogs["askNew"];
    askDelete: () => void;
  },
): SelectionAct[] {
  const { onActed } = doors;
  const acted = (act: () => void) => () => {
    act();
    onActed();
  };
  const chosen = tasks.tasks.filter((task) => taskIds.includes(task.id));
  const status = statusSubmenu(tasks, taskIds, sharedStatus(chosen), onActed);
  const workspaceId = tasks.workspace?.id;
  const sections =
    workspaceId === undefined ? [] : workspaceSections(tasks.taskSections, workspaceId);
  const move = (sectionId: string | null) =>
    acted(() => moveToSection(tasks, latest, taskIds, sectionId, toast));
  const members = taskIds.map((id) => ({ agent: false, id }));
  const put = (sectionId: string) =>
    placeAllWrites(latest().taskSections, members, sectionId, Date.now());
  const sectionMenu = (workspace: string) => [
    [
      ...sections.map((section) => ({
        label: section.title,
        icon: sectionGlyph(section.icon) ?? <GLYPH.SECTION />,
        onSelect: move(section.id),
      })),
      newSectionAction(acted(() => doors.askNew(workspace, put))),
    ],
    ...(sections.length === 0 ? [] : [[{ label: SELECTION_ACT.NO_SECTION, onSelect: move(null) }]]),
  ];
  return [
    {
      label: status.label,
      ...(status.icon === undefined ? {} : { icon: status.icon }),
      menu: [status.items],
    },
    ...(workspaceId === undefined
      ? []
      : [{ ...commandHead(PANEL_COMMAND.MOVE_TO_SECTION), menu: sectionMenu(workspaceId) }]),
    { ...commandHead(PANEL_COMMAND.DELETE_TASK), danger: true, onAct: doors.askDelete },
  ];
}

/**
 * The question Permanently delete asks of the tasks chosen, naming how many.
 * Each goes with its board and transcript, which nothing in the app brings
 * back.
 */
function deleteChosenQuestion(count: number): DialogQuestion {
  const one = count === 1;
  const named = countWords(count, TERM.TASK);
  return {
    title: `Permanently delete ${named}?`,
    body: `${one ? "The task and its board and transcript" : `The ${named} and their boards and transcripts`} will be deleted. ${IRREVERSIBLE_WORDS}`,
    verb: "Permanently delete",
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
  };
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
  /** The questions its acts ask, Permanently delete and New section, which the page draws beside the bar. */
  readonly dialog: React.JSX.Element;
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
  const sections = useSectionDialogs(tasks, tasks.shown);
  // The tasks Permanently delete was asked of, held as it asks, so a selection changed meanwhile deletes none it never named.
  const [doomed, setDoomed] = useState<readonly string[]>([]);
  // Note that a refusal leaves only the tasks refused asked of, so Retry sends none already deleted.
  const deletion = useConfirmDialog(
    { subject: doomed.length > 0, surfaceOpen: tasks.shown },
    async () => {
      const answers = await Promise.all(doomed.map((id) => latest.current.onDeleteTask(id)));
      const refused = doomed.filter(
        (_, at) => answers[at]?.status !== ACTION_RESULT_STATUS.ACCEPTED,
      );
      if (refused.length === 0) {
        onClear();
        return ACCEPTED;
      }
      setDoomed(refused);
      // Note that the tasks deleted leave the selection now, rather than once the list stops drawing them.
      setChosen(
        (held) => new Set([...held].filter((id) => refused.includes(id) || !doomed.includes(id))),
      );
      return answers.find((answer) => answer.status !== ACTION_RESULT_STATUS.ACCEPTED) ?? ACCEPTED;
    },
    confirmFailure(FAILURE_SURFACE.TASK_DELETE),
  );
  const acts = selectionActs(tasks, () => latest.current, [...selected], toast, {
    onActed: onClear,
    askNew: sections.askNew,
    askDelete: () => {
      setDoomed([...selected]);
      deletion.ask();
    },
  });
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
    dialog: (
      <>
        <ConfirmDialog
          open
          confirm={deletion}
          question={deleteChosenQuestion(doomed.length)}
          restoreTo={nextRowOrHead}
        />
        {sections.dialog}
      </>
    ),
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
