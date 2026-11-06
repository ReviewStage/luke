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
  SCROLL_SIZE,
  ScrollArea,
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
  taskRowFit,
  UnassignedAvatar,
  VirtualTaskRows,
} from "@repo/ui";
import { GLYPH, HandIcon, OctagonMinusIcon } from "@repo/ui/icons";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { type ReactNode, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function ignore(): void {}

const RELATION_KIND = {
  BLOCKED_BY: { words: "Blocked by", icon: <OctagonMinusIcon aria-hidden="true" /> },
  BLOCKS: { words: "Blocks", icon: <HandIcon aria-hidden="true" /> },
} as const;

type RelationKind = (typeof RELATION_KIND)[keyof typeof RELATION_KIND];

interface CatalogTask {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly assignee: string | undefined;
  readonly pullRequests: readonly number[];
  readonly kind?: RelationKind;
  readonly blocked?: boolean;
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

function taskMenu(name: string): readonly (readonly MenuEntry[])[] {
  return [
    [{ label: `Rename ${name}`, icon: <PencilIcon />, onSelect: ignore }],
    [{ label: "Delete", icon: <TrashIcon />, danger: true, onSelect: ignore }],
  ];
}

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

function PullRequest({ number }: { number: number }): React.JSX.Element {
  const Glyph = PULL_REQUEST_GLYPH[PULL_REQUEST_STATE.OPEN];
  return (
    <Chip look={CHIP_LOOK.PILL} size={CHIP_SIZE.COMPACT} onClick={ignore}>
      <Glyph />
      <ChipName>{`#${number}`}</ChipName>
    </Chip>
  );
}

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

function Key({ task }: { task: CatalogTask }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {task.key}
    </Text>
  );
}

function CatalogTaskRow({
  task,
  depth,
  nest,
  fold,
  place,
}: {
  task: CatalogTask;
  depth?: number;
  nest?: ListRowNest;
  fold?: { open: boolean; onOpenChange: (open: boolean) => void };
  place?: VirtualRowPlace;
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
      place={place}
    />
  );
}

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

const RUN_TASKS = [PARENT, CHILD, RELATED] as const;

function RelatedTasksRun(): React.JSX.Element {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const fit = taskRowFit(
    RUN_TASKS.map((task) => ({
      key: task.key,
      relation: task.kind?.words,
      pullRequests: task.pullRequests.map((number) => `#${number}`),
      subTasks:
        task.subTasks === undefined
          ? undefined
          : `${task.subTasks.finished}/${task.subTasks.total}`,
    })),
  );
  return (
    <ScrollArea ref={scroller} size={SCROLL_SIZE.CONTENT}>
      <VirtualTaskRows
        label="Related tasks"
        selection={{ selected, onChange: setSelected }}
        scroller={scroller}
        keys={RUN_TASKS.map((task) => task.id)}
        fit={fit}
      >
        {(index, place) => {
          const task = RUN_TASKS[index];
          return task === undefined ? null : <CatalogTaskRow task={task} place={place} />;
        }}
      </VirtualTaskRows>
    </ScrollArea>
  );
}

const DOCK_CELLS = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.END,
] as const;

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

const GLANCE_CELLS = [
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.REPOSITORY,
  TASK_ROW_CELL.AGENTS,
  TASK_ROW_CELL.UPDATED,
] as const;

const READING_NAMES = ["46%", "38%", "54%"] as const;

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
      <CatalogSection id="task-rows-run" title="Related tasks drawn only near the view">
        <RelatedTasksRun />
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
