import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, IRREVERSIBLE_WORDS, TERM } from "@repo/features/words";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  type SelectionAct,
  selectionMenu,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import {
  placeAllWrites,
  sectionEntries,
  unplaceAllWrites,
  workspaceSections,
} from "@repo/ui/task-sections-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { createContext, useId, useMemo, useRef, useState } from "react";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { confirmFailure } from "../failure-report.js";
import { useSteadyDoor } from "../steady-door.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { sectionGlyph } from "./section-icon-picker.js";
import {
  movesInto,
  newSectionAction,
  type SectionDialogs,
  useSectionDialogs,
} from "./sidebar-sections.js";
import { sharedStatus, statusSubmenu } from "./standing-submenus.js";
import { useRefusalHeard } from "./use-refusal-heard.js";

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

/**
 * Moves tasks into a section, on top of it in their order, or out of every
 * section where `sectionId` is null, through the section dialogs' `move`,
 * whose one toast's Undo puts each back in the section it stood in, under
 * the rows it stood under, or in none. A task already where it is sent is
 * left as it stands.
 */
function moveToSection(
  tasks: TasksControl,
  taskIds: readonly string[],
  sectionId: string | null,
  move: SectionDialogs["move"],
): void {
  const before = tasks.taskSections;
  const entries = sectionEntries(before);
  const moving = taskIds.filter((taskId) => (entries.get(taskId)?.sectionId ?? null) !== sectionId);
  const members = moving.map((id) => ({ agent: false, id }));
  move(
    members,
    sectionId,
    sectionId === null
      ? unplaceAllWrites(members)
      : placeAllWrites(before, members, sectionId, Date.now()),
  );
}

/**
 * A selection of several tasks as a chosen row's menu reads it: how many,
 * and the bar's acts on them all, read as the menu draws. Note that it is
 * the same while the count stands, so a row held while what it is handed
 * does (`memo`) holds as the selection moves, and reads the acts newest.
 */
export interface ChosenTasks {
  readonly count: number;
  readonly acts: () => readonly SelectionAct[];
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
  doors: {
    onActed: () => void;
    askNew: SectionDialogs["askNew"];
    move: SectionDialogs["move"];
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
    acted(() => moveToSection(tasks, taskIds, sectionId, doors.move));
  const members = taskIds.map((id) => ({ agent: false, id }));
  const put = (sectionId: string) =>
    placeAllWrites(latest().taskSections, members, sectionId, Date.now());
  const sectionMenu = (workspace: string) => [
    [
      ...sections.map((section) => ({
        label: section.title,
        key: section.id,
        icon: sectionGlyph(section.icon) ?? <GLYPH.SECTION />,
        replayMasked: true,
        onSelect: move(section.id),
      })),
      newSectionAction(
        acted(() => doors.askNew(workspace, put, movesInto(taskIds.length, chosen[0]?.name))),
      ),
    ],
    ...(sections.length === 0 ? [] : [[{ label: SELECTION_ACT.NO_SECTION, onSelect: move(null) }]]),
  ];
  return [
    {
      label: status.label,
      ...(status.icon === undefined ? {} : { icon: status.icon }),
      menu: [status.items],
      replayUnmasked: true,
    },
    ...(workspaceId === undefined
      ? []
      : [
          {
            ...commandHead(PANEL_COMMAND.MOVE_TO_SECTION),
            menu: sectionMenu(workspaceId),
            replayUnmasked: true,
          },
        ]),
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
    verb: `Permanently delete ${one ? TERM.TASK.one : TERM.TASK.many}`,
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
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
  const regionId = useId();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const selected: ReadonlySet<string> = new Set([...chosen].filter((id) => drawn.has(id)));
  if (selected.size !== chosen.size) setChosen(selected);
  const onClear = () => setChosen(new Set());
  const sections = useSectionDialogs(tasks, tasks.shown);
  // The tasks Permanently delete was asked of, held as it asks, so a selection changed meanwhile deletes none it never named.
  const [doomed, setDoomed] = useState<readonly string[]>([]);
  // Note that a refusal said once the tab went away is said in a toast, since the question went with it.
  const heard = useRefusalHeard(doomed.length > 0 && tasks.shown, {
    surface: FAILURE_SURFACE.TASK_DELETE,
  });
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
      // Note that the tasks refused are chosen again, since each left the selection as the host drew it gone, and the deleted stay out.
      setChosen((held) => new Set([...[...held].filter((id) => !doomed.includes(id)), ...refused]));
      return heard(
        answers.find((answer) => answer.status !== ACTION_RESULT_STATUS.ACCEPTED) ?? ACCEPTED,
      );
    },
    confirmFailure(FAILURE_SURFACE.TASK_DELETE),
  );
  const acts = selectionActs(tasks, () => latest.current, [...selected], {
    onActed: onClear,
    askNew: sections.askNew,
    move: sections.move,
    askDelete: () => {
      setDoomed([...selected]);
      deletion.ask();
    },
  });
  const actsNow = useSteadyDoor(() => acts);
  // Note that a row is offered the selection's acts only among several chosen, as one chosen alone is the row's own menu already.
  const count = selected.size;
  const several: ChosenTasks | undefined = useMemo(
    () => (count > 1 ? { count, acts: actsNow } : undefined),
    [count, actsNow],
  );
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
    groups: selectionMenu(chosen.acts()),
    heading: countWords(chosen.count, TERM.TASK),
    replayUnmasked: true,
    shown,
  };
}

/** The selection a sidebar task row stands in, where it is one of several chosen (`TasksSelection.chosenOf`); none outside a choosing sidebar. */
export const ChosenTasksContext = createContext<(taskId: string) => ChosenTasks | undefined>(
  () => undefined,
);
