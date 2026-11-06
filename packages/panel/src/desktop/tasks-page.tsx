import { TASK_PRIORITY_ORDER, TASK_STATUS } from "@repo/features/task-wire";
import {
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Toolbar,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import {
  BOARD_PROPERTIES,
  COMPLETED_WINDOW,
  DEFAULT_BOARD_DISPLAY,
  DEFAULT_LIST_DISPLAY,
  EARLIER_BOARD_PROPERTIES,
  EARLIER_LIST_PROPERTIES,
  filteredFields,
  keptTasksDisplay,
  NO_TASKS_FILTER,
  TASK_MAKER_ORDER,
  TASK_PROPERTY_ORDER,
  TASKS_GROUPING,
  TASKS_ORDER,
  type TaskProperty,
  type TasksDisplay,
  type TasksFilter,
} from "@repo/ui/tasks-page-model";
import { Schema, SchemaTransformation } from "effect";
import { KanbanIcon, ListFilterIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { keptKey, useKept } from "../use-kept.js";
import { PhoneHead, PlaceMore, phoneFindGroups, useMenuAsk } from "./phone-head.js";
import { TasksBoard } from "./tasks-board.js";
import { TasksList } from "./tasks-list.js";
import type { TasksPageHeld } from "./tasks-page-held.js";
import {
  FILTER,
  FILTERED,
  TasksFilterButton,
  TasksFilterChips,
  TasksViewOptions,
  VIEW_OPTIONS,
} from "./tasks-page-options.js";

const TASKS = "Tasks";

const TASKS_VIEW = {
  LIST: "list",
  BOARD: "board",
} as const;

export type TasksView = (typeof TASKS_VIEW)[keyof typeof TASKS_VIEW];

const storedView = Schema.fromJsonString(Schema.Literals(Object.values(TASKS_VIEW)));

const storedFilters = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      status: Schema.optionalKey(Schema.Array(Schema.Literals(Object.values(TASK_STATUS)))),
      priority: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PRIORITY_ORDER))),
      assignee: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
      creator: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
      madeBy: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_MAKER_ORDER))),
      repository: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
    }),
  ),
);

const storedDisplay = Schema.fromJsonString(
  Schema.Struct({
    grouping: Schema.optionalKey(Schema.Literals(Object.values(TASKS_GROUPING))),
    order: Schema.optionalKey(Schema.Literals(Object.values(TASKS_ORDER))),
    emptyGroups: Schema.optionalKey(Schema.Boolean),
    completed: Schema.optionalKey(Schema.Literals(Object.values(COMPLETED_WINDOW))),
    done: Schema.optionalKey(Schema.Boolean),
    canceled: Schema.optionalKey(Schema.Boolean),
    pinnedFirst: Schema.optionalKey(Schema.Boolean),
    properties: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PROPERTY_ORDER))),
    offered: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PROPERTY_ORDER))),
  }),
);

const OFFERED = {
  [TASKS_VIEW.LIST]: TASK_PROPERTY_ORDER,
  [TASKS_VIEW.BOARD]: BOARD_PROPERTIES,
} as const satisfies Record<TasksView, readonly TaskProperty[]>;

const EARLIER_OFFERED = {
  [TASKS_VIEW.LIST]: EARLIER_LIST_PROPERTIES,
  [TASKS_VIEW.BOARD]: EARLIER_BOARD_PROPERTIES,
} as const satisfies Record<TasksView, readonly TaskProperty[]>;

const INITIAL_DISPLAY = {
  [TASKS_VIEW.LIST]: DEFAULT_LIST_DISPLAY,
  [TASKS_VIEW.BOARD]: DEFAULT_BOARD_DISPLAY,
} as const satisfies Record<TasksView, TasksDisplay>;

function storedDisplayOf(view: TasksView) {
  return storedDisplay.pipe(
    Schema.decodeTo(
      Schema.declare(
        (display): display is TasksDisplay => typeof display === "object" && display !== null,
      ),
      SchemaTransformation.transform({
        decode: (kept) => keptTasksDisplay(kept, INITIAL_DISPLAY[view], EARLIER_OFFERED[view]),
        encode: (display) => ({ ...display, offered: OFFERED[view] }),
      }),
    ),
  );
}

const KEPT = {
  VIEW: keptKey("app.tasksPageView", storedView),
  FILTERS: keptKey("app.tasksFilter", storedFilters),
  DISPLAY: {
    [TASKS_VIEW.LIST]: keptKey("app.tasksListDisplay", storedDisplayOf(TASKS_VIEW.LIST)),
    [TASKS_VIEW.BOARD]: keptKey("app.tasksBoardDisplay", storedDisplayOf(TASKS_VIEW.BOARD)),
  },
} as const;

function ViewSwitch({
  view,
  onView,
}: {
  view: TasksView;
  onView: (view: TasksView) => void;
}): React.JSX.Element {
  return (
    <ChoiceBar<TasksView>
      label="Tasks view"
      items={[
        { value: TASKS_VIEW.LIST, label: "List" },
        { value: TASKS_VIEW.BOARD, label: "Columns" },
      ]}
      value={view}
      look={CHOICE_BAR_LOOK.SEGMENTED}
      size={CHOICE_BAR_SIZE.COMPACT}
      onChange={onView}
    />
  );
}

export function TasksPage({
  tasks,
  room,
  held,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  held?: TasksPageHeld | undefined;
}): React.JSX.Element {
  const [view, keepView] = useKept(KEPT.VIEW, TASKS_VIEW.LIST);
  const [listDisplay, onListDisplay] = useKept(
    KEPT.DISPLAY[TASKS_VIEW.LIST],
    INITIAL_DISPLAY[TASKS_VIEW.LIST],
  );
  const [boardDisplay, onBoardDisplay] = useKept(
    KEPT.DISPLAY[TASKS_VIEW.BOARD],
    INITIAL_DISPLAY[TASKS_VIEW.BOARD],
  );
  const [filters, , changeFilters] = useKept<Readonly<Record<string, TasksFilter>>>(
    KEPT.FILTERS,
    {},
  );
  const workspaceId = tasks.workspace?.id;
  const filter =
    workspaceId === undefined ? NO_TASKS_FILTER : (filters[workspaceId] ?? NO_TASKS_FILTER);
  const onFilter = (next: TasksFilter) => {
    if (workspaceId === undefined) return;
    changeFilters((held) => ({ ...held, [workspaceId]: next }));
  };
  const display = view === TASKS_VIEW.LIST ? listDisplay : boardDisplay;
  const onDisplay = view === TASKS_VIEW.LIST ? onListDisplay : onBoardDisplay;
  const choose = (next: TasksView) => keepView(next);
  const shared = (tasks.workspace?.memberCount ?? 1) > 1;
  const listed = tasks.listed.tasks;
  const filterAsk = useMenuAsk();
  const optionsAsk = useMenuAsk();
  const phone = room === SHELL_ROOM.NARROW;
  const viewItem = (value: TasksView, label: string, icon: React.JSX.Element) => ({
    label,
    icon,
    checked: view === value,
    onSelect: () => choose(value),
  });
  const filtered = filteredFields(filter).length > 0;
  const phoneHead = (
    <>
      <PhoneHead
        place="tasks"
        start={null}
        title={
          <Text
            as={TEXT_ELEMENT.H1}
            variant={TEXT_VARIANT.TOOLBAR_TITLE}
            className="ui-toolbar-title"
          >
            {TASKS}
          </Text>
        }
        end={
          <PlaceMore
            thing="Task list"
            replayUnmasked
            shown={tasks.shown}
            groups={(opener) => [
              [
                viewItem(TASKS_VIEW.LIST, "List", <ListIcon />),
                viewItem(TASKS_VIEW.BOARD, "Columns", <KanbanIcon />),
              ],
              [
                {
                  label: FILTER,
                  icon: <ListFilterIcon />,
                  detail: filtered ? FILTERED : undefined,
                  opens: true,
                  onSelect: () => filterAsk.onAsk(opener),
                },
                {
                  label: VIEW_OPTIONS,
                  icon: <SlidersHorizontalIcon />,
                  opens: true,
                  onSelect: () => optionsAsk.onAsk(opener),
                },
              ],
              ...phoneFindGroups(),
            ]}
          />
        }
      />
      <TasksFilterButton
        shown={tasks.shown}
        tasks={listed}
        filter={filter}
        onFilter={onFilter}
        shared={shared}
        pictures={tasks.repositories.pictures}
        asked={{ ask: filterAsk.ask }}
      />
      <TasksViewOptions
        shown={tasks.shown}
        board={view === TASKS_VIEW.BOARD}
        display={display}
        initial={INITIAL_DISPLAY[view]}
        onDisplay={onDisplay}
        shared={shared}
        asked={{ ask: optionsAsk.ask }}
      />
    </>
  );
  const toolbar = phone ? (
    phoneHead
  ) : (
    <Toolbar
      title={TASKS}
      titleReplayUnmasked
      tag={<ViewSwitch view={view} onView={choose} />}
      actions={
        <>
          <TasksFilterButton
            shown={tasks.shown}
            tasks={listed}
            filter={filter}
            onFilter={onFilter}
            shared={shared}
            pictures={tasks.repositories.pictures}
          />
          <TasksViewOptions
            shown={tasks.shown}
            board={view === TASKS_VIEW.BOARD}
            display={display}
            initial={INITIAL_DISPLAY[view]}
            onDisplay={onDisplay}
            shared={shared}
          />
        </>
      }
    />
  );
  const chips = <TasksFilterChips tasks={listed} filter={filter} onFilter={onFilter} />;
  const frame = {
    toolbar,
    chips,
    filter,
    display,
    onDisplay,
    chosen: held?.chosenIn(view),
    measured: held?.measuredIn(view),
    column: held?.column,
  };
  return (
    <PageFind page={FIND_PAGE.BOARD} at={view} active={tasks.shown} held={held?.find}>
      <ReplayUnmask>
        <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
          {view === TASKS_VIEW.BOARD ? (
            <TasksBoard tasks={tasks} room={room} title={TASKS} frame={frame} />
          ) : (
            <TasksList tasks={tasks} room={room} frame={frame} />
          )}
        </MemberDirectory>
      </ReplayUnmask>
    </PageFind>
  );
}
