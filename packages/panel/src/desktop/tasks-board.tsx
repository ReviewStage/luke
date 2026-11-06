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
import { FIND_SKIP_ATTRIBUTE } from "@repo/ui/find-skip";
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
  type VirtualRowMeasurements,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
  type VirtualRuns,
} from "@repo/ui/virtual-rows";
import { useMutation } from "@tanstack/react-query";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { SquareKanbanIcon } from "lucide-react";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { useMemberDirectory } from "../member-directory.js";
import { renameWrite } from "../rename-write.js";
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
import { TASK_RENAME_SHAPE, type TasksControl } from "../tasks/use-tasks-tab.js";
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

const READING_LINE = readingWords(TERM.TASK.many);

const UNREAD_LINE = readFailedWords(`your ${TERM.TASK.many}`);

const NO_TASKS = "No tasks";

const NONE_STANDING = "No tasks match this view";

function boardState(tasks: TasksControl, empty: boolean): CollectionState {
  if (tasks.listFailed && empty) return COLLECTION_STATE.ERROR;
  if (!tasks.listRead && !tasks.listFailed) return COLLECTION_STATE.LOADING;
  return empty ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY;
}

const CARD_HANDLE = CARD_PRESS_SELECTOR;

const CARD_ESTIMATE_PX = 64;

const CARD_GAP_PX = 6;

const FIRST_SHOWN: string = TASK_STATUS.TODO;

const COLUMN_TABS = "Columns";

const BOARD =
  "tasks-board relative -me-collection-page-inset flex min-h-0 min-w-min flex-[1_1_0] gap-block-gap pe-collection-page-inset leading-[normal] [--carried-ground:var(--ui-color-surface)]";

const BOARD_CARD =
  "tasks-board-card group/board-card flex flex-col gap-item-gap pt-row-inset pr-row-inset pb-item-gap pl-list-inset";

const BOARD_CARD_TITLE =
  "tasks-board-card-title flex min-w-0 items-start gap-ui-4 [&>:last-child]:min-w-0 [&>:last-child]:flex-auto";

const BOARD_NAME =
  "tasks-board-name line-clamp-3 text-label font-ui-medium text-foreground wrap-anywhere";

const BOARD_CARD_NOTE = "tasks-board-card-note text-caption text-danger";

const BOARD_CARD_KEY =
  "tasks-board-card-key flex ms-[calc(var(--spacing-select-box-inset)-var(--ui-space-4))] group-has-[.ui-card-press:hover]/board-card:invisible group-has-[.ui-card-press:focus-visible]/board-card:invisible group-has-[.ui-select-box:hover]/board-card:invisible group-has-[.ui-select-box[data-shown=true]]/board-card:invisible";

const BOARD_CARD_FOOT =
  "tasks-board-card-foot pointer-events-none relative z-1 flex min-w-0 items-end gap-tight-gap";

const BOARD_CARD_PILLS =
  "tasks-board-card-pills flex min-w-0 flex-auto flex-wrap items-center gap-ui-6 [&>:not(.task-agents-mark,.ui-progress-count)]:pointer-events-auto";

function TaskBoardRepository({
  repository,
  label,
  openGitHub,
  pictures,
}: {
  repository: string;
  label: string;
  openGitHub: (url: string) => void;
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
  repositoryName: string | undefined;
  opened: OpenedTask | undefined;
  workspaceName: string;
  properties: readonly TaskProperty[];
  waiting: number;
  subTasksFinished: number;
  subTasksTotal: number;
  chosen: ChosenTasks | undefined;
  onSelect: (taskId: string) => void;
  onStanding: (task: TaskSummary, standing: TaskStanding) => void;
  place: VirtualRowPlace;
}): React.JSX.Element {
  const maker = useTaskMaker(task);
  const unread = useMarkedUnread(task.id);
  const renaming = useMutation(tasks.renameTask);
  const rename = useInlineRename(task.id, renameWrite(renaming, TASK_RENAME_SHAPE));
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

interface ColumnHead {
  readonly mark: React.JSX.Element | null;
  readonly words: string;
  readonly masked?: boolean | undefined;
}

const NO_ASSIGNEE_COLUMN = "no-assignee";

interface ColumnPeople {
  readonly mark: (userId: string) => React.JSX.Element;
  readonly words: (userId: string) => string;
}

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

function columnValue(head: TasksGroupHead): string {
  if (head.kind === TASKS_GROUP.STATUS) return head.status;
  if (head.kind === TASKS_GROUP.PRIORITY) return head.priority;
  if (head.kind === TASKS_GROUP.ASSIGNEE) return head.assigneeId ?? NO_ASSIGNEE_COLUMN;
  return head.kind;
}

function pressOf(card: Element | undefined): HTMLElement | undefined {
  return card?.querySelector<HTMLElement>(CARD_HANDLE) ?? undefined;
}

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
  measured,
  onSelect,
  onStanding,
  onShowOlder,
}: {
  tasks: TasksControl;
  rowTab: TaskRowTab;
  opened: OpenedTask | undefined;
  column: TasksGroup;
  columns: readonly TasksGroup[];
  workspaceName: string;
  narrow: boolean;
  panelId: string;
  properties: readonly TaskProperty[];
  people: ColumnPeople;
  waitingOn: ReadonlyMap<string, number>;
  subTasksOf: ReadonlyMap<string, ChildTaskCount>;
  chosenOf: (taskId: string) => ChosenTasks | undefined;
  finding: boolean;
  holdRun: VirtualRuns["hold"];
  measured: Map<string, VirtualRowMeasurements> | undefined;
  onSelect: (taskId: string) => void;
  onStanding: (task: TaskSummary, standing: TaskStanding) => void;
  onShowOlder: () => void;
}): React.JSX.Element {
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
  const unassigned = useMemo(
    () => properties.filter((property) => property !== TASK_PROPERTY.ASSIGNEE),
    [properties],
  );
  const drawn = (task: TaskSummary) =>
    column.head.kind === TASKS_GROUP.ASSIGNEE &&
    !narrow &&
    column.head.assigneeId === (task.assignee?.userId ?? null)
      ? unassigned
      : properties;
  const cards = useLeaving(column.tasks, taskIdOf);
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
  const adding = quick.shown;
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
          <ScrollArea
            ref={scroller}
            size={narrow ? SCROLL_SIZE.FILL : SCROLL_SIZE.CONTENT}
            fade={SCROLL_FADE.BOTH}
            gutter={SCROLL_GUTTER.STABLE}
            overscroll={SCROLL_OVERSCROLL.CHAIN}
          >
            <Stack ref={body} gap={GAP.ITEM} inset={INSET.RING} className="tasks-board-column-body">
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
                  measurements={measured?.get(columnValue(column.head))}
                  onMeasurements={(rows) => measured?.set(columnValue(column.head), rows)}
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

export function TasksBoard({
  tasks,
  room,
  title,
  frame,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  title: string;
  frame: TasksViewFrame;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, tasks.boardView.onClose);
  const now = useMinute();
  const waitingOn = useTasksWaiting(tasks);
  const ids = useId();
  const board = useRef<HTMLDivElement>(null);
  const crossing = useRovingColumns<HTMLDivElement>();
  const ownColumn = useCreateStore<string | undefined>(undefined);
  const columnStore = frame.column ?? ownColumn;
  const chosen = useSelector(columnStore) ?? FIRST_SHOWN;
  const setChosen = (next: string) => columnStore.setState(() => next);
  const listed = tasks.listed.tasks;
  const subTasksOf = useMemo(() => childTaskCounts(listed), [listed]);
  const { filter, display } = frame;
  const directory = useMemberDirectory();
  const people: ColumnPeople = {
    mark: (userId) => (
      <ActorMark actor={assigneeFor(userId, directory, listed)} size={ACTOR_SIZE.MARK} />
    ),
    words: (userId) => assigneeWords(userId, directory, listed),
  };
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
  const setStanding = useSteadyDoor(useStandingDoor(tasks));
  const rowTab = useTaskRowTab(tasks);
  const { region, agents } = tasks;
  const opened = useMemo(() => openedTaskOf({ region, agents }), [region, agents]);
  const narrow = room === SHELL_ROOM.NARROW;
  const values = columns.map((column) => columnValue(column.head));
  const chosenStands = values.includes(chosen);
  useEffect(() => {
    if (!chosenStands) columnStore.setState(() => FIRST_SHOWN);
  }, [chosenStands, columnStore]);
  const shown = chosenStands ? chosen : values.includes(FIRST_SHOWN) ? FIRST_SHOWN : values[0];
  const panelId = `${ids}panel`;
  const properties = display.properties;
  const shownColumn = narrow ? shown : undefined;
  const laidOut = useMemo(
    () => ({ columns, properties, shownColumn }),
    [columns, properties, shownColumn],
  );
  const drawnColumns = narrow
    ? columns.filter((column) => columnValue(column.head) === shown)
    : columns;
  const order = drawnColumns.map((column) => column.tasks.map(taskIdOf));
  const runs = useVirtualRuns();
  const finding = useFindOpen();
  const selection = useTasksSelection(tasks, new Set(order.flat()), frame.chosen);
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
      width={PAGE_WIDTH.FULL}
      label={title}
      toolbar={frame.toolbar}
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
                measured={frame.measured}
                onSelect={tasks.onSelect}
                onStanding={setStanding}
                onShowOlder={() => frame.onDisplay({ ...display, completed: COMPLETED_WINDOW.ALL })}
              />
            ))}
          </div>
        </SelectionRegion>
      </ListMotion>
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
