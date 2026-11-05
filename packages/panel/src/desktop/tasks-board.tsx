import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  TASK_BOUNDS,
  TASK_STATUS,
  type TaskStanding,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  noneYetWords,
  REFRESH_FAILED_WORDS,
  readFailedWords,
  readingWords,
  TERM,
} from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  ANNOUNCE,
  AVATAR_SIZE,
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
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  GAP,
  GLYPH_INK,
  GlyphSlot,
  GROUP_ACTIONS,
  GROUP_SURFACE,
  GroupHeader,
  INSET,
  InlineEdit,
  LAYOUT_ELEMENT,
  ListMotion,
  motionKey,
  PAGE_FRAME,
  PAGE_WIDTH,
  PROGRESS_COUNT_LOOK,
  ProgressCount,
  RepositoryPicture,
  reachedKey,
  SCROLL_FADE,
  SCROLL_GUTTER,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
  ScrollArea,
  SELECT_BOX_PLACE,
  SelectionBar,
  SelectionRegion,
  Stack,
  selectionRun,
  TASK_AGENTS_MARK_SIZE,
  TaskAgentsMark,
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
  useRovingColumns,
  useRovingKeys,
  useRowMenu,
  VisuallyHidden,
} from "@repo/ui";
import { actorName } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import {
  type ChildTaskCount,
  childTaskCounts,
  repositoryLabel,
  TASK_ORDER,
  taskTime,
} from "@repo/ui/task-list-model";
import { RENAME_FAILED_NOTE, repositoryPageUrl } from "@repo/ui/tasks-model";
import {
  COMPLETED_WINDOW,
  TASK_PROPERTY,
  TASKS_GROUP,
  type TaskProperty,
  type TasksGroup,
  type TasksGroupHead,
  taskIdOf,
  tasksBoardColumns,
} from "@repo/ui/tasks-page-model";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import {
  useVirtualRuns,
  VIRTUAL_ROW_KEY_ATTRIBUTE,
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
  type VirtualRuns,
} from "@repo/ui/virtual-rows";
import { SquareKanbanIcon } from "lucide-react";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { FIND_SKIP_ATTRIBUTE } from "../find-matches.js";
import { useMemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoor } from "../steady-door.js";
import { newTaskAction } from "../tasks/inbox-list.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
  TaskKey,
} from "../tasks/task-standing.js";
import { linkPressOf } from "../tasks/use-open-link.js";
import { useMarkedUnread } from "../tasks/use-task-looks.js";
import { useTaskMaker } from "../tasks/use-task-origin.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { rowMenu } from "./action-menu.js";
import {
  groupNewTaskWords,
  groupStanding,
  NewTaskInButton,
  quickAddInto,
} from "./new-task-button.js";
import { useTasksWaiting } from "./places-waiting.js";
import { type QuickAddLine, QuickAddLines, useQuickAdd } from "./quick-add.js";
import { groupCount } from "./sidebar-fold.js";
import {
  type OpenedTask,
  openedTaskOf,
  TASK_MENU_SURFACE,
  type TaskRowTab,
  useTaskMenuItems,
  useTaskRowTab,
} from "./task-actions.js";
import {
  AssigneeChip,
  CreatorFace,
  PriorityChip,
  StatusChip,
  standsAt,
  taskSubject,
  useStandingDoor,
  WaitingCount,
} from "./task-row-parts.js";
import {
  assigneeFor,
  assigneeWords,
  OlderCompleted,
  type TasksViewFrame,
} from "./tasks-page-options.js";
import { type ChosenTasks, chosenRowMenu, useTasksSelection } from "./tasks-selection.js";
import { useHeldTasks } from "./use-held-tasks.js";
import { useTaskDrag } from "./use-row-drag.js";

/**
 * tasks-board.tsx -- the Tasks page's Board: the listed workspace's tasks on a column for each status, or each priority, in the order work moves through them, or each assignee.
 *
 * It is one of the Tasks page's two views (`tasks-page.tsx`), which stands
 * in the plan's place beside the sidebar, as the Inbox does. A column is a quiet well headed by
 * its status's mark, its name, and how many tasks stand in it, and scrolls
 * its own cards, the most pressing first. A card is raised off the well,
 * drawn as Linear's board draws one: its key, how many of its Inbox threads
 * wait on the reader, when it last moved, and its creator's face over its
 * status's chip and its whole name, then a row that wraps rather than
 * running past the card's edge: the chips that change its priority and its
 * assignee where it stands, their marks alone as the List draws them, the
 * assignee's left off under an assignee's column, its repository, how many
 * of its sub-tasks are finished ("1/3") where it has any, as the List's row
 * says it, the one
 * icon of how its agents stand (`TaskAgentsMark`), and a ⋯ at their end dropping the task's own menu, the sidebar
 * row's, which a right-click and the menu key drop too (`useRowMenu`) and
 * whose Rename makes the card's name its field. A press anywhere else opens the task. A card hangs no
 * card for the whole task, since it already says what that card would;
 * its parts hang their own instead. A card dragged onto another column
 * is sent that column's status or priority, or assigned to its person, No
 * assignee's assigning it to no one, as the task page's chips send them,
 * and moves there at once; the + at a column's head opens a bare title at
 * the column's top, and Return adds a task there with that same status,
 * priority, or assignee and no agent, opening nothing (`quick-add.tsx`); a change the service did not keep goes back
 * where it stood and says so, whether dragged or picked. Which columns stand, what each holds, its order, and what a card
 * draws are the Tasks page's filter and the Board's own display
 * (`tasks-page-model.ts`): Backlog, Todo, In progress, and Done at first,
 * Canceled once asked for. A task archived is off the board, as it is off
 * the sidebar's list. A task from a service before statuses stands under
 * Todo, where a task starts, and is sent nothing until it is dragged.
 * Escape closes the board, as it closes the Automations page, but for
 * while cards are chosen, when it chooses none.
 *
 * Cards are chosen together (`SelectionRegion`): by the box that takes the
 * key's place at a card's start under the pointer and stays on every card
 * while any is chosen, by X on the card in hand, and by ⌘-click, across
 * columns; a ⇧-click or ⇧↑↓ chooses a run within the card's own column
 * (`selectionRun`), as Linear's board does. While any is chosen, a bar at the
 * page's foot marks them done, sets their status, or moves them to a section,
 * as the List's does (`tasks-selection.tsx`), and a card chosen among
 * several offers those acts from its ⋯ and a right-click.
 *
 * Each column draws only the cards near the view (`VirtualRows`), as the
 * List draws its rows, those it leaves undrawn standing as the room they
 * would take, so a column is as tall as its cards and a long workspace's
 * Board draws as quickly as a short one; every card while a find bar stands
 * open over it, and the card holding the keyboard wherever its column is
 * scrolled. The keys, the choosing, and a drag still reach the cards left
 * undrawn, each brought in where it is reached.
 *
 * A narrow room, a phone's, has no width for columns side by side, nor a
 * second column in sight to drag a card onto: it stands one column at a
 * time across the whole page, chosen by a tab for each column above it
 * (Todo at first), and each card's Status chip, its mark before its name as
 * on a wide board, is how a card moves there without a drag.
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

/** What a press must land on to carry a card: the press that opens it, which reaches every edge of the card but its foot's controls. */
const CARD_HANDLE = CARD_PRESS_SELECTOR;

/** How tall a card is taken to be before it is drawn, in pixels: no taller than the shortest a card draws, its head and a line of its name, so a column whose cards fit shows no scroll bar for its first frame. */
const CARD_ESTIMATE_PX = 64;

/** The room between two cards, in pixels: the item gap (`--ui-item-gap`). */
const CARD_GAP_PX = 6;

/** The column a narrow board shows first, where it stands: where a task starts. */
const FIRST_SHOWN: string = TASK_STATUS.TODO;

/** What the tabs choosing a narrow board's column are called, to a screen reader. */
const COLUMN_TABS = "Columns";

/**
 * The board: a column for each status, side by side at one fixed width
 * whatever the page's width, filling the page's height. Note that it reaches
 * into the page's end inset and pads it back, because a scroller leaves its
 * content's end padding at the room's edge, so the last column would
 * otherwise scroll flush against the page's side.
 */
const BOARD =
  "tasks-board relative -me-collection-page-inset flex min-h-0 min-w-min flex-[1_1_0] gap-block-gap pe-collection-page-inset leading-[normal] [--carried-ground:var(--ui-color-surface)]";

/** A card, raised off its column's well, a draft's as a task's. */
const BOARD_CARD =
  "tasks-board-card group/board-card flex flex-col gap-item-gap pt-row-inset pr-row-inset pb-item-gap pl-list-inset";

/** The status's mark before the name, on the name's first line; the name wraps beside it. */
const BOARD_CARD_TITLE =
  "tasks-board-card-title flex min-w-0 items-start gap-ui-4 [&>:last-child]:min-w-0 [&>:last-child]:flex-auto";

/** A card's name, whole under its line in the label's weight, wrapping to three lines at most. */
const BOARD_NAME =
  "tasks-board-name line-clamp-3 text-label font-ui-medium text-foreground wrap-anywhere";

/** What did not land, under a card. */
const BOARD_CARD_NOTE = "tasks-board-card-note text-caption text-danger";

/**
 * The card's key, at the start of its first line, which gives its place to
 * the card's box (`SELECT_BOX_PLACE.CARD_HEAD`) for as long as the box shows:
 * the card under the pointer or reached from the keyboard, the box itself
 * under the pointer, or the box at rest while the board is being chosen from.
 * It starts where the box does, drawn out as the status chip under it is
 * and stood in by the box's inset in that chip, so the key, the box, and the
 * status mark line up on one edge of the card.
 */
const BOARD_CARD_KEY =
  "tasks-board-card-key flex ms-[calc(var(--spacing-select-box-inset)-var(--ui-space-4))] group-has-[.ui-card-press:hover]/board-card:invisible group-has-[.ui-card-press:focus-visible]/board-card:invisible group-has-[.ui-select-box:hover]/board-card:invisible group-has-[.ui-select-box[data-shown=true]]/board-card:invisible";

/** A card's foot, standing over its press, which lets the pointer through between its pills. */
const BOARD_CARD_FOOT =
  "tasks-board-card-foot pointer-events-none relative z-1 flex min-w-0 items-end gap-tight-gap";

/** A card's pills, wrapping onto as many lines as they take, each taking the pointer but its agents' icon and its sub-tasks' count, which are no presses and let one through to the card's. */
const BOARD_CARD_PILLS =
  "tasks-board-card-pills flex min-w-0 flex-auto flex-wrap items-center gap-ui-6 [&>:not(.task-agents-mark,.ui-progress-count)]:pointer-events-auto";

/**
 * A card's repository as a pill: its owner's picture and its name, owner and
 * all where another column's repository shares it (`repositoryLabel`), its
 * whole name in its hint, and a press that opens it on GitHub, as its
 * sidebar header's menu does.
 */
function TaskBoardRepository({
  repository,
  label,
  openGitHub,
  pictures,
}: {
  repository: string;
  /** What the pill says for it: its name, or `owner/name` where the board names another of that name. */
  label: string;
  openGitHub: (url: string) => void;
  /** Whether it is drawn by its owner's picture. */
  pictures: boolean;
}): React.JSX.Element {
  return (
    <Tooltip label={repository}>
      <Chip
        look={CHIP_LOOK.PILL}
        size={CHIP_SIZE.COMPACT}
        data-task-repository=""
        href={repositoryPageUrl(repository)}
        onClick={linkPressOf(openGitHub, repositoryPageUrl(repository))}
      >
        <RepositoryPicture repository={repository} pictures={pictures} size={AVATAR_SIZE.GLYPH} />
        <ChipName>
          <ReplayMask>{label}</ReplayMask>
        </ChipName>
      </Chip>
    </Tooltip>
  );
}

/**
 * One task's card, as Linear's board draws one: its key, what waits on the
 * reader, when it last moved, and its creator's face on its first line; its
 * status's mark before its name, which wraps; and a row under it, wrapping
 * onto as many lines as they take, so nothing is cut off at the card's edge:
 * its priority's and its assignee's marks, drawn as the List draws them, then
 * a pill for its repository, a press of its own
 * hanging its own card, a badge of how many of its sub-tasks are finished
 * where it has any, and the icon of
 * how its agents stand, rather than one card for the whole task, which
 * says nothing the card does not. Its ⋯ stands at the pills' end, dropping
 * the task's own menu, which a right-click and a long press open too; a
 * finger's card draws no ⋯ and keeps it no room, as a phone's mail list
 * draws none, so its pills have the foot's whole width. One press, under its
 * pills, opens it. Renamed from that menu, its name is its field until the
 * edit ends.
 *
 * Note that it is held while what it is handed stands (`memo`), each prop a
 * plain value or a steady door, so a change to one task draws its card
 * alone, and the minute moves only its time.
 */
const TaskBoardCard = memo(function TaskBoardCard({
  tasks,
  task,
  opened,
  workspaceName,
  properties,
  repositoryName,
  waiting,
  subTasksFinished,
  subTasksTotal,
  chosen,
  onSelect,
  onStanding,
  place,
}: {
  tasks: TaskRowTab;
  task: TaskSummary;
  /** What its repository's pill says (`repositoryLabel`), none where it has no repository. */
  repositoryName: string | undefined;
  /** The task the window has open, where it is this one (`openedTaskOf`). */
  opened: OpenedTask | undefined;
  workspaceName: string;
  /** What the card draws beside its name. */
  properties: readonly TaskProperty[];
  /** How many of its questions wait on the reader, as the Inbox counts them (`useTasksWaiting`). */
  waiting: number;
  /** How many of its sub-tasks are finished, of all of them, `subTasksTotal`; none where it has none. */
  subTasksFinished: number;
  subTasksTotal: number;
  /** The selection it stands in, where it is one of several chosen: how many, and what the bar does to them all. */
  chosen: ChosenTasks | undefined;
  /** Opens a task by its id. */
  onSelect: (taskId: string) => void;
  onStanding: (task: TaskSummary, standing: TaskStanding) => void;
  /** Where it stands in its column's run of cards (`VirtualRows`). */
  place: VirtualRowPlace;
}): React.JSX.Element {
  const maker = useTaskMaker(task);
  const unread = useMarkedUnread(task.id);
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  useAnnounceShown(ANNOUNCE.ALERT, rename.refused ? RENAME_FAILED_NOTE : "");
  const drawn = (property: TaskProperty) => properties.includes(property);
  const actions = useTaskMenuItems(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread,
    surface: TASK_MENU_SURFACE.ROW,
    chips: {
      status: drawn(TASK_PROPERTY.STATUS),
      priority: drawn(TASK_PROPERTY.PRIORITY),
      assignee: drawn(TASK_PROPERTY.ASSIGNEE),
    },
    opened,
  });
  const onOpen = () => onSelect(task.id);
  const setStanding = (standing: TaskStanding) => onStanding(task, standing);
  const press = useRef<HTMLButtonElement | null>(null);
  const coarse = useCoarsePointer();
  const nameId = useId();
  const key = task.number === undefined ? undefined : taskKey(workspaceName, task.number);
  const repository = task.repository === null ? undefined : repositoryLabel(task.repository, []);
  const own = {
    ...rowMenu("Task", actions.groups(), tasks.shown, true),
    footer: actions.footer,
    subject: taskSubject(task, repository, key),
  };
  const menu = useRowMenu(
    rename.editing
      ? undefined
      : chosen === undefined
        ? own
        : chosenRowMenu(own.thing, chosen, tasks.shown),
    { disabled: actions.deletion.busy, opener: press, more: !coarse },
  );
  const endedByKey = useRefocusAfterEdit(rename.editing, press);
  return (
    <Card
      as={CARD_ELEMENT.LI}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.SOFT}
      hover={CARD_HOVER.LIFT}
      lit={menu.open}
      className={BOARD_CARD}
      {...place}
      data-task-id={task.id}
      {...motionKey(task.id)}
      {...menu.props}
      data-editing={rename.editing ? "true" : undefined}
    >
      {/* Note that the first line stands under the card's press, but for the creator's face, which hangs their card. */}
      <span className="tasks-board-card-head flex min-h-ui-20 items-center gap-item-gap text-muted-foreground">
        {drawn(TASK_PROPERTY.KEY) ? (
          <span className={BOARD_CARD_KEY}>
            <ReplayMask>
              <TaskKey workspaceName={workspaceName} number={task.number} decorative />
            </ReplayMask>
          </span>
        ) : null}
        <span className="tasks-board-card-marks ml-auto inline-flex min-w-0 items-center gap-item-gap text-caption text-muted-foreground tabular-nums">
          {drawn(TASK_PROPERTY.WAITING) && waiting > 0 ? (
            <span className="tasks-board-waiting flex flex-none">
              <WaitingCount count={waiting} />
            </span>
          ) : null}
          {drawn(TASK_PROPERTY.UPDATED) ? (
            <Time at={taskTime(task, TASK_ORDER.UPDATED)} hint={false} />
          ) : null}
          {drawn(TASK_PROPERTY.CREATOR) ? (
            <span className="tasks-board-face inline-flex min-w-0 items-center gap-tight-gap">
              {maker === undefined ? null : (
                <Text
                  as={TEXT_ELEMENT.SPAN}
                  variant={TEXT_VARIANT.INHERIT}
                  truncate
                  className="tasks-board-maker text-muted-foreground"
                >
                  <ReplayMask>{actorName(maker.actor)}</ReplayMask>
                </Text>
              )}
              <CreatorFace task={task} onOpen={onOpen} />
            </span>
          ) : null}
        </span>
      </span>
      <span className={BOARD_CARD_TITLE}>
        {drawn(TASK_PROPERTY.STATUS) ? (
          <StatusChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={setStanding} />
        ) : null}
        {rename.editing ? (
          <span className="tasks-board-name flex overflow-visible text-label font-ui-medium text-foreground wrap-anywhere">
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
          </span>
        ) : (
          <CardPress
            ref={press}
            disabled={actions.deletion.busy}
            selectKey={task.id}
            selectBox={SELECT_BOX_PLACE.CARD_HEAD}
            roving
            onPress={() => {
              menu.close(false);
              onOpen();
            }}
          >
            <span id={nameId} className={BOARD_NAME}>
              <ReplayMask>{task.name}</ReplayMask>
            </span>
            {/* Note that the key stands drawn on the first line, outside the press, so the press says it to a screen reader, and find skips it, which finds it drawn. */}
            {key === undefined || !drawn(TASK_PROPERTY.KEY) ? null : (
              <VisuallyHidden {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>
                <ReplayMask>{`, ${key}`}</ReplayMask>
              </VisuallyHidden>
            )}
          </CardPress>
        )}
      </span>
      {rename.refused ? <span className={BOARD_CARD_NOTE}>{RENAME_FAILED_NOTE}</span> : null}
      <div className={BOARD_CARD_FOOT}>
        <div className={BOARD_CARD_PILLS}>
          {/* Note that a task from a service before priorities offers No priority, as one before statuses stands under Todo. */}
          {drawn(TASK_PROPERTY.PRIORITY) ? (
            <PriorityChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={setStanding} />
          ) : null}
          {drawn(TASK_PROPERTY.ASSIGNEE) ? (
            <AssigneeChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={setStanding} />
          ) : null}
          {task.repository === null ||
          repositoryName === undefined ||
          !drawn(TASK_PROPERTY.REPOSITORY) ? null : (
            <TaskBoardRepository
              repository={task.repository}
              label={repositoryName}
              openGitHub={tasks.onOpenGitHub}
              pictures={tasks.pictures}
            />
          )}
          {subTasksTotal === 0 ? null : (
            <ProgressCount
              done={subTasksFinished}
              total={subTasksTotal}
              label={`${subTasksFinished} of ${subTasksTotal} sub-tasks finished`}
              look={PROGRESS_COUNT_LOOK.BADGE}
            />
          )}
          {drawn(TASK_PROPERTY.AGENTS) ? (
            <TaskAgentsMark agents={task.agents} size={TASK_AGENTS_MARK_SIZE.MEDIUM} />
          ) : null}
        </div>
        {menu.moreDrawn ? (
          <span className="tasks-board-card-more pointer-events-auto flex flex-none">
            {menu.more({ size: BUTTON_SIZE.COMPACT, describedBy: nameId })}
          </span>
        ) : null}
      </div>
      {menu.popup}
      {actions.dialog}
    </Card>
  );
});

/**
 * A column's quick add line (`quick-add.tsx`): the draft as the card it is
 * about to be, raised off the well as every card is, its status's chip before
 * its bare title and its priority's and assignee's in its foot, each changing
 * the draft; an add still out as its card, its name muted, until it draws;
 * and why one was refused, under the draft.
 */
const boardQuickAddLine: QuickAddLine = ({ draft, pending, refused }) =>
  refused === undefined ? (
    <Card
      as={CARD_ELEMENT.LI}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.SOFT}
      className={`${BOARD_CARD} tasks-board-draft`}
      data-quick-add={draft === undefined ? undefined : ""}
      data-pending={pending === undefined ? undefined : "true"}
    >
      <span className={BOARD_CARD_TITLE}>
        {draft?.status}
        <span className={BOARD_NAME}>
          <ReplayMask>{draft?.title ?? pending}</ReplayMask>
        </span>
      </span>
      {draft === undefined ? null : (
        <div className={BOARD_CARD_FOOT}>
          <div className={BOARD_CARD_PILLS}>
            {draft.priority}
            {draft.assignee}
          </div>
        </div>
      )}
    </Card>
  ) : (
    <li className={`tasks-board-draft-note ${BOARD_CARD_NOTE}`}>
      <ReplayMask>{refused}</ReplayMask>
    </li>
  );

/** What heads a column: its value's mark and its name. */
interface ColumnHead {
  readonly mark: React.JSX.Element | null;
  readonly words: string;
  /** Whether its words name a person, which a screen recording keeps masked. */
  readonly masked?: boolean | undefined;
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
      : {
          mark: <ReplayMask>{people.mark(head.assigneeId)}</ReplayMask>,
          words: people.words(head.assigneeId),
          masked: true,
        };
  }
  return { mark: null, words: "" };
}

/** The value a column stands for, which names it among the Board's columns: a status, a priority, or an assignee's account id, as its grouping is. */
function columnValue(head: TasksGroupHead): string {
  if (head.kind === TASKS_GROUP.STATUS) return head.status;
  if (head.kind === TASKS_GROUP.PRIORITY) return head.priority;
  if (head.kind === TASKS_GROUP.ASSIGNEE) return head.assigneeId ?? NO_ASSIGNEE_COLUMN;
  return head.kind;
}

/** The press of a card, which opens it and takes the keyboard. */
function pressOf(card: Element | undefined): HTMLElement | undefined {
  return card?.querySelector<HTMLElement>(CARD_HANDLE) ?? undefined;
}

/**
 * A column: its head, and its cards, drawing only those near the view
 * (`VirtualRows`), its quick add's lines standing over them, or the line
 * saying it holds none. It is a drop zone of the board, and its cards are
 * dragged out of it onto another; dropped there, a card's task is sent that
 * column's status or priority, or assigned to its person. Under an assignee's column a card
 * leaves its assignee's chip off, as the column's head says who, but on a
 * phone, where a card is moved by its chips alone.
 */
function TaskBoardColumnView({
  tasks,
  rowTab,
  opened,
  column,
  columns,
  workspaceName,
  narrow,
  panelId,
  properties,
  people,
  waitingOn,
  subTasksOf,
  chosenOf,
  finding,
  holdRun,
  onSelect,
  onStanding,
  onShowOlder,
}: {
  tasks: TasksControl;
  /** What a card reads of the tab (`useTaskRowTab`). */
  rowTab: TaskRowTab;
  /** The task the window has open, which only its own card is handed. */
  opened: OpenedTask | undefined;
  column: TasksGroup;
  /** Every column standing, which a card is dropped onto. */
  columns: readonly TasksGroup[];
  workspaceName: string;
  /** Whether the room is a phone's: the column stands alone, as its tab's panel, its cards moved by their chips, not dragged. */
  narrow: boolean;
  panelId: string;
  properties: readonly TaskProperty[];
  people: ColumnPeople;
  /** How many of a task's questions wait on the reader, by its id (`useTasksWaiting`). */
  waitingOn: ReadonlyMap<string, number>;
  /** How many of a task's sub-tasks are finished, of all of them, by its id; none for a task with none. */
  subTasksOf: ReadonlyMap<string, ChildTaskCount>;
  /** The selection a card of the task stands in, where it is one of several chosen (`useTasksSelection`). */
  chosenOf: (taskId: string) => ChosenTasks | undefined;
  /** Whether a find bar stands open over the page, which draws every card so the find covers them. */
  finding: boolean;
  /** Holds the column's run of cards while it stands, so a card out of view can be brought in (`useVirtualRuns`). */
  holdRun: VirtualRuns["hold"];
  /** Opens a task by its id. */
  onSelect: (taskId: string) => void;
  onStanding: (task: TaskSummary, standing: TaskStanding) => void;
  /** Shows every settled task, as the column's "+ N older" line asks. */
  onShowOlder: () => void;
}): React.JSX.Element {
  // Note that a card is carried by its press alone, so a press on one of its chips, its ⋯, or a menu they drop stays that control's.
  const drag = useTaskDrag(undefined, {
    handle: CARD_HANDLE,
    onDropOut: (taskId, zone) => {
      const task = column.tasks.find((each) => each.id === taskId);
      const onto = columns.find((each) => columnValue(each.head) === zone);
      const standing = onto === undefined ? undefined : groupStanding(onto.head);
      if (task === undefined || standing === undefined || standsAt(task, standing)) return;
      onStanding(task, standing);
    },
  });
  const { mark, words, masked } = columnHead(column.head, people);
  const value = columnValue(column.head);
  // Note that the properties a card under its assignee's column draws are made once, so a card handed them holds (`memo`).
  const unassigned = useMemo(
    () => properties.filter((property) => property !== TASK_PROPERTY.ASSIGNEE),
    [properties],
  );
  // Note that a phone's card keeps its assignee's chip under an assignee's column, since with no drag it is how the card moves to another, and so does a card held under a column that no longer names its assignee.
  const drawn = (task: TaskSummary) =>
    column.head.kind === TASKS_GROUP.ASSIGNEE &&
    !narrow &&
    column.head.assigneeId === (task.assignee?.userId ?? null)
      ? unassigned
      : properties;
  const cards = useLeaving(column.tasks, taskIdOf);
  // Every repository the board stands a card for, which a card's pill tells its own apart from.
  const repositories = columns.flatMap((each) =>
    each.tasks.map((task) => ({ repository: task.repository })),
  );
  const keys = useMemo(() => cards.map(({ key }) => key), [cards]);
  const run = useRef<VirtualRowsHandle>(null);
  useLayoutEffect(() => holdRun(run), [holdRun]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLElement | null>(null);
  const into = quickAddInto(column.head);
  const quick = useQuickAdd(tasks, into ?? {});
  // Note that the quick add's lines stand where the cards do, so a column with none draws them in their list rather than its empty line.
  const adding = quick.shown;
  // A column's cards are one Tab stop that ↑↓ walk; ←→ cross to the next column's (`useRovingColumns`). A key reaching past
  // the cards drawn goes on to the column's own first or last card, or the one after or before, brought in where it is not drawn.
  const roving = useRovingKeys<HTMLDivElement>({
    reach: (from, to) => {
      const inHand = from?.closest(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}]`);
      const id = reachedKey(
        column.tasks.map(taskIdOf),
        inHand?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE) ?? undefined,
        to,
      );
      if (id === undefined) return false;
      const press = pressOf(run.current?.rowElement(id));
      if (press !== undefined) {
        press.focus();
        return true;
      }
      return run.current?.bringIn(id, (card) => pressOf(card)?.focus()) === true;
    },
  });
  return (
    <Card
      as={CARD_ELEMENT.SECTION}
      look={CARD_LOOK.WELL}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      className="tasks-board-column flex min-h-0 w-tasks-board-column flex-none flex-col px-item-gap pt-tight-gap pb-item-gap"
      data-task-column={value}
      data-row-drop={value}
      {...selectionRun()}
      aria-label={words}
      id={narrow ? panelId : undefined}
      role={narrow ? "tabpanel" : undefined}
    >
      <GroupHeader
        label={masked === true ? <ReplayMask>{words}</ReplayMask> : words}
        glyph={mark}
        count={column.tasks.length === 0 ? undefined : groupCount(column.tasks.length)}
        surface={GROUP_SURFACE.WIDE}
        actions={
          into === undefined || !tasks.signedIn ? undefined : (
            <NewTaskInButton label={groupNewTaskWords(column.head, words)} onPress={quick.open} />
          )
        }
        actionsShown={GROUP_ACTIONS.AT_REST}
      />
      {cards.length === 0 && !adding ? (
        column.older === undefined ? (
          <Text
            variant={TEXT_VARIANT.CAPTION}
            tone={TEXT_TONE.MUTED}
            className="tasks-board-empty px-item-gap pt-ui-2 pb-item-gap"
          >
            {NO_TASKS}
          </Text>
        ) : null
      ) : (
        <div
          className="tasks-board-column-scroll -mx-ring-reach mt-0 -mb-ring-reach flex min-h-0 flex-initial flex-col"
          {...roving}
        >
          {/* Note that the cards hand a swipe on, because a contained area swallows a sideways one it cannot scroll, and the board scrolls sideways under them. */}
          {/* Note that the gutter is kept, because the column is as tall as its cards measured without a scroll bar, so a bar that takes room and rewraps a card's pills taller would leave a column that fits scrolling and faded. */}
          <ScrollArea
            ref={scroller}
            size={narrow ? SCROLL_SIZE.FILL : SCROLL_SIZE.CONTENT}
            fade={SCROLL_FADE.BOTH}
            gutter={SCROLL_GUTTER.STABLE}
            overscroll={SCROLL_OVERSCROLL.CHAIN}
          >
            {/* Note that the ring's room stands around the lists rather than on the run, whose own padding is the room of the cards it leaves undrawn. */}
            <Stack ref={body} gap={GAP.ITEM} inset={INSET.RING} className="tasks-board-column-body">
              {/* Note that the quick add's lines stand in a list of their own, over the run, because a run draws only its rows. */}
              {adding ? (
                <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ITEM} moves className="tasks-board-adds">
                  <QuickAddLines quick={quick} line={boardQuickAddLine} />
                </Stack>
              ) : null}
              {cards.length === 0 ? null : (
                <VirtualRows
                  scroller={scroller}
                  shiftedBy={body}
                  keys={keys}
                  estimate={CARD_ESTIMATE_PX}
                  gap={CARD_GAP_PX}
                  overscan={finding ? keys.length : undefined}
                  anchor={VIRTUAL_ROWS_ANCHOR.START}
                  listItems
                  moves
                  holdsFocus
                  className="tasks-board-cards data-[dragging=true]:cursor-grabbing"
                  onPointerDown={narrow ? undefined : drag}
                  handle={run}
                >
                  {(index, place) => {
                    const task = cards[index]?.value;
                    return task === undefined ? null : (
                      <TaskBoardCard
                        key={task.id}
                        place={place}
                        tasks={rowTab}
                        task={task}
                        opened={opened?.task.id === task.id ? opened : undefined}
                        workspaceName={workspaceName}
                        repositoryName={
                          task.repository === null
                            ? undefined
                            : repositoryLabel(task.repository, repositories)
                        }
                        properties={drawn(task)}
                        waiting={waitingOn.get(task.id) ?? 0}
                        subTasksFinished={subTasksOf.get(task.id)?.finished ?? 0}
                        subTasksTotal={subTasksOf.get(task.id)?.total ?? 0}
                        chosen={chosenOf(task.id)}
                        onSelect={onSelect}
                        onStanding={onStanding}
                      />
                    );
                  }}
                </VirtualRows>
              )}
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
  const now = useMinute();
  const waitingOn = useTasksWaiting(tasks);
  const ids = useId();
  const board = useRef<HTMLDivElement>(null);
  const crossing = useRovingColumns<HTMLDivElement>();
  const [chosen, setChosen] = useState<string>(FIRST_SHOWN);
  const listed = tasks.listed.tasks;
  // Note that a card counts every sub-task listed, as the List's row does, whatever the filter leaves on the board.
  const subTasksOf = useMemo(() => childTaskCounts(listed), [listed]);
  const { filter, display } = frame;
  const directory = useMemberDirectory();
  const people: ColumnPeople = {
    mark: (userId) => (
      <ActorMark actor={assigneeFor(userId, directory, listed)} size={ACTOR_SIZE.MARK} />
    ),
    words: (userId) => assigneeWords(userId, directory, listed),
  };
  // While the page is shown each card keeps the column and the place it was first drawn in, so one a teammate's change would move stays under the reader's eye.
  const columns = useHeldTasks(
    tasks,
    { workspaceId: tasks.workspace?.id, filter, display },
    (standing) =>
      tasksBoardColumns(standing, {
        filter,
        display,
        readerId: tasks.me,
        personName: people.words,
        members: (directory.members ?? []).map((member) => member.userId),
        now,
      }),
  );
  // Note that every door a card is handed stands across draws, so a card held while what it is handed does (`memo`) holds.
  const setStanding = useSteadyDoor(useStandingDoor(tasks));
  const rowTab = useTaskRowTab(tasks);
  const { region, agents } = tasks;
  const opened = useMemo(() => openedTaskOf({ region, agents }), [region, agents]);
  const narrow = room === SHELL_ROOM.NARROW;
  const values = columns.map((column) => columnValue(column.head));
  // Note that a column gone from the view lets the choice go, so its coming back does not bring it back unasked.
  const chosenStands = values.includes(chosen);
  useEffect(() => {
    if (!chosenStands) setChosen(FIRST_SHOWN);
  }, [chosenStands]);
  const shown = chosenStands ? chosen : values.includes(FIRST_SHOWN) ? FIRST_SHOWN : values[0];
  const panelId = `${ids}panel`;
  // Note that the motion is handed what lays the cards out, so a draw that moved none measures none.
  const properties = display.properties;
  const shownColumn = narrow ? shown : undefined;
  const laidOut = useMemo(
    () => ({ columns, properties, shownColumn }),
    [columns, properties, shownColumn],
  );
  const drawnColumns = narrow
    ? columns.filter((column) => columnValue(column.head) === shown)
    : columns;
  // Each drawn column's tasks, in the order drawn down it, those its run leaves undrawn among them.
  const order = drawnColumns.map((column) => column.tasks.map(taskIdOf));
  const runs = useVirtualRuns();
  // Note that the runs draw only the cards near the view, and every card while a find bar stands open over the page.
  const finding = useFindOpen();
  // Note that only cards a drawn column lists stay chosen, so a task the filter or another tab's column took away is never acted on.
  const selection = useTasksSelection(tasks, new Set(order.flat()));
  const tabs =
    narrow && columns.length > 0 ? (
      <div className="tasks-board-tabs flex min-w-0 grow basis-full flex-col">
        <ChoiceBar
          label={COLUMN_TABS}
          items={columns.map((column) => {
            const { mark, words, masked } = columnHead(column.head, people);
            return {
              value: columnValue(column.head),
              label: words,
              replayMasked: masked,
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
      scrollRef={frame.scroll}
      filters={filters}
      state={boardState(tasks, listed.length === 0)}
      loadingLabel={READING_LINE}
      empty={
        <EmptyState
          icon={<SquareKanbanIcon />}
          replayUnmasked
          action={newTaskAction(tasks.signedIn ? tasks.onNewTask : undefined)}
        >
          {noneYetWords(TERM.TASK)}
        </EmptyState>
      }
      error={
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.TASKS_READ)}
          onRetry={tasks.onRetryList}
          placement={ERROR_STATE_PLACEMENT.CENTERED}
        >
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      {/* A refresh that failed after the tasks were read leaves them drawn, with a line over them. */}
      {tasks.listFailed && listed.length > 0 ? (
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.TASKS_REFRESH)}
          onRetry={tasks.onRetryList}
        >
          {REFRESH_FAILED_WORDS}
        </ErrorState>
      ) : null}
      <ListMotion root={board} change={laidOut}>
        <SelectionRegion
          id={selection.regionId}
          selection={{ selected: selection.selected, onChange: selection.onChange }}
          order={order}
          bringIn={runs.bringIn}
        >
          <div ref={board} className={BOARD} data-row-drop-scope="" {...crossing}>
            {columns.length === 0 ? (
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {NONE_STANDING}
              </Text>
            ) : null}
            {drawnColumns.map((column) => (
              <TaskBoardColumnView
                key={columnValue(column.head)}
                tasks={tasks}
                rowTab={rowTab}
                opened={opened}
                column={column}
                columns={columns}
                workspaceName={workspaceName}
                narrow={narrow}
                panelId={panelId}
                properties={properties}
                people={people}
                waitingOn={waitingOn}
                subTasksOf={subTasksOf}
                chosenOf={selection.chosenOf}
                finding={finding}
                holdRun={runs.hold}
                onSelect={tasks.onSelect}
                onStanding={setStanding}
                onShowOlder={() => frame.onDisplay({ ...display, completed: COMPLETED_WINDOW.ALL })}
              />
            ))}
          </div>
        </SelectionRegion>
      </ListMotion>
      {/* Note that the bar floats over the columns' feet, taking no height from them, and stays across the page's width however far the board scrolls sideways. */}
      <div className="tasks-board-selection pointer-events-none sticky bottom-ui-16 left-0 z-4 h-0 w-[100cqw]">
        <div className="absolute inset-x-0 bottom-0 flex justify-center *:pointer-events-auto">
          <SelectionBar
            count={selection.selected.size}
            acts={selection.acts}
            onClear={selection.onClear}
            controls={selection.regionId}
          />
        </div>
      </div>
      {selection.dialog}
    </CollectionPage>
  );
}
