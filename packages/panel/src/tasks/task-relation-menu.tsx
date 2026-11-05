import {
  TASK_BLOCK_CHANGE,
  TASK_CREATE_RELATION_KIND,
  TASK_RELATION_KIND,
  type Task,
  type TaskBlockRequest,
  type TaskCreateRelationKind,
  type TaskRelationKind,
  type TaskSummary,
} from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import {
  type FootRow,
  type MenuHead,
  type MenuPanel,
  type MenuRow,
  POPOVER_ALIGN,
  type PopoverAlign,
  SEARCHABLE_MENU_LAYER,
  SearchableMenu,
  TaskStatusMark,
} from "@repo/ui";
import { CornerLeftUpIcon, GLYPH, HandIcon, NetworkIcon, OctagonMinusIcon } from "@repo/ui/icons";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useEffect, useId, useRef, useState } from "react";

/**
 * task-relation-menu.tsx -- the one menu that relates a task to another: the relation first, as what it does ("Add sub-task…"), then the workspace's other tasks, searched by name or key, under a head saying what a pick does.
 *
 * A relation is one of four kinds (`TASK_RELATION_KIND`): the task is
 * blocked by the one picked, blocks it, takes it as a sub-task, or takes it
 * as its parent. The menu is named Task relation wherever it opens, as New
 * task's + names its own (`new-task-relation.tsx`). Note that it asks for
 * the kind before the task, because a pick relates at once: a reader who
 * chose "Mark as blocked by…" knows what pressing a task will do, where a
 * search led by tasks read as one that opens them. Opened on no kind, it
 * lists the kinds the door can send, each by its icon and what it does; a
 * kind chosen turns it into that kind's search, headed by what a pick does
 * and led by the way back to the kinds, which Escape takes too. Opened on a
 * kind its owner names, as Add sub-task and ⌘K do, it is that search
 * already, Escape closing it. The search lists every other task of the
 * workspace by its status mark, name, and key, its field saying which way
 * round the relation stands ("Find the task this waits on"). A task that
 * cannot take the kind stays listed, dimmed, with
 * why at its end: already related that way, a loop the service would
 * refuse, or, for a sub-task or a parent, another repository, since a tree
 * works in one. New task is pinned under them, named for the kind ("New
 * blocking task"), and opens New task with a relation to this task, read
 * from the new task's side: on Sub-task as a sub-task of this task, on
 * Blocked by as one that blocks it. A pick is sent through the door: a block as the
 * blocks' change, a sub-task or a parent as a parent set, the service's
 * answer being what the head goes on drawing. A task's menu, wherever a
 * row or the Plan tab draws it, hangs it beside itself as its Task relation
 * panel (`taskRelationMenuPanel`), opened on the kinds, so a task is related
 * from a list without being opened; ⌘K opens it from the head on a kind
 * (`TaskRelationAsked`), and a group's + draws it on a kind of its own or on
 * the kinds.
 */

/** What the menu is called wherever it opens, New task's + among them. */
export const TASK_RELATION_MENU = "Task relation";

/** Each kind as the menu's kind row, its submenu, the task's menus, and a related row's pill name it. */
export const TASK_RELATION_WORDS = {
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
      return <GLYPH.SUB_TASK />;
    case TASK_RELATION_KIND.PARENT:
      return <CornerLeftUpIcon aria-hidden="true" />;
  }
}

/** Each kind as what choosing it does, which the kinds list and the search's head say. */
const KIND_VERBS = {
  [TASK_RELATION_KIND.SUB_TASK]: { choose: "Add sub-task…", head: "Add sub-task" },
  [TASK_RELATION_KIND.PARENT]: { choose: "Set parent…", head: "Set parent" },
  [TASK_RELATION_KIND.BLOCKED_BY]: {
    choose: "Mark as blocked by…",
    head: "Mark as blocked by",
  },
  [TASK_RELATION_KIND.BLOCKS]: { choose: "Mark as blocking…", head: "Mark as blocking" },
} as const satisfies Record<TaskRelationKind, { choose: string; head: string }>;

/** Each kind's search field, saying which way round the task picked stands, and its New task, the one it makes. */
const KIND_SEARCH = {
  [TASK_RELATION_KIND.SUB_TASK]: {
    find: "Find a task to add as a sub-task",
    create: "New sub-task",
  },
  [TASK_RELATION_KIND.PARENT]: { find: "Find the parent task", create: "New parent task" },
  [TASK_RELATION_KIND.BLOCKED_BY]: {
    find: "Find the task this waits on",
    create: "New blocking task",
  },
  [TASK_RELATION_KIND.BLOCKS]: {
    find: "Find the task that waits on this",
    create: "New blocked task",
  },
} as const satisfies Record<TaskRelationKind, { find: string; create: string }>;

/** Why a task cannot take a kind, printed at its row's end. */
const WHY = {
  [TASK_RELATION_KIND.BLOCKED_BY]: { already: "Already blocks this", loop: "Waits on this task" },
  [TASK_RELATION_KIND.BLOCKS]: { already: "Already waits on this", loop: "This task waits on it" },
  [TASK_RELATION_KIND.SUB_TASK]: { already: "Already a sub-task", loop: "A parent of this task" },
  [TASK_RELATION_KIND.PARENT]: { already: "Already the parent", loop: "A sub-task of this task" },
} as const satisfies Record<TaskRelationKind, { already: string; loop: string }>;

const OTHER_REPOSITORY = "Another repository";

/** The pinned New task row's id, apart from every task's. */
const NEW_TASK_ROW_ID = "new-task";

/** Each kind as the new task New task makes stands to this one: the other side of the same relation. */
const NEW_TASK_KIND = {
  [TASK_RELATION_KIND.SUB_TASK]: TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  [TASK_RELATION_KIND.PARENT]: TASK_CREATE_RELATION_KIND.PARENT_OF,
  [TASK_RELATION_KIND.BLOCKED_BY]: TASK_CREATE_RELATION_KIND.BLOCKS,
  [TASK_RELATION_KIND.BLOCKS]: TASK_CREATE_RELATION_KIND.BLOCKED_BY,
} as const satisfies Record<TaskRelationKind, TaskCreateRelationKind>;

/**
 * The task the menu relates: a list's row of it, or the open task, whose
 * blocks the list does not carry, so a row's menu judges only the tree's
 * kinds and leaves a block already standing to the service's refusal.
 */
export type TaskRelationSubject = TaskSummary & Pick<Task, "blockedBy" | "blocks">;

/** What the menu reads and sends through: the workspace's name, which a key is drawn from, its tasks, and where a block, a parent, and a new related task go; a kind whose door is missing is offered nowhere. */
export interface TaskRelationDoor {
  readonly workspaceName: string;
  readonly tasks: readonly TaskSummary[];
  readonly onChange?: ((change: TaskBlockRequest) => void) | undefined;
  readonly onSetParent?: ((taskId: string, parentTaskId: string | null) => void) | undefined;
  /** Opens New task related to this task as `kind`, read from the new task's side. */
  readonly onNewTask?: ((kind: TaskCreateRelationKind) => void) | undefined;
}

/** An ask from the task's menus or ⌘K to open the menu on a kind, each counted so the same press opens it again. */
export interface TaskRelationAsk {
  readonly kind: TaskRelationKind;
  readonly request: number;
}

/** What the page hands the task's head: the menu's door, and the ask from the task's menus or ⌘K to open it, handed back once answered. */
export interface TaskRelationsDoor extends TaskRelationDoor {
  readonly ask?: TaskRelationAsk | undefined;
  readonly onAsked?: ((request: number) => void) | undefined;
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
  task: TaskRelationSubject,
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
  task: TaskRelationSubject,
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
        replayMasked: true,
        ...(each.status === undefined ? {} : { icon: <TaskStatusMark status={each.status} /> }),
        ...(key === undefined ? {} : { detail: key, terms: [key] }),
        ...(disabled === undefined ? {} : { disabled }),
      };
    });
}

/** Sends `otherId` related to `task` as `kind` through the door. */
function relate(
  task: TaskRelationSubject,
  door: TaskRelationDoor,
  kind: TaskRelationKind,
  otherId: string,
): void {
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

/** The kind of a picked row of the kinds; none for a row that names none. */
function kindOf(id: string): TaskRelationKind | undefined {
  return TASK_RELATION_ORDER.find((kind) => kind === id);
}

/** The kinds the door can send, each a row by its icon and what choosing it does. */
function kindRows(door: TaskRelationDoor): readonly MenuRow[] {
  return sentKinds(door).map((kind) => ({
    id: kind,
    label: KIND_VERBS[kind].choose,
    icon: <TaskRelationIcon kind={kind} />,
  }));
}

/**
 * The add menu: opened on no kind, the kinds the door can send, a pick of
 * one turning it into that kind's search, led by the way back; opened on
 * `kind`, that kind's search alone. The search lists the tasks for the
 * kind, New task for it pinned under them. A pick of a task is sent and
 * closes the menu (`onPicked`, else `onClose`). Its owner holds it open and
 * hangs it from a box of its own, or stands it in a menu's panel
 * (`embedded`).
 */
export function TaskRelationMenu({
  id,
  task,
  door,
  kind: opened,
  align = POPOVER_ALIGN.START,
  embedded = false,
  leaving,
  menuRef,
  onClose,
  onPicked = onClose,
  onLeave,
}: {
  id: string;
  task: TaskRelationSubject;
  door: TaskRelationDoor;
  /** The kind the menu opens on; none opens it on the kinds. */
  kind?: TaskRelationKind | undefined;
  align?: PopoverAlign | undefined;
  /** Whether it stands in a menu's panel, which places it, rather than hung from its owner's box. */
  embedded?: boolean | undefined;
  leaving?: boolean | undefined;
  menuRef?: ((element: HTMLElement | null) => void) | undefined;
  /** Escape's way out: the menu's close, or a panel's way back to its item. */
  onClose: () => void;
  /** A pick's way out, once a task or New task is picked; Escape's where none is said. */
  onPicked?: (() => void) | undefined;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<TaskRelationKind | undefined>(undefined);
  const kind = opened ?? chosen;
  const place = embedded ? { layer: SEARCHABLE_MENU_LAYER.EMBEDDED } : { align };
  if (kind === undefined) {
    return (
      <SearchableMenu
        {...place}
        // Keyed apart from the search, so each takes the focus afresh as it comes to stand.
        replayUnmasked
        key={TASK_RELATION_MENU}
        id={id}
        label={TASK_RELATION_MENU}
        rows={kindRows(door)}
        value={undefined}
        noMatch={TASK_RELATION_MENU}
        leaving={leaving}
        ref={menuRef}
        onPick={(picked) => setChosen(kindOf(picked))}
        onClose={onClose}
        onLeave={onLeave}
      />
    );
  }
  // Note that a search chosen from the kinds goes back to them, by its head or Escape, rather than closing.
  const back = opened === undefined ? () => setChosen(undefined) : undefined;
  const head: MenuHead = {
    words: KIND_VERBS[kind].head,
    ...(back === undefined ? {} : { back: { label: TASK_RELATION_MENU, onBack: back } }),
  };
  const { onNewTask } = door;
  const foot: FootRow[] =
    onNewTask === undefined
      ? []
      : [
          {
            id: NEW_TASK_ROW_ID,
            label: KIND_SEARCH[kind].create,
            icon: <GLYPH.ADD />,
            onPress: () => {
              onPicked();
              onNewTask(NEW_TASK_KIND[kind]);
            },
          },
        ];
  return (
    <SearchableMenu
      replayUnmasked
      {...place}
      key={kind}
      id={id}
      label={KIND_VERBS[kind].head}
      head={head}
      placeholder={KIND_SEARCH[kind].find}
      rows={relationRows(task, door, kind)}
      value={undefined}
      noMatch="No tasks match"
      foot={foot}
      leaving={leaving}
      ref={menuRef}
      onPick={(otherId) => {
        onPicked();
        relate(task, door, kind, otherId);
      }}
      onClose={back ?? onClose}
      onLeave={onLeave}
    />
  );
}

/**
 * A task's menu's Task relation: the add menu hung beside the menu as its
 * panel, as New task's + hangs its own, opened on the kinds. A pick relates
 * the task and closes the menu, and Escape goes back, from a kind's search
 * to the kinds and from the kinds to the menu. The door is read only while the panel is
 * drawn, so a list drawing a menu for every row works out none of it.
 */
export function taskRelationMenuPanel(
  id: string,
  task: TaskRelationSubject,
  door: () => TaskRelationDoor,
): MenuPanel {
  return {
    label: TASK_RELATION_MENU,
    icon: <NetworkIcon />,
    panel: ({ back, close }) => (
      <TaskRelationMenu
        id={id}
        task={task}
        door={door()}
        embedded
        onClose={back}
        onPicked={close}
        onLeave={() => undefined}
      />
    ),
  };
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
  task: TaskRelationSubject;
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
