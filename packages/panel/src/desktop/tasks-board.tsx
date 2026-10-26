import {
  TASK_BOUNDS,
  TASK_STATUS,
  type TaskStanding,
  type TaskSummary,
} from "@luke/features/task-wire";
import {
  noneYetWords,
  REFRESH_FAILED_WORDS,
  readFailedWords,
  readingWords,
  TERM,
} from "@luke/features/words";
import { taskKey } from "@luke/features/workspace-key";
import { APP_COMMAND } from "@luke/settings/shortcuts";
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
  SCROLL_FADE,
  SCROLL_GUTTER,
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
  useRovingColumns,
  useRovingKeys,
  useRowMenu,
  VisuallyHidden,
} from "@luke/ui";
import { actorName } from "@luke/ui/actor-model";
import { repositoryLabel, TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { RENAME_FAILED_NOTE, repositoryPageUrl } from "@luke/ui/tasks-model";
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
import { FolderGitIcon, SquareKanbanIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { FIND_SKIP_ATTRIBUTE } from "../find-matches.js";
import { useMemberDirectory } from "../member-directory.js";
import { RepositoryPicture } from "../repository-picture.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { newTaskAction } from "../tasks/inbox-list.js";
import { useSettledWaiting } from "../tasks/inbox-settling.js";
import { TaskIssueTagChip } from "../tasks/task-issue-links.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
  TaskKey,
} from "../tasks/task-standing.js";
import { linkPressOf } from "../tasks/use-open-link.js";
import { useReadMarks } from "../tasks/use-task-looks.js";
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
import { type QuickAddLine, QuickAddLines, useQuickAdd } from "./quick-add.js";
import { groupCount } from "./sidebar-fold.js";
import { useTaskMenuItems } from "./task-actions.js";
import {
  AssigneeChip,
  CreatorFace,
  PriorityChip,
  StatusChip,
  standsAt,
  TaskWorkMarks,
  taskSubject,
  useStandingDoor,
  WaitingBadge,
  WORK_LOOK,
} from "./task-row-parts.js";
import {
  assigneeFor,
  assigneeWords,
  OlderCompleted,
  type TasksViewFrame,
} from "./tasks-page-options.js";
import { useHeldTasks } from "./use-held-tasks.js";
import { useRowDrag } from "./use-row-drag.js";

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
 * assignee's left off under an assignee's column, its repository, what its agents are doing and the
 * pull requests they opened (`task-row-parts.tsx`), and the issues it
 * links, and a ⋯ at their end dropping the task's own menu, the sidebar
 * row's, which a right-click and the menu key drop too (`useRowMenu`) and
 * whose Rename makes the card's name its field. A press anywhere else opens the task. A card hangs no
 * card for the whole task, since it already says what that card would;
 * its parts hang their own instead (`task-part-cards.tsx`). A card dragged onto another column
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
 * Escape closes the board, as it closes the Automations page.
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

/**
 * The board: a column for each status, side by side at one fixed width
 * whatever the page's width, filling the page's height. Note that it reaches
 * into the page's end inset and pads it back, because a scroller leaves its
 * content's end padding at the room's edge, so the last column would
 * otherwise scroll flush against the page's side.
 */
const BOARD =
  "tasks-board relative -me-collection-page-inset flex min-h-0 min-w-min flex-[1_1_0] gap-block-gap pe-collection-page-inset leading-[normal] [--carried-ground:var(--luke-color-surface)]";

/** A card, raised off its column's well, a draft's as a task's. */
const BOARD_CARD =
  "tasks-board-card flex flex-col gap-item-gap pt-row-inset pr-row-inset pb-item-gap pl-list-inset";

/** The status's mark before the name, on the name's first line; the name wraps beside it. */
const BOARD_CARD_TITLE =
  "tasks-board-card-title flex min-w-0 items-start gap-luke-4 [&>:last-child]:min-w-0 [&>:last-child]:flex-auto";

/** A card's name, whole under its line in the label's weight, wrapping to three lines at most. */
const BOARD_NAME =
  "tasks-board-name line-clamp-3 text-label font-luke-medium text-foreground wrap-anywhere";

/** What did not land, under a card. */
const BOARD_CARD_NOTE = "tasks-board-card-note text-caption text-danger";

/** A card's foot, standing over its press, which lets the pointer through between its pills. */
const BOARD_CARD_FOOT =
  "tasks-board-card-foot pointer-events-none relative z-1 flex min-w-0 items-end gap-tight-gap";

/** A card's pills, wrapping onto as many lines as they take. */
const BOARD_CARD_PILLS =
  "tasks-board-card-pills flex min-w-0 flex-auto flex-wrap items-center gap-luke-6 *:pointer-events-auto";

/**
 * The issues a card's task links, oldest first, a tag each among its pills
 * (`../tasks/task-issue-links.tsx`). Nothing for a task that links none.
 */
function TaskBoardTags({ task }: { task: TaskSummary }): React.JSX.Element {
  return (
    <>
      {(task.issues ?? []).map((tag) => (
        <TaskIssueTagChip key={tag.id} tag={tag} taskId={task.id} repository={task.repository} />
      ))}
    </>
  );
}

/**
 * A card's repository as a pill: its owner's picture and its own name, its
 * whole name in its hint, and a press that opens it on GitHub, as the
 * task's menu does.
 */
function TaskBoardRepository({
  tasks,
  repository,
}: {
  tasks: TasksControl;
  repository: string;
}): React.JSX.Element {
  return (
    <Tooltip label={repository}>
      <Chip
        look={CHIP_LOOK.PILL}
        size={CHIP_SIZE.COMPACT}
        data-task-repository=""
        href={repositoryPageUrl(repository)}
        onClick={linkPressOf(tasks.repositories.openGitHub, repositoryPageUrl(repository))}
      >
        <RepositoryPicture
          repository={repository}
          pictures={tasks.repositories.pictures}
          fallback={<FolderGitIcon />}
          size={AVATAR_SIZE.GLYPH}
        />
        <ChipName>{repositoryName(repository)}</ChipName>
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
 * pills for its repository, its agents at
 * work, the pull requests they opened, and the issues it links, each a press
 * of its own and each hanging its own card where it has more to say
 * (`task-part-cards.tsx`), rather than one card for the whole task, which
 * says nothing the card does not. Its ⋯ stands at the pills' end, dropping
 * the task's own menu, which a right-click opens too. One press, under its
 * pills, opens it. Renamed from that menu, its name is its field until the
 * edit ends.
 */
function TaskBoardCard({
  tasks,
  task,
  workspaceName,
  properties,
  waiting,
  now,
  onOpen,
  onStanding,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  workspaceName: string;
  /** What the card draws beside its name. */
  properties: readonly TaskProperty[];
  /** How many of its Inbox threads wait on the reader. */
  waiting: number;
  now: number;
  onOpen: () => void;
  onStanding: (standing: TaskStanding) => void;
}): React.JSX.Element {
  const maker = useTaskMaker(task);
  const reads = useReadMarks();
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  useAnnounceShown(ANNOUNCE.ALERT, rename.refused ? RENAME_FAILED_NOTE : "");
  const actions = useTaskMenuItems(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread: reads.markedUnread(task.id),
  });
  const press = useRef<HTMLButtonElement | null>(null);
  const nameId = useId();
  const key = task.number === undefined ? undefined : taskKey(workspaceName, task.number);
  const repository = task.repository === null ? undefined : repositoryLabel(task.repository, []);
  const menu = useRowMenu(
    rename.editing
      ? undefined
      : {
          ...rowMenu("Task", actions.groups(), tasks.shown),
          footer: actions.footer,
          subject: taskSubject(task, repository, key),
        },
    { disabled: actions.deletion.busy, opener: press },
  );
  const drawn = (property: TaskProperty) => properties.includes(property);
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
      data-task-id={task.id}
      {...motionKey(task.id)}
      {...menu.props}
      data-editing={rename.editing ? "true" : undefined}
    >
      {/* Note that the first line stands under the card's press, but for the creator's face, which hangs their card. */}
      <span className="tasks-board-card-head flex min-h-luke-20 items-center gap-item-gap text-muted-foreground">
        {drawn(TASK_PROPERTY.KEY) ? (
          <TaskKey workspaceName={workspaceName} number={task.number} decorative />
        ) : null}
        <span className="tasks-board-card-marks ml-auto inline-flex min-w-0 items-center gap-item-gap text-caption text-muted-foreground tabular-nums">
          {drawn(TASK_PROPERTY.WAITING) && waiting > 0 ? (
            <span className="tasks-board-waiting flex flex-none">
              <WaitingBadge count={waiting} />
            </span>
          ) : null}
          {drawn(TASK_PROPERTY.UPDATED) ? (
            <Time at={taskTime(task, TASK_ORDER.UPDATED)} now={now} hint={false} />
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
                  {actorName(maker.actor)}
                </Text>
              )}
              <CreatorFace task={task} onOpen={onOpen} />
            </span>
          ) : null}
        </span>
      </span>
      <span className={BOARD_CARD_TITLE}>
        {drawn(TASK_PROPERTY.STATUS) ? (
          <StatusChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
        ) : null}
        {rename.editing ? (
          <span className="tasks-board-name flex overflow-visible text-label font-luke-medium text-foreground wrap-anywhere">
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
            roving
            onPress={() => {
              menu.close(false);
              onOpen();
            }}
          >
            <span id={nameId} className={BOARD_NAME}>
              {task.name}
            </span>
            {/* Note that the key stands drawn on the first line, outside the press, so the press says it to a screen reader, and find skips it, which finds it drawn. */}
            {key === undefined || !drawn(TASK_PROPERTY.KEY) ? null : (
              <VisuallyHidden {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>{`, ${key}`}</VisuallyHidden>
            )}
          </CardPress>
        )}
      </span>
      {rename.refused ? <span className={BOARD_CARD_NOTE}>{RENAME_FAILED_NOTE}</span> : null}
      <div className={BOARD_CARD_FOOT}>
        <div className={BOARD_CARD_PILLS}>
          {/* Note that a task from a service before priorities offers No priority, as one before statuses stands under Todo. */}
          {drawn(TASK_PROPERTY.PRIORITY) ? (
            <PriorityChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
          ) : null}
          {drawn(TASK_PROPERTY.ASSIGNEE) ? (
            <AssigneeChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
          ) : null}
          {task.repository === null || !drawn(TASK_PROPERTY.REPOSITORY) ? null : (
            <TaskBoardRepository tasks={tasks} repository={task.repository} />
          )}
          {drawn(TASK_PROPERTY.AGENTS) ? (
            <TaskWorkMarks task={task} tasks={tasks} look={WORK_LOOK.PILLS} onOpen={onOpen} />
          ) : null}
          <TaskBoardTags task={task} />
        </div>
        <span className="tasks-board-card-more pointer-events-auto flex flex-none">
          {menu.more({ size: BUTTON_SIZE.COMPACT, describedBy: nameId })}
        </span>
      </div>
      {menu.popup}
      {actions.dialog}
    </Card>
  );
}

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
        <span className={BOARD_NAME}>{draft?.title ?? pending}</span>
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
    <li className={`tasks-board-draft-note ${BOARD_CARD_NOTE}`}>{refused}</li>
  );

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
      const standing = onto === undefined ? undefined : groupStanding(onto.head);
      if (task === undefined || standing === undefined || standsAt(task, standing)) return;
      onStanding(task, standing);
    },
  });
  const { mark, words } = columnHead(column.head, people);
  const value = columnValue(column.head);
  // Note that a phone's card keeps its assignee's chip under an assignee's column, since with no drag it is how the card moves to another, and so does a card held under a column that no longer names its assignee.
  const drawn = (task: TaskSummary) =>
    column.head.kind === TASKS_GROUP.ASSIGNEE &&
    !narrow &&
    column.head.assigneeId === (task.assignee?.userId ?? null)
      ? properties.filter((property) => property !== TASK_PROPERTY.ASSIGNEE)
      : properties;
  const cards = useLeaving(column.tasks, taskIdOf);
  const into = quickAddInto(column.head);
  const quick = useQuickAdd(tasks, into ?? {});
  // Note that the quick add's lines stand where the cards do, so a column with none draws them in their list rather than its empty line.
  const adding = quick.shown;
  // A column's cards are one Tab stop that ↑↓ walk; ←→ cross to the next column's (`useRovingColumns`).
  const roving = useRovingKeys<HTMLDivElement>();
  return (
    <Card
      as={CARD_ELEMENT.SECTION}
      look={CARD_LOOK.WELL}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      className="tasks-board-column flex min-h-0 w-tasks-board-column flex-none flex-col px-item-gap pt-tight-gap pb-item-gap"
      data-task-column={value}
      data-row-drop={value}
      aria-label={words}
      id={narrow ? panelId : undefined}
      role={narrow ? "tabpanel" : undefined}
    >
      <GroupHeader
        label={words}
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
            className="tasks-board-empty px-item-gap pt-luke-2 pb-item-gap"
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
            size={narrow ? SCROLL_SIZE.FILL : SCROLL_SIZE.CONTENT}
            fade={SCROLL_FADE.BOTH}
            gutter={SCROLL_GUTTER.STABLE}
            overscroll={SCROLL_OVERSCROLL.CHAIN}
          >
            <Stack
              as={LAYOUT_ELEMENT.UL}
              gap={GAP.ITEM}
              inset={INSET.RING}
              className="tasks-board-cards data-[dragging=true]:cursor-grabbing"
              moves
              onPointerDown={narrow ? undefined : drag}
            >
              <QuickAddLines quick={quick} line={boardQuickAddLine} />
              {cards.map(({ value: task }) => (
                <TaskBoardCard
                  key={task.id}
                  tasks={tasks}
                  task={task}
                  workspaceName={workspaceName}
                  properties={drawn(task)}
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
  const now = useMinute();
  const { waiting } = useSettledWaiting(tasks.listed.inbox, tasks.inboxTaskless);
  const waitingOn = new Map(waiting.map((each) => [each.taskId, each.items.length]));
  const ids = useId();
  const board = useRef<HTMLDivElement>(null);
  const crossing = useRovingColumns<HTMLDivElement>();
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
  const setStanding = useStandingDoor(tasks);
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
      <div className="tasks-board-tabs flex min-w-0 grow basis-full flex-col">
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
      scrollRef={frame.scroll}
      filters={filters}
      state={boardState(tasks, listed.length === 0)}
      loadingLabel={READING_LINE}
      empty={
        <EmptyState
          icon={<SquareKanbanIcon />}
          action={newTaskAction(tasks.signedIn ? tasks.onNewTask : undefined)}
        >
          {noneYetWords(TERM.TASK)}
        </EmptyState>
      }
      error={
        <ErrorState onRetry={tasks.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      {/* A refresh that failed after the tasks were read leaves them drawn, with a line over them. */}
      {tasks.listFailed && listed.length > 0 ? (
        <ErrorState onRetry={tasks.onRetryList}>{REFRESH_FAILED_WORDS}</ErrorState>
      ) : null}
      <ListMotion root={board}>
        <div ref={board} className={BOARD} data-row-drop-scope="" {...crossing}>
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
