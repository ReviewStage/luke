import {
  TASK_RELATION_KIND,
  type Task,
  type TaskRelationKind,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  BUTTON_SIZE,
  GROUP_ACTIONS,
  GROUP_HEADING,
  GroupAction,
  GroupHeader,
  IconButton,
  type MenuRow,
  POPOVER_ALIGN,
  PROGRESS_COUNT_LOOK,
  ProgressCount,
  Tooltip,
} from "@repo/ui";
import { GLYPH, NetworkIcon, PlusIcon } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { subTaskCount, subTasksOf, taskFinished } from "@repo/ui/task-list-model";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useId, useRef, useState } from "react";
import type { DescriptionRoom } from "../tasks/description-body.js";
import { RelationKindPill } from "../tasks/relation-kind-pill.js";
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

const GROUP_WORDS = {
  SUB_TASKS: "Sub-tasks",
  RELATIONS: "Task relations",
} as const;

const ADD_WORDS = {
  SUB_TASK: "Add sub-task",
  RELATION: "Add task relation",
} as const;

const RELATIONS_NOUN = { one: "task relation", many: "task relations" } as const;

const CHANGE_RELATION = "Change relation";
const REMOVE_RELATION = "Remove relation";

const UNLISTED_TASK_NAME = "Task";

const SUB_TASKS_OF = "Sub-tasks of";

const KIND_ROWS: readonly MenuRow[] = TASK_RELATION_ORDER.map((kind) => ({
  id: kind,
  label: TASK_RELATION_WORDS[kind],
  icon: <TaskRelationIcon kind={kind} />,
}));

function kindOf(id: string): TaskRelationKind | undefined {
  return TASK_RELATION_ORDER.find((kind) => kind === id);
}

interface RelationDoors {
  readonly onChange: (to: TaskRelationKind) => void;
  readonly onRemove: () => void;
}

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

function relationMenu(kind: TaskRelationKind, doors: RelationDoors): readonly MenuEntry[][] {
  const change = chipSubmenu(CHANGE_RELATION, KIND_ROWS, kind, (id) => {
    const picked = kindOf(id);
    if (picked !== undefined) doors.onChange(picked);
  });
  return [[change, { label: REMOVE_RELATION, icon: <GLYPH.CLOSE />, onSelect: doors.onRemove }]];
}

function RelationAdd({
  task,
  door,
  kind,
  label,
}: {
  task: Task;
  door: TaskRelationDoor;
  kind?: TaskRelationKind | undefined;
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

interface BlockTask {
  readonly task: TaskSummary;
  readonly listed: boolean;
}

function blockTasks(
  task: Task,
  byId: ReadonlyMap<string, TaskSummary>,
  ids: readonly string[] | undefined,
): readonly BlockTask[] {
  return (ids ?? []).map((id) => {
    const listed = byId.get(id);
    if (listed !== undefined) return { task: listed, listed: true };
    const unlisted: TaskSummary = {
      id,
      workspaceId: task.workspaceId,
      name: UNLISTED_TASK_NAME,
      repository: null,
      createdAt: 0,
      updatedAt: 0,
    };
    return { task: unlisted, listed: false };
  });
}

export function PlanRelations({
  task,
  tasks,
  door,
  room,
  onOpenTask,
}: {
  task: Task;
  tasks: TasksControl;
  door: TaskRelationDoor;
  room: DescriptionRoom;
  onOpenTask: (taskId: string) => void;
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
    { kind: TASK_RELATION_KIND.BLOCKED_BY, related: blockTasks(task, byId, task.blockedBy) },
    { kind: TASK_RELATION_KIND.BLOCKS, related: blockTasks(task, byId, task.blocks) },
  ] as const;
  const relations: RelatedTaskRow[] = sides.flatMap(({ kind, related }) =>
    related.map(({ task: other, listed }) => {
      const settled = listed && taskFinished(other);
      const blocker = kind === TASK_RELATION_KIND.BLOCKED_BY;
      const doors = doorsOf(other, kind);
      return {
        task: other,
        relationWords: TASK_RELATION_WORDS[kind],
        relation: (
          <ReplayUnmask>
            <RelationKindPill
              kind={kind}
              kinds={TASK_RELATION_ORDER}
              words={TASK_RELATION_WORDS}
              icon={(each) => <TaskRelationIcon kind={each} />}
              attention={blocker && !settled}
              onChange={doors.onChange}
              onRemove={doors.onRemove}
            />
          </ReplayUnmask>
        ),
        settled: blocker && settled,
        menu: relationMenu(kind, doors),
        unlisted: !listed,
      };
    }),
  );
  if (subTasks.length === 0 && relations.length === 0) return null;
  return (
    <div className="plan-relations -mx-row-inset mb-block-gap flex flex-col gap-block-gap">
      {subTasks.length === 0 ? null : (
        <ReplayUnmask>
          <GroupHeader
            heading={GROUP_HEADING.NONE}
            label={GROUP_WORDS.SUB_TASKS}
            glyph={<GLYPH.SUB_TASK />}
            mark={
              <ProgressCount
                done={count.finished}
                total={count.total}
                label={`${count.finished} of ${count.total} sub-tasks finished`}
                look={PROGRESS_COUNT_LOOK.BADGE}
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
            <RelatedTasks
              tasks={tasks}
              label={GROUP_WORDS.SUB_TASKS}
              rows={subTasks}
              room={room}
              onOpenTask={onOpenTask}
            />
          </GroupHeader>
        </ReplayUnmask>
      )}
      {relations.length === 0 ? null : (
        <ReplayUnmask>
          <GroupHeader
            heading={GROUP_HEADING.NONE}
            label={GROUP_WORDS.RELATIONS}
            glyph={<NetworkIcon />}
            count={{
              value: relations.length,
              noun: relations.length === 1 ? RELATIONS_NOUN.one : RELATIONS_NOUN.many,
            }}
            fold={{ defaultOpen: true }}
            actions={<RelationAdd task={task} door={door} label={ADD_WORDS.RELATION} />}
            actionsShown={GROUP_ACTIONS.AT_REST}
          >
            <RelatedTasks
              tasks={tasks}
              label={GROUP_WORDS.RELATIONS}
              rows={relations}
              room={room}
              onOpenTask={onOpenTask}
            />
          </GroupHeader>
        </ReplayUnmask>
      )}
    </div>
  );
}
