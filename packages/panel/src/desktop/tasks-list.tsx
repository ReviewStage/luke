import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "@repo/features/pin-order";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSectionWrite,
} from "@repo/features/task-section-wire";
import { isAgentEntry } from "@repo/features/task-section-writes";
import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
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
  AVATAR_SIZE,
  CARD_PRESS_SELECTOR,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  cssCustomProperties,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  GAP,
  GROUP_HEAD,
  GROUP_ROWS,
  GROUP_SURFACE,
  GroupHeader,
  joinRefs,
  LAYOUT_ELEMENT,
  ListMotion,
  motionKey,
  motionRows,
  NoRepositoryGlyph,
  PAGE_FRAME,
  PAGE_WIDTH,
  RepositoryPicture,
  reachedKey,
  SelectionBar,
  SelectionRegion,
  Stack,
  TaskPriorityMark,
  type TaskRowCell,
  TaskRowDraft,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  taskRowColumns,
  taskRowFit,
  useLeaving,
  useMinute,
  useRovingKeys,
} from "@repo/ui";
import { actorName, creatorActor } from "@repo/ui/actor-model";
import { GLYPH, ListTodoIcon, PinIcon, UserXIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { childTaskCounts, NO_REPOSITORY, repositoryLabel } from "@repo/ui/task-list-model";
import {
  placeWrites,
  restoreWrites,
  sectionEntries,
  sectionOrder,
  sectionTaskIds,
  workspaceSections,
} from "@repo/ui/task-sections-model";
import { TASK_MARK } from "@repo/ui/tasks-model";
import {
  COMPLETED_WINDOW,
  LIST_COLUMN,
  type ListColumn,
  TASK_PROPERTY,
  TASKS_GROUP,
  TASKS_GROUPING,
  type TasksGroup,
  type TasksGroupHead,
  type TasksSection,
  taskIdOf,
  tasksListGroups,
} from "@repo/ui/tasks-page-model";
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
import { Schema } from "effect";
import {
  Fragment,
  memo,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { useMemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoor } from "../steady-door.js";
import { pullRequestNumberLabel } from "../tasks/agent-model.js";
import { newTaskAction } from "../tasks/inbox-list.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
} from "../tasks/task-standing.js";
import { useTaskMaker } from "../tasks/use-task-origin.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { keptKey, useKept } from "../use-kept.js";
import { useFittedColumns } from "./fitted-columns.js";
import { groupNewTaskWords, NewTaskInButton, quickAddInto } from "./new-task-button.js";
import { useTasksWaiting } from "./places-waiting.js";
import { type DraftParts, type QuickAddLine, QuickAddLines, useQuickAdd } from "./quick-add.js";
import { sectionGlyph } from "./section-icon-picker.js";
import { groupCount, sidebarFold } from "./sidebar-fold.js";
import { type OpenedTask, openedTaskOf, type TaskRowTab, useTaskRowTab } from "./task-actions.js";
import { openPullRequests, TaskListRow } from "./task-list-row.js";
import { CreatorFace, useStandingDoor, WaitingCount } from "./task-row-parts.js";
import {
  assigneeFor,
  assigneeWords,
  creatorWords,
  NO_CREATOR,
  OlderCompleted,
  type TasksViewFrame,
} from "./tasks-page-options.js";
import { type ChosenTasks, useTasksSelection } from "./tasks-selection.js";
import { useHeldTasks } from "./use-held-tasks.js";
import { useTaskDrag } from "./use-row-drag.js";

const TASKS = "Tasks";

const READING_LINE = readingWords(TERM.TASK.many);

const UNREAD_LINE = readFailedWords(`your ${TERM.TASK.many}`);

const NONE_STANDING = "No tasks match this view";

const NO_TASKS = "No tasks";
const DRAG_HERE = "Drag tasks here";

const PINNED = "Pinned";

const ROW_HANDLE = CARD_PRESS_SELECTOR;

const ROW_ESTIMATE_PX = 36;

const ROWS_GRID =
  "col-span-full m-0 grid list-none grid-cols-subgrid content-start gap-x-[normal] p-0";

const DROP_ZONE = {
  PINNED: "pinned",
  ALL: "all",
  NO_ASSIGNEE: "no-assignee",
} as const;

const storedFolds = Schema.fromJsonString(
  Schema.Struct({
    pinned: Schema.optionalKey(Schema.Boolean),
    sections: Schema.optionalKey(Schema.Array(Schema.String)),
    status: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_STATUS_ORDER))),
    priority: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PRIORITY_ORDER))),
    repository: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
    assignee: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
    creator: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  }),
);

type ListFolds = typeof storedFolds.Type;

const KEPT = {
  FOLDS: keptKey("app.tasksListFolds", storedFolds),
} as const;

function flipped<T>(held: readonly T[] | undefined, value: T): readonly T[] {
  const kept = held ?? [];
  return kept.includes(value) ? kept.filter((each) => each !== value) : [...kept, value];
}

function foldedIn(folds: ListFolds, head: TasksGroupHead): boolean {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
      return folds.pinned === true;
    case TASKS_GROUP.SECTION:
      return folds.sections?.includes(head.sectionId) === true;
    case TASKS_GROUP.STATUS:
      return folds.status?.includes(head.status) === true;
    case TASKS_GROUP.PRIORITY:
      return folds.priority?.includes(head.priority) === true;
    case TASKS_GROUP.REPOSITORY:
      return folds.repository?.includes(head.repository) === true;
    case TASKS_GROUP.ASSIGNEE:
      return folds.assignee?.includes(head.assigneeId) === true;
    case TASKS_GROUP.CREATOR:
      return folds.creator?.includes(head.creatorId) === true;
    case TASKS_GROUP.ALL:
      return false;
  }
}

function toggledIn(folds: ListFolds, head: TasksGroupHead): ListFolds {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
      return { ...folds, pinned: folds.pinned !== true };
    case TASKS_GROUP.SECTION:
      return { ...folds, sections: flipped(folds.sections, head.sectionId) };
    case TASKS_GROUP.STATUS:
      return { ...folds, status: flipped(folds.status, head.status) };
    case TASKS_GROUP.PRIORITY:
      return { ...folds, priority: flipped(folds.priority, head.priority) };
    case TASKS_GROUP.REPOSITORY:
      return { ...folds, repository: flipped(folds.repository, head.repository) };
    case TASKS_GROUP.ASSIGNEE:
      return { ...folds, assignee: flipped(folds.assignee, head.assigneeId) };
    case TASKS_GROUP.CREATOR:
      return { ...folds, creator: flipped(folds.creator, head.creatorId) };
    case TASKS_GROUP.ALL:
      return folds;
  }
}

function useListFolds(): {
  folded: (head: TasksGroupHead) => boolean;
  toggle: (head: TasksGroupHead) => void;
} {
  const [folds, keep] = useKept(KEPT.FOLDS, {});
  return {
    folded: (head) => foldedIn(folds, head),
    toggle: (head) => keep(toggledIn(folds, head)),
  };
}

function zoneOf(head: TasksGroupHead): string | undefined {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
      return DROP_ZONE.PINNED;
    case TASKS_GROUP.SECTION:
      return head.sectionId;
    case TASKS_GROUP.STATUS:
      return head.status;
    case TASKS_GROUP.PRIORITY:
      return head.priority;
    case TASKS_GROUP.ASSIGNEE:
      return head.assigneeId ?? DROP_ZONE.NO_ASSIGNEE;
    case TASKS_GROUP.ALL:
      return DROP_ZONE.ALL;
    default:
      return undefined;
  }
}

function ordered(head: TasksGroupHead): boolean {
  return head.kind === TASKS_GROUP.PINNED || head.kind === TASKS_GROUP.SECTION;
}

function groupKey(head: TasksGroupHead): string {
  switch (head.kind) {
    case TASKS_GROUP.SECTION:
      return head.sectionId;
    case TASKS_GROUP.STATUS:
      return head.status;
    case TASKS_GROUP.PRIORITY:
      return head.priority;
    case TASKS_GROUP.REPOSITORY:
      return head.repository ?? NO_REPOSITORY;
    case TASKS_GROUP.ASSIGNEE:
      return head.assigneeId ?? NO_ASSIGNEE_WORDS;
    case TASKS_GROUP.CREATOR:
      return head.creatorId ?? NO_CREATOR;
    default:
      return head.kind;
  }
}

function listState(tasks: TasksControl, empty: boolean): CollectionState {
  if (tasks.listFailed && empty) return COLLECTION_STATE.ERROR;
  if (!tasks.listRead && !tasks.listFailed) return COLLECTION_STATE.LOADING;
  return empty ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY;
}

function listSections(tasks: TasksControl): readonly TasksSection[] {
  const workspaceId = tasks.workspace?.id;
  if (workspaceId === undefined) return [];
  return workspaceSections(tasks.taskSections, workspaceId).map((section) => ({
    sectionId: section.id,
    taskIds: sectionTaskIds(tasks.taskSections, section.id),
  }));
}

interface GroupHead {
  readonly icon: ReactNode;
  readonly name: string;
  readonly hint?: string | undefined;
  readonly masked?: boolean | undefined;
}

interface GroupPeople {
  readonly creatorName: (creatorId: string | null) => string;
  readonly creatorMark: (creatorId: string) => ReactNode;
  readonly assigneeName: (assigneeId: string | null) => string;
  readonly assigneeMark: (assigneeId: string) => ReactNode;
}

function groupHead(
  head: TasksGroupHead,
  tasks: TasksControl,
  repositories: readonly { readonly repository: string | null }[],
  people: GroupPeople,
): GroupHead {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
      return { icon: <PinIcon />, name: PINNED };
    case TASKS_GROUP.SECTION: {
      const section = tasks.taskSections.sections.find((each) => each.id === head.sectionId);
      const glyph = sectionGlyph(section?.icon) ?? <GLYPH.SECTION />;
      return {
        icon:
          section?.icon?.kind === TASK_SECTION_ICON_KIND.EMOJI ? (
            <ReplayMask>{glyph}</ReplayMask>
          ) : (
            glyph
          ),
        name: section?.title ?? "",
        masked: true,
      };
    }
    case TASKS_GROUP.STATUS:
      return {
        icon: <TaskStatusMark status={head.status} />,
        name: TASK_STATUS_WORDS[head.status],
      };
    case TASKS_GROUP.PRIORITY:
      return {
        icon: <TaskPriorityMark priority={head.priority} />,
        name: TASK_PRIORITY_WORDS[head.priority],
      };
    case TASKS_GROUP.REPOSITORY:
      return head.repository === null
        ? { icon: <NoRepositoryGlyph />, name: NO_REPOSITORY }
        : {
            icon: (
              <RepositoryPicture
                repository={head.repository}
                pictures={tasks.repositories.pictures}
                size={AVATAR_SIZE.GLYPH}
              />
            ),
            name: repositoryLabel(head.repository, repositories),
            hint: head.repository,
            masked: true,
          };
    case TASKS_GROUP.ASSIGNEE:
      return head.assigneeId === null
        ? { icon: <UnassignedMark size={ACTOR_SIZE.MARK} decorative />, name: NO_ASSIGNEE_WORDS }
        : {
            icon: <ReplayMask>{people.assigneeMark(head.assigneeId)}</ReplayMask>,
            name: people.assigneeName(head.assigneeId),
            masked: true,
          };
    case TASKS_GROUP.CREATOR:
      return head.creatorId === null
        ? { icon: <UserXIcon />, name: NO_CREATOR }
        : {
            icon: <ReplayMask>{people.creatorMark(head.creatorId)}</ReplayMask>,
            name: people.creatorName(head.creatorId),
            masked: true,
          };
    case TASKS_GROUP.ALL:
      return { icon: null, name: TASKS };
  }
}

const pinPlaceOf = (task: TaskSummary): PinPlace => ({
  position: task.pinPosition,
  at: task.pinnedAt ?? 0,
});

function pinMoves(positions: ReadonlyMap<TaskSummary, string>) {
  return [...positions].map(([task, position]) => ({ agent: false, id: task.id, position }));
}

function leaveSection(tasks: TasksControl, taskId: string): TaskSectionWrite[] {
  return sectionEntries(tasks.taskSections).has(taskId)
    ? [{ kind: TASK_SECTION_WRITE.PLACE, taskId, sectionId: null }]
    : [];
}

function drawnEntries(tasks: TasksControl, group: TasksGroup, sectionId: string) {
  const drawn = new Set(group.tasks.map((task) => task.id));
  return sectionOrder(tasks.taskSections, sectionId).flatMap((entry) =>
    !isAgentEntry(entry) && drawn.has(entry.taskId) ? [entry] : [],
  );
}

interface ListDrops {
  readonly move: (group: TasksGroup) => ((taskId: string, to: number) => void) | undefined;
  readonly dropOut: (group: TasksGroup, taskId: string, zone: string, at: number) => void;
}

function listDrops(
  tasks: TasksControl,
  latest: () => TasksControl,
  groups: readonly TasksGroup[],
  setStanding: (task: TaskSummary, standing: TaskStanding, onRefused?: () => void) => void,
): ListDrops {
  const pins = groups.find((group) => group.head.kind === TASKS_GROUP.PINNED)?.tasks ?? [];
  const move = (group: TasksGroup) => {
    const { head } = group;
    if (head.kind === TASKS_GROUP.PINNED) {
      return (taskId: string, to: number) => {
        const from = group.tasks.findIndex((each) => each.id === taskId);
        if (from < 0) return;
        tasks.onMovePins(pinMoves(pinPositionsForMove(group.tasks, from, to, pinPlaceOf)));
      };
    }
    if (head.kind === TASKS_GROUP.SECTION) {
      return (taskId: string, to: number) => {
        const entries = drawnEntries(tasks, group, head.sectionId);
        const entry = entries.find((each) => each.taskId === taskId);
        if (entry === undefined) return;
        const member = { agent: false, id: entry.taskId };
        tasks.onWriteSections(placeWrites(entries, member, head.sectionId, to, Date.now()));
      };
    }
    return undefined;
  };
  const dropOut = (group: TasksGroup, taskId: string, zone: string, at: number) => {
    const task = group.tasks.find((each) => each.id === taskId);
    const onto = groups.find((each) => zoneOf(each.head) === zone)?.head;
    if (task === undefined || onto === undefined) return;
    const fromPins = group.head.kind === TASKS_GROUP.PINNED;
    const leaving: TaskSectionWrite[] =
      group.head.kind === TASKS_GROUP.SECTION && onto.kind !== TASKS_GROUP.SECTION
        ? leaveSection(tasks, task.id)
        : [];
    const leave = () => {
      if (fromPins) tasks.onMarkTask(task.id, TASK_MARK.UNPIN);
      if (leaving.length > 0) tasks.onWriteSections(leaving);
    };
    const before = tasks.taskSections;
    const allPins = inPinOrder(
      tasks.listed.tasks.filter((each) => each.pinnedAt !== undefined),
      pinPlaceOf,
    );
    const back = () => {
      const now = latest();
      if (fromPins) {
        const others = allPins.filter((each) => each.id !== task.id);
        const at = allPins.findIndex((each) => each.id === task.id);
        const { pinPosition: _position, ...rest } = task;
        const again: TaskSummary = { ...rest, pinnedAt: Date.now() };
        now.onMarkTask(task.id, TASK_MARK.PIN);
        now.onMovePins(pinMoves(pinPositionsForInsert(others, again, at, pinPlaceOf)));
      }
      if (leaving.length === 0) return;
      const member = { agent: false, id: task.id };
      const writes = restoreWrites(before, now.taskSections, [member], null, Date.now());
      if (writes.length > 0) now.onWriteSections(writes);
    };
    switch (onto.kind) {
      case TASKS_GROUP.PINNED: {
        const { pinPosition: _position, ...rest } = task;
        const moving: TaskSummary = { ...rest, pinnedAt: Date.now() };
        leave();
        tasks.onMarkTask(task.id, TASK_MARK.PIN);
        const positions = pinPositionsForInsert(pins, moving, at, pinPlaceOf);
        tasks.onMovePins(pinMoves(positions));
        return;
      }
      case TASKS_GROUP.SECTION: {
        const target = groups.find(
          (each) =>
            each.head.kind === TASKS_GROUP.SECTION && each.head.sectionId === onto.sectionId,
        );
        const entries = target === undefined ? [] : drawnEntries(tasks, target, onto.sectionId);
        leave();
        const member = { agent: false, id: task.id };
        tasks.onWriteSections(placeWrites(entries, member, onto.sectionId, at, Date.now()));
        return;
      }
      case TASKS_GROUP.STATUS:
        leave();
        setStanding(task, { status: onto.status }, back);
        return;
      case TASKS_GROUP.PRIORITY:
        leave();
        setStanding(task, { priority: onto.priority }, back);
        return;
      case TASKS_GROUP.ASSIGNEE:
        leave();
        setStanding(task, { assigneeId: onto.assigneeId }, back);
        return;
      default:
        leave();
    }
  };
  return { move, dropOut };
}

const TasksPageRow = memo(function TasksPageRow({
  tasks,
  task,
  opened,
  workspaceName,
  repositoryName,
  waiting,
  properties,
  assigneeHeld,
  subTasksFinished,
  subTasksTotal,
  chosen,
  more,
  onSelect,
  onStanding,
  place,
}: {
  tasks: TaskRowTab;
  task: TaskSummary;
  opened: OpenedTask | undefined;
  workspaceName: string;
  repositoryName: string;
  waiting: number;
  properties: readonly TaskRowCell[];
  assigneeHeld: boolean;
  subTasksFinished: number;
  subTasksTotal: number;
  chosen: ChosenTasks | undefined;
  more: boolean;
  onSelect: (taskId: string) => void;
  onStanding: (task: TaskSummary, standing: TaskStanding) => void;
  place: VirtualRowPlace;
}): React.JSX.Element {
  const maker = useTaskMaker(task);
  const onOpen = () => onSelect(task.id);
  return (
    <TaskListRow
      tasks={tasks}
      task={task}
      opened={opened}
      workspaceName={workspaceName}
      cells={properties}
      repositoryName={repositoryName}
      assigneeHeld={assigneeHeld}
      subTasks={
        subTasksTotal === 0 ? undefined : { finished: subTasksFinished, total: subTasksTotal }
      }
      chosen={chosen}
      more={more}
      place={place}
      onOpen={onOpen}
      onStanding={(standing) => onStanding(task, standing)}
      content={{
        [TASK_PROPERTY.WAITING]: <WaitingCount count={waiting} />,
        [TASK_PROPERTY.CREATOR]: (
          <>
            {maker === undefined ? null : (
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.INHERIT}
                truncate
                className="tasks-list-maker max-w-tasks-list-maker"
              >
                <ReplayMask>{actorName(maker.actor)}</ReplayMask>
              </Text>
            )}
            <CreatorFace task={task} onOpen={onOpen} />
          </>
        ),
      }}
    />
  );
});

const DRAFT_CELLS = [TASK_PROPERTY.PRIORITY, TASK_PROPERTY.STATUS, TASK_PROPERTY.ASSIGNEE] as const;

function draftChip(draft: DraftParts, property: TaskRowCell): ReactNode {
  if (property === TASK_PROPERTY.PRIORITY) return draft.priority;
  if (property === TASK_PROPERTY.STATUS) return draft.status;
  if (property === TASK_PROPERTY.ASSIGNEE) return draft.assignee;
  return null;
}

function listQuickAddLine(properties: readonly TaskRowCell[]): QuickAddLine {
  return ({ draft, pending, refused }) => (
    <TaskRowDraft
      cells={properties}
      content={
        draft === undefined
          ? {}
          : Object.fromEntries(
              DRAFT_CELLS.map((property) => [property, draftChip(draft, property)]),
            )
      }
      name={
        <>
          <ReplayMask>{draft?.title ?? pending}</ReplayMask>
          {draft === undefined
            ? null
            : DRAFT_CELLS.filter((property) => !properties.includes(property)).map((property) => (
                <Fragment key={property}>{draftChip(draft, property)}</Fragment>
              ))}
        </>
      }
      note={refused === undefined ? undefined : <ReplayMask>{refused}</ReplayMask>}
      drafting={draft !== undefined}
      pending={pending !== undefined}
    />
  );
}

interface ListRunsPlace {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly list: RefObject<HTMLElement | null>;
  readonly finding: boolean;
  readonly holdRun: VirtualRuns["hold"];
}

function TasksListGroup({
  group,
  head,
  folded,
  onToggle,
  drops,
  draggable,
  onShowOlder,
  tasks,
  properties,
  place,
  row,
  measured,
}: {
  group: TasksGroup;
  head: GroupHead;
  folded: boolean;
  onToggle: () => void;
  drops: ListDrops;
  draggable: boolean;
  onShowOlder: () => void;
  tasks: TasksControl;
  properties: readonly TaskRowCell[];
  place: ListRunsPlace;
  row: (task: TaskSummary, at: VirtualRowPlace) => ReactNode;
  measured: Map<string, VirtualRowMeasurements> | undefined;
}): React.JSX.Element {
  const runKey = groupKey(group.head);
  const drawn = useLeaving(group.tasks, taskIdOf);
  const keys = useMemo(() => drawn.map(({ key }) => key), [drawn]);
  const run = useRef<VirtualRowsHandle>(null);
  const { holdRun } = place;
  useLayoutEffect(() => holdRun(run), [holdRun]);
  const move = folded ? undefined : drops.move(group);
  const drag = useTaskDrag(move, {
    handle: ROW_HANDLE,
    onDropOut: (taskId, zone, at) => drops.dropOut(group, taskId, zone, at),
  });
  const zone = zoneOf(group.head);
  const titled = group.head.kind !== TASKS_GROUP.ALL;
  const into = quickAddInto(group.head);
  const quick = useQuickAdd(tasks, into ?? {});
  const adding = quick.shown;
  const add = () => {
    if (folded) onToggle();
    quick.open();
  };
  const rows =
    drawn.length === 0 && !adding ? (
      group.older === undefined ? (
        <Text
          variant={TEXT_VARIANT.CAPTION}
          tone={TEXT_TONE.MUTED}
          className="tasks-list-group-empty px-row-inset py-tight-gap"
        >
          {draggable && ordered(group.head) ? DRAG_HERE : NO_TASKS}
        </Text>
      ) : null
    ) : (
      <>
        {adding ? (
          <Stack
            as={LAYOUT_ELEMENT.UL}
            gap={GAP.NONE}
            moves
            className={`tasks-list-adds ${ROWS_GRID}`}
          >
            <QuickAddLines quick={quick} line={listQuickAddLine(properties)} />
          </Stack>
        ) : null}
        {drawn.length === 0 ? null : (
          <VirtualRows
            scroller={place.scroller}
            shiftedBy={place.list}
            keys={keys}
            estimate={ROW_ESTIMATE_PX}
            overscan={place.finding ? keys.length : undefined}
            anchor={VIRTUAL_ROWS_ANCHOR.START}
            listItems
            moves
            holdsFocus
            className={`tasks-list-rows ${ROWS_GRID} data-[dragging=true]:cursor-grabbing`}
            aria-label={head.name}
            data-row-drop-rows={ordered(group.head) ? "" : undefined}
            onPointerDown={draggable ? drag : undefined}
            handle={run}
            measurements={measured?.get(runKey)}
            onMeasurements={(rows) => measured?.set(runKey, rows)}
          >
            {(index, at) => {
              const entry = drawn[index];
              return entry === undefined ? null : row(entry.value, at);
            }}
          </VirtualRows>
        )}
      </>
    );
  const body = (
    <>
      {rows}
      <OlderCompleted older={group.older} onShow={onShowOlder} />
    </>
  );
  return (
    <section
      className="tasks-list-group col-span-full grid grid-cols-subgrid content-start gap-y-list-gap rounded-ui-10 transition-[background-color] duration-(--ui-duration-hover) ease-motion-exit data-leaving:grid-cols-tasks-list data-leaving:gap-x-block-gap data-[drop-target=true]:bg-muted [&>:not(.tasks-list-rows)]:col-span-full"
      aria-label={head.name}
      {...motionKey(groupKey(group.head))}
      data-row-drop={draggable ? zone : undefined}
      data-folded={folded ? "true" : undefined}
    >
      {titled ? (
        <GroupHeader
          label={head.masked === true ? <ReplayMask>{head.name}</ReplayMask> : head.name}
          glyph={head.icon}
          tooltip={head.hint === head.name ? undefined : head.hint}
          fold={sidebarFold(folded, onToggle)}
          count={groupCount(group.tasks.length)}
          surface={GROUP_SURFACE.WIDE}
          head={GROUP_HEAD.STICKS}
          rows={GROUP_ROWS.SUBGRID}
          actions={
            into === undefined || !tasks.signedIn ? undefined : (
              <NewTaskInButton label={groupNewTaskWords(group.head, head.name)} onPress={add} />
            )
          }
        >
          {body}
        </GroupHeader>
      ) : (
        body
      )}
    </section>
  );
}

function LeavingTasksGroups({
  groups,
  group,
}: {
  groups: readonly TasksGroup[];
  group: (group: TasksGroup) => ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(groups, (each) => groupKey(each.head));
  return <>{drawn.map(({ value }) => group(value))}</>;
}

export function TasksList({
  tasks,
  room,
  frame,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  frame: TasksViewFrame;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, tasks.boardView.onClose);
  const { filter, display } = frame;
  const directory = useMemberDirectory();
  const now = useMinute();
  const folds = useListFolds();
  const waitingOn = useTasksWaiting(tasks);
  const narrow = room === SHELL_ROOM.NARROW;
  const more = !useCoarsePointer();
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const subTaskCounts = useMemo(() => childTaskCounts(tasks.listed.tasks), [tasks.listed.tasks]);
  const chosen = useMemo(
    () =>
      subTaskCounts.size > 0 ? [...display.properties, LIST_COLUMN.SUB_TASKS] : display.properties,
    [display.properties, subTaskCounts.size],
  );
  const properties = useFittedColumns<ListColumn>(listElement, chosen, { narrow });
  const listed = tasks.listed.tasks;
  const pinned = inPinOrder(
    listed.filter((task) => task.pinnedAt !== undefined),
    pinPlaceOf,
  ).map((task) => task.id);
  const people: GroupPeople = {
    creatorName: (creatorId) => creatorWords(creatorId, directory, listed),
    creatorMark: (creatorId) => {
      const named = listed.find((task) => (task.createdBy?.userId ?? task.ownerId) === creatorId);
      return (
        <ActorMark
          actor={creatorActor(named ?? { ownerId: creatorId }, directory, undefined)}
          size={ACTOR_SIZE.MARK}
        />
      );
    },
    assigneeName: (assigneeId) => assigneeWords(assigneeId, directory, listed),
    assigneeMark: (assigneeId) => (
      <ActorMark actor={assigneeFor(assigneeId, directory, listed)} size={ACTOR_SIZE.MARK} />
    ),
  };
  const groups = useHeldTasks(
    tasks,
    { workspaceId: tasks.workspace?.id, filter, display },
    (standing) =>
      tasksListGroups(standing, {
        filter,
        display,
        pinned,
        sections: listSections(tasks),
        readerId: tasks.me,
        personName:
          display.grouping === TASKS_GROUPING.ASSIGNEE ? people.assigneeName : people.creatorName,
        members: (directory.members ?? []).map((member) => member.userId),
        now,
      }),
  );
  const setStanding = useSteadyDoor(useStandingDoor(tasks));
  const rowTab = useTaskRowTab(tasks);
  const { region, agents } = tasks;
  const opened = useMemo(() => openedTaskOf({ region, agents }), [region, agents]);
  const repositories = useMemo(
    () => groups.flatMap((group) => group.tasks.map((task) => ({ repository: task.repository }))),
    [groups],
  );
  const workspaceName = tasks.workspace?.name ?? "";
  const fit = useMemo(
    () =>
      taskRowFit(
        groups.flatMap((group) =>
          group.tasks.map((task) => {
            const subTasks = subTaskCounts.get(task.id);
            const waiting = waitingOn.get(task.id) ?? 0;
            return {
              key: task.number === undefined ? undefined : taskKey(workspaceName, task.number),
              pullRequests: openPullRequests(task).map(pullRequestNumberLabel),
              subTasks:
                subTasks === undefined || subTasks.total === 0
                  ? undefined
                  : `${subTasks.finished}/${subTasks.total}`,
              waiting: waiting === 0 ? undefined : String(waiting),
              repository:
                task.repository === null
                  ? NO_REPOSITORY
                  : repositoryLabel(task.repository, repositories),
            };
          }),
        ),
      ),
    [groups, subTaskCounts, waitingOn, workspaceName, repositories],
  );
  const listStyle = useMemo(
    () => ({
      ...fit,
      ...cssCustomProperties({ "--tasks-list-columns": taskRowColumns(properties, more) }),
    }),
    [fit, properties, more],
  );
  const latest = useRef(tasks);
  latest.current = tasks;
  const drops = listDrops(tasks, () => latest.current, groups, setStanding);
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const order = groups.flatMap((group) =>
    folds.folded(group.head) ? [] : group.tasks.map(taskIdOf),
  );
  const runs = useVirtualRuns();
  const finding = useFindOpen();
  const runsPlace = useMemo(
    (): ListRunsPlace => ({ scroller, list, finding, holdRun: runs.hold }),
    [finding, runs.hold],
  );
  const pressIn = (row: Element | null | undefined) =>
    row?.querySelector<HTMLElement>(ROW_HANDLE) ?? undefined;
  const roving = useRovingKeys<HTMLDivElement>({
    reach: (from, to) => {
      const inHand = from?.closest(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}]`);
      const id = reachedKey(
        order,
        inHand?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE) ?? undefined,
        to,
      );
      if (id === undefined) return false;
      const press = pressIn(
        list.current?.querySelector(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}="${CSS.escape(id)}"]`),
      );
      if (press !== undefined) {
        press.focus();
        return true;
      }
      return runs.bringIn(id, (row) => pressIn(row)?.focus());
    },
  });
  const listRef = useMemo(() => joinRefs(list, roving.ref, setListElement), [roving.ref]);
  const selection = useTasksSelection(tasks, new Set(order), frame.chosen);
  const { regionId, selected } = selection;
  const laidOut = useMemo(() => ({ groups, properties }), [groups, properties]);
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      width={PAGE_WIDTH.FULL}
      label={TASKS}
      toolbar={frame.toolbar}
      scrollRef={scroller}
      filters={frame.chips}
      state={listState(tasks, listed.length === 0)}
      loadingLabel={READING_LINE}
      empty={
        <EmptyState
          icon={<ListTodoIcon />}
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
      <SelectionRegion
        id={regionId}
        selection={{ selected, onChange: selection.onChange }}
        order={[order]}
        bringIn={runs.bringIn}
      >
        <ListMotion root={list} change={laidOut}>
          <div
            {...roving}
            ref={listRef}
            className="tasks-list grid grid-cols-tasks-list gap-x-block-gap gap-y-section-gap pb-ui-24"
            data-row-drop-scope=""
            {...motionRows()}
            style={listStyle}
          >
            {groups.every((group) => group.tasks.length === 0) ? (
              <Text
                variant={TEXT_VARIANT.CAPTION}
                tone={TEXT_TONE.MUTED}
                className="tasks-list-none col-span-full"
              >
                {NONE_STANDING}
              </Text>
            ) : null}
            <LeavingTasksGroups
              key={display.grouping}
              groups={groups}
              group={(group) => {
                const named = groupHead(group.head, tasks, repositories, people);
                return (
                  <TasksListGroup
                    key={groupKey(group.head)}
                    group={group}
                    head={named}
                    folded={folds.folded(group.head)}
                    onToggle={() => folds.toggle(group.head)}
                    drops={drops}
                    draggable={!narrow}
                    onShowOlder={() =>
                      frame.onDisplay({ ...display, completed: COMPLETED_WINDOW.ALL })
                    }
                    tasks={tasks}
                    properties={properties}
                    place={runsPlace}
                    measured={frame.measured}
                    row={(task, at) => (
                      <TasksPageRow
                        key={task.id}
                        place={at}
                        tasks={rowTab}
                        task={task}
                        opened={opened?.task.id === task.id ? opened : undefined}
                        workspaceName={workspaceName}
                        repositoryName={
                          task.repository === null
                            ? NO_REPOSITORY
                            : repositoryLabel(task.repository, repositories)
                        }
                        waiting={waitingOn.get(task.id) ?? 0}
                        properties={properties}
                        assigneeHeld={
                          !narrow &&
                          group.head.kind === TASKS_GROUP.ASSIGNEE &&
                          group.head.assigneeId === (task.assignee?.userId ?? null)
                        }
                        subTasksFinished={subTaskCounts.get(task.id)?.finished ?? 0}
                        subTasksTotal={subTaskCounts.get(task.id)?.total ?? 0}
                        chosen={selection.chosenOf(task.id)}
                        more={more}
                        onSelect={tasks.onSelect}
                        onStanding={setStanding}
                      />
                    )}
                  />
                );
              }}
            />
          </div>
        </ListMotion>
      </SelectionRegion>
      <div className="tasks-list-selection pointer-events-none sticky bottom-ui-16 z-4 flex justify-center *:pointer-events-auto">
        <SelectionBar
          count={selected.size}
          acts={selection.acts}
          onClear={selection.onClear}
          controls={regionId}
        />
      </div>
      {selection.dialog}
    </CollectionPage>
  );
}
