import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import {
  TASK_BOUNDS,
  type TaskPullRequestLine,
  type TaskStanding,
  type TaskSummary,
} from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import {
  ANNOUNCE,
  BLOCKED_WORDS,
  BlockedMark,
  CHIP_LOOK,
  InlineEdit,
  type ListRowFold,
  type ListRowNest,
  PROGRESS_COUNT_LOOK,
  ProgressCount,
  RepositoryName,
  RowHint,
  RowHintOptions,
  TASK_AGENTS_MARK_SIZE,
  TASK_ROW_CELL,
  TaskAgentsMark,
  TaskRow,
  type TaskRowCell,
  type TaskRowEdges,
  Time,
  VisuallyHidden,
} from "@repo/ui";
import { FIND_SKIP_ATTRIBUTE } from "@repo/ui/find-skip";
import { ReplayMask, ReplayUnmask, ReplayWords } from "@repo/ui/session-replay-marks";
import {
  type ChildTaskCount,
  repositoryLabel,
  TASK_ORDER,
  taskTime,
} from "@repo/ui/task-list-model";
import { RENAME_FAILED_NOTE } from "@repo/ui/tasks-model";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useRef } from "react";
import { renameWrite } from "../rename-write.js";
import { PullRequestCard } from "../tasks/pull-request-card.js";
import { PullRequestChip } from "../tasks/pull-request-chip.js";
import { TASK_STATUS_WORDS, TaskKey } from "../tasks/task-standing.js";
import { openerOf } from "../tasks/use-link-standing.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useMarkedUnread } from "../tasks/use-task-looks.js";
import { TASK_RENAME_SHAPE } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { type MenuEntry, rowMenu } from "./action-menu.js";
import {
  type OpenedTask,
  TASK_MENU_SURFACE,
  type TaskRowTab,
  useTaskMenuItems,
} from "./task-actions.js";
import { AssigneeChip, PriorityChip, StatusChip, statusOf, taskSubject } from "./task-row-parts.js";
import { type ChosenTasks, chosenRowMenu } from "./tasks-selection.js";

function stillOpen(
  pullRequest: TaskPullRequestLine,
): pullRequest is TaskPullRequestLine & { readonly url: string } {
  const open =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  return open && pullRequest.url !== undefined;
}

export function openPullRequests(task: TaskSummary) {
  return (task.agents?.pullRequests ?? []).filter(stillOpen);
}

function OpenPullRequests({ task }: { task: TaskSummary }): React.JSX.Element | null {
  const openLink = useOpenLink();
  const open = openPullRequests(task);
  if (open.length === 0) return null;
  return (
    <>
      {open.map((pullRequest) => (
        <ReplayMask key={pullRequest.url}>
          <PullRequestChip
            key={pullRequest.url}
            pullRequest={pullRequest}
            card={
              <PullRequestCard
                pullRequest={pullRequest}
                place={{ taskId: task.id }}
                lines={pullRequest}
                opener={openerOf(pullRequest)}
              />
            }
            onOpen={() => openLink(pullRequest.url)}
          />
        </ReplayMask>
      ))}
    </>
  );
}

export function TaskListRow({
  tasks,
  task,
  opened,
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
  nest,
  fold,
  settled,
  menuGroups = [],
  unlisted = false,
  more = true,
  edges,
  unread,
  card,
  place,
}: {
  tasks: TaskRowTab;
  task: TaskSummary;
  opened: OpenedTask | undefined;
  workspaceName: string;
  cells: readonly TaskRowCell[];
  content?: Partial<Record<TaskRowCell, ReactNode>> | undefined;
  repositoryName?: string | undefined;
  assigneeHeld?: boolean | undefined;
  subTasks?: ChildTaskCount | undefined;
  chosen: ChosenTasks | undefined;
  onOpen: () => void;
  onStanding: (standing: TaskStanding) => void;
  depth?: number | undefined;
  nest?: ListRowNest | undefined;
  fold?: ListRowFold | undefined;
  settled?: boolean | undefined;
  menuGroups?: readonly (readonly MenuEntry[])[] | undefined;
  unlisted?: boolean | undefined;
  more?: boolean | undefined;
  edges?: TaskRowEdges | undefined;
  unread?: boolean | undefined;
  card?: ReactNode;
  place?: VirtualRowPlace | undefined;
}): React.JSX.Element {
  const marked = useMarkedUnread(task.id);
  const renaming = useMutation(tasks.renameTask);
  const rename = useInlineRename(task.id, renameWrite(renaming, TASK_RENAME_SHAPE));
  useAnnounceShown(ANNOUNCE.ALERT, rename.refused ? RENAME_FAILED_NOTE : "");
  const drawn = (cell: TaskRowCell) => cells.includes(cell);
  const actions = useTaskMenuItems(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread: unread ?? marked,
    surface: TASK_MENU_SURFACE.ROW,
    chips: {
      status: drawn(TASK_ROW_CELL.STATUS),
      priority: drawn(TASK_ROW_CELL.PRIORITY),
      assignee: drawn(TASK_ROW_CELL.ASSIGNEE) && !assigneeHeld,
    },
    opened,
  });
  const press = useRef<HTMLButtonElement | null>(null);
  const key = task.number === undefined ? undefined : taskKey(workspaceName, task.number);
  const repository =
    task.repository === null
      ? undefined
      : (repositoryName ?? repositoryLabel(task.repository, [{ repository: task.repository }]));
  const own = unlisted
    ? rowMenu("Task", menuGroups, tasks.shown, true)
    : {
        ...rowMenu("Task", [...menuGroups, ...actions.groups()], tasks.shown, true),
        footer: actions.footer,
        subject: taskSubject(task, repository, key),
      };
  const menu = rename.editing
    ? undefined
    : chosen === undefined
      ? own
      : chosenRowMenu(own.thing, chosen, tasks.shown);
  const endedByKey = useRefocusAfterEdit(rename.editing, press);
  const spoken = [
    drawn(TASK_ROW_CELL.KEY) ? key : undefined,
    drawn(TASK_ROW_CELL.STATUS) && !unlisted ? TASK_STATUS_WORDS[statusOf(task)] : undefined,
    task.blocked === true ? BLOCKED_WORDS : undefined,
  ]
    .filter((each) => each !== undefined)
    .map((each) => `, ${each}`)
    .join("");
  const row = (
    <TaskRow
      taskId={task.id}
      name={task.name}
      said={
        spoken === "" ? undefined : (
          <VisuallyHidden {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>
            <ReplayMask>{spoken}</ReplayMask>
          </VisuallyHidden>
        )
      }
      beside={task.blocked === true ? <BlockedMark aria-hidden="true" /> : undefined}
      cells={cells}
      content={
        unlisted
          ? { ...content }
          : {
              [TASK_ROW_CELL.PRIORITY]: (
                <ReplayUnmask>
                  <PriorityChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
                </ReplayUnmask>
              ),
              [TASK_ROW_CELL.KEY]: (
                <ReplayMask>
                  <TaskKey workspaceName={workspaceName} number={task.number} decorative />
                </ReplayMask>
              ),
              [TASK_ROW_CELL.STATUS]: (
                <ReplayUnmask>
                  <StatusChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
                </ReplayUnmask>
              ),
              [TASK_ROW_CELL.ASSIGNEE]: assigneeHeld ? null : (
                <AssigneeChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
              ),
              [TASK_ROW_CELL.PULL_REQUESTS]: drawn(TASK_ROW_CELL.PULL_REQUESTS) ? (
                <OpenPullRequests task={task} />
              ) : null,
              [TASK_ROW_CELL.SUB_TASKS]:
                subTasks === undefined ? null : (
                  <ProgressCount
                    done={subTasks.finished}
                    total={subTasks.total}
                    label={`${subTasks.finished} of ${subTasks.total} sub-tasks finished`}
                    look={PROGRESS_COUNT_LOOK.BADGE}
                  />
                ),
              [TASK_ROW_CELL.REPOSITORY]: drawn(TASK_ROW_CELL.REPOSITORY) ? (
                <ReplayWords masked={task.repository !== null}>
                  <RepositoryName
                    repository={task.repository}
                    label={repository}
                    pictures={tasks.pictures}
                  />
                </ReplayWords>
              ) : null,
              [TASK_ROW_CELL.AGENTS]: drawn(TASK_ROW_CELL.AGENTS) ? (
                <TaskAgentsMark agents={task.agents} size={TASK_AGENTS_MARK_SIZE.MEDIUM} />
              ) : null,
              [TASK_ROW_CELL.UPDATED]: drawn(TASK_ROW_CELL.UPDATED) ? (
                <Time at={taskTime(task, TASK_ORDER.UPDATED)} hint={false} />
              ) : null,
              ...content,
            }
      }
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
      more={more}
      edges={edges}
      unread={unread === true}
      hint={card === undefined || rename.editing ? undefined : { Hint: RowHint, label: task.name }}
      disabled={actions.deletion.busy}
      onOpen={onOpen}
      pressRef={press}
      depth={depth}
      nest={nest}
      fold={fold}
      settled={settled}
      place={place}
    >
      {actions.dialog}
    </TaskRow>
  );
  return card === undefined ? row : <RowHintOptions card={card}>{row}</RowHintOptions>;
}
