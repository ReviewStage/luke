import { PULL_REQUEST_STATE } from "@luke/features/agent-wire";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@luke/features/task-wire";
import {
  AVATAR_SIZE,
  Avatar,
  Badge,
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  ChipName,
  type MenuEntry,
  PencilIcon,
  PULL_REQUEST_GLYPH,
  RELATED_TASK_CELLS,
  STATUS_TONE,
  TASK_ROW_CELL,
  TaskPriorityMark,
  TaskRow,
  TaskRowDraft,
  TaskRows,
  TaskStatusMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TrashIcon,
  UnassignedAvatar,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * task-rows.tsx -- a task's related tasks as a list of their own: each row
 * as the Tasks page's List draws it, its priority, key, and status before
 * its name, its assignee and its open pull requests after it, then the
 * relation's kind and its ⋯; one row nested under another that folds it,
 * rows chosen by their box, ⌘-click, and ⇧-click, and a menu their ⋯, a
 * right-click, and the menu key open; and a quick add's draft raised as a
 * card over a row, its chips in their cells. Synthetic tasks.
 */

/** Does nothing: the catalog's menus act on nothing. */
function ignore(): void {}

/** One synthetic task, as a row draws it. */
interface CatalogTask {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly assignee: string | undefined;
  readonly pullRequests: readonly number[];
  readonly kind: string;
}

const PARENT: CatalogTask = {
  id: "task-42",
  name: "Fix Safari login",
  key: "ACME-42",
  priority: TASK_PRIORITY.HIGH,
  status: TASK_STATUS.IN_PROGRESS,
  assignee: "Ada Lovelace",
  pullRequests: [612],
  kind: "Blocks",
};

const CHILD: CatalogTask = {
  id: "task-43",
  name: "Invite links expire after a week",
  key: "ACME-43",
  priority: TASK_PRIORITY.MEDIUM,
  status: TASK_STATUS.TODO,
  assignee: undefined,
  pullRequests: [615, 611],
  kind: "Child",
};

const RELATED: CatalogTask = {
  id: "task-39",
  name: "Rate limit search",
  key: "ACME-39",
  priority: TASK_PRIORITY.URGENT,
  status: TASK_STATUS.BACKLOG,
  assignee: "Grace Hopper",
  pullRequests: [],
  kind: "Related",
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

/** One task's row, nested and folding as said. */
function CatalogTaskRow({
  task,
  depth,
  fold,
}: {
  task: CatalogTask;
  depth?: number;
  fold?: { open: boolean; onOpenChange: (open: boolean) => void };
}): React.JSX.Element {
  return (
    <TaskRow
      taskId={task.id}
      name={task.name}
      cells={RELATED_TASK_CELLS}
      content={{
        [TASK_ROW_CELL.PRIORITY]: (
          <MarkChip mark={<TaskPriorityMark priority={task.priority} />} words={task.priority} />
        ),
        [TASK_ROW_CELL.KEY]: (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {task.key}
          </Text>
        ),
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
        [TASK_ROW_CELL.END]: <Badge tone={STATUS_TONE.NEUTRAL}>{task.kind}</Badge>,
      }}
      menu={{ thing: "Task", groups: taskMenu(task.name) }}
      onOpen={ignore}
      depth={depth}
      fold={fold === undefined ? undefined : { ...fold, label: `Child tasks of ${task.name}` }}
    />
  );
}

/** Three related tasks, the second nested under the first, which folds it. */
function RelatedTasks(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <TaskRows label="Related tasks" selection={{ selected, onChange: setSelected }}>
      <CatalogTaskRow task={PARENT} fold={{ open, onOpenChange: setOpen }} />
      {open ? <CatalogTaskRow task={CHILD} depth={1} /> : null}
      <CatalogTaskRow task={RELATED} />
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

function TaskRowsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="task-rows" title="A task's related tasks, one nested">
        <RelatedTasks />
      </CatalogSection>
      <CatalogSection id="task-row-draft" title="A quick add's draft over a row">
        <DraftOverRow />
      </CatalogSection>
    </>
  );
}

export const TASK_ROWS_EXAMPLE: Example = {
  id: "task-rows",
  title: "Task rows",
  Render: TaskRowsExample,
};
