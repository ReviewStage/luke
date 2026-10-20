import {
  TASK_BOUNDS,
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskStanding,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  CHIP_LOOK,
  CHIP_SIZE,
  CHOICE_BAR_LOOK,
  Chip,
  ChipName,
  ChoiceBar,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  dropBelowStart,
  EllipsisIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  IconButton,
  InlineEdit,
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
  useMenu,
} from "@luke/ui";
import { creatorActor } from "@luke/ui/actor-model";
import { type TaskBoardColumn, taskBoardColumns } from "@luke/ui/task-list-model";
import { RENAME_FAILED_NOTE } from "@luke/ui/tasks-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { Schema } from "effect";
import { SquareKanbanIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { TASK_PRIORITY_WORDS, TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import { useReadMarks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { Tooltip } from "../tooltip.js";
import { ActionMenu } from "./action-menu.js";
import { readKept, writeKept } from "./folded-groups.js";
import { useTaskMenu } from "./task-actions.js";
import { useRowDrag } from "./use-row-drag.js";

/**
 * tasks-board.tsx -- the Tasks page's Board: the listed workspace's tasks on a column for each status, in the order work moves through them.
 *
 * It is one of the Tasks page's two views (`tasks-page.tsx`), which stands
 * in the plan's place beside the sidebar, as Factory does. A column is a quiet well headed by
 * its status's mark, its name, and how many tasks stand in it, and scrolls
 * its own cards, the most pressing first. A card is raised off the well:
 * its key and its creator's face over its whole name, and at its foot the
 * chips that change its priority and its status where it stands, its
 * repository, and a ⋯ dropping the task's own menu, the sidebar row's, which
 * a right-click drops too and whose Rename makes the card's name its field.
 * A press anywhere else opens the task. A card dragged onto another column
 * is sent that column's status, as the task page's Status chip sends it,
 * and stands where it was until the list read again says otherwise; a
 * change the service did not keep says so, whether dragged or picked.
 * Backlog, Todo, In progress, and Done stand at first; Canceled is a filter
 * of the toolbar's, kept on this Mac as the sidebar's view is
 * (`folded-groups.ts`). A task archived is off the board, as it is off the
 * sidebar's list. A task from a service before statuses stands under Todo,
 * where a task starts, and is sent nothing until it is dragged. Escape
 * closes the board, as it closes Factory.
 *
 * A narrow room, a phone's, has no width for columns side by side, nor a
 * second column in sight to drag a card onto: it stands one column at a
 * time across the whole page, chosen by a tab for each status above it
 * (Todo at first), and each card's Status chip says its status in words,
 * since its pick is how a card moves there without a drag.
 */

/** The columns the board stands before Canceled is asked for. */
const OPEN_COLUMNS: readonly TaskStatus[] = TASK_STATUS_ORDER.filter(
  (status) => status !== TASK_STATUS.CANCELED,
);

/** Where whether the board shows Canceled is kept in the renderer's storage. */
const CANCELED_KEY = "luke.boardShowsCanceled";

const storedCanceled = Schema.fromJsonString(Schema.Boolean);

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

/** A repository's own name, without its owner, as a card has room for. */
function repositoryName(repository: string): string {
  return repository.slice(repository.indexOf("/") + 1);
}

/** What a press must land on to carry a card: the press that opens it, which reaches every edge of the card but its foot's controls. */
const CARD_HANDLE = ".tasks-board-card-press";

/** The column a narrow board shows first: where a task starts. */
const FIRST_SHOWN: TaskStatus = TASK_STATUS.TODO;

/** What the tabs choosing a narrow board's column are called, to a screen reader. */
const COLUMN_TABS = "Status";

/** A card's chip that names one of a task's standings by its mark and drops the menu that changes it, each value with its mark, the one standing checked. */
function CardStandingChip<T extends string>({
  label,
  value,
  order,
  words,
  mark,
  named,
  onPick,
}: {
  /** What it changes, Status or Priority, which its tooltip and its menu say before the value. */
  label: string;
  value: T;
  order: readonly T[];
  words: Readonly<Record<T, string>>;
  mark: (value: T) => React.JSX.Element;
  /** Whether it says its value in words beside its mark, as on a phone, where it is how a card moves. */
  named: boolean;
  onPick: (value: T) => void;
}): React.JSX.Element {
  const { drawn, close, trigger } = useMenu(true);
  const name = `${label}: ${words[value]}`;
  return (
    <>
      <Tooltip label={name}>
        <Chip
          look={CHIP_LOOK.FIELD}
          size={CHIP_SIZE.COMPACT}
          iconOnly={!named}
          aria-label={name}
          {...trigger(dropBelowStart)}
        >
          {mark(value)}
          <ChipName>{words[value]}</ChipName>
        </Chip>
      </Tooltip>
      {drawn === undefined ? null : (
        <ActionMenu
          label={label}
          menu={drawn}
          groups={[
            order.map((each) => ({
              label: words[each],
              icon: mark(each),
              checked: each === value,
              onSelect: () => {
                if (each !== value) onPick(each);
              },
            })),
          ]}
          onClose={close}
        />
      )}
    </>
  );
}

/**
 * One task's card: its key and its creator's face over its name, one press
 * that opens it, and at its foot the chips that change it where it stands,
 * its priority and its status, its repository, and the ⋯ dropping the
 * task's own menu, which a right-click opens too. Renamed from that menu,
 * its name is its field until the edit ends. On a phone the status chip
 * says its status in words, since it is how a card moves there.
 */
function TaskBoardCard({
  tasks,
  task,
  workspaceName,
  narrow,
  onOpen,
  onStanding,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  workspaceName: string;
  narrow: boolean;
  onOpen: () => void;
  onStanding: (standing: TaskStanding) => void;
}): React.JSX.Element {
  const creator = creatorActor(task, useMemberDirectory(), undefined);
  const reads = useReadMarks();
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  const actions = useTaskMenu(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread: reads.markedUnread(task.id),
  });
  const press = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    press.current?.focus();
  }, [rename.editing]);
  const head = (
    <span className="tasks-board-card-head">
      {task.number === undefined ? null : (
        <span className="tasks-board-key">{taskKey(workspaceName, task.number)}</span>
      )}
      <span className="tasks-board-face">
        <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />
      </span>
    </span>
  );
  return (
    <li
      className="tasks-board-card"
      data-task-id={task.id}
      data-menu-open={actions.open ? "true" : undefined}
      data-editing={rename.editing ? "true" : undefined}
    >
      {rename.editing ? (
        <div className="tasks-board-card-press">
          {head}
          <span className="tasks-board-name">
            <InlineEdit
              value={task.name}
              label="Task name"
              maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
              editing
              onEnd={(edit) => {
                refocus.current = edit.byKey;
                void rename.end(edit.value);
              }}
            />
          </span>
        </div>
      ) : (
        <button
          ref={press}
          type="button"
          className="tasks-board-card-press"
          disabled={actions.deletion.busy}
          onClick={() => {
            actions.close(false);
            onOpen();
          }}
          onKeyDown={actions.keyMenu}
          {...actions.contextMenu(press)}
        >
          {head}
          <span className="tasks-board-name">{task.name}</span>
        </button>
      )}
      {rename.refused ? (
        <span className="tasks-board-card-note" role="alert">
          {RENAME_FAILED_NOTE}
        </span>
      ) : null}
      <div className="tasks-board-card-foot">
        {/* Note that a task from a service before priorities offers No priority, as one before statuses stands under Todo. */}
        <CardStandingChip
          label="Priority"
          value={task.priority ?? TASK_PRIORITY.NONE}
          order={TASK_PRIORITY_ORDER}
          words={TASK_PRIORITY_WORDS}
          mark={(priority) => <TaskPriorityMark priority={priority} />}
          named={false}
          onPick={(priority) => onStanding({ priority })}
        />
        <CardStandingChip
          label="Status"
          value={task.status ?? FIRST_SHOWN}
          order={TASK_STATUS_ORDER}
          words={TASK_STATUS_WORDS}
          mark={(status) => <TaskStatusMark status={status} />}
          named={narrow}
          onPick={(status) => onStanding({ status })}
        />
        {task.repository === null ? null : (
          <span className="tasks-board-repository">{repositoryName(task.repository)}</span>
        )}
        <span className="tasks-board-card-more">
          <Tooltip label="Task actions">
            <IconButton
              icon={<EllipsisIcon />}
              label={`Actions for ${task.name}`}
              size={BUTTON_SIZE.COMPACT}
              disabled={actions.deletion.busy}
              {...actions.trigger()}
            />
          </Tooltip>
        </span>
      </div>
      {actions.menu}
      {actions.dialog}
    </li>
  );
}

/**
 * A column: its head, and its cards or the line saying it holds none. It
 * is a drop zone of the board, and its cards are dragged out of it onto
 * another; dropped there, a card's task is sent that column's status.
 */
function TaskBoardColumnView({
  tasks,
  column,
  workspaceName,
  narrow,
  panelId,
  onOpen,
  onStanding,
}: {
  tasks: TasksControl;
  column: TaskBoardColumn;
  workspaceName: string;
  /** Whether the room is a phone's: the column stands alone, as its tab's panel, its cards moved by their chips, not dragged. */
  narrow: boolean;
  panelId: string;
  onOpen: (task: TaskSummary) => void;
  onStanding: (task: TaskSummary, standing: TaskStanding) => void;
}): React.JSX.Element {
  // Note that a card is carried by its press alone, so a press on one of its chips, its ⋯, or a menu they drop stays that control's.
  const drag = useRowDrag(undefined, {
    handle: CARD_HANDLE,
    onDropOut: (from, zone) => {
      const task = column.tasks[from];
      const status = TASK_STATUS_ORDER.find((each) => each === zone);
      if (task === undefined || status === undefined || status === task.status) return;
      onStanding(task, { status });
    },
  });
  const words = TASK_STATUS_WORDS[column.status];
  return (
    <section
      className="tasks-board-column"
      data-task-column={column.status}
      data-row-drop={column.status}
      aria-label={words}
      id={narrow ? panelId : undefined}
      role={narrow ? "tabpanel" : undefined}
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
          <ScrollArea
            size={narrow ? SCROLL_SIZE.FILL : SCROLL_SIZE.CONTENT}
            fade={SCROLL_FADE.BOTH}
          >
            <ul className="tasks-board-cards" onPointerDown={narrow ? undefined : drag}>
              {column.tasks.map((task) => (
                <TaskBoardCard
                  key={task.id}
                  tasks={tasks}
                  task={task}
                  workspaceName={workspaceName}
                  narrow={narrow}
                  onOpen={() => onOpen(task)}
                  onStanding={(standing) => onStanding(task, standing)}
                />
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </section>
  );
}

/** The Tasks page's Board: the listed workspace's tasks by status. */
export function TasksBoard({
  tasks,
  room,
  title,
  switcher,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  /** What the toolbar calls the page: the Tasks page's name. */
  title: string;
  /** The Tasks page's List | Board switch, beside the title. */
  switcher: ReactNode;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, tasks.boardView.onClose);
  const toast = useToast();
  const ids = useId();
  const [canceled, setCanceled] = useState(() => readKept(CANCELED_KEY, storedCanceled, false));
  const [chosen, setChosen] = useState<TaskStatus>(FIRST_SHOWN);
  const listed = tasks.listed.tasks;
  const statuses = canceled ? TASK_STATUS_ORDER : OPEN_COLUMNS;
  const columns = taskBoardColumns(listed, statuses);
  const narrow = room === SHELL_ROOM.NARROW;
  // Note that Canceled hidden again while its column was shown shows the first column again, rather than none.
  const shown = statuses.includes(chosen) ? chosen : FIRST_SHOWN;
  const panelId = `${ids}panel`;
  const tabs = narrow ? (
    <div className="tasks-board-tabs">
      <ChoiceBar
        label={COLUMN_TABS}
        items={columns.map((column) => ({
          value: column.status,
          label: TASK_STATUS_WORDS[column.status],
          icon: <TaskStatusMark status={column.status} />,
          count: column.tasks.length === 0 ? undefined : String(column.tasks.length),
        }))}
        value={shown}
        look={CHOICE_BAR_LOOK.FILL}
        panels={(status) => ({ tab: `${ids}tab-${status}`, panel: panelId })}
        onChange={setChosen}
      />
    </div>
  ) : null;
  const workspaceName = tasks.workspace?.name ?? "";
  const setStanding = (task: TaskSummary, standing: TaskStanding) => {
    void tasks.onSetTaskStanding(task.id, standing).then((kept) => {
      if (!kept) toast({ words: UNCHANGED_LINE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    });
  };
  const toolbar = (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">{title}</h1>
        {switcher}
      </div>
      <div className="desktop-toolbar-actions">
        <Chip
          look={CHIP_LOOK.FILTER}
          aria-pressed={canceled}
          onClick={() => {
            setCanceled(!canceled);
            // Note that Canceled hidden while its column is shown lets the choice go, so showing it again does not bring it back unasked.
            if (canceled && chosen === TASK_STATUS.CANCELED) setChosen(FIRST_SHOWN);
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
      label={title}
      toolbar={toolbar}
      filters={tabs}
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
          {(narrow ? columns.filter((column) => column.status === shown) : columns).map(
            (column) => (
              <TaskBoardColumnView
                key={column.status}
                tasks={tasks}
                column={column}
                workspaceName={workspaceName}
                narrow={narrow}
                panelId={panelId}
                onOpen={(task) => tasks.onSelect(task.id)}
                onStanding={setStanding}
              />
            ),
          )}
        </div>
      </MemberDirectory>
    </CollectionPage>
  );
}
