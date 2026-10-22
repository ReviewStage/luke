import { TASK_PRIORITY_ORDER, TASK_STATUS } from "@luke/features/task-wire";
import {
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  OneLine,
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
import { Schema } from "effect";
import { useState } from "react";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import type { ShellRoom } from "../shell-room.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { readKept, writeKept } from "./folded-groups.js";
import { TasksBoard } from "./tasks-board.js";
import { TasksList } from "./tasks-list.js";
import { TasksFilterButton, TasksFilterChips, TasksViewOptions } from "./tasks-page-options.js";

/**
 * tasks-page.tsx -- the window's Tasks page: the listed workspace's tasks as a List or as the Board, chosen by a switch beside its title, narrowed by its Filter and laid out by its View options.
 *
 * It stands in the plan's place, opened by the sidebar's Tasks row, and its
 * way out is `EXIT_BOARD`, so Back, Escape, and the window's history treat it
 * as the place the Board alone once was. With the inbox-first sidebar on,
 * the sidebar lists the Inbox and this page is where the task list stands.
 *
 * Its toolbar ends in Filter and View options (`tasks-page-options.tsx`).
 * The filter is the page's, one for both views and one for each workspace,
 * since a creator and a repository are a workspace's own; each view keeps a
 * display of its own (`tasks-page-model.ts`). Which view it shows, the
 * filter, and both displays are kept on this Mac.
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

/** Where the view shown last, the filters (each workspace's by its id), and each view's display are kept in the renderer's storage. */
const VIEW_KEY = "luke.tasksPageView";
const FILTER_KEY = "luke.tasksFilter";
const DISPLAY_KEY = {
  [TASKS_VIEW.LIST]: "luke.tasksListDisplay",
  [TASKS_VIEW.BOARD]: "luke.tasksBoardDisplay",
} as const satisfies Record<TasksView, string>;

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

/** The List | Board switch beside the page's title. */
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
        { value: TASKS_VIEW.BOARD, label: "Board" },
      ]}
      value={view}
      look={CHOICE_BAR_LOOK.SEGMENTED}
      size={CHOICE_BAR_SIZE.COMPACT}
      onChange={onView}
    />
  );
}

/** A view's display as kept, over its own initial one; its own where none was kept. A property the view offered only since it was kept stands as its own display draws it. */
function readDisplay(view: TasksView): TasksDisplay {
  const kept = readKept(DISPLAY_KEY[view], storedDisplay, {});
  return keptTasksDisplay(kept, INITIAL_DISPLAY[view], EARLIER_OFFERED[view]);
}

/** The Tasks page, in the plan's place: the List or the Board, as the reader last chose, under its Filter and View options. */
export function TasksPage({
  tasks,
  room,
}: {
  tasks: TasksControl;
  room: ShellRoom;
}): React.JSX.Element {
  const [view, setView] = useState(() => readKept(VIEW_KEY, storedView, TASKS_VIEW.LIST));
  const [displays, setDisplays] = useState(() => ({
    [TASKS_VIEW.LIST]: readDisplay(TASKS_VIEW.LIST),
    [TASKS_VIEW.BOARD]: readDisplay(TASKS_VIEW.BOARD),
  }));
  const [filters, setFilters] = useState<Readonly<Record<string, TasksFilter>>>(() =>
    readKept(FILTER_KEY, storedFilters, {}),
  );
  const workspaceId = tasks.workspace?.id;
  const filter =
    workspaceId === undefined ? NO_TASKS_FILTER : (filters[workspaceId] ?? NO_TASKS_FILTER);
  const onFilter = (next: TasksFilter) => {
    if (workspaceId === undefined) return;
    // Note that the record is read again before it is written, so another tab's filter for another workspace is kept, over this tab's own where storage keeps nothing.
    const kept = { ...filters, ...readKept(FILTER_KEY, storedFilters, {}), [workspaceId]: next };
    setFilters(kept);
    writeKept(FILTER_KEY, storedFilters, kept);
  };
  const display = displays[view];
  const onDisplay = (next: TasksDisplay) => {
    setDisplays((held) => ({ ...held, [view]: next }));
    writeKept(DISPLAY_KEY[view], storedDisplay, { ...next, offered: OFFERED[view] });
  };
  const choose = (next: TasksView) => {
    setView(next);
    writeKept(VIEW_KEY, storedView, next);
  };
  const shared = (tasks.workspace?.memberCount ?? 1) > 1;
  const listed = tasks.listed.tasks;
  const toolbar = (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <OneLine
          as={ONE_LINE_ELEMENT.H1}
          end={ONE_LINE_END.ELLIPSIS}
          className="desktop-toolbar-title"
        >
          {TASKS}
        </OneLine>
        <ViewSwitch view={view} onView={choose} />
      </div>
      <div className="desktop-toolbar-actions">
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
      </div>
    </header>
  );
  const chips =
    filteredFields(filter).length === 0 ? null : (
      <TasksFilterChips tasks={listed} filter={filter} onFilter={onFilter} />
    );
  const frame = { toolbar, chips, filter, display, onDisplay };
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
