import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { TASK_ISSUE_PROVIDER, type TaskIssueProvider } from "@luke/features/task-issue-wire";
import {
  TASK_BOUNDS,
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskStanding,
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
  PROVIDER_MARK_SIZE,
  ProviderMark,
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
import { RENAME_FAILED_NOTE } from "@luke/ui/tasks-model";
import {
  COMPLETED_WINDOW,
  TASK_PROPERTY,
  TASKS_GROUP,
  type TaskProperty,
  type TasksGroup,
  type TasksGroupHead,
  tasksBoardColumns,
} from "@luke/ui/tasks-page-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { SquareKanbanIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useMemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { issueTagWords } from "../tasks/task-issue-links-model.js";
import { TASK_PRIORITY_WORDS, TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import { useMinute } from "../tasks/task-time.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useReadMarks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { Tooltip } from "../tooltip.js";
import { ActionMenu } from "./action-menu.js";
import { useTaskMenu } from "./task-actions.js";
import { OlderCompleted, type TasksViewFrame } from "./tasks-page-options.js";
import { useRowDrag } from "./use-row-drag.js";

/**
 * tasks-board.tsx -- the Tasks page's Board: the listed workspace's tasks on a column for each status, or each priority, in the order work moves through them.
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
 * is sent that column's status, or its priority, as the task page's chips
 * send them, and stands where it was until the list read again says
 * otherwise; a change the service did not keep says so, whether dragged or
 * picked. Which columns stand, what each holds, its order, and what a card
 * draws are the Tasks page's filter and the Board's own display
 * (`tasks-page-model.ts`): Backlog, Todo, In progress, and Done at first,
 * Canceled once asked for. A task archived is off the board, as it is off
 * the sidebar's list. A task from a service before statuses stands under
 * Todo, where a task starts, and is sent nothing until it is dragged.
 * Escape closes the board, as it closes Factory.
 *
 * A narrow room, a phone's, has no width for columns side by side, nor a
 * second column in sight to drag a card onto: it stands one column at a
 * time across the whole page, chosen by a tab for each column above it
 * (Todo at first), and each card's Status chip says its status in words,
 * since its pick is how a card moves there without a drag.
 */

/** What the page is read as while the tasks are. */
const READING_LINE = "Reading tasks";

/** What the page says where the tasks could not be read. */
const UNREAD_LINE = "Your tasks could not be read.";

/** What a column with no task says in its own place. */
const NO_TASKS = "No tasks";

/** What the Board says where the filter and the view leave no column standing. */
const NONE_STANDING = "No tasks match this view";

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

/** The column a narrow board shows first, where it stands: where a task starts. */
const FIRST_SHOWN: string = TASK_STATUS.TODO;

/** What the tabs choosing a narrow board's column are called, to a screen reader. */
const COLUMN_TABS = "Columns";

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

/** The mark a tag wears for who holds its issue. */
const TAG_MARK = {
  [TASK_ISSUE_PROVIDER.GITHUB]: INTEGRATION_PROVIDER.GITHUB,
  [TASK_ISSUE_PROVIDER.LINEAR]: INTEGRATION_PROVIDER.LINEAR,
} as const satisfies Record<TaskIssueProvider, string>;

/**
 * The issues a card's task links, oldest first, a tag each in a row under
 * its name: the provider's mark and its key, a GitHub issue of the task's
 * own repository by its `#N` alone. A press on a tag opens the issue as a
 * link to it does elsewhere (`../tasks/use-open-link.ts`), never the task.
 * Nothing for a task that links none.
 */
function TaskBoardTags({ task }: { task: TaskSummary }): React.JSX.Element | null {
  const openLink = useOpenLink();
  const tags = task.issues ?? [];
  if (tags.length === 0) return null;
  return (
    <div className="tasks-board-tags">
      {tags.map((tag) => (
        <Chip
          key={tag.id}
          look={CHIP_LOOK.PILL}
          size={CHIP_SIZE.COMPACT}
          data-provider={tag.provider}
          onClick={() => openLink(tag.url)}
        >
          <ProviderMark provider={TAG_MARK[tag.provider]} size={PROVIDER_MARK_SIZE.CAPTION} />
          <ChipName mono>{issueTagWords(tag, task.repository)}</ChipName>
        </Chip>
      ))}
    </div>
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
  properties,
  onOpen,
  onStanding,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  workspaceName: string;
  narrow: boolean;
  /** What the card draws beside its name. */
  properties: readonly TaskProperty[];
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
  const drawn = (property: TaskProperty) => properties.includes(property);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    press.current?.focus();
  }, [rename.editing]);
  const head = (
    <span className="tasks-board-card-head">
      {task.number === undefined || !drawn(TASK_PROPERTY.KEY) ? null : (
        <span className="tasks-board-key">{taskKey(workspaceName, task.number)}</span>
      )}
      {drawn(TASK_PROPERTY.CREATOR) ? (
        <span className="tasks-board-face">
          <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />
        </span>
      ) : null}
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
      <TaskBoardTags task={task} />
      <div className="tasks-board-card-foot">
        {/* Note that a task from a service before priorities offers No priority, as one before statuses stands under Todo. */}
        {drawn(TASK_PROPERTY.PRIORITY) ? (
          <CardStandingChip
            label="Priority"
            value={task.priority ?? TASK_PRIORITY.NONE}
            order={TASK_PRIORITY_ORDER}
            words={TASK_PRIORITY_WORDS}
            mark={(priority) => <TaskPriorityMark priority={priority} />}
            named={false}
            onPick={(priority) => onStanding({ priority })}
          />
        ) : null}
        {drawn(TASK_PROPERTY.STATUS) ? (
          <CardStandingChip
            label="Status"
            value={task.status ?? TASK_STATUS.TODO}
            order={TASK_STATUS_ORDER}
            words={TASK_STATUS_WORDS}
            mark={(status) => <TaskStatusMark status={status} />}
            named={narrow}
            onPick={(status) => onStanding({ status })}
          />
        ) : null}
        {task.repository === null || !drawn(TASK_PROPERTY.REPOSITORY) ? null : (
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

/** What heads a column: its value's mark and its name. */
interface ColumnHead {
  readonly mark: React.JSX.Element | null;
  readonly words: string;
}

/** A column's head for the value it stands for. */
function columnHead(head: TasksGroupHead): ColumnHead {
  if (head.kind === TASKS_GROUP.STATUS) {
    return { mark: <TaskStatusMark status={head.status} />, words: TASK_STATUS_WORDS[head.status] };
  }
  if (head.kind === TASKS_GROUP.PRIORITY) {
    return {
      mark: <TaskPriorityMark priority={head.priority} />,
      words: TASK_PRIORITY_WORDS[head.priority],
    };
  }
  return { mark: null, words: "" };
}

/** What a card dropped on a column is sent: the column's status, or its priority. */
function columnStanding(head: TasksGroupHead): TaskStanding | undefined {
  if (head.kind === TASKS_GROUP.STATUS) return { status: head.status };
  if (head.kind === TASKS_GROUP.PRIORITY) return { priority: head.priority };
  return undefined;
}

/** Whether a task already stands where a standing would send it. */
function standsAt(task: TaskSummary, standing: TaskStanding): boolean {
  if (standing.status !== undefined) return (task.status ?? TASK_STATUS.TODO) === standing.status;
  return (task.priority ?? TASK_PRIORITY.NONE) === standing.priority;
}

/** The value a column stands for, which names it among the Board's columns: a status, or a priority, as its grouping is. */
function columnValue(head: TasksGroupHead): string {
  if (head.kind === TASKS_GROUP.STATUS) return head.status;
  if (head.kind === TASKS_GROUP.PRIORITY) return head.priority;
  return head.kind;
}

/**
 * A column: its head, and its cards or the line saying it holds none. It
 * is a drop zone of the board, and its cards are dragged out of it onto
 * another; dropped there, a card's task is sent that column's status or
 * priority.
 */
function TaskBoardColumnView({
  tasks,
  column,
  columns,
  workspaceName,
  narrow,
  panelId,
  properties,
  onOpen,
  onStanding,
  onShowOlder,
}: {
  tasks: TasksControl;
  column: TasksGroup;
  /** Every column standing, which a card is dropped onto. */
  columns: readonly TasksGroup[];
  workspaceName: string;
  /** Whether the room is a phone's: the column stands alone, as its tab's panel, its cards moved by their chips, not dragged. */
  narrow: boolean;
  panelId: string;
  properties: readonly TaskProperty[];
  onOpen: (task: TaskSummary) => void;
  onStanding: (task: TaskSummary, standing: TaskStanding) => void;
  /** Shows every settled task, as the column's "+ N older" line asks. */
  onShowOlder: () => void;
}): React.JSX.Element {
  // Note that a card is carried by its press alone, so a press on one of its chips, its ⋯, or a menu they drop stays that control's.
  const drag = useRowDrag(undefined, {
    handle: CARD_HANDLE,
    onDropOut: (from, zone) => {
      const task = column.tasks[from];
      const onto = columns.find((each) => columnValue(each.head) === zone);
      const standing = onto === undefined ? undefined : columnStanding(onto.head);
      if (task === undefined || standing === undefined || standsAt(task, standing)) return;
      onStanding(task, standing);
    },
  });
  const { mark, words } = columnHead(column.head);
  const value = columnValue(column.head);
  return (
    <section
      className="tasks-board-column"
      data-task-column={value}
      data-row-drop={value}
      aria-label={words}
      id={narrow ? panelId : undefined}
      role={narrow ? "tabpanel" : undefined}
    >
      <h2 className="tasks-board-column-head">
        {mark}
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
        column.older === undefined ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {NO_TASKS}
          </Text>
        ) : null
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
                  properties={properties}
                  onOpen={() => onOpen(task)}
                  onStanding={(standing) => onStanding(task, standing)}
                />
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
      <OlderCompleted older={column.older} onShow={onShowOlder} />
    </section>
  );
}

/** The Tasks page's Board: the listed workspace's tasks by status, or by priority, under the page's filter. */
export function TasksBoard({
  tasks,
  room,
  title,
  frame,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  /** What the toolbar calls the page: the Tasks page's name. */
  title: string;
  /** The Tasks page's toolbar, filter chips, filter, and the Board's display. */
  frame: TasksViewFrame;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, tasks.boardView.onClose);
  const toast = useToast();
  const ids = useId();
  const [chosen, setChosen] = useState<string>(FIRST_SHOWN);
  const listed = tasks.listed.tasks;
  const { filter, display } = frame;
  const now = useMinute();
  const columns = tasksBoardColumns(listed, { filter, display, now });
  const narrow = room === SHELL_ROOM.NARROW;
  const values = columns.map((column) => columnValue(column.head));
  // Note that a column gone from the view lets the choice go, so its coming back does not bring it back unasked.
  const chosenStands = values.includes(chosen);
  useEffect(() => {
    if (!chosenStands) setChosen(FIRST_SHOWN);
  }, [chosenStands]);
  const shown = chosenStands ? chosen : values.includes(FIRST_SHOWN) ? FIRST_SHOWN : values[0];
  const panelId = `${ids}panel`;
  const tabs =
    narrow && columns.length > 0 ? (
      <div className="tasks-board-tabs">
        <ChoiceBar
          label={COLUMN_TABS}
          items={columns.map((column) => {
            const { mark, words } = columnHead(column.head);
            return {
              value: columnValue(column.head),
              label: words,
              icon: mark ?? undefined,
              count: column.tasks.length === 0 ? undefined : String(column.tasks.length),
            };
          })}
          value={shown ?? FIRST_SHOWN}
          look={CHOICE_BAR_LOOK.FILL}
          panels={(value) => ({ tab: `${ids}tab-${value}`, panel: panelId })}
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
  const filters =
    frame.chips === null && tabs === null ? null : (
      <>
        {frame.chips}
        {tabs}
      </>
    );
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      // Note that the board stands its columns across the room and scrolls sideways past it, each column scrolling its own cards.
      width={PAGE_WIDTH.FULL}
      label={title}
      toolbar={frame.toolbar}
      filters={filters}
      state={boardState(tasks, listed.length === 0)}
      loadingLabel={READING_LINE}
      empty={<EmptyState icon={<SquareKanbanIcon />}>No tasks yet</EmptyState>}
      error={
        <ErrorState onRetry={tasks.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      <div className="tasks-board" data-row-drop-scope="">
        {columns.length === 0 ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {NONE_STANDING}
          </Text>
        ) : null}
        {(narrow ? columns.filter((column) => columnValue(column.head) === shown) : columns).map(
          (column) => (
            <TaskBoardColumnView
              key={columnValue(column.head)}
              tasks={tasks}
              column={column}
              columns={columns}
              workspaceName={workspaceName}
              narrow={narrow}
              panelId={panelId}
              properties={display.properties}
              onOpen={(task) => tasks.onSelect(task.id)}
              onStanding={setStanding}
              onShowOlder={() => frame.onDisplay({ ...display, completed: COMPLETED_WINDOW.ALL })}
            />
          ),
        )}
      </div>
    </CollectionPage>
  );
}
