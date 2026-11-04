import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@repo/features/task-wire";
import {
  AVATAR_SIZE,
  Avatar,
  BlockedMark,
  BUTTON_SIZE,
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  ChipName,
  IconButton,
  type ListRowNest,
  type MenuEntry,
  PencilIcon,
  ProgressCount,
  PULL_REQUEST_GLYPH,
  RELATED_TASK_CELLS,
  SKELETON_SHAPE,
  Skeleton,
  STATUS_TONE,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  TaskPriorityMark,
  TaskRow,
  TaskRowDraft,
  TaskRowSkeleton,
  TaskRows,
  TaskStatusMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TrashIcon,
  UnassignedAvatar,
} from "@repo/ui";
import { GLYPH, HandIcon, OctagonMinusIcon } from "@repo/ui/icons";
import { type ReactNode, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * task-rows.tsx -- a task's related tasks as a list of their own: each row
 * as the Tasks page's List draws it, led by the relation's kind in words so
 * it reads as a sentence, an open blocker's in the attention tone, then its
 * priority, key, and status before its name, its assignee and its open pull
 * requests after it, and its ⋯; a blocked task wearing its stop sign beside
 * its name and a parent its count of finished sub-tasks; one row nested
 * under another that folds it, rows chosen by their box, ⌘-click, and
 * ⇧-click, and a menu their ⋯, a right-click, and the menu key open; a
 * composer's dock of related tasks, bare of a box's gutter and a ⋯, its
 * rows' kinds leading and their × at their ends; and a quick add's draft
 * raised as a card over a row, its chips in their cells; and a list never
 * chosen still being read, its rows' blocks in their cells. Synthetic tasks.
 */

/** Does nothing: the catalog's menus act on nothing. */
function ignore(): void {}

/** How a related task stands to the list's task, by its words and its icon. */
const RELATION_KIND = {
  BLOCKED_BY: { words: "Blocked by", icon: <OctagonMinusIcon aria-hidden="true" /> },
  BLOCKS: { words: "Blocks", icon: <HandIcon aria-hidden="true" /> },
} as const;

type RelationKind = (typeof RELATION_KIND)[keyof typeof RELATION_KIND];

/** One synthetic task, as a row draws it. */
interface CatalogTask {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly assignee: string | undefined;
  readonly pullRequests: readonly number[];
  /** How it stands to the list's task; none for a row nested under another, which stands to its parent. */
  readonly kind?: RelationKind;
  /** Whether another task it waits on is still open. */
  readonly blocked?: boolean;
  /** How many of its sub-tasks are finished, of all of them. */
  readonly subTasks?: { readonly finished: number; readonly total: number };
}

const PARENT: CatalogTask = {
  id: "task-42",
  name: "Fix Safari login",
  key: "ACME-42",
  priority: TASK_PRIORITY.HIGH,
  status: TASK_STATUS.IN_PROGRESS,
  assignee: "Ada Lovelace",
  pullRequests: [612],
  kind: RELATION_KIND.BLOCKED_BY,
  blocked: true,
  subTasks: { finished: 1, total: 3 },
};

const CHILD: CatalogTask = {
  id: "task-43",
  name: "Invite links expire after a week",
  key: "ACME-43",
  priority: TASK_PRIORITY.MEDIUM,
  status: TASK_STATUS.TODO,
  assignee: undefined,
  pullRequests: [615, 611],
};

const RELATED: CatalogTask = {
  id: "task-39",
  name: "Rate limit search",
  key: "ACME-39",
  priority: TASK_PRIORITY.URGENT,
  status: TASK_STATUS.BACKLOG,
  assignee: "Grace Hopper",
  pullRequests: [],
  kind: RELATION_KIND.BLOCKS,
};

/** A task's own menu. */
function taskMenu(name: string): readonly (readonly MenuEntry[])[] {
  return [
    [{ label: `Rename ${name}`, icon: <PencilIcon />, onSelect: ignore }],
    [{ label: "Delete", icon: <TrashIcon />, danger: true, onSelect: ignore }],
  ];
}

/** A mark as the toolbar's compact chip, named by its words. */
function MarkChip({ mark, words }: { mark: React.JSX.Element; words: string }): React.JSX.Element {
  return (
    <Chip
      look={CHIP_LOOK.TOOLBAR}
      size={CHIP_SIZE.COMPACT}
      iconOnly
      aria-label={words}
      onClick={ignore}
    >
      {mark}
      <ChipName>{words}</ChipName>
    </Chip>
  );
}

/** One open pull request as its compact chip. */
function PullRequest({ number }: { number: number }): React.JSX.Element {
  const Glyph = PULL_REQUEST_GLYPH[PULL_REQUEST_STATE.OPEN];
  return (
    <Chip look={CHIP_LOOK.PILL} size={CHIP_SIZE.COMPACT} onClick={ignore}>
      <Glyph />
      <ChipName>{`#${number}`}</ChipName>
    </Chip>
  );
}

/** A relation's kind as the compact pill that leads its row, by its icon, its words, and a chevron; in the attention tone for a blocker still open. */
function RelationPill({
  kind,
  open = false,
}: {
  kind: RelationKind;
  open?: boolean;
}): React.JSX.Element {
  return (
    <Chip
      look={CHIP_LOOK.PILL}
      size={CHIP_SIZE.COMPACT}
      tone={open ? STATUS_TONE.ATTENTION : undefined}
      chevron
      aria-label={`Relation: ${kind.words}`}
      onClick={ignore}
    >
      {kind.icon}
      <ChipName>{kind.words}</ChipName>
    </Chip>
  );
}

/** A task's key, in the caption's muted ink. */
function Key({ task }: { task: CatalogTask }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {task.key}
    </Text>
  );
}

/** One task's row, nested and folding as said, and read at its place among its siblings. */
function CatalogTaskRow({
  task,
  depth,
  nest,
  fold,
}: {
  task: CatalogTask;
  depth?: number;
  nest?: ListRowNest;
  fold?: { open: boolean; onOpenChange: (open: boolean) => void };
}): React.JSX.Element {
  return (
    <TaskRow
      taskId={task.id}
      name={task.name}
      beside={task.blocked === true ? <BlockedMark aria-hidden="true" /> : undefined}
      cells={RELATED_TASK_CELLS}
      content={{
        [TASK_ROW_CELL.PRIORITY]: (
          <MarkChip mark={<TaskPriorityMark priority={task.priority} />} words={task.priority} />
        ),
        [TASK_ROW_CELL.RELATION]:
          task.kind === undefined ? null : (
            <RelationPill kind={task.kind} open={task.kind === RELATION_KIND.BLOCKED_BY} />
          ),
        [TASK_ROW_CELL.KEY]: <Key task={task} />,
        [TASK_ROW_CELL.STATUS]: (
          <MarkChip mark={<TaskStatusMark status={task.status} />} words={task.status} />
        ),
        [TASK_ROW_CELL.ASSIGNEE]:
          task.assignee === undefined ? (
            <UnassignedAvatar size={AVATAR_SIZE.MARK} />
          ) : (
            <Avatar name={task.assignee} size={AVATAR_SIZE.MARK} />
          ),
        [TASK_ROW_CELL.PULL_REQUESTS]: task.pullRequests.map((number) => (
          <PullRequest key={number} number={number} />
        )),
        [TASK_ROW_CELL.SUB_TASKS]:
          task.subTasks === undefined ? null : (
            <ProgressCount
              done={task.subTasks.finished}
              total={task.subTasks.total}
              label={`${task.subTasks.finished} of ${task.subTasks.total} sub-tasks finished`}
            />
          ),
      }}
      menu={{ thing: "Task", groups: taskMenu(task.name) }}
      onOpen={ignore}
      depth={depth}
      nest={nest}
      fold={fold === undefined ? undefined : { ...fold, label: `Child tasks of ${task.name}` }}
    />
  );
}

/**
 * Three related tasks, the second nested under the first, which folds it: a
 * reader hears the first and the third at level 1, 1 and 2 of 2, and the
 * second at level 2, 1 of 1, though the three stand flat in one list.
 */
function RelatedTasks(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <TaskRows label="Related tasks" selection={{ selected, onChange: setSelected }}>
      <CatalogTaskRow
        task={PARENT}
        nest={{ position: 1, size: 2 }}
        fold={{ open, onOpenChange: setOpen }}
      />
      {open ? <CatalogTaskRow task={CHILD} depth={1} nest={{ position: 1, size: 1 }} /> : null}
      <CatalogTaskRow task={RELATED} nest={{ position: 2, size: 2 }} />
    </TaskRows>
  );
}

/** The cells a composer's dock draws of each related task: its relation, key, status, name, and the × that takes it away. */
const DOCK_CELLS = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.END,
] as const;

/** One related task in a composer's dock: bare of a box and a ⋯, its kind leading and its × at its end. */
function DockRow({ task, remove }: { task: CatalogTask; remove: ReactNode }): React.JSX.Element {
  return (
    <TaskRow
      taskId={task.id}
      name={task.name}
      cells={DOCK_CELLS}
      edges={TASK_ROW_EDGES.BARE}
      content={{
        [TASK_ROW_CELL.RELATION]:
          task.kind === undefined ? null : <RelationPill kind={task.kind} />,
        [TASK_ROW_CELL.KEY]: <Key task={task} />,
        [TASK_ROW_CELL.STATUS]: (
          <MarkChip mark={<TaskStatusMark status={task.status} />} words={task.status} />
        ),
        [TASK_ROW_CELL.END]: remove,
      }}
      onOpen={ignore}
    />
  );
}

/** A composer's dock of the tasks a new task will be related to, each row bare, its first cell at its inset and its × at its end. */
function ComposerDock(): React.JSX.Element {
  const [docked, setDocked] = useState<readonly CatalogTask[]>([PARENT, RELATED]);
  return (
    <TaskRows label="Related tasks" cells={DOCK_CELLS} edges={TASK_ROW_EDGES.BARE}>
      {docked.map((task) => (
        <DockRow
          key={task.id}
          task={task}
          remove={
            <IconButton
              icon={<GLYPH.CLOSE />}
              label={`Remove ${task.name}`}
              size={BUTTON_SIZE.COMPACT}
              onClick={() => setDocked((was) => was.filter((each) => each.id !== task.id))}
            />
          }
        />
      ))}
    </TaskRows>
  );
}

/** A quick add's draft over a row, its chips standing in their cells. */
function DraftOverRow(): React.JSX.Element {
  return (
    <TaskRows label="Child tasks">
      <TaskRowDraft
        cells={RELATED_TASK_CELLS}
        content={{
          [TASK_ROW_CELL.PRIORITY]: (
            <MarkChip mark={<TaskPriorityMark priority={TASK_PRIORITY.NONE} />} words="none" />
          ),
          [TASK_ROW_CELL.STATUS]: (
            <MarkChip mark={<TaskStatusMark status={TASK_STATUS.TODO} />} words="todo" />
          ),
          [TASK_ROW_CELL.ASSIGNEE]: <UnassignedAvatar size={AVATAR_SIZE.MARK} />,
        }}
        name="Check the invite email copy"
        drafting
        pending={false}
      />
      <CatalogTaskRow task={RELATED} />
    </TaskRows>
  );
}

/** The cells a glance at a task draws, as Home's Recent does. */
const GLANCE_CELLS = [
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.REPOSITORY,
  TASK_ROW_CELL.AGENTS,
  TASK_ROW_CELL.UPDATED,
] as const;

/** How wide each placeholder row's name stands. */
const READING_NAMES = ["46%", "38%", "54%"] as const;

/** A list never chosen still being read: each row's own cells holding blocks. */
function ReadingRowsSkeleton(): React.JSX.Element {
  return (
    <TaskRows label="Recent" cells={GLANCE_CELLS} edges={TASK_ROW_EDGES.UNCHOSEN}>
      {READING_NAMES.map((name) => (
        <TaskRowSkeleton
          key={name}
          cells={GLANCE_CELLS}
          name={name}
          edges={TASK_ROW_EDGES.UNCHOSEN}
          content={{
            [TASK_ROW_CELL.STATUS]: <Skeleton shape={SKELETON_SHAPE.CIRCLE} width="16px" />,
            [TASK_ROW_CELL.REPOSITORY]: <Skeleton width="72px" />,
            [TASK_ROW_CELL.UPDATED]: <Skeleton width="24px" />,
          }}
        />
      ))}
    </TaskRows>
  );
}

function TaskRowsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection
        id="task-rows"
        title="A task's related tasks, led by their relations, one nested"
      >
        <RelatedTasks />
      </CatalogSection>
      <CatalogSection id="task-rows-dock" title="A composer's dock of related tasks, bare">
        <ComposerDock />
      </CatalogSection>
      <CatalogSection id="task-row-draft" title="A quick add's draft over a row">
        <DraftOverRow />
      </CatalogSection>
      <CatalogSection id="task-rows-reading" title="A list never chosen, still being read">
        <ReadingRowsSkeleton />
      </CatalogSection>
    </>
  );
}

export const TASK_ROWS_EXAMPLE: Example = {
  id: "task-rows",
  title: "Task rows",
  Render: TaskRowsExample,
};
