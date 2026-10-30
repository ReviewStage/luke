import { PULL_REQUEST_STATE } from "@luke/features/agent-wire";
import {
  TASK_BOUNDS,
  type TaskPullRequestLine,
  type TaskStanding,
  type TaskSummary,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import {
  ANNOUNCE,
  BLOCKED_WORDS,
  BlockedMark,
  CHIP_LOOK,
  InlineEdit,
  ListRowCount,
  type ListRowFold,
  TASK_ROW_CELL,
  TaskRow,
  type TaskRowCell,
  VisuallyHidden,
} from "@luke/ui";
import { type ChildTaskCount, repositoryLabel } from "@luke/ui/task-list-model";
import { RENAME_FAILED_NOTE } from "@luke/ui/tasks-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { type ReactNode, useRef } from "react";
import { FIND_SKIP_ATTRIBUTE } from "../find-matches.js";
import { PullRequestCard } from "../tasks/pull-request-card.js";
import { PullRequestChip } from "../tasks/pull-request-chip.js";
import { TASK_STATUS_WORDS, TaskKey } from "../tasks/task-standing.js";
import { openerOf } from "../tasks/use-link-standing.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useReadMarks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { rowMenu } from "./action-menu.js";
import { TASK_MENU_SURFACE, useTaskMenuItems } from "./task-actions.js";
import { AssigneeChip, PriorityChip, StatusChip, statusOf, taskSubject } from "./task-row-parts.js";
import { type ChosenTasks, chosenRowMenu } from "./tasks-selection.js";

/**
 * task-list-row.tsx -- one task's row as every list of tasks draws it: the Tasks page's List and a task's related tasks alike, so the two never drift.
 *
 * It is `@luke/ui`'s `TaskRow` (`task-row.tsx`) filled with the task: its
 * press opens it; the chips that change its priority, its status, and its
 * assignee stand where it stands, each changing it there
 * (`task-row-parts.tsx`); its key; and each of its open pull requests as the
 * compact chip the plan's Agents list draws (`pull-request-chip.tsx`),
 * hanging the pull request's card and opening it as a link to it does
 * (`use-open-link.ts`). The rest of a list's cells are the list's own
 * (`content`): the Tasks page's what waits on the reader, its repository,
 * its creator, its agents, and its time; a related task's kind at its end.
 * Each cell stands only where the row's list draws it (`cells`). Beside its
 * name stands the stop sign of a task blocked by another (`BlockedMark`),
 * which the press says after the status, and in its own cell how many of
 * its sub-tasks are finished, "1/3", as the sidebar's row says it.
 *
 * Its menu is the task's own, whose Rename makes its name its field until
 * the edit ends; chosen among several, its ⋯, right-click, and menu key
 * offer the selection bar's acts on every task chosen, as a Mac's list
 * does, and one not chosen keeps its own menu.
 */

/** A pull request still open on GitHub, a draft or one in its merge queue among them, whose page the service sent, which its chip links to. */
function stillOpen(
  pullRequest: TaskPullRequestLine,
): pullRequest is TaskPullRequestLine & { readonly url: string } {
  const open =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  return open && pullRequest.url !== undefined;
}

/** Each of a task's open pull requests as its chip, hanging its card; nothing where it has none. */
function OpenPullRequests({ task }: { task: TaskSummary }): React.JSX.Element | null {
  // Its page opens as a link to it does: in its agent's Pull request tab where the window knows the agent, else on GitHub.
  const openLink = useOpenLink();
  const open = (task.agents?.pullRequests ?? []).filter(stillOpen);
  if (open.length === 0) return null;
  return (
    <>
      {open.map((pullRequest) => (
        <PullRequestChip
          key={pullRequest.url}
          pullRequest={pullRequest}
          card={
            <PullRequestCard
              pullRequest={pullRequest}
              lines={pullRequest}
              opener={openerOf(pullRequest)}
            />
          }
          onOpen={() => openLink(pullRequest.url)}
        />
      ))}
    </>
  );
}

/** One task's row, its cells those its list draws. */
export function TaskListRow({
  tasks,
  task,
  workspaceName,
  cells,
  content,
  repositoryName,
  assigneeHeld = false,
  subTasks,
  chosen,
  onOpen,
  onStanding,
  depth,
  fold,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  workspaceName: string;
  /** The cells its list draws, the same for every row of it. */
  cells: readonly TaskRowCell[];
  /** What its list stands in the cells only that list draws, beside the chips, key, and pull requests every row draws. */
  content?: Partial<Record<TaskRowCell, ReactNode>> | undefined;
  /** The task's repository as its menu's head says it: its name alone, unless another repository the list draws shares it. */
  repositoryName?: string | undefined;
  /** Whether its group's head says who it is assigned to, so its own assignee's cell stands empty. */
  assigneeHeld?: boolean | undefined;
  /** How many of its sub-tasks are finished, of all of them, in the cell that says it; none where it has none. */
  subTasks?: ChildTaskCount | undefined;
  /** The selection it stands in, where it is one of several chosen: how many, and what the bar does to them all. */
  chosen: ChosenTasks | undefined;
  onOpen: () => void;
  onStanding: (standing: TaskStanding) => void;
  /** How deep it stands nested under other rows: 0, at the top, unless said. */
  depth?: number | undefined;
  /** The rows nested under it, which it folds; none where it holds none. */
  fold?: ListRowFold | undefined;
}): React.JSX.Element {
  const reads = useReadMarks();
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  useAnnounceShown(ANNOUNCE.ALERT, rename.refused ? RENAME_FAILED_NOTE : "");
  const actions = useTaskMenuItems(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread: reads.markedUnread(task.id),
    surface: TASK_MENU_SURFACE.ROW,
  });
  const press = useRef<HTMLButtonElement | null>(null);
  const key = task.number === undefined ? undefined : taskKey(workspaceName, task.number);
  const repository =
    task.repository === null
      ? undefined
      : (repositoryName ?? repositoryLabel(task.repository, [{ repository: task.repository }]));
  const own = {
    ...rowMenu("Task", actions.groups(), tasks.shown),
    footer: actions.footer,
    subject: taskSubject(task, repository, key),
  };
  const menu = rename.editing
    ? undefined
    : chosen === undefined
      ? own
      : chosenRowMenu(own.thing, chosen, tasks.shown);
  const endedByKey = useRefocusAfterEdit(rename.editing, press);
  const drawn = (cell: TaskRowCell) => cells.includes(cell);
  // Note that the marks before the name are a control and decoration to a screen reader, so the key and status are said in the press, and left out of find, which finds them drawn.
  const spoken = [
    drawn(TASK_ROW_CELL.KEY) ? key : undefined,
    drawn(TASK_ROW_CELL.STATUS) ? TASK_STATUS_WORDS[statusOf(task)] : undefined,
    task.blocked === true ? BLOCKED_WORDS : undefined,
  ]
    .filter((each) => each !== undefined)
    .map((each) => `, ${each}`)
    .join("");
  return (
    <TaskRow
      taskId={task.id}
      name={task.name}
      said={
        spoken === "" ? undefined : (
          <VisuallyHidden {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>{spoken}</VisuallyHidden>
        )
      }
      beside={task.blocked === true ? <BlockedMark aria-hidden="true" /> : undefined}
      cells={cells}
      content={{
        // Note that a task from a service before priorities offers No priority, as one before statuses stands under Todo.
        [TASK_ROW_CELL.PRIORITY]: (
          <PriorityChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
        ),
        [TASK_ROW_CELL.KEY]: (
          <TaskKey workspaceName={workspaceName} number={task.number} decorative />
        ),
        [TASK_ROW_CELL.STATUS]: (
          <StatusChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
        ),
        [TASK_ROW_CELL.ASSIGNEE]: assigneeHeld ? null : (
          <AssigneeChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
        ),
        [TASK_ROW_CELL.PULL_REQUESTS]: drawn(TASK_ROW_CELL.PULL_REQUESTS) ? (
          <OpenPullRequests task={task} />
        ) : null,
        [TASK_ROW_CELL.SUB_TASKS]:
          subTasks === undefined ? null : (
            <ListRowCount
              settled={subTasks.finished}
              total={subTasks.total}
              label={`${subTasks.finished} of ${subTasks.total} sub-tasks finished`}
            />
          ),
        ...content,
      }}
      editor={
        rename.editing ? (
          <InlineEdit
            value={rename.asked ?? task.name}
            label="Task name"
            maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
            editing
            onEnd={(edit) => {
              endedByKey(edit.byKey);
              void rename.end(edit.value);
            }}
          />
        ) : undefined
      }
      note={rename.refused ? RENAME_FAILED_NOTE : undefined}
      menu={menu}
      disabled={actions.deletion.busy}
      onOpen={onOpen}
      pressRef={press}
      depth={depth}
      fold={fold}
    >
      {actions.dialog}
    </TaskRow>
  );
}
