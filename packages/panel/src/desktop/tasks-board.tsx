import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { TASK_ISSUE_PROVIDER, type TaskIssueProvider } from "@luke/features/task-issue-wire";
import {
  TASK_BOUNDS,
  TASK_STATUS,
  type TaskStanding,
  type TaskSummary,
} from "@luke/features/task-wire";
import { noneYetWords, readFailedWords, readingWords, TERM } from "@luke/features/words";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_HOVER,
  CARD_LOOK,
  CARD_PADDING,
  CARD_PRESS_SELECTOR,
  CARD_SHADOW,
  Card,
  CardPress,
  CHIP_LOOK,
  CHIP_SIZE,
  CHOICE_BAR_LOOK,
  Chip,
  ChipName,
  ChoiceBar,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  EllipsisIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  GAP,
  GLYPH_INK,
  GlyphSlot,
  IconButton,
  INSET,
  InlineEdit,
  LAYOUT_ELEMENT,
  ListMotion,
  motionKey,
  PAGE_FRAME,
  PAGE_WIDTH,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SCROLL_FADE,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
  ScrollArea,
  Stack,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Time,
  Tooltip,
  useLeaving,
  useMinute,
} from "@luke/ui";
import { actorName, creatorActor } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { RENAME_FAILED_NOTE } from "@luke/ui/tasks-model";
import {
  COMPLETED_WINDOW,
  TASK_PROPERTY,
  TASKS_GROUP,
  type TaskProperty,
  type TasksGroup,
  type TasksGroupHead,
  taskIdOf,
  tasksBoardColumns,
} from "@luke/ui/tasks-page-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { SquareKanbanIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useMemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSettledWaiting } from "../tasks/inbox-settling.js";
import { issueTagWords } from "../tasks/task-issue-links-model.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
  TaskKey,
} from "../tasks/task-standing.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useReadMarks } from "../tasks/use-task-looks.js";
import { useTaskMaker } from "../tasks/use-task-origin.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { useTaskMenu } from "./task-actions.js";
import { taskCardOf } from "./task-card.js";
import {
  AssigneeChip,
  PriorityChip,
  StatusChip,
  standsAt,
  TaskWorkMarks,
  useStandingDoor,
  WaitingBadge,
} from "./task-row-parts.js";
import {
  assigneeFor,
  assigneeWords,
  OlderCompleted,
  type TasksViewFrame,
} from "./tasks-page-options.js";
import { useRowDrag } from "./use-row-drag.js";

/**
 * tasks-board.tsx -- the Tasks page's Board: the listed workspace's tasks on a column for each status, or each priority, in the order work moves through them, or each assignee.
 *
 * It is one of the Tasks page's two views (`tasks-page.tsx`), which stands
 * in the plan's place beside the sidebar, as the Inbox does. A column is a quiet well headed by
 * its status's mark, its name, and how many tasks stand in it, and scrolls
 * its own cards, the most pressing first. A card is raised off the well:
 * its key, how many of its Inbox threads wait on the reader, when it last
 * moved, and its creator's face over its whole name, and at its foot the
 * chips that change its priority, its status, and its assignee where it
 * stands, the assignee's left off under an assignee's column, its
 * repository, what its agents are doing and the pull requests they opened
 * (`task-row-parts.tsx`), and a ⋯ dropping the task's own menu, the sidebar
 * row's, which a right-click drops too and whose Rename makes the card's
 * name its field. A press anywhere else opens the task. A card hangs no
 * hover card, since it already says what its row's card would. A card dragged onto another column
 * is sent that column's status or priority, or assigned to its person, No
 * assignee's assigning it to no one, as the task page's chips send them,
 * and stands where it was until the list read again says otherwise; a
 * change the service did not keep says so, whether dragged or picked. Which columns stand, what each holds, its order, and what a card
 * draws are the Tasks page's filter and the Board's own display
 * (`tasks-page-model.ts`): Backlog, Todo, In progress, and Done at first,
 * Canceled once asked for. A task archived is off the board, as it is off
 * the sidebar's list. A task from a service before statuses stands under
 * Todo, where a task starts, and is sent nothing until it is dragged.
 * Escape closes the board, as it closes the Automations page.
 *
 * A narrow room, a phone's, has no width for columns side by side, nor a
 * second column in sight to drag a card onto: it stands one column at a
 * time across the whole page, chosen by a tab for each column above it
 * (Todo at first), and each card's Status chip says its status in words,
 * since its pick is how a card moves there without a drag.
 */

/** What the page is read as while the tasks are. */
const READING_LINE = readingWords(TERM.TASK.many);

/** What the page says where the tasks could not be read. */
const UNREAD_LINE = readFailedWords(`your ${TERM.TASK.many}`);

/** What a column with no task says in its own place. */
const NO_TASKS = "No tasks";

/** What the Board says where the filter and the view leave no column standing. */
const NONE_STANDING = "No tasks match this view";

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
const CARD_HANDLE = CARD_PRESS_SELECTOR;

/** The column a narrow board shows first, where it stands: where a task starts. */
const FIRST_SHOWN: string = TASK_STATUS.TODO;

/** What the tabs choosing a narrow board's column are called, to a screen reader. */
const COLUMN_TABS = "Columns";

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
 * One task's card: its key, what waits on the reader, when it last moved,
 * and its creator's face over its name, one press that opens it, and at its foot
 * the chips that change it where it stands, its priority, its status, and
 * its assignee, its repository, its agents' work and pull requests, and the
 * ⋯ dropping the task's own menu, which a right-click opens too. Renamed
 * from that menu, its name is its field until the edit ends. On a phone the status
 * chip says its status in words, since it is how a card moves there.
 */
function TaskBoardCard({
  tasks,
  task,
  workspaceName,
  narrow,
  properties,
  waiting,
  now,
  onOpen,
  onStanding,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  workspaceName: string;
  narrow: boolean;
  /** What the card draws beside its name. */
  properties: readonly TaskProperty[];
  /** How many of its Inbox threads wait on the reader. */
  waiting: number;
  now: number;
  onOpen: () => void;
  onStanding: (standing: TaskStanding) => void;
}): React.JSX.Element {
  const creator = creatorActor(task, useMemberDirectory(), undefined);
  const maker = useTaskMaker(task);
  const reads = useReadMarks();
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  const actions = useTaskMenu(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread: reads.markedUnread(task.id),
  });
  const press = useRef<HTMLButtonElement | null>(null);
  const item = useRef<HTMLElement | null>(null);
  const drawn = (property: TaskProperty) => properties.includes(property);
  const endedByKey = useRefocusAfterEdit(rename.editing, press);
  const head = (
    <span className="tasks-board-card-head">
      {drawn(TASK_PROPERTY.KEY) ? (
        <TaskKey workspaceName={workspaceName} number={task.number} />
      ) : null}
      <span className="tasks-board-card-marks">
        {drawn(TASK_PROPERTY.WAITING) && waiting > 0 ? (
          <span className="tasks-board-waiting">
            <WaitingBadge count={waiting} />
          </span>
        ) : null}
        {drawn(TASK_PROPERTY.UPDATED) ? (
          <Time at={taskTime(task, TASK_ORDER.UPDATED)} now={now} hint={false} />
        ) : null}
        {drawn(TASK_PROPERTY.CREATOR) ? (
          <span className="tasks-board-face">
            {maker === undefined ? null : (
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.INHERIT}
                truncate
                className="tasks-board-maker"
              >
                {actorName(maker.actor)}
              </Text>
            )}
            <ActorMark
              actor={maker?.actor ?? creator}
              size={ACTOR_SIZE.MARK}
              forWhom={maker === undefined ? undefined : creator}
            />
          </span>
        ) : null}
      </span>
    </span>
  );
  return (
    <Card
      as={CARD_ELEMENT.LI}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.SOFT}
      hover={CARD_HOVER.LIFT}
      lit={actions.open}
      className="tasks-board-card"
      ref={item}
      data-task-id={task.id}
      {...motionKey(task.id)}
      data-menu-open={actions.open ? "true" : undefined}
      data-editing={rename.editing ? "true" : undefined}
    >
      {rename.editing ? (
        <div className="tasks-board-card-face">
          {head}
          <span className="tasks-board-name">
            <InlineEdit
              value={task.name}
              label="Task name"
              maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
              editing
              onEnd={(edit) => {
                endedByKey(edit.byKey);
                void rename.end(edit.value);
              }}
            />
          </span>
        </div>
      ) : (
        <Tooltip label={task.name} card={taskCardOf(tasks, task, now)} cardRegion={item}>
          <CardPress
            ref={press}
            disabled={actions.deletion.busy}
            onPress={() => {
              actions.close(false);
              onOpen();
            }}
            onKeyDown={actions.keyMenu}
            contextMenu={actions.contextMenu(press)}
          >
            <span className="tasks-board-card-face">
              {head}
              <span className="tasks-board-name">{task.name}</span>
            </span>
          </CardPress>
        </Tooltip>
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
          <PriorityChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
        ) : null}
        {drawn(TASK_PROPERTY.STATUS) ? (
          <StatusChip task={task} look={CHIP_LOOK.TOOLBAR} named={narrow} onStanding={onStanding} />
        ) : null}
        {drawn(TASK_PROPERTY.ASSIGNEE) ? (
          <AssigneeChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
        ) : null}
        {task.repository === null || !drawn(TASK_PROPERTY.REPOSITORY) ? null : (
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.INHERIT}
            truncate
            className="tasks-board-repository"
          >
            {repositoryName(task.repository)}
          </Text>
        )}
        {drawn(TASK_PROPERTY.AGENTS) ? <TaskWorkMarks task={task} /> : null}
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
    </Card>
  );
}

/** What heads a column: its value's mark and its name. */
interface ColumnHead {
  readonly mark: React.JSX.Element | null;
  readonly words: string;
}

/** The value an assignee's column stands for where no one is assigned, apart from every account's id. */
const NO_ASSIGNEE_COLUMN = "no-assignee";

/** How the Board draws a person its column stands for: their face and their name, by account id. */
interface ColumnPeople {
  readonly mark: (userId: string) => React.JSX.Element;
  readonly words: (userId: string) => string;
}

/** A column's head for the value it stands for. */
function columnHead(head: TasksGroupHead, people: ColumnPeople): ColumnHead {
  if (head.kind === TASKS_GROUP.STATUS) {
    return {
      mark: (
        <GlyphSlot ink={GLYPH_INK.INHERIT}>
          <TaskStatusMark status={head.status} />
        </GlyphSlot>
      ),
      words: TASK_STATUS_WORDS[head.status],
    };
  }
  if (head.kind === TASKS_GROUP.PRIORITY) {
    return {
      mark: (
        <GlyphSlot ink={GLYPH_INK.INHERIT}>
          <TaskPriorityMark priority={head.priority} />
        </GlyphSlot>
      ),
      words: TASK_PRIORITY_WORDS[head.priority],
    };
  }
  if (head.kind === TASKS_GROUP.ASSIGNEE) {
    return head.assigneeId === null
      ? { mark: <UnassignedMark size={ACTOR_SIZE.MARK} decorative />, words: NO_ASSIGNEE_WORDS }
      : { mark: people.mark(head.assigneeId), words: people.words(head.assigneeId) };
  }
  return { mark: null, words: "" };
}

/** What a card dropped on a column is sent: the column's status or priority, or its assignee, null for No assignee's. */
function columnStanding(head: TasksGroupHead): TaskStanding | undefined {
  if (head.kind === TASKS_GROUP.STATUS) return { status: head.status };
  if (head.kind === TASKS_GROUP.PRIORITY) return { priority: head.priority };
  if (head.kind === TASKS_GROUP.ASSIGNEE) return { assigneeId: head.assigneeId };
  return undefined;
}

/** The value a column stands for, which names it among the Board's columns: a status, a priority, or an assignee's account id, as its grouping is. */
function columnValue(head: TasksGroupHead): string {
  if (head.kind === TASKS_GROUP.STATUS) return head.status;
  if (head.kind === TASKS_GROUP.PRIORITY) return head.priority;
  if (head.kind === TASKS_GROUP.ASSIGNEE) return head.assigneeId ?? NO_ASSIGNEE_COLUMN;
  return head.kind;
}

/**
 * A column: its head, and its cards or the line saying it holds none. It
 * is a drop zone of the board, and its cards are dragged out of it onto
 * another; dropped there, a card's task is sent that column's status or
 * priority, or assigned to its person. Under an assignee's column a card
 * leaves its assignee's chip off, as the column's head says who, but on a
 * phone, where a card is moved by its chips alone.
 */
function TaskBoardColumnView({
  tasks,
  column,
  columns,
  workspaceName,
  narrow,
  panelId,
  properties,
  people,
  waitingOn,
  now,
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
  people: ColumnPeople;
  /** How many of a task's Inbox threads wait on the reader, by its id. */
  waitingOn: ReadonlyMap<string, number>;
  now: number;
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
  const { mark, words } = columnHead(column.head, people);
  const value = columnValue(column.head);
  // Note that a phone's card keeps its assignee's chip under an assignee's column, since with no drag it is how the card moves to another.
  const drawn =
    column.head.kind === TASKS_GROUP.ASSIGNEE && !narrow
      ? properties.filter((property) => property !== TASK_PROPERTY.ASSIGNEE)
      : properties;
  const cards = useLeaving(column.tasks, taskIdOf);
  return (
    <Card
      as={CARD_ELEMENT.SECTION}
      look={CARD_LOOK.WELL}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
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
      {cards.length === 0 ? (
        column.older === undefined ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} className="tasks-board-empty">
            {NO_TASKS}
          </Text>
        ) : null
      ) : (
        <div className="tasks-board-column-scroll">
          {/* Note that the cards hand a swipe on, because a contained area swallows a sideways one it cannot scroll, and the board scrolls sideways under them. */}
          <ScrollArea
            size={narrow ? SCROLL_SIZE.FILL : SCROLL_SIZE.CONTENT}
            fade={SCROLL_FADE.BOTH}
            overscroll={SCROLL_OVERSCROLL.CHAIN}
          >
            <Stack
              as={LAYOUT_ELEMENT.UL}
              gap={GAP.ITEM}
              inset={INSET.RING}
              className="tasks-board-cards"
              moves
              onPointerDown={narrow ? undefined : drag}
            >
              {cards.map(({ value: task }) => (
                <TaskBoardCard
                  key={task.id}
                  tasks={tasks}
                  task={task}
                  workspaceName={workspaceName}
                  narrow={narrow}
                  properties={drawn}
                  waiting={waitingOn.get(task.id) ?? 0}
                  now={now}
                  onOpen={() => onOpen(task)}
                  onStanding={(standing) => onStanding(task, standing)}
                />
              ))}
            </Stack>
          </ScrollArea>
        </div>
      )}
      <OlderCompleted older={column.older} onShow={onShowOlder} />
    </Card>
  );
}

/** The Tasks page's Board: the listed workspace's tasks by status, by priority, or by assignee, under the page's filter. */
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
  const setStanding = useStandingDoor(tasks);
  const now = useMinute();
  const { waiting } = useSettledWaiting(tasks.listed.inbox, tasks.inboxTaskless);
  const waitingOn = new Map(waiting.map((each) => [each.taskId, each.items.length]));
  const ids = useId();
  const board = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<string>(FIRST_SHOWN);
  const listed = tasks.listed.tasks;
  const { filter, display } = frame;
  const directory = useMemberDirectory();
  const people: ColumnPeople = {
    mark: (userId) => (
      <ActorMark actor={assigneeFor(userId, directory, listed)} size={ACTOR_SIZE.MARK} />
    ),
    words: (userId) => assigneeWords(userId, directory, listed),
  };
  const columns = tasksBoardColumns(listed, {
    filter,
    display,
    readerId: tasks.me,
    personName: people.words,
    members: (directory.members ?? []).map((member) => member.userId),
    now,
  });
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
            const { mark, words } = columnHead(column.head, people);
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
      empty={<EmptyState icon={<SquareKanbanIcon />}>{noneYetWords(TERM.TASK)}</EmptyState>}
      error={
        <ErrorState onRetry={tasks.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      <ListMotion root={board}>
        <div ref={board} className="tasks-board" data-row-drop-scope="">
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
                people={people}
                waitingOn={waitingOn}
                now={now}
                onOpen={(task) => tasks.onSelect(task.id)}
                onStanding={setStanding}
                onShowOlder={() => frame.onDisplay({ ...display, completed: COMPLETED_WINDOW.ALL })}
              />
            ),
          )}
        </div>
      </ListMotion>
    </CollectionPage>
  );
}
