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

export const TASK_RELATION_MENU = "Task relation";

export const TASK_RELATION_WORDS = {
  [TASK_RELATION_KIND.SUB_TASK]: "Sub-task",
  [TASK_RELATION_KIND.PARENT]: "Parent",
  [TASK_RELATION_KIND.BLOCKED_BY]: "Blocked by",
  [TASK_RELATION_KIND.BLOCKS]: "Blocks",
} as const satisfies Record<TaskRelationKind, string>;

export const TASK_RELATION_ORDER: readonly TaskRelationKind[] = [
  TASK_RELATION_KIND.SUB_TASK,
  TASK_RELATION_KIND.PARENT,
  TASK_RELATION_KIND.BLOCKED_BY,
  TASK_RELATION_KIND.BLOCKS,
];

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

const KIND_VERBS = {
  [TASK_RELATION_KIND.SUB_TASK]: { choose: "Add sub-task…", head: "Add sub-task" },
  [TASK_RELATION_KIND.PARENT]: { choose: "Set parent…", head: "Set parent" },
  [TASK_RELATION_KIND.BLOCKED_BY]: {
    choose: "Mark as blocked by…",
    head: "Mark as blocked by",
  },
  [TASK_RELATION_KIND.BLOCKS]: { choose: "Mark as blocking…", head: "Mark as blocking" },
} as const satisfies Record<TaskRelationKind, { choose: string; head: string }>;

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

const WHY = {
  [TASK_RELATION_KIND.BLOCKED_BY]: { already: "Already blocks this", loop: "Waits on this task" },
  [TASK_RELATION_KIND.BLOCKS]: { already: "Already waits on this", loop: "This task waits on it" },
  [TASK_RELATION_KIND.SUB_TASK]: { already: "Already a sub-task", loop: "A parent of this task" },
  [TASK_RELATION_KIND.PARENT]: { already: "Already the parent", loop: "A sub-task of this task" },
} as const satisfies Record<TaskRelationKind, { already: string; loop: string }>;

const OTHER_REPOSITORY = "Another repository";

const NEW_TASK_ROW_ID = "new-task";

const NEW_TASK_KIND = {
  [TASK_RELATION_KIND.SUB_TASK]: TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  [TASK_RELATION_KIND.PARENT]: TASK_CREATE_RELATION_KIND.PARENT_OF,
  [TASK_RELATION_KIND.BLOCKED_BY]: TASK_CREATE_RELATION_KIND.BLOCKS,
  [TASK_RELATION_KIND.BLOCKS]: TASK_CREATE_RELATION_KIND.BLOCKED_BY,
} as const satisfies Record<TaskRelationKind, TaskCreateRelationKind>;

export type TaskRelationSubject = TaskSummary & Pick<Task, "blockedBy" | "blocks">;

export interface TaskRelationDoor {
  readonly workspaceName: string;
  readonly tasks: readonly TaskSummary[];
  readonly onChange?: ((change: TaskBlockRequest) => void) | undefined;
  readonly onSetParent?: ((taskId: string, parentTaskId: string | null) => void) | undefined;
  readonly onNewTask?: ((kind: TaskCreateRelationKind) => void) | undefined;
}

export interface TaskRelationAsk {
  readonly kind: TaskRelationKind;
  readonly request: number;
}

export interface TaskRelationsDoor extends TaskRelationDoor {
  readonly ask?: TaskRelationAsk | undefined;
  readonly onAsked?: ((request: number) => void) | undefined;
}

function kindSent(door: TaskRelationDoor, kind: TaskRelationKind): boolean {
  if (kind === TASK_RELATION_KIND.BLOCKED_BY || kind === TASK_RELATION_KIND.BLOCKS) {
    return door.onChange !== undefined;
  }
  return door.onSetParent !== undefined;
}

function sentKinds(door: TaskRelationDoor): readonly TaskRelationKind[] {
  return TASK_RELATION_ORDER.filter((kind) => kindSent(door, kind));
}

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

function sameRepository(one: string | null, other: string | null): boolean {
  if (one === null || other === null) return one === other;
  return one.toLowerCase() === other.toLowerCase();
}

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

function kindOf(id: string): TaskRelationKind | undefined {
  return TASK_RELATION_ORDER.find((kind) => kind === id);
}

function kindRows(door: TaskRelationDoor): readonly MenuRow[] {
  return sentKinds(door).map((kind) => ({
    id: kind,
    label: KIND_VERBS[kind].choose,
    icon: <TaskRelationIcon kind={kind} />,
  }));
}

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
  kind?: TaskRelationKind | undefined;
  align?: PopoverAlign | undefined;
  embedded?: boolean | undefined;
  leaving?: boolean | undefined;
  menuRef?: ((element: HTMLElement | null) => void) | undefined;
  onClose: () => void;
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
  const [shown, setShown] = useState<TaskRelationAsk | undefined>(undefined);
  const drawn = useDisclosure(open !== undefined);
  const menuId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const answered = useRef<number | undefined>(undefined);
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
  const close = () => {
    setOpen(undefined);
    opener.current?.focus();
  };
  if (!drawn.mounted || shown === undefined) return null;
  return (
    <span className="task-relation-asked relative inline-flex" ref={box}>
      <TaskRelationMenu
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
