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
import { useMutation } from "@tanstack/react-query";
import { type Store, useCreateStore, useSelector } from "@tanstack/react-store";
import { createContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useConfirmAct } from "../confirm-act.js";
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

const SELECTION_ACT = {
  NO_SECTION: "Remove from section",
} as const;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

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

export interface ChosenTasks {
  readonly count: number;
  readonly acts: () => readonly SelectionAct[];
}

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

export interface TasksSelection {
  readonly regionId: string;
  readonly selected: ReadonlySet<string>;
  readonly onChange: (selected: ReadonlySet<string>) => void;
  readonly onClear: () => void;
  readonly acts: readonly SelectionAct[];
  readonly chosenOf: (taskId: string) => ChosenTasks | undefined;
  readonly dialog: React.JSX.Element;
}

export type ChosenTasksStore = Store<ReadonlySet<string>>;

export function useTasksSelection(
  tasks: TasksControl,
  drawn: ReadonlySet<string>,
  held?: ChosenTasksStore,
): TasksSelection {
  const latest = useRef(tasks);
  latest.current = tasks;
  const regionId = useId();
  const own = useCreateStore<ReadonlySet<string>>(new Set<string>());
  const store = held ?? own;
  const chosen = useSelector(store);
  const setChosen = (
    next: ReadonlySet<string> | ((was: ReadonlySet<string>) => ReadonlySet<string>),
  ) => store.setState(typeof next === "function" ? next : () => next);
  const selected: ReadonlySet<string> = new Set([...chosen].filter((id) => drawn.has(id)));
  const stale = selected.size !== chosen.size;
  useEffect(() => {
    if (stale) store.setState((was) => new Set([...was].filter((id) => drawn.has(id))));
  });
  const onClear = () => setChosen(new Set());
  const sections = useSectionDialogs(tasks, tasks.shown);
  const [doomed, setDoomed] = useState<readonly string[]>([]);
  const heard = useRefusalHeard(doomed.length > 0 && tasks.shown, {
    surface: FAILURE_SURFACE.TASK_DELETE,
  });
  const deleting = useMutation(tasks.deleteTasks);
  const deletionAct = useConfirmAct(deleting, {
    send: async () => {
      const answers = await deleting.mutateAsync(doomed);
      const refused = doomed.filter(
        (_, at) => answers[at]?.status !== ACTION_RESULT_STATUS.ACCEPTED,
      );
      if (refused.length === 0) {
        onClear();
        return ACCEPTED;
      }
      setDoomed(refused);
      setChosen((held) => new Set([...[...held].filter((id) => !doomed.includes(id)), ...refused]));
      return heard(
        answers.find((answer) => answer.status !== ACTION_RESULT_STATUS.ACCEPTED) ?? ACCEPTED,
      );
    },
    answered: (answers) =>
      answers.find((answer) => answer.status !== ACTION_RESULT_STATUS.ACCEPTED) ?? ACCEPTED,
  });
  const deletion = useConfirmDialog(
    { subject: doomed.length > 0, surfaceOpen: tasks.shown },
    deletionAct,
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

export function chosenRowMenu(thing: string, chosen: ChosenTasks, shown: boolean) {
  return {
    thing,
    groups: selectionMenu(chosen.acts()),
    heading: countWords(chosen.count, TERM.TASK),
    replayUnmasked: true,
    shown,
  };
}

export const ChosenTasksContext = createContext<(taskId: string) => ChosenTasks | undefined>(
  () => undefined,
);
