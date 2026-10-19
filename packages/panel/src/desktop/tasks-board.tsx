import {
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  PAGE_FRAME,
  PAGE_WIDTH,
  SCROLL_FADE,
  SCROLL_SIZE,
  ScrollArea,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { creatorActor } from "@luke/ui/actor-model";
import { type TaskBoardColumn, taskBoardColumns } from "@luke/ui/task-list-model";
import { Schema } from "effect";
import { SquareKanbanIcon } from "lucide-react";
import { useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { readKept, writeKept } from "./folded-groups.js";
import { useRowDrag } from "./use-row-drag.js";

/**
 * tasks-board.tsx -- the window's Board: the listed workspace's tasks on a column for each status, in the order work moves through them.
 *
 * It stands in the plan's place beside the sidebar, as Factory does, and its
 * sidebar row is marked while it does. A column is boxed and headed as the
 * Issues board's are, by its status's mark, its name, and how many tasks
 * stand in it, and scrolls its own cards, the most pressing first. A card
 * is a row of the sidebar's own on two lines: its priority's mark, its key,
 * and its creator's face over its whole name. A press opens the task. A
 * card dragged onto another column is sent that column's status, as the
 * task page's Status chip sends it, and stands where it was until the list
 * read again says otherwise; a change the service did not keep says so.
 * Backlog, Todo, In progress, and Done stand at first; Canceled is a filter
 * of the toolbar's, kept on this Mac as the sidebar's view is
 * (`folded-groups.ts`). A task archived is off the board, as it is off the
 * sidebar's list.
 */

/** The columns the board stands before Canceled is asked for. */
const OPEN_COLUMNS: readonly TaskStatus[] = TASK_STATUS_ORDER.filter(
  (status) => status !== TASK_STATUS.CANCELED,
);

/** Where whether the board shows Canceled is kept in the renderer's storage. */
const CANCELED_KEY = "luke.boardShowsCanceled";

const storedCanceled = Schema.fromJsonString(Schema.Boolean);

/** What the page is called, on its toolbar and to a screen reader. */
const BOARD = "Board";

/** What the page is read as while the tasks are. */
const READING_LINE = "Reading tasks";

/** What the page says where the tasks could not be read. */
const UNREAD_LINE = "Your tasks could not be read.";

/** What a column with no task says in its own place. */
const NO_TASKS = "No tasks";

/** What a change the service did not keep says. */
const UNCHANGED_LINE = "Couldn't change the task. Try again.";

/** What the page stands: its read, or none of the workspace's tasks. */
function boardState(tasks: TasksControl, empty: boolean): CollectionState {
  if (tasks.listFailed && empty) return COLLECTION_STATE.ERROR;
  if (!tasks.listRead && !tasks.listFailed) return COLLECTION_STATE.LOADING;
  return empty ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY;
}

/** One task's card: its priority, key, and creator's face over its name, one press that opens it. */
function TaskBoardCard({
  task,
  workspaceName,
  onOpen,
}: {
  task: TaskSummary;
  workspaceName: string;
  onOpen: () => void;
}): React.JSX.Element {
  const creator = creatorActor(task, useMemberDirectory(), undefined);
  return (
    <li className="sidebar-task-item home-row factory-row" data-task-id={task.id}>
      <button type="button" className="sidebar-task" onClick={onOpen}>
        <span className="sidebar-task-line">
          {task.priority === undefined ? null : <TaskPriorityMark priority={task.priority} />}
          {task.number === undefined ? null : (
            <span className="tasks-board-key">{taskKey(workspaceName, task.number)}</span>
          )}
          <span className="tasks-board-face">
            <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />
          </span>
        </span>
        <span className="sidebar-task-name tasks-board-name">{task.name}</span>
      </button>
    </li>
  );
}

/**
 * A column: its head, and its cards or the line saying it holds none. It
 * is a drop zone of the board, and its cards are dragged out of it onto
 * another; dropped there, a card's task is sent that column's status.
 */
function TaskBoardColumnView({
  column,
  workspaceName,
  onOpen,
  onStatus,
}: {
  column: TaskBoardColumn;
  workspaceName: string;
  onOpen: (task: TaskSummary) => void;
  onStatus: (task: TaskSummary, status: TaskStatus) => void;
}): React.JSX.Element {
  const drag = useRowDrag(undefined, {
    onDropOut: (from, zone) => {
      const task = column.tasks[from];
      const status = TASK_STATUS_ORDER.find((each) => each === zone);
      if (task === undefined || status === undefined || status === task.status) return;
      onStatus(task, status);
    },
  });
  const words = TASK_STATUS_WORDS[column.status];
  return (
    <section
      className="tasks-board-column"
      data-task-column={column.status}
      data-row-drop={column.status}
      aria-label={words}
    >
      <h2 className="tasks-board-column-head">
        <TaskStatusMark status={column.status} />
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION} truncate>
          {words}
        </Text>
        {column.tasks.length === 0 ? null : (
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
            {column.tasks.length}
          </Text>
        )}
      </h2>
      {column.tasks.length === 0 ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {NO_TASKS}
        </Text>
      ) : (
        <div className="tasks-board-column-scroll">
          <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
            <ul className="sidebar-tasks tasks-board-cards" onPointerDown={drag}>
              {column.tasks.map((task) => (
                <TaskBoardCard
                  key={task.id}
                  task={task}
                  workspaceName={workspaceName}
                  onOpen={() => onOpen(task)}
                />
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </section>
  );
}

/** The window's Board, in the plan's place: the listed workspace's tasks by status. */
export function TasksBoard({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const toast = useToast();
  const [canceled, setCanceled] = useState(() => readKept(CANCELED_KEY, storedCanceled, false));
  const listed = tasks.listed.tasks;
  const statuses = canceled ? TASK_STATUS_ORDER : OPEN_COLUMNS;
  const columns = taskBoardColumns(listed, statuses);
  const workspaceName = tasks.workspace?.name ?? "";
  const setStatus = (task: TaskSummary, status: TaskStatus) => {
    void tasks.onSetTaskStanding(task.id, { status }).then((kept) => {
      if (!kept) toast({ words: UNCHANGED_LINE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    });
  };
  const toolbar = (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">{BOARD}</h1>
      </div>
      <div className="desktop-toolbar-actions">
        <Chip
          look={CHIP_LOOK.FILTER}
          aria-pressed={canceled}
          onClick={() => {
            setCanceled(!canceled);
            writeKept(CANCELED_KEY, storedCanceled, !canceled);
          }}
        >
          <TaskStatusMark status={TASK_STATUS.CANCELED} />
          <ChipName>{TASK_STATUS_WORDS[TASK_STATUS.CANCELED]}</ChipName>
        </Chip>
      </div>
    </header>
  );
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      // Note that the board stands its columns across the room and scrolls sideways past it, each column scrolling its own cards.
      width={PAGE_WIDTH.FULL}
      label={BOARD}
      toolbar={toolbar}
      state={boardState(tasks, listed.length === 0)}
      loadingLabel={READING_LINE}
      empty={<EmptyState icon={<SquareKanbanIcon />}>No tasks yet</EmptyState>}
      error={
        <ErrorState onRetry={tasks.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      {/* A card's face names its creator against the listed workspace's members. */}
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <div className="tasks-board" data-row-drop-scope="">
          {columns.map((column) => (
            <TaskBoardColumnView
              key={column.status}
              column={column}
              workspaceName={workspaceName}
              onOpen={(task) => tasks.onSelect(task.id)}
              onStatus={setStatus}
            />
          ))}
        </div>
      </MemberDirectory>
    </CollectionPage>
  );
}
