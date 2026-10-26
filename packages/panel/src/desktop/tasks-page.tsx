import { TASK_PRIORITY_ORDER, TASK_STATUS } from "@luke/features/task-wire";
import {
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Toolbar,
} from "@luke/ui";
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
} from "@luke/ui/tasks-page-model";
import { Schema, SchemaTransformation } from "effect";
import { KanbanIcon, ListFilterIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { keptKey, useKept } from "../use-kept.js";
import { storedScrolls, useKeptScroll } from "../use-kept-scroll.js";
import { NewTaskButton } from "./new-task-button.js";
import { PhoneHead, PlaceMore, useMenuAsk } from "./phone-head.js";
import { TasksBoard } from "./tasks-board.js";
import { TasksList } from "./tasks-list.js";
import {
  FILTER,
  FILTERED,
  TasksFilterButton,
  TasksFilterChips,
  TasksViewOptions,
  VIEW_OPTIONS,
} from "./tasks-page-options.js";

/**
 * tasks-page.tsx -- the window's Tasks page: the listed workspace's tasks as a List or as the Board, chosen by a switch beside its title, narrowed by its Filter and laid out by its View options.
 *
 * It stands in the plan's place, opened by the sidebar's Tasks row, and its
 * way out is `EXIT_BOARD`, so Back, Escape, and the window's history treat it
 * as the place the Board alone once was. The sidebar lists channels, so
 * this page is where the task list stands.
 *
 * Its toolbar ends in Filter and View options (`tasks-page-options.tsx`).
 * The filter is the page's, one for both views and one for each workspace,
 * since a creator and a repository are a workspace's own; each view keeps a
 * display of its own (`tasks-page-model.ts`). Which view it shows, the
 * filter, both displays, and where each view stood scrolled when the reader
 * left it are kept on this Mac.
 *
 * The List is `tasks-list.tsx`, and the Board `tasks-board.tsx`. A display
 * is kept with the properties its view offered then, so a property a view
 * gains since is drawn as the view's own display draws it rather than read
 * as one turned off.
 */

/** What the page is called, on its toolbar and to a screen reader. */
const TASKS = "Tasks";

/** The page's two views. */
export const TASKS_VIEW = {
  LIST: "list",
  BOARD: "board",
} as const;

export type TasksView = (typeof TASKS_VIEW)[keyof typeof TASKS_VIEW];

const storedView = Schema.fromJsonString(Schema.Literals(Object.values(TASKS_VIEW)));

/** The filters as kept: each workspace's by its id. */
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

/** A display as kept (`KeptTasksDisplay`): each choice optional, the Done and Canceled switches of an earlier build among them. */
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
    /** The properties the view offered when it was kept; absent from an earlier build, which offered `EARLIER_OFFERED`'s. */
    offered: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PROPERTY_ORDER))),
  }),
);

/** The properties each view offers its rows or cards. */
const OFFERED = {
  [TASKS_VIEW.LIST]: TASK_PROPERTY_ORDER,
  [TASKS_VIEW.BOARD]: BOARD_PROPERTIES,
} as const satisfies Record<TasksView, readonly TaskProperty[]>;

/** The properties each view offered before a kept display said which it offered. */
const EARLIER_OFFERED = {
  [TASKS_VIEW.LIST]: EARLIER_LIST_PROPERTIES,
  [TASKS_VIEW.BOARD]: EARLIER_BOARD_PROPERTIES,
} as const satisfies Record<TasksView, readonly TaskProperty[]>;

/** Each view's display until its reader changes it. */
const INITIAL_DISPLAY = {
  [TASKS_VIEW.LIST]: DEFAULT_LIST_DISPLAY,
  [TASKS_VIEW.BOARD]: DEFAULT_BOARD_DISPLAY,
} as const satisfies Record<TasksView, TasksDisplay>;

/** A view's display as kept, over its own initial one; its own where none was kept. A property the view offered only since it was kept stands as its own display draws it, and one kept is kept with the properties its view offers now. */
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

/** Where the view shown last, the filters (each workspace's by its id), each view's display, and where each view stood scrolled when the reader left it, by the view's name, are kept on this Mac. */
const KEPT = {
  VIEW: keptKey("luke.tasksPageView", storedView),
  FILTERS: keptKey("luke.tasksFilter", storedFilters),
  DISPLAY: {
    [TASKS_VIEW.LIST]: keptKey("luke.tasksListDisplay", storedDisplayOf(TASKS_VIEW.LIST)),
    [TASKS_VIEW.BOARD]: keptKey("luke.tasksBoardDisplay", storedDisplayOf(TASKS_VIEW.BOARD)),
  },
  SCROLLS: keptKey("luke.tasksScroll", storedScrolls),
} as const;

/** The List | Columns switch beside the page's title. */
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

/** The Tasks page, in the plan's place: the List or the Board, as the reader last chose, under its Filter and View options. */
export function TasksPage({
  tasks,
  room,
}: {
  tasks: TasksControl;
  room: ShellRoom;
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
  // Note that the record is read again before it is written, so another tab's filter for another workspace is kept, over this tab's own where storage keeps nothing.
  const onFilter = (next: TasksFilter) => {
    if (workspaceId === undefined) return;
    changeFilters((held) => ({ ...held, [workspaceId]: next }));
  };
  const display = view === TASKS_VIEW.LIST ? listDisplay : boardDisplay;
  const onDisplay = view === TASKS_VIEW.LIST ? onListDisplay : onBoardDisplay;
  // Note that each view stands where its reader left it, put back once as the page has its tasks and never as they refresh.
  const scroll = useKeptScroll(KEPT.SCROLLS, view, tasks.listRead);
  const choose = (next: TasksView) => {
    scroll.keep();
    keepView(next);
  };
  const shared = (tasks.workspace?.memberCount ?? 1) > 1;
  const listed = tasks.listed.tasks;
  const filterAsk = useMenuAsk();
  const optionsAsk = useMenuAsk();
  // A phone heads the page as it heads every place (`phone-head.tsx`): New task, the title centred, and a ⋯ holding
  // the view's switch and opening the Filter's and View options' own menus where it stands.
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
        start={<NewTaskButton tasks={tasks} />}
        title={
          <Text
            as={TEXT_ELEMENT.H1}
            variant={TEXT_VARIANT.TOOLBAR_TITLE}
            className="luke-toolbar-title"
          >
            {TASKS}
          </Text>
        }
        end={
          <PlaceMore
            thing="Task list"
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
  // Note that the line stands while nothing is filtered, hidden, so its first chip scales in and its last scales out.
  const chips = <TasksFilterChips tasks={listed} filter={filter} onFilter={onFilter} />;
  const frame = { toolbar, chips, filter, display, onDisplay, scroll: scroll.ref };
  // Note that find's subject is the view shown, so a search in one view is let go as the other is chosen.
  return (
    <PageFind page={FIND_PAGE.BOARD} at={view} active={tasks.shown}>
      {/* A face names its assignee or its creator, and the Filter offers them, against the listed workspace's members. */}
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        {view === TASKS_VIEW.BOARD ? (
          <TasksBoard tasks={tasks} room={room} title={TASKS} frame={frame} />
        ) : (
          <TasksList tasks={tasks} room={room} frame={frame} />
        )}
      </MemberDirectory>
    </PageFind>
  );
}
