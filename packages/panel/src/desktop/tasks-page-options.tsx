import { TASK_PRIORITY_ORDER, TASK_STATUS_ORDER, type TaskSummary } from "@luke/features/task-wire";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  IconButton,
  LIST_MOTION_WAY,
  ListMotion,
  MENU_DETAIL,
  MENU_ITEM_MARK,
  motionKey,
  motionRows,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  Tooltip,
  useLeaving,
  useMenu,
} from "@luke/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  actorName,
  creatorActor,
  LUKE_ACTOR,
  memberActor,
  personActor,
} from "@luke/ui/actor-model";
import {
  BOARD_GROUPINGS,
  BOARD_PROPERTIES,
  boardGrouping,
  COMPLETED_WINDOW,
  type CompletedWindow,
  clearedField,
  filteredFields,
  filterValues,
  TASK_MAKER,
  TASK_MAKER_ORDER,
  TASK_PROPERTY,
  TASK_PROPERTY_ORDER,
  TASKS_FILTER_FIELD,
  TASKS_GROUPING,
  TASKS_ORDER,
  type TaskMaker,
  type TaskProperty,
  type TasksDisplay,
  type TasksFilter,
  type TasksFilterField,
  type TasksGrouping,
  type TasksOrder,
  toggledFilter,
  valueCounts,
} from "@luke/ui/tasks-page-model";
import {
  ArrowDownAZIcon,
  ArrowDownNarrowWideIcon,
  BotIcon,
  CalendarPlusIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ClockIcon,
  EyeIcon,
  FolderGitIcon,
  FolderXIcon,
  ListFilterIcon,
  ListIcon,
  RotateCcwIcon,
  Rows3Icon,
  SignalHighIcon,
  SlidersHorizontalIcon,
  UserCheckIcon,
  UserIcon,
  UserXIcon,
} from "lucide-react";
import { type ReactNode, type RefObject, useMemo, useRef } from "react";
import { ACTOR_SIZE, ActorMark, actorCard, UnassignedMark } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberRows } from "../member-rows.js";
import { RepositoryPicture } from "../repository-picture.js";
import { repositoryWords } from "../repository-row.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
} from "../tasks/task-standing.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { type MenuAsk, useAskedMenu } from "./phone-head.js";

/**
 * tasks-page-options.tsx -- the Tasks page's Filter and View options, the two buttons at its toolbar's end, and the chips under it saying what the filter keeps.
 *
 * Filter drops a submenu for each field a task can be narrowed by, Status,
 * Priority, Assignee and Creator in a shared workspace, Made by, and
 * Repository, each value led by its mark, a repository by its owner's
 * picture as the List's rows lead it, and checked while the filter keeps it;
 * a value toggles where it
 * stands and leaves the menu open, so several are chosen in one visit, as
 * Linear's and Stage's filters are. While the filter keeps anything the
 * button wears the sidebar's dot, and a chip under the toolbar says each
 * field's values, its × lifting the field, beside a Clear that lifts them
 * all, so a filtered page never passes for the whole of it.
 *
 * View options is the Inbox's and the sidebar's sliders: Group by and Order
 * by, each a submenu with its choice checked, the Board offered only the
 * groupings a dragged card can be sent, and by a person only in a shared
 * workspace; then the switches, the pins and
 * sections leading the List, and empty groups; Show completed, which of the
 * Done and Canceled tasks stand by when each was finished; then the
 * properties a row or a card draws; and Reset view while the view is not the
 * one it started as. A settled group the window leaves older tasks out of
 * ends on a muted "+ N older" line, which shows them all.
 */

/** What both views are handed: the page's toolbar, its filter line's chips, and the filter and the view's display. */
export interface TasksViewFrame {
  readonly toolbar: ReactNode;
  /** The filter's chips, for the page's filter line; null while it keeps nothing. */
  readonly chips: ReactNode;
  readonly filter: TasksFilter;
  readonly display: TasksDisplay;
  /** Changes the view's display, as the line under a settled group does. */
  readonly onDisplay: (display: TasksDisplay) => void;
}

/** What the buttons are called, on their tooltips and their menus alike. */
export const FILTER = "Filter";
export const VIEW_OPTIONS = "View options";

/** What each field is called, on its submenu and its chip. */
const FIELD_WORDS = {
  [TASKS_FILTER_FIELD.STATUS]: "Status",
  [TASKS_FILTER_FIELD.PRIORITY]: "Priority",
  [TASKS_FILTER_FIELD.ASSIGNEE]: "Assignee",
  [TASKS_FILTER_FIELD.CREATOR]: "Creator",
  [TASKS_FILTER_FIELD.MADE_BY]: "Made by",
  [TASKS_FILTER_FIELD.REPOSITORY]: "Repository",
} as const satisfies Record<TasksFilterField, string>;

/** Each field's glyph, on its submenu and its chip. */
const FIELD_ICON = {
  [TASKS_FILTER_FIELD.STATUS]: <CircleDotIcon />,
  [TASKS_FILTER_FIELD.PRIORITY]: <SignalHighIcon />,
  [TASKS_FILTER_FIELD.ASSIGNEE]: <UserCheckIcon />,
  [TASKS_FILTER_FIELD.CREATOR]: <UserIcon />,
  [TASKS_FILTER_FIELD.MADE_BY]: <BotIcon />,
  [TASKS_FILTER_FIELD.REPOSITORY]: <FolderGitIcon />,
} as const satisfies Record<TasksFilterField, React.JSX.Element>;

/** What each completed window is called, in the order the menu lists them. */
const COMPLETED_WORDS = {
  [COMPLETED_WINDOW.NONE]: "None",
  [COMPLETED_WINDOW.PAST_WEEK]: "Past week",
  [COMPLETED_WINDOW.PAST_MONTH]: "Past month",
  [COMPLETED_WINDOW.ALL]: "All",
} as const satisfies Record<CompletedWindow, string>;

/**
 * What each maker is called in Made by, and the mark it wears there: a
 * person's glyph, a coding agent's square on no harness, and Luke's face.
 * Note that an agent an automation's run started makes its tasks as an
 * agent, which the task names by the automation, so Agents says both.
 */
const MAKER_WORDS = {
  [TASK_MAKER.PERSON]: "People",
  [TASK_MAKER.AGENT]: "Agents and automations",
  [TASK_MAKER.LUKE]: "Luke",
} as const satisfies Record<TaskMaker, string>;

const MAKER_ACTOR = {
  [TASK_MAKER.AGENT]: {
    kind: ACTOR_KIND.AGENT,
    name: MAKER_WORDS[TASK_MAKER.AGENT],
    provider: undefined,
    state: ACTOR_STATE.REST,
  },
  [TASK_MAKER.LUKE]: LUKE_ACTOR,
} as const satisfies Record<Exclude<TaskMaker, typeof TASK_MAKER.PERSON>, Actor>;

/** What a grouping is called. */
const GROUPING_WORDS = {
  [TASKS_GROUPING.STATUS]: "Status",
  [TASKS_GROUPING.PRIORITY]: "Priority",
  [TASKS_GROUPING.REPOSITORY]: "Repository",
  [TASKS_GROUPING.ASSIGNEE]: "Assignee",
  [TASKS_GROUPING.CREATOR]: "Creator",
  [TASKS_GROUPING.NONE]: "None",
} as const satisfies Record<TasksGrouping, string>;

const GROUPING_ICON = {
  [TASKS_GROUPING.STATUS]: <CircleDotIcon />,
  [TASKS_GROUPING.PRIORITY]: <SignalHighIcon />,
  [TASKS_GROUPING.REPOSITORY]: <FolderGitIcon />,
  [TASKS_GROUPING.ASSIGNEE]: <UserCheckIcon />,
  [TASKS_GROUPING.CREATOR]: <UserIcon />,
  [TASKS_GROUPING.NONE]: <ListIcon />,
} as const satisfies Record<TasksGrouping, React.JSX.Element>;

/** What an order is called. */
const ORDER_WORDS = {
  [TASKS_ORDER.PRIORITY]: "Priority",
  [TASKS_ORDER.UPDATED]: "Last updated",
  [TASKS_ORDER.CREATED]: "Created",
  [TASKS_ORDER.NAME]: "Name",
} as const satisfies Record<TasksOrder, string>;

const ORDER_ICON = {
  [TASKS_ORDER.PRIORITY]: <SignalHighIcon />,
  [TASKS_ORDER.UPDATED]: <ClockIcon />,
  [TASKS_ORDER.CREATED]: <CalendarPlusIcon />,
  [TASKS_ORDER.NAME]: <ArrowDownAZIcon />,
} as const satisfies Record<TasksOrder, React.JSX.Element>;

/** What a property is called in the menu. */
const PROPERTY_WORDS = {
  [TASK_PROPERTY.PRIORITY]: "Priority",
  [TASK_PROPERTY.KEY]: "ID",
  [TASK_PROPERTY.STATUS]: "Status",
  [TASK_PROPERTY.WAITING]: "Needs you",
  [TASK_PROPERTY.REPOSITORY]: "Repository",
  [TASK_PROPERTY.ASSIGNEE]: "Assignee",
  [TASK_PROPERTY.CREATOR]: "Creator",
  [TASK_PROPERTY.AGENTS]: "Agents",
  [TASK_PROPERTY.UPDATED]: "Last updated",
} as const satisfies Record<TaskProperty, string>;

/** What the List calls a task with no repository, and a task nobody is named for. */
export const NO_REPOSITORY = "No repository";
export const NO_CREATOR = "No one";

/** How many values a chip names before it counts the rest. */
const CHIP_VALUES = 2;

/** One value a field may keep: its words, its mark, and the value itself; a repository's owner or a person's detail, and a person's menu name and card, besides. */
interface FieldValue {
  readonly value: string | null;
  /** What the chip says of it, the reader as You. */
  readonly words: string;
  /** What the menu names it where that is not its words: the reader by their name, whose detail says You. */
  readonly label?: string;
  readonly icon: React.JSX.Element;
  /** Muted words beside the name in the menu, a repository's owner or a person's email or You; the chip names the value without them. */
  readonly detail?: string | undefined;
  /** The card a person's row hangs. */
  readonly card?: React.ReactNode;
}

/** Who a creator is, as the directory draws them, else as a listed task names them. */
function creatorFor(
  creatorId: string,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): Actor {
  const member = reader.members?.find((each) => each.userId === creatorId);
  if (member !== undefined) return memberActor(member, reader.readerId);
  const named = tasks.find((task) => task.createdBy?.userId === creatorId);
  return creatorActor(named ?? { ownerId: creatorId }, reader, undefined);
}

/** A creator's name as the page says it: the directory's, else the one a task carries; the reader's own as You. */
export function creatorWords(
  creatorId: string | null,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): string {
  return creatorId === null ? NO_CREATOR : actorName(creatorFor(creatorId, reader, tasks));
}

/** Who an assignee is, as the directory draws them, else by the name a listed task assigned to them carries. */
export function assigneeFor(
  assigneeId: string,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): Actor {
  const member = reader.members?.find((each) => each.userId === assigneeId);
  if (member !== undefined) return memberActor(member, reader.readerId);
  const named = tasks.find((task) => task.assignee?.userId === assigneeId)?.assignee;
  return personActor(
    named ?? { userId: assigneeId, name: "" },
    reader.members,
    reader.readerId,
    reader.former,
  );
}

/** An assignee's name as the page says it, the reader's own as You; No assignee for the tasks with none. */
export function assigneeWords(
  assigneeId: string | null,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): string {
  return assigneeId === null
    ? NO_ASSIGNEE_WORDS
    : actorName(assigneeFor(assigneeId, reader, tasks));
}

/**
 * The people a person's field offers: the members as every people menu lists
 * them (`memberRows`), then anyone else a task or the filter names, drawn
 * as `actorOf` reads them, each hanging their card.
 */
function peopleValues(
  held: ReadonlySet<string | null>,
  reader: ReturnType<typeof useMemberDirectory>,
  actorOf: (userId: string) => Actor,
): readonly FieldValue[] {
  const rows = memberRows(reader.members, reader.readerId);
  const listed = new Set(rows.map((row) => row.member.userId));
  const others = [
    ...new Set([
      ...(reader.readerId === undefined ? [] : [reader.readerId]),
      ...[...held].filter((id): id is string => id !== null),
    ]),
  ].filter((id) => !listed.has(id));
  return [
    ...rows.map((row) => ({
      value: row.member.userId,
      words: actorName(row.actor),
      label: row.label,
      detail: row.detail,
      icon: row.icon,
      card: row.card,
    })),
    ...others.map((id) => {
      const actor = actorOf(id);
      return {
        value: id,
        words: actorName(actor),
        icon: <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />,
        card: actorCard(actor),
      };
    }),
  ];
}

/**
 * The values a field offers: every status and priority, in their order; for
 * an assignee or a creator, the reader, then each member, then anyone else a
 * task names, and nobody where a task names no one; and each repository a task
 * is on, by name, led by its owner's picture, then none. A value the filter
 * keeps is offered though no task holds it now.
 */
function fieldValues(
  field: TasksFilterField,
  tasks: readonly TaskSummary[],
  filter: TasksFilter,
  reader: ReturnType<typeof useMemberDirectory>,
  pictures: boolean,
): readonly FieldValue[] {
  const held = new Set<string | null>([
    ...valueCounts(tasks, field).keys(),
    ...filterValues(filter, field),
  ]);
  switch (field) {
    case TASKS_FILTER_FIELD.STATUS:
      return TASK_STATUS_ORDER.map((status) => ({
        value: status,
        words: TASK_STATUS_WORDS[status],
        icon: <TaskStatusMark status={status} />,
      }));
    case TASKS_FILTER_FIELD.PRIORITY:
      return TASK_PRIORITY_ORDER.map((priority) => ({
        value: priority,
        words: TASK_PRIORITY_WORDS[priority],
        icon: <TaskPriorityMark priority={priority} />,
      }));
    case TASKS_FILTER_FIELD.ASSIGNEE:
      return [
        ...peopleValues(held, reader, (id) => assigneeFor(id, reader, tasks)),
        ...(held.has(null)
          ? [
              {
                value: null,
                words: NO_ASSIGNEE_WORDS,
                icon: <UnassignedMark size={ACTOR_SIZE.INLINE} decorative />,
              },
            ]
          : []),
      ];
    case TASKS_FILTER_FIELD.CREATOR:
      return [
        ...peopleValues(held, reader, (id) => creatorFor(id, reader, tasks)),
        ...(held.has(null) ? [{ value: null, words: NO_CREATOR, icon: <UserXIcon /> }] : []),
      ];
    case TASKS_FILTER_FIELD.MADE_BY:
      return TASK_MAKER_ORDER.map((maker) => ({
        value: maker,
        words: MAKER_WORDS[maker],
        icon:
          maker === TASK_MAKER.PERSON ? (
            <UserIcon />
          ) : (
            <ActorMark actor={MAKER_ACTOR[maker]} size={ACTOR_SIZE.INLINE} />
          ),
      }));
    case TASKS_FILTER_FIELD.REPOSITORY:
      return [
        ...[...held]
          .filter((repository): repository is string => repository !== null)
          .sort(
            (a, b) =>
              repositoryWords(a).label.localeCompare(repositoryWords(b).label) ||
              a.localeCompare(b),
          )
          .map((repository) => ({
            value: repository,
            words: repositoryWords(repository).label,
            detail: repositoryWords(repository).detail,
            icon: (
              <RepositoryPicture
                repository={repository}
                pictures={pictures}
                fallback={<FolderGitIcon />}
              />
            ),
          })),
        ...(held.has(null) ? [{ value: null, words: NO_REPOSITORY, icon: <FolderXIcon /> }] : []),
      ];
  }
}

/** The fields that name a person, which a workspace nobody shares has no use for. */
const PERSON_FIELDS: readonly TasksFilterField[] = [
  TASKS_FILTER_FIELD.ASSIGNEE,
  TASKS_FILTER_FIELD.CREATOR,
];

/** The groupings by a person, offered on the same terms. */
const PERSON_GROUPINGS: readonly TasksGrouping[] = [
  TASKS_GROUPING.ASSIGNEE,
  TASKS_GROUPING.CREATOR,
];

/** The fields the Filter offers: Assignee and Creator only where the workspace is shared. */
function offeredFields(shared: boolean): readonly TasksFilterField[] {
  return Object.values(TASKS_FILTER_FIELD).filter(
    (field) => shared || !PERSON_FIELDS.includes(field),
  );
}

/** The row standing last in a people's field while the members are read, which nothing picks. */
const READING_MEMBERS: MenuAction = {
  label: "Reading members…",
  disabled: true,
  onSelect: () => undefined,
};

/** What the Filter says of itself while it keeps anything. */
export const FILTERED = "Filtered";

/** The filter's menu: a submenu for each field, its values toggled where they stand, and Clear filters at its foot. */
function filterEntries(
  tasks: readonly TaskSummary[],
  filter: TasksFilter,
  onFilter: (filter: TasksFilter) => void,
  shared: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
  pictures: boolean,
): MenuEntry[][] {
  const fields: MenuEntry[] = offeredFields(shared).map((field) => {
    const kept = filterValues(filter, field);
    return {
      label: FIELD_WORDS[field],
      icon: FIELD_ICON[field],
      items: [
        ...fieldValues(field, tasks, filter, reader, pictures).map(
          ({ value, words, label, icon, detail, card }): MenuAction => ({
            label: label ?? words,
            icon,
            ...(detail === undefined ? {} : { detail, detailPlace: MENU_DETAIL.BESIDE }),
            card,
            checked: kept.includes(value),
            stays: true,
            onSelect: () => onFilter(toggledFilter(filter, field, value)),
          }),
        ),
        // Note that the members are read for the people's fields alone, so no other field says it is reading.
        ...(reader.membersReading && PERSON_FIELDS.includes(field) ? [READING_MEMBERS] : []),
      ],
    };
  });
  return [
    fields,
    [
      {
        label: "Clear filters",
        icon: <RotateCcwIcon />,
        disabled: filteredFields(filter).length === 0,
        onSelect: () => onFilter({}),
      },
    ],
  ];
}

/** The toolbar's Filter: its button, which wears a dot while the filter keeps anything, and the menu it drops. */
export function TasksFilterButton({
  shown,
  tasks,
  filter,
  onFilter,
  shared,
  asked,
  pictures,
}: {
  /** Whether the page is on screen, for the menu not to outlive it. */
  shown: boolean;
  /** The workspace's tasks, whose creators and repositories the menu offers. */
  tasks: readonly TaskSummary[];
  filter: TasksFilter;
  onFilter: (filter: TasksFilter) => void;
  /** Whether the workspace is shared, which alone filters by assignee or creator. */
  shared: boolean;
  /** Where a phone's ⋯ stands for the button, the menu drawn under the ⋯ each time it asks (`phone-head.tsx`), and no button of its own; none elsewhere. */
  asked?: { readonly ask: MenuAsk | undefined } | undefined;
  /** Whether repositories' owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
}): React.JSX.Element {
  const menu = useMenu(shown);
  useAskedMenu(menu.show, asked?.ask);
  const reader = useMemberDirectory();
  const filtered = filteredFields(filter).length > 0;
  return (
    <>
      {asked === undefined ? (
        <span className="tasks-page-option" data-filtered={filtered ? "true" : undefined}>
          <Tooltip label={FILTER}>
            <IconButton
              icon={<ListFilterIcon />}
              label={FILTER}
              aria-description={filtered ? FILTERED : undefined}
              {...menu.trigger()}
            />
          </Tooltip>
        </span>
      ) : null}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={FILTER}
          menu={menu.drawn}
          groups={filterEntries(tasks, filter, onFilter, shared, reader, pictures)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** What a field's chip says of its values: up to two by name, the rest counted. */
function chipWords(words: readonly string[]): string {
  const named = words.slice(0, CHIP_VALUES).join(", ");
  const more = words.length - CHIP_VALUES;
  return more > 0 ? `${named} +${more}` : named;
}

/** What the filter line's last place holds, after a chip for each field: its Clear. */
const FILTER_LINE = {
  CLEAR: "clear",
} as const;

/** One place on the filter line: a field's chip, with its words as last drawn, or the Clear after them. */
type FilterLineEntry =
  | { readonly key: TasksFilterField; readonly words: string }
  | { readonly key: typeof FILTER_LINE.CLEAR };

/** The filter line's places: a chip for each field filtered, its values named in the menu's order, whatever order they were chosen in, and Clear after them; none while nothing is filtered. */
function filterLineEntries(
  tasks: readonly TaskSummary[],
  filter: TasksFilter,
  reader: ReturnType<typeof useMemberDirectory>,
): FilterLineEntry[] {
  const fields = filteredFields(filter);
  if (fields.length === 0) return [];
  const chips = fields.map((field) => {
    const kept = filterValues(filter, field);
    const words = fieldValues(field, tasks, filter, reader, false)
      .filter((each) => kept.includes(each.value))
      .map((each) => each.words);
    return { key: field, words: `${FIELD_WORDS[field]}: ${chipWords(words)}` };
  });
  return [...chips, { key: FILTER_LINE.CLEAR }];
}

/** What a press on a leaving chip or Clear does, out of reach as it is: nothing. */
function stays(): void {}

/**
 * The filter line's chips and Clear. Note that it is its own component
 * under the line's `ListMotion`, because `useLeaving` finds the motion
 * through the context the motion provides.
 */
function FilterLine({
  line,
  tasks,
  filter,
  onFilter,
}: {
  line: RefObject<HTMLDivElement | null>;
  tasks: readonly TaskSummary[];
  filter: TasksFilter;
  onFilter: (filter: TasksFilter) => void;
}): React.JSX.Element {
  const reader = useMemberDirectory();
  // Note that the entries are made once for what they are made from, because `useLeaving` reads a new list as a change.
  const listed = useMemo(() => filterLineEntries(tasks, filter, reader), [tasks, filter, reader]);
  const drawn = useLeaving(listed, (entry) => entry.key);
  return (
    <div ref={line} className="tasks-filter-line" hidden={drawn.length === 0} {...motionRows()}>
      {drawn.map(({ key, value, leaving }) =>
        value.key === FILTER_LINE.CLEAR ? (
          <span key={key} className="tasks-filter-clear" {...motionKey(key)}>
            <TextButton onClick={leaving ? stays : () => onFilter({})}>Clear</TextButton>
          </span>
        ) : (
          <Chip
            key={key}
            motionKey={key}
            look={CHIP_LOOK.FILTER}
            removeLabel={`Clear the ${FIELD_WORDS[value.key].toLowerCase()} filter`}
            onRemove={leaving ? stays : () => onFilter(clearedField(filter, value.key))}
          >
            {FIELD_ICON[value.key]}
            <ChipName>{value.words}</ChipName>
          </Chip>
        ),
      )}
    </div>
  );
}

/**
 * The chips on the page's filter line, a field a chip, its values named,
 * its × lifting it, and Clear lifting them all. The line stands, hidden,
 * while the filter keeps nothing, so a field's chip scales in as it is
 * filtered and out as it is lifted, the last one too, under the line's
 * `ListMotion`; Clear comes and goes with the first chip and the last.
 */
export function TasksFilterChips({
  tasks,
  filter,
  onFilter,
}: {
  tasks: readonly TaskSummary[];
  filter: TasksFilter;
  onFilter: (filter: TasksFilter) => void;
}): React.JSX.Element {
  const line = useRef<HTMLDivElement | null>(null);
  return (
    <ListMotion root={line} way={LIST_MOTION_WAY.SCALE}>
      <FilterLine line={line} tasks={tasks} filter={filter} onFilter={onFilter} />
    </ListMotion>
  );
}

/** Whether a grouping draws a group for each of a fixed set of values, the workspace's members among them, which alone may stand empty. */
function groupsFixed(grouping: TasksGrouping): boolean {
  return (
    grouping === TASKS_GROUPING.STATUS ||
    grouping === TASKS_GROUPING.PRIORITY ||
    grouping === TASKS_GROUPING.ASSIGNEE
  );
}

/** Whether two displays lay the tasks out alike. */
function sameDisplay(a: TasksDisplay, b: TasksDisplay): boolean {
  return (
    a.grouping === b.grouping &&
    a.order === b.order &&
    a.emptyGroups === b.emptyGroups &&
    a.completed === b.completed &&
    a.pinnedFirst === b.pinnedFirst &&
    a.properties.length === b.properties.length &&
    a.properties.every((property) => b.properties.includes(property))
  );
}

/** The view's menu for the List or the Board: Group by and Order by, the switches, the properties, and Reset view. */
function displayEntries({
  board,
  display,
  initial,
  onDisplay,
  shared,
}: {
  board: boolean;
  display: TasksDisplay;
  initial: TasksDisplay;
  onDisplay: (display: TasksDisplay) => void;
  shared: boolean;
}): MenuEntry[][] {
  const set = (change: Partial<TasksDisplay>) => onDisplay({ ...display, ...change });
  const grouping = board ? boardGrouping(display.grouping) : display.grouping;
  // Note that a grouping by a person kept for a workspace nobody shares now stays offered while it is chosen, so it can be chosen away.
  const groupings = (board ? BOARD_GROUPINGS : Object.values(TASKS_GROUPING)).filter(
    (each) => shared || !PERSON_GROUPINGS.includes(each) || grouping === each,
  );
  const toggle = (label: string, checked: boolean, change: Partial<TasksDisplay>): MenuAction => ({
    label,
    checked,
    mark: MENU_ITEM_MARK.SWITCH,
    stays: true,
    onSelect: () => set(change),
  });
  const offeredProperties = board ? BOARD_PROPERTIES : TASK_PROPERTY_ORDER;
  return [
    [
      {
        label: board ? "Columns" : "Group by",
        icon: <Rows3Icon />,
        items: groupings.map((each) => ({
          label: GROUPING_WORDS[each],
          icon: GROUPING_ICON[each],
          checked: grouping === each,
          onSelect: () => set({ grouping: each }),
        })),
      },
      {
        label: "Order by",
        icon: <ArrowDownNarrowWideIcon />,
        items: Object.values(TASKS_ORDER).map((each) => ({
          label: ORDER_WORDS[each],
          icon: ORDER_ICON[each],
          checked: display.order === each,
          onSelect: () => set({ order: each }),
        })),
      },
    ],
    [
      ...(board
        ? []
        : [
            toggle("Pinned and sections first", display.pinnedFirst, {
              pinnedFirst: !display.pinnedFirst,
            }),
          ]),
      ...(groupsFixed(grouping)
        ? [
            toggle(board ? "Empty columns" : "Empty groups", display.emptyGroups, {
              emptyGroups: !display.emptyGroups,
            }),
          ]
        : []),
    ],
    [
      {
        label: "Show completed",
        icon: <CircleCheckIcon />,
        items: Object.values(COMPLETED_WINDOW).map((each) => ({
          label: COMPLETED_WORDS[each],
          checked: display.completed === each,
          onSelect: () => set({ completed: each }),
        })),
      },
    ],
    [
      {
        label: "Properties",
        icon: <EyeIcon />,
        items: offeredProperties.map((property) => ({
          label: PROPERTY_WORDS[property],
          checked: display.properties.includes(property),
          stays: true,
          onSelect: () =>
            set({
              properties: TASK_PROPERTY_ORDER.filter((each) =>
                each === property
                  ? !display.properties.includes(property)
                  : display.properties.includes(each),
              ),
            }),
        })),
      },
      {
        label: "Reset view",
        icon: <RotateCcwIcon />,
        disabled: sameDisplay(display, initial),
        onSelect: () => onDisplay(initial),
      },
    ],
  ];
}

/** The toolbar's View options: its button and the menu it drops, for the view shown. */
export function TasksViewOptions({
  shown,
  board,
  display,
  initial,
  onDisplay,
  shared,
  asked,
}: {
  shown: boolean;
  /** Whether the view is the Board, which offers only what its columns and cards can draw. */
  board: boolean;
  display: TasksDisplay;
  /** The view as it started, which Reset view goes back to. */
  initial: TasksDisplay;
  onDisplay: (display: TasksDisplay) => void;
  /** Whether the workspace is shared, which alone groups by assignee or creator. */
  shared: boolean;
  /** Where a phone's ⋯ stands for the button, as the Filter's (`TasksFilterButton`); none elsewhere. */
  asked?: { readonly ask: MenuAsk | undefined } | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  useAskedMenu(menu.show, asked?.ask);
  return (
    <>
      {asked === undefined ? (
        <span className="tasks-page-option">
          <Tooltip label={VIEW_OPTIONS}>
            <IconButton icon={<SlidersHorizontalIcon />} label={VIEW_OPTIONS} {...menu.trigger()} />
          </Tooltip>
        </span>
      ) : null}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={displayEntries({ board, display, initial, onDisplay, shared })}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The muted line ending a settled group the completed window leaves older tasks out of, which shows them all; nothing where it leaves none. */
export function OlderCompleted({
  older,
  onShow,
}: {
  older: number | undefined;
  onShow: () => void;
}): React.JSX.Element | null {
  if (older === undefined) return null;
  // Note that the line is the group's quiet caption, as its "No tasks" is, the words a press.
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      <TextButton onClick={onShow}>{`+ ${older} older`}</TextButton>
    </Text>
  );
}
