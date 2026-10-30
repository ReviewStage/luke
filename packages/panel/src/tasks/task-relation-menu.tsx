import {
  TASK_BLOCK_CHANGE,
  TASK_RELATION_KIND,
  type Task,
  type TaskBlockRequest,
  type TaskRelationKind,
  type TaskSummary,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import {
  type FootRow,
  type MenuRow,
  POPOVER_ALIGN,
  type PopoverAlign,
  SearchableMenu,
  TaskStatusMark,
} from "@luke/ui";
import {
  CornerDownRightIcon,
  CornerLeftUpIcon,
  GLYPH,
  HandIcon,
  OctagonMinusIcon,
} from "@luke/ui/icons";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useEffect, useId, useRef, useState } from "react";

/**
 * task-relation-menu.tsx -- the one menu that relates a task to another: the workspace's other tasks first, searched by name or key, and the kind of relation pinned under them, switched without starting over.
 *
 * A relation is one of four kinds (`TASK_RELATION_KIND`): the task is
 * blocked by the one picked, blocks it, takes it as a sub-task, or takes it
 * as its parent. The menu opens on a kind its owner names, lists every other
 * task of the workspace by its status mark, name, and key, and pins
 * "Relation: Sub-task" under them, a submenu of the four kinds, each by its
 * icon, so a reader who opened it on the wrong one switches without losing
 * their search. A task that cannot take the kind stays listed, dimmed, with
 * why at its end: already related that way, a loop the service would
 * refuse, or, for a sub-task or a parent, another repository, since a tree
 * works in one. On Sub-task, New sub-task is pinned above the kind and
 * opens the child composer. A pick is sent through the door: a block as the
 * blocks' change, a sub-task or a parent as a parent set, the service's
 * answer being what the head goes on drawing. The task's ⋯ menu, its
 * right-click, and ⌘K open it from the head (`TaskRelationAsked`), and a
 * group's + may draw it on a kind of its own.
 */

/** Each kind as the menu's kind row, its submenu, and the task's menus name it. */
const TASK_RELATION_WORDS = {
  [TASK_RELATION_KIND.SUB_TASK]: "Sub-task",
  [TASK_RELATION_KIND.PARENT]: "Parent",
  [TASK_RELATION_KIND.BLOCKED_BY]: "Blocked by",
  [TASK_RELATION_KIND.BLOCKS]: "Blocks",
} as const satisfies Record<TaskRelationKind, string>;

/** The kinds in the order the kind submenu and the task's menus stand them. */
export const TASK_RELATION_ORDER: readonly TaskRelationKind[] = [
  TASK_RELATION_KIND.SUB_TASK,
  TASK_RELATION_KIND.PARENT,
  TASK_RELATION_KIND.BLOCKED_BY,
  TASK_RELATION_KIND.BLOCKS,
];

/** Each kind's icon, which leads its row wherever a kind is offered, as a status leads by its mark. */
export function TaskRelationIcon({ kind }: { kind: TaskRelationKind }): React.JSX.Element {
  switch (kind) {
    case TASK_RELATION_KIND.BLOCKED_BY:
      return <OctagonMinusIcon aria-hidden="true" />;
    case TASK_RELATION_KIND.BLOCKS:
      return <HandIcon aria-hidden="true" />;
    case TASK_RELATION_KIND.SUB_TASK:
      return <CornerDownRightIcon aria-hidden="true" />;
    case TASK_RELATION_KIND.PARENT:
      return <CornerLeftUpIcon aria-hidden="true" />;
  }
}

/** Why a task cannot take a kind, printed at its row's end. */
const WHY = {
  [TASK_RELATION_KIND.BLOCKED_BY]: { already: "Already blocks this", loop: "Waits on this task" },
  [TASK_RELATION_KIND.BLOCKS]: { already: "Already waits on this", loop: "This task waits on it" },
  [TASK_RELATION_KIND.SUB_TASK]: { already: "Already a sub-task", loop: "A parent of this task" },
  [TASK_RELATION_KIND.PARENT]: { already: "Already the parent", loop: "A sub-task of this task" },
} as const satisfies Record<TaskRelationKind, { already: string; loop: string }>;

const OTHER_REPOSITORY = "Another repository";

/** The pinned rows' ids, apart from every task's. */
const FOOT_ID = {
  NEW_SUB_TASK: "new-sub-task",
  KIND: "relation-kind",
} as const;

/** What the menu reads and sends through: the workspace's name, which a key is drawn from, its tasks, and where a block, a parent, and a new sub-task go; a kind whose door is missing is offered nowhere. */
export interface TaskRelationDoor {
  readonly workspaceName: string;
  readonly tasks: readonly TaskSummary[];
  readonly onChange?: ((change: TaskBlockRequest) => void) | undefined;
  readonly onSetParent?: ((taskId: string, parentTaskId: string | null) => void) | undefined;
  readonly onNewSubTask?: (() => void) | undefined;
}

/** An ask from the task's menus or ⌘K to open the menu on a kind, each counted so the same press opens it again. */
export interface TaskRelationAsk {
  readonly kind: TaskRelationKind;
  readonly request: number;
}

/** Whether the door can send a kind at all. */
function kindSent(door: TaskRelationDoor, kind: TaskRelationKind): boolean {
  if (kind === TASK_RELATION_KIND.BLOCKED_BY || kind === TASK_RELATION_KIND.BLOCKS) {
    return door.onChange !== undefined;
  }
  return door.onSetParent !== undefined;
}

/** The kinds the door can send, in their order. */
function sentKinds(door: TaskRelationDoor): readonly TaskRelationKind[] {
  return TASK_RELATION_ORDER.filter((kind) => kindSent(door, kind));
}

/** The tasks standing above one whose parent is `parentId`, walking up by parents through the tasks the list holds and stopping at a loop. */
function ancestors(
  byId: ReadonlyMap<string, TaskSummary>,
  parentId: string | undefined,
): Set<string> {
  const above = new Set<string>();
  let at = parentId;
  while (at !== undefined && !above.has(at)) {
    above.add(at);
    at = byId.get(at)?.parentTaskId;
  }
  return above;
}

/** Two repositories as the service compares them: both none, or the same name in any case. */
function sameRepository(one: string | null, other: string | null): boolean {
  if (one === null || other === null) return one === other;
  return one.toLowerCase() === other.toLowerCase();
}

/** Why `other` cannot take `kind` against `task`; none where it can. */
function whyNot(
  task: Task,
  other: TaskSummary,
  kind: TaskRelationKind,
  byId: ReadonlyMap<string, TaskSummary>,
): string | undefined {
  const blockedBy = task.blockedBy ?? [];
  const blocks = task.blocks ?? [];
  switch (kind) {
    case TASK_RELATION_KIND.BLOCKED_BY:
      if (blockedBy.includes(other.id)) return WHY[kind].already;
      return blocks.includes(other.id) ? WHY[kind].loop : undefined;
    case TASK_RELATION_KIND.BLOCKS:
      if (blocks.includes(other.id)) return WHY[kind].already;
      return blockedBy.includes(other.id) ? WHY[kind].loop : undefined;
    case TASK_RELATION_KIND.SUB_TASK:
      if (other.parentTaskId === task.id) return WHY[kind].already;
      if (ancestors(byId, task.parentTaskId).has(other.id)) return WHY[kind].loop;
      return sameRepository(task.repository, other.repository) ? undefined : OTHER_REPOSITORY;
    case TASK_RELATION_KIND.PARENT:
      if (task.parentTaskId === other.id) return WHY[kind].already;
      if (ancestors(byId, other.parentTaskId).has(task.id)) return WHY[kind].loop;
      return sameRepository(task.repository, other.repository) ? undefined : OTHER_REPOSITORY;
  }
}

/**
 * The tasks the menu lists for a kind: the workspace's others, by name,
 * their status mark, and their key, which a search matches too, each one
 * that cannot take the kind dimmed with why.
 */
function relationRows(
  task: Task,
  door: TaskRelationDoor,
  kind: TaskRelationKind,
): readonly MenuRow[] {
  const byId = new Map(door.tasks.map((each) => [each.id, each]));
  return door.tasks
    .filter((each) => each.id !== task.id)
    .map((each) => {
      const key = each.number === undefined ? undefined : taskKey(door.workspaceName, each.number);
      const disabled = whyNot(task, each, kind, byId);
      return {
        id: each.id,
        label: each.name,
        ...(each.status === undefined ? {} : { icon: <TaskStatusMark status={each.status} /> }),
        ...(key === undefined ? {} : { detail: key, terms: [key] }),
        ...(disabled === undefined ? {} : { disabled }),
      };
    });
}

/** Sends `otherId` related to `task` as `kind` through the door. */
function relate(task: Task, door: TaskRelationDoor, kind: TaskRelationKind, otherId: string): void {
  switch (kind) {
    case TASK_RELATION_KIND.BLOCKED_BY:
    case TASK_RELATION_KIND.BLOCKS:
      door.onChange?.({ change: TASK_BLOCK_CHANGE.ADD, relation: kind, taskId: otherId });
      return;
    case TASK_RELATION_KIND.SUB_TASK:
      door.onSetParent?.(otherId, task.id);
      return;
    case TASK_RELATION_KIND.PARENT:
      door.onSetParent?.(task.id, otherId);
      return;
  }
}

/** The kind of a picked submenu row; none for a row that names none. */
function kindOf(id: string): TaskRelationKind | undefined {
  return TASK_RELATION_ORDER.find((kind) => kind === id);
}

/**
 * The add menu, opened on `kind`: the tasks for the kind chosen now, and
 * pinned under them New sub-task on Sub-task and the kind's submenu. A
 * pick of a task is sent and closes the menu; a kind switched keeps the
 * search. Its owner holds it open and hangs it from a box of its own.
 */
export function TaskRelationMenu({
  id,
  task,
  door,
  kind: opened,
  align = POPOVER_ALIGN.START,
  leaving,
  menuRef,
  onClose,
  onLeave,
}: {
  id: string;
  task: Task;
  door: TaskRelationDoor;
  /** The kind the menu opens on. */
  kind: TaskRelationKind;
  align?: PopoverAlign | undefined;
  leaving?: boolean | undefined;
  menuRef?: ((element: HTMLElement | null) => void) | undefined;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const [kind, setKind] = useState(opened);
  const kinds = sentKinds(door);
  const { onNewSubTask } = door;
  const foot: FootRow[] = [
    ...(kind === TASK_RELATION_KIND.SUB_TASK && onNewSubTask !== undefined
      ? [
          {
            id: FOOT_ID.NEW_SUB_TASK,
            label: "New sub-task",
            icon: <GLYPH.ADD />,
            onPress: () => {
              onClose();
              onNewSubTask();
            },
          },
        ]
      : []),
    {
      id: FOOT_ID.KIND,
      label: "Relation",
      icon: <TaskRelationIcon kind={kind} />,
      detail: TASK_RELATION_WORDS[kind],
      submenu: {
        label: "Relation",
        rows: kinds.map((each) => ({
          id: each,
          label: TASK_RELATION_WORDS[each],
          icon: <TaskRelationIcon kind={each} />,
        })),
        value: kind,
        onPick: (picked) => setKind(kindOf(picked) ?? kind),
        stays: true,
      },
    },
  ];
  return (
    <SearchableMenu
      id={id}
      label={TASK_RELATION_WORDS[kind]}
      placeholder="Find a task…"
      rows={relationRows(task, door, kind)}
      value={undefined}
      noMatch="No tasks match"
      foot={foot}
      align={align}
      leaving={leaving}
      ref={menuRef}
      onPick={(otherId) => {
        onClose();
        relate(task, door, kind, otherId);
      }}
      onClose={onClose}
      onLeave={onLeave}
    />
  );
}

/**
 * The add menu as the task's head holds it for the task's menus and ⌘K: no
 * control of its own, only a box at the end of the properties line the menu
 * hangs from while an ask stands, and nothing drawn while none does. Each ask opens it afresh on its kind, and
 * is handed back through `onAsked` so the asker can let it go; closing it
 * hands focus back to wherever it came from.
 */
export function TaskRelationAsked({
  task,
  door,
  ask,
  onAsked,
}: {
  task: Task;
  door: TaskRelationDoor;
  ask: TaskRelationAsk | undefined;
  onAsked?: ((request: number) => void) | undefined;
}): React.JSX.Element | null {
  const [open, setOpen] = useState<TaskRelationAsk | undefined>(undefined);
  // The ask last drawn, kept while the menu fades out after it closed.
  const [shown, setShown] = useState<TaskRelationAsk | undefined>(undefined);
  const drawn = useDisclosure(open !== undefined);
  const menuId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const answered = useRef<number | undefined>(undefined);
  // Another task closes the menu at once, so a menu asked on one never stands over the next.
  const [forTask, setForTask] = useState(task.id);
  if (forTask !== task.id) {
    setForTask(task.id);
    setOpen(undefined);
    setShown(undefined);
  }
  useEffect(() => {
    if (ask === undefined || ask.request === answered.current) return;
    answered.current = ask.request;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(ask);
    setShown(ask);
    onAsked?.(ask.request);
  }, [ask, onAsked]);
  // Note that we hand focus back to where the ask came from, as a native menu returns it to its button, because closing takes the focused field away.
  const close = () => {
    setOpen(undefined);
    opener.current?.focus();
  };
  // Nothing is drawn while the menu is closed, so the box adds nothing to the head until an ask opens it.
  if (!drawn.mounted || shown === undefined) return null;
  return (
    <span className="task-relation-asked relative inline-flex" ref={box}>
      <TaskRelationMenu
        // Keyed by the ask, so each opens on its own kind and search.
        key={shown.request}
        id={menuId}
        task={task}
        door={door}
        kind={shown.kind}
        leaving={drawn.leaving}
        menuRef={drawn.ref}
        onClose={close}
        onLeave={(left) => {
          if (!(left instanceof Node && box.current?.contains(left))) close();
        }}
      />
    </span>
  );
}
