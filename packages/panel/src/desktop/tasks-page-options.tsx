import { PRODUCT_NAME } from "@repo/features/product-name";
import { TASK_PRIORITY_ORDER, TASK_STATUS_ORDER, type TaskSummary } from "@repo/features/task-wire";
import { noMatchWords, TERM } from "@repo/features/words";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  CornerDot,
  IconButton,
  LIST_MOTION_WAY,
  ListMotion,
  MENU_DETAIL,
  MENU_ITEM_MARK,
  motionKey,
  motionRows,
  NoRepositoryGlyph,
  RepositoryPicture,
  ShowMoreRow,
  TaskPriorityMark,
  TaskStatusMark,
  TextButton,
  Tooltip,
  useLeaving,
  useMenu,
} from "@repo/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  APP_ACTOR,
  actorName,
  creatorActor,
  memberActor,
  personActor,
} from "@repo/ui/actor-model";
import {
  ArrowDownAZIcon,
  BotIcon,
  CalendarPlusIcon,
  CircleCheckIcon,
  ClockIcon,
  EyeIcon,
  GLYPH,
  ListFilterIcon,
  ListIcon,
  RotateCcwIcon,
  SignalHighIcon,
  SlidersHorizontalIcon,
  UserCheckIcon,
  UserIcon,
  UserXIcon,
} from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { NO_REPOSITORY, repositoryLabel, repositoryParts } from "@repo/ui/task-list-model";
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
} from "@repo/ui/tasks-page-model";
import type { VirtualRowMeasurements } from "@repo/ui/virtual-rows";
import type { Store } from "@tanstack/react-store";
import { Fragment, type ReactNode, type RefObject, useMemo, useRef } from "react";
import { ACTOR_SIZE, ActorMark, actorCard, UnassignedMark } from "../actor-ref.js";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberReadNote, memberRows } from "../member-rows.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
} from "../tasks/task-standing.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { actionSearchPanel } from "./action-search-menu.js";
import { type MenuAsk, useAskedMenu } from "./phone-head.js";
import type { ChosenTasksStore } from "./tasks-selection.js";

export interface TasksViewFrame {
  readonly toolbar: ReactNode;
  readonly chips: ReactNode;
  readonly filter: TasksFilter;
  readonly display: TasksDisplay;
  readonly onDisplay: (display: TasksDisplay) => void;
  readonly chosen?: ChosenTasksStore | undefined;
  readonly measured?: Map<string, VirtualRowMeasurements> | undefined;
  readonly column?: Store<string | undefined> | undefined;
}

export const FILTER = "Filter";
export const VIEW_OPTIONS = "View options";

const FIELD_WORDS = {
  [TASKS_FILTER_FIELD.STATUS]: "Status",
  [TASKS_FILTER_FIELD.PRIORITY]: "Priority",
  [TASKS_FILTER_FIELD.ASSIGNEE]: "Assignee",
  [TASKS_FILTER_FIELD.CREATOR]: "Creator",
  [TASKS_FILTER_FIELD.MADE_BY]: "Made by",
  [TASKS_FILTER_FIELD.REPOSITORY]: "Repository",
} as const satisfies Record<TasksFilterField, string>;

const FIELD_ICON = {
  [TASKS_FILTER_FIELD.STATUS]: <GLYPH.STATUS />,
  [TASKS_FILTER_FIELD.PRIORITY]: <SignalHighIcon />,
  [TASKS_FILTER_FIELD.ASSIGNEE]: <UserCheckIcon />,
  [TASKS_FILTER_FIELD.CREATOR]: <UserIcon />,
  [TASKS_FILTER_FIELD.MADE_BY]: <BotIcon />,
  [TASKS_FILTER_FIELD.REPOSITORY]: <GLYPH.REPOSITORY />,
} as const satisfies Record<TasksFilterField, React.JSX.Element>;

const COMPLETED_WORDS = {
  [COMPLETED_WINDOW.NONE]: "None",
  [COMPLETED_WINDOW.PAST_WEEK]: "Past week",
  [COMPLETED_WINDOW.PAST_MONTH]: "Past month",
  [COMPLETED_WINDOW.ALL]: "All",
} as const satisfies Record<CompletedWindow, string>;

const MAKER_WORDS = {
  [TASK_MAKER.PERSON]: "People",
  [TASK_MAKER.AGENT]: "Agents and automations",
  [TASK_MAKER.APP]: PRODUCT_NAME,
} as const satisfies Record<TaskMaker, string>;

const MAKER_ACTOR = {
  [TASK_MAKER.AGENT]: {
    kind: ACTOR_KIND.AGENT,
    name: MAKER_WORDS[TASK_MAKER.AGENT],
    provider: undefined,
    state: ACTOR_STATE.REST,
  },
  [TASK_MAKER.APP]: APP_ACTOR,
} as const satisfies Record<Exclude<TaskMaker, typeof TASK_MAKER.PERSON>, Actor>;

const GROUPING_WORDS = {
  [TASKS_GROUPING.STATUS]: "Status",
  [TASKS_GROUPING.PRIORITY]: "Priority",
  [TASKS_GROUPING.REPOSITORY]: "Repository",
  [TASKS_GROUPING.ASSIGNEE]: "Assignee",
  [TASKS_GROUPING.CREATOR]: "Creator",
  [TASKS_GROUPING.NONE]: "None",
} as const satisfies Record<TasksGrouping, string>;

const GROUPING_ICON = {
  [TASKS_GROUPING.STATUS]: <GLYPH.STATUS />,
  [TASKS_GROUPING.PRIORITY]: <SignalHighIcon />,
  [TASKS_GROUPING.REPOSITORY]: <GLYPH.REPOSITORY />,
  [TASKS_GROUPING.ASSIGNEE]: <UserCheckIcon />,
  [TASKS_GROUPING.CREATOR]: <UserIcon />,
  [TASKS_GROUPING.NONE]: <ListIcon />,
} as const satisfies Record<TasksGrouping, React.JSX.Element>;

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

const PROPERTY_WORDS = {
  [TASK_PROPERTY.PRIORITY]: "Priority",
  [TASK_PROPERTY.KEY]: "ID",
  [TASK_PROPERTY.STATUS]: "Status",
  [TASK_PROPERTY.WAITING]: NEEDS_YOU.LABEL,
  [TASK_PROPERTY.REPOSITORY]: "Repository",
  [TASK_PROPERTY.ASSIGNEE]: "Assignee",
  [TASK_PROPERTY.CREATOR]: "Creator",
  [TASK_PROPERTY.AGENTS]: "Agents",
  [TASK_PROPERTY.UPDATED]: "Last updated",
} as const satisfies Record<TaskProperty, string>;

export const NO_CREATOR = "No one";

const CHIP_VALUES = 2;

interface FieldValue {
  readonly value: string | null;
  readonly words: string;
  readonly label?: string;
  readonly icon: React.JSX.Element;
  readonly detail?: string | undefined;
  readonly card?: React.ReactNode;
}

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

export function creatorWords(
  creatorId: string | null,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): string {
  return creatorId === null ? NO_CREATOR : actorName(creatorFor(creatorId, reader, tasks));
}

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

export function assigneeWords(
  assigneeId: string | null,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): string {
  return assigneeId === null
    ? NO_ASSIGNEE_WORDS
    : actorName(assigneeFor(assigneeId, reader, tasks));
}

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
              repositoryParts(a).name.localeCompare(repositoryParts(b).name) || a.localeCompare(b),
          )
          .map((repository) => ({
            value: repository,
            words: repositoryLabel(
              repository,
              [...held].map((each) => ({ repository: each })),
            ),
            label: repositoryParts(repository).name,
            detail: repositoryParts(repository).owner,
            icon: <RepositoryPicture repository={repository} pictures={pictures} />,
          })),
        ...(held.has(null)
          ? [{ value: null, words: NO_REPOSITORY, icon: <NoRepositoryGlyph /> }]
          : []),
      ];
  }
}

const SEARCH_MEMBERS = "Search members";
const SEARCH_REPOSITORIES = "Search repositories";

const PERSON_FIELDS: readonly TasksFilterField[] = [
  TASKS_FILTER_FIELD.ASSIGNEE,
  TASKS_FILTER_FIELD.CREATOR,
];

const PERSON_GROUPINGS: readonly TasksGrouping[] = [
  TASKS_GROUPING.ASSIGNEE,
  TASKS_GROUPING.CREATOR,
];

function namesData(field: TasksFilterField): boolean {
  return PERSON_FIELDS.includes(field) || field === TASKS_FILTER_FIELD.REPOSITORY;
}

function offeredFields(shared: boolean): readonly TasksFilterField[] {
  return Object.values(TASKS_FILTER_FIELD).filter(
    (field) => shared || !PERSON_FIELDS.includes(field),
  );
}

export const FILTERED = "Filtered";

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
    const head = { label: FIELD_WORDS[field], icon: FIELD_ICON[field] };
    const values = fieldValues(field, tasks, filter, reader, pictures).map(
      ({ value, words, label, icon, detail, card }): MenuAction => ({
        key: value ?? undefined,
        label: label ?? words,
        icon:
          PERSON_FIELDS.includes(field) && value !== null ? <ReplayMask>{icon}</ReplayMask> : icon,
        ...(detail === undefined ? {} : { detail, detailPlace: MENU_DETAIL.BESIDE }),
        card,
        checked: kept.includes(value),
        stays: true,
        replayMasked: value !== null && namesData(field),
        onSelect: () => onFilter(toggledFilter(filter, field, value)),
      }),
    );
    if (namesData(field)) {
      const person = PERSON_FIELDS.includes(field);
      return actionSearchPanel(head, {
        label: FIELD_WORDS[field],
        placeholder: person ? SEARCH_MEMBERS : SEARCH_REPOSITORIES,
        noMatch: noMatchWords(person ? TERM.MEMBER : TERM.REPOSITORY),
        actions: values,
        note: person ? memberReadNote(reader) : undefined,
        replayUnmasked: true,
      });
    }
    return { ...head, items: values };
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

export function TasksFilterButton({
  shown,
  tasks,
  filter,
  onFilter,
  shared,
  asked,
  pictures,
}: {
  shown: boolean;
  tasks: readonly TaskSummary[];
  filter: TasksFilter;
  onFilter: (filter: TasksFilter) => void;
  shared: boolean;
  asked?: { readonly ask: MenuAsk | undefined } | undefined;
  pictures: boolean;
}): React.JSX.Element {
  const menu = useMenu(shown);
  useAskedMenu(menu.show, asked?.ask);
  const reader = useMemberDirectory();
  const filtered = filteredFields(filter).length > 0;
  return (
    <>
      {asked === undefined ? (
        <CornerDot shown={filtered}>
          <Tooltip label={FILTER}>
            <IconButton
              icon={<ListFilterIcon />}
              label={FILTER}
              aria-description={filtered ? FILTERED : undefined}
              {...menu.trigger()}
            />
          </Tooltip>
        </CornerDot>
      ) : null}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={FILTER}
          menu={menu.drawn}
          replayUnmasked
          groups={filterEntries(tasks, filter, onFilter, shared, reader, pictures)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

interface ChipValue {
  readonly value: string | null;
  readonly words: string;
  readonly masked: boolean;
}

function ChipValues({ values }: { values: readonly ChipValue[] }): React.JSX.Element {
  const more = values.length - CHIP_VALUES;
  return (
    <>
      {values.slice(0, CHIP_VALUES).map((each, at) => (
        <Fragment key={String(each.value)}>
          {at === 0 ? null : ", "}
          {each.masked ? <ReplayMask>{each.words}</ReplayMask> : each.words}
        </Fragment>
      ))}
      {more > 0 ? ` +${more}` : null}
    </>
  );
}

const FILTER_LINE = {
  CLEAR: "clear",
} as const;

type FilterLineEntry =
  | { readonly key: TasksFilterField; readonly values: readonly ChipValue[] }
  | { readonly key: typeof FILTER_LINE.CLEAR };

function filterLineEntries(
  tasks: readonly TaskSummary[],
  filter: TasksFilter,
  reader: ReturnType<typeof useMemberDirectory>,
): FilterLineEntry[] {
  const fields = filteredFields(filter);
  if (fields.length === 0) return [];
  const chips = fields.map((field) => {
    const kept = filterValues(filter, field);
    const values = fieldValues(field, tasks, filter, reader, false)
      .filter((each) => kept.includes(each.value))
      .map((each) => ({
        value: each.value,
        words: each.words,
        masked: namesData(field) && each.value !== null,
      }));
    return { key: field, values };
  });
  return [...chips, { key: FILTER_LINE.CLEAR }];
}

function stays(): void {}

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
  const listed = useMemo(() => filterLineEntries(tasks, filter, reader), [tasks, filter, reader]);
  const drawn = useLeaving(listed, (entry) => entry.key);
  return (
    <div
      ref={line}
      className="tasks-filter-line flex min-w-0 flex-wrap items-center gap-control-gap [&[hidden]]:hidden"
      hidden={drawn.length === 0}
      {...motionRows()}
    >
      {drawn.map(({ key, value, leaving }) =>
        value.key === FILTER_LINE.CLEAR ? (
          <span key={key} className="tasks-filter-clear inline-flex" {...motionKey(key)}>
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
            <ChipName>
              {`${FIELD_WORDS[value.key]}: `}
              <ChipValues values={value.values} />
            </ChipName>
          </Chip>
        ),
      )}
    </div>
  );
}

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

function groupsFixed(grouping: TasksGrouping): boolean {
  return (
    grouping === TASKS_GROUPING.STATUS ||
    grouping === TASKS_GROUPING.PRIORITY ||
    grouping === TASKS_GROUPING.ASSIGNEE
  );
}

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
        ...commandHead(PANEL_COMMAND.GROUP_BY),
        items: groupings.map((each) => ({
          label: GROUPING_WORDS[each],
          icon: GROUPING_ICON[each],
          checked: grouping === each,
          onSelect: () => set({ grouping: each }),
        })),
      },
      {
        ...commandHead(PANEL_COMMAND.ORDER_BY),
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
  board: boolean;
  display: TasksDisplay;
  initial: TasksDisplay;
  onDisplay: (display: TasksDisplay) => void;
  shared: boolean;
  asked?: { readonly ask: MenuAsk | undefined } | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  useAskedMenu(menu.show, asked?.ask);
  return (
    <>
      {asked === undefined ? (
        <span className="tasks-page-option relative inline-flex">
          <Tooltip label={VIEW_OPTIONS}>
            <IconButton icon={<SlidersHorizontalIcon />} label={VIEW_OPTIONS} {...menu.trigger()} />
          </Tooltip>
        </span>
      ) : null}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          replayUnmasked
          groups={displayEntries({ board, display, initial, onDisplay, shared })}
          onClose={menu.close}
        />
      )}
    </>
  );
}

export function OlderCompleted({
  older,
  onShow,
}: {
  older: number | undefined;
  onShow: () => void;
}): React.JSX.Element | null {
  if (older === undefined) return null;
  return <ShowMoreRow more={older} shown={false} onToggle={onShow} />;
}
