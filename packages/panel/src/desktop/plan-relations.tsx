import {
  TASK_RELATION_KIND,
  type Task,
  type TaskRelationKind,
  type TaskSummary,
} from "@luke/features/task-wire";
import {
  BUTTON_SIZE,
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  type FootRow,
  GROUP_ACTIONS,
  GROUP_HEADING,
  GroupAction,
  GroupHeader,
  IconButton,
  ListRowCount,
  type MenuRow,
  POPOVER_ALIGN,
  SearchableMenu,
  STATUS_TONE,
  Tooltip,
} from "@luke/ui";
import { GLYPH, ListTreeIcon, NetworkIcon, PlusIcon } from "@luke/ui/icons";
import { subTaskCount, subTasksOf, taskFinished } from "@luke/ui/task-list-model";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useId, useRef, useState } from "react";
import {
  TASK_RELATION_ORDER,
  TASK_RELATION_WORDS,
  type TaskRelationDoor,
  TaskRelationIcon,
  TaskRelationMenu,
} from "../tasks/task-relation-menu.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import type { MenuEntry } from "./action-menu.js";
import { type RelatedTaskRow, RelatedTasks } from "./related-tasks.js";
import { chipSubmenu } from "./standing-submenus.js";

/**
 * plan-relations.tsx -- the open task's sub-tasks and the tasks related to it at the head of its plan, each a group of the Tasks list's own rows.
 *
 * Two groups stand under the byline, ahead of the Agents, each the shape
 * every group of the head takes, a `GroupHeader` over a list
 * (`related-tasks.tsx`), and each drawn only while it holds a row, so a
 * task with neither draws no empty heads. Sub-tasks, by the list-tree
 * glyph, counts how many of the task's own sub-tasks are finished of all of
 * them, and nests theirs under each to any depth, folded until opened, as
 * the sidebar nests and folds them; it reads the task list's
 * `parentTaskId` and nothing more. Relations, by the network glyph, holds a
 * row for each task the task waits on and each that waits on it, its kind
 * at the row's end as a compact pill by its icon and a chevron: an open
 * blocker's in the attention tone, and a blocker that is done or canceled
 * muting its row. The pill drops the four kinds, the current one checked,
 * and Remove relation; a kind picked is moved in one call
 * (`onChangeTaskRelation`), so nothing is taken away and added again, and a
 * row moved to Parent leaves for the path's crumb, where a parent stands.
 * A related row's ⋯, right-click, and menu key lead its task's menu with
 * the same: Change relation, its four kinds, and Remove relation, which
 * acts at once and offers Undo in a toast. Each group's +, standing at rest
 * on its head, drops the add menu (`task-relation-menu.tsx`) on its kind:
 * Sub-task, or Blocked by. A refusal, a loop or another repository, is the
 * service's, said in the toast its door raises.
 */

/** What each group is called, and its list for a reader moving between lists. */
const GROUP_WORDS = {
  SUB_TASKS: "Sub-tasks",
  RELATIONS: "Relations",
} as const;

/** What each group's + is called, said beside its glyph. */
const ADD_WORDS = {
  SUB_TASK: "Add sub-task",
  RELATION: "Add relation",
} as const;

/** What the Relations group's count counts, said to a reader beside the figure. */
const RELATIONS_NOUN = { one: "relation", many: "relations" } as const;

/** What a row's menu and a pill's menu name the relation's change and its taking away. */
const CHANGE_RELATION = "Change relation";
const REMOVE_RELATION = "Remove relation";

/** The words a sub-task's fold is named by, before its name. */
const SUB_TASKS_OF = "Sub-tasks of";

/** The pill's pinned row's id, apart from every kind's. */
const REMOVE_ROW_ID = "remove-relation";

/** The four kinds as a menu's rows, each by its icon. */
const KIND_ROWS: readonly MenuRow[] = TASK_RELATION_ORDER.map((kind) => ({
  id: kind,
  label: TASK_RELATION_WORDS[kind],
  icon: <TaskRelationIcon kind={kind} />,
}));

/** The kind a picked row names; none for a row that names none. */
function kindOf(id: string): TaskRelationKind | undefined {
  return TASK_RELATION_ORDER.find((kind) => kind === id);
}

/** What a relation's row changes it through: a kind moved, or the relation taken away. */
interface RelationDoors {
  readonly onChange: (to: TaskRelationKind) => void;
  readonly onRemove: () => void;
}

/**
 * The doors that change how `other` stands to `task`, as `kind`, through
 * the task list's own: a kind moved in one call, and a block taken away or
 * a sub-task taken out from under the task, each offering Undo.
 */
function relationDoors(
  tasks: TasksControl,
  task: Task,
  other: TaskSummary,
  kind: TaskRelationKind,
): RelationDoors {
  return {
    onChange: (to) => {
      if (to !== kind) tasks.onChangeTaskRelation(task.id, { taskId: other.id, from: kind, to });
    },
    onRemove: () => {
      switch (kind) {
        case TASK_RELATION_KIND.BLOCKED_BY:
        case TASK_RELATION_KIND.BLOCKS:
          tasks.onRemoveTaskBlock(task.id, kind, other.id);
          return;
        case TASK_RELATION_KIND.SUB_TASK:
          tasks.onRemoveTaskParent(other.id);
          return;
        case TASK_RELATION_KIND.PARENT:
          tasks.onRemoveTaskParent(task.id);
          return;
      }
    },
  };
}

/** A related row's menu groups: Change relation, its four kinds with the current one checked, and Remove relation. */
function relationMenu(kind: TaskRelationKind, doors: RelationDoors): readonly MenuEntry[][] {
  const change = chipSubmenu(CHANGE_RELATION, KIND_ROWS, kind, (id) => {
    const picked = kindOf(id);
    if (picked !== undefined) doors.onChange(picked);
  });
  return [[change, { label: REMOVE_RELATION, icon: <GLYPH.CLOSE />, onSelect: doors.onRemove }]];
}

/**
 * A relation's kind at its row's end: a compact pill by the kind's icon and
 * a chevron, its words its name and its hover's, since a side panel's row
 * has no room to spare its name for them, in the attention tone for a blocker still open,
 * dropping the four kinds, the current one checked, and Remove relation
 * pinned under them.
 */
function RelationKindPill({
  kind,
  open: attention,
  doors,
}: {
  kind: TaskRelationKind;
  /** Whether the relation still asks for attention: a blocker not yet done. */
  open: boolean;
  doors: RelationDoors;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const words = TASK_RELATION_WORDS[kind];
  // Note that we hand focus back to the pill, as a native menu returns it to its button, because closing takes the focused menu away.
  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };
  const foot: readonly FootRow[] = [
    {
      id: REMOVE_ROW_ID,
      label: REMOVE_RELATION,
      icon: <GLYPH.CLOSE />,
      onPress: () => {
        close();
        doors.onRemove();
      },
    },
  ];
  return (
    <span className="plan-relation-kind relative inline-flex items-center" ref={box}>
      <Tooltip label={open ? undefined : words}>
        <Chip
          ref={chip}
          look={CHIP_LOOK.PILL}
          size={CHIP_SIZE.COMPACT}
          tone={attention ? STATUS_TONE.ATTENTION : undefined}
          chevron
          aria-label={`Relation: ${words}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(!open)}
        >
          <TaskRelationIcon kind={kind} />
        </Chip>
      </Tooltip>
      {drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={CHANGE_RELATION}
          rows={KIND_ROWS}
          value={kind}
          foot={foot}
          noMatch="No kinds match"
          align={POPOVER_ALIGN.END}
          onPick={(id) => {
            close();
            const picked = kindOf(id);
            if (picked !== undefined) doors.onChange(picked);
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && box.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </span>
  );
}

/**
 * A group's +, standing at rest on its head: a glyph's button dropping the
 * add menu on `kind`, the menu hanging from the button and handing focus
 * back to it once closed.
 */
function RelationAdd({
  task,
  door,
  kind,
  label,
}: {
  task: Task;
  door: TaskRelationDoor;
  kind: TaskRelationKind;
  label: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <GroupAction>
      <span className="plan-relation-add relative inline-flex" ref={box}>
        <Tooltip label={open ? undefined : label}>
          <IconButton
            ref={button}
            icon={<PlusIcon />}
            label={label}
            size={BUTTON_SIZE.COMPACT}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen(!open)}
          />
        </Tooltip>
        {drawn.mounted ? (
          <TaskRelationMenu
            id={menuId}
            task={task}
            door={door}
            kind={kind}
            align={POPOVER_ALIGN.END}
            leaving={drawn.leaving}
            menuRef={drawn.ref}
            onClose={close}
            onLeave={(left) => {
              if (!(left instanceof Node && box.current?.contains(left))) setOpen(false);
            }}
          />
        ) : null}
      </span>
    </GroupAction>
  );
}

/**
 * The task's sub-tasks as rows, each nested under its parent to any depth,
 * those under a folded row passed by, in the order they were made; a loop
 * of parents, which nothing writes, is cut where it closes.
 */
function subTaskRows(
  tasks: readonly TaskSummary[],
  task: Task,
  opened: ReadonlySet<string>,
  onFold: (taskId: string) => void,
  menuOf: (subTask: TaskSummary) => readonly MenuEntry[][],
): RelatedTaskRow[] {
  const rows: RelatedTaskRow[] = [];
  const walked = new Set([task.id]);
  const draw = (parentId: string, depth: number) => {
    for (const subTask of subTasksOf(tasks, parentId)) {
      if (walked.has(subTask.id)) continue;
      walked.add(subTask.id);
      const under = subTasksOf(tasks, subTask.id).filter((each) => !walked.has(each.id));
      const open = opened.has(subTask.id);
      // Note that only the task's own sub-tasks are related to it, so a deeper row's menu is its task's alone.
      const menu = depth === 0 ? menuOf(subTask) : undefined;
      rows.push({
        task: subTask,
        depth,
        ...(under.length === 0
          ? {}
          : {
              fold: {
                open,
                onOpenChange: (asked: boolean) => {
                  if (asked !== open) onFold(subTask.id);
                },
                label: `${SUB_TASKS_OF} ${subTask.name}`,
              },
            }),
        ...(menu === undefined ? {} : { menu }),
      });
      if (open) draw(subTask.id, depth + 1);
    }
  };
  draw(task.id, 0);
  return rows;
}

/** The tasks a side of the task's blocks names, as the list holds them; one it does not hold yet is left out until it does. */
function blockTasks(
  byId: ReadonlyMap<string, TaskSummary>,
  ids: readonly string[] | undefined,
): readonly TaskSummary[] {
  return (ids ?? []).flatMap((id) => {
    const listed = byId.get(id);
    return listed === undefined ? [] : [listed];
  });
}

/**
 * The open task's Sub-tasks and Relations groups at the head of its plan,
 * each only while it holds a row; nothing for a task with neither. Its
 * relations change through the task list's doors, and each group's + adds
 * one through the add menu's `door`.
 */
export function PlanRelations({
  task,
  tasks,
  door,
}: {
  task: Task;
  tasks: TasksControl;
  door: TaskRelationDoor;
}): React.JSX.Element | null {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const fold = (taskId: string) =>
    setOpened((held) => {
      const next = new Set(held);
      if (!next.delete(taskId)) next.add(taskId);
      return next;
    });
  const doorsOf = (other: TaskSummary, kind: TaskRelationKind) =>
    relationDoors(tasks, task, other, kind);
  const subTasks = subTaskRows(tasks.tasks, task, opened, fold, (subTask) =>
    relationMenu(TASK_RELATION_KIND.SUB_TASK, doorsOf(subTask, TASK_RELATION_KIND.SUB_TASK)),
  );
  const count = subTaskCount(subTasksOf(tasks.tasks, task.id));
  const byId = new Map(tasks.tasks.map((each) => [each.id, each]));
  const sides = [
    { kind: TASK_RELATION_KIND.BLOCKED_BY, related: blockTasks(byId, task.blockedBy) },
    { kind: TASK_RELATION_KIND.BLOCKS, related: blockTasks(byId, task.blocks) },
  ] as const;
  const relations: RelatedTaskRow[] = sides.flatMap(({ kind, related }) =>
    related.map((other) => {
      const settled = taskFinished(other);
      const blocker = kind === TASK_RELATION_KIND.BLOCKED_BY;
      const doors = doorsOf(other, kind);
      return {
        task: other,
        end: <RelationKindPill kind={kind} open={blocker && !settled} doors={doors} />,
        settled: blocker && settled,
        menu: relationMenu(kind, doors),
      };
    }),
  );
  if (subTasks.length === 0 && relations.length === 0) return null;
  return (
    // Note that the groups are pulled out by a row's inset on each side, so their marks stand on the title's edge, as the Agents group's do.
    <div className="plan-relations -mx-row-inset mb-block-gap flex flex-col gap-block-gap">
      {subTasks.length === 0 ? null : (
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          label={GROUP_WORDS.SUB_TASKS}
          glyph={<ListTreeIcon />}
          mark={
            <ListRowCount
              settled={count.finished}
              total={count.total}
              label={`${count.finished} of ${count.total} sub-tasks finished`}
            />
          }
          fold={{ defaultOpen: true }}
          actions={
            <RelationAdd
              task={task}
              door={door}
              kind={TASK_RELATION_KIND.SUB_TASK}
              label={ADD_WORDS.SUB_TASK}
            />
          }
          actionsShown={GROUP_ACTIONS.AT_REST}
        >
          <RelatedTasks tasks={tasks} label={GROUP_WORDS.SUB_TASKS} rows={subTasks} />
        </GroupHeader>
      )}
      {relations.length === 0 ? null : (
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          label={GROUP_WORDS.RELATIONS}
          glyph={<NetworkIcon />}
          count={{
            value: relations.length,
            noun: relations.length === 1 ? RELATIONS_NOUN.one : RELATIONS_NOUN.many,
          }}
          fold={{ defaultOpen: true }}
          actions={
            <RelationAdd
              task={task}
              door={door}
              kind={TASK_RELATION_KIND.BLOCKED_BY}
              label={ADD_WORDS.RELATION}
            />
          }
          actionsShown={GROUP_ACTIONS.AT_REST}
        >
          <RelatedTasks tasks={tasks} label={GROUP_WORDS.RELATIONS} rows={relations} />
        </GroupHeader>
      )}
    </div>
  );
}
