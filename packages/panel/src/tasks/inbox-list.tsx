import { type InboxItem, inboxAddressedTo } from "@repo/features/inbox-wire";
import type { CatalogModel } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskStatus } from "@repo/features/task-wire";
import { sameShape } from "@repo/features/turn-rows";
import { countWords, selectedWords, TERM } from "@repo/features/words";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  CHIP_LOOK,
  Checkbox,
  Chip,
  ChipName,
  ComposeIcon,
  EMPTY_STATE_ACTION_LOOK,
  EmptyState,
  type EmptyStateAction,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  IconButton,
  INSET,
  joinRefs,
  LIST_LEAVING_SELECTOR,
  LIST_MOTION_WAY,
  LIST_ROW_CURRENT,
  LIST_ROW_CURRENT_LOOK,
  LIST_ROW_INK,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  List,
  ListMotion,
  ListRow,
  motionRows,
  NOTE_LINE_LOOK,
  NoteLine,
  PaneBar,
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  RowHint,
  RowHintOptions,
  reachedKey,
  SCROLL_FADE,
  ScrollArea,
  SearchField,
  type SelectionAct,
  SelectionBar,
  SelectionRegion,
  SelectionToolbar,
  Shortcut,
  Skeleton,
  SkeletonRegion,
  Stack,
  selectionMenu,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TOOLBAR_INSET,
  Toolbar,
  Tooltip,
  UnreadMark,
  useLeaving,
  useMenu,
  useResizeEdge,
  useRovingKeys,
} from "@repo/ui";
import { actorName, personActor } from "@repo/ui/actor-model";
import { CheckCheckIcon, GLYPH, InboxIcon, SlidersHorizontalIcon, UsersIcon } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "@repo/ui/virtual-rows";
import {
  memo,
  type RefObject,
  startTransition,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import {
  holdsPicks,
  type InboxRowDraft,
  rowDrafted,
  rowPicks,
  useInboxRowDrafts,
} from "../composer-drafts.js";
import { ActionMenu, type MenuAction, type MenuEntry, rowMenu } from "../desktop/action-menu.js";
import {
  INBOX_LIST_WIDTH,
  type InboxViewChoices,
  type InboxWhoseChoice,
  useInboxListWidth,
} from "../desktop/folded-groups.js";
import {
  type MenuAsk,
  PhoneHead,
  PlaceMore,
  phoneFindGroups,
  useAskedMenu,
  useMenuAsk,
} from "../desktop/phone-head.js";
import { type TabActionGroups, useTabActions } from "../desktop/strip-tabs.js";
import { unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { PEOPLE_FILTER, PEOPLE_FILTER_WORDS, peopleFilterActions } from "../member-rows.js";
import { usePhoneRoom } from "../stage-room.js";
import { useSteadyDoor } from "../steady-door.js";
import { type InboxCloser, useInboxCloseAsk } from "./inbox-close.js";
import {
  INBOX_COLUMNS,
  type InboxColumnsShown,
  type InboxRowPresses,
  listHeadControl,
  VIEW_OPTIONS,
} from "./inbox-columns.js";
import { useInboxItemActions } from "./inbox-item-actions.js";
import {
  addressedWords,
  HolderGlyph,
  InboxItemCard,
  InboxItemMarks,
  inboxLineGlyph,
  useInboxStanding,
} from "./inbox-item-parts.js";
import {
  EVERYONES,
  holderName,
  INBOX_NOT_READ,
  INBOX_SHOW,
  INBOX_WHOSE,
  type InboxCounts,
  type InboxListed,
  type InboxListView,
  type InboxShow,
  type InboxWhose,
  inboxLineKind,
  inboxPreview,
  inboxPreviewHeard,
  inboxShownTicks,
  isDone,
  isUnread,
  listedItems,
  MINE,
  NEEDS_YOU,
  narrowedByWhose,
} from "./inbox-model.js";
import { type InboxReminder, useInboxReminding, useRemindMany } from "./inbox-remind.js";
import { type InboxListMark, type InboxSelection, useInboxSelection } from "./inbox-selection.js";
import { PlanGlyph } from "./tab-look.js";
import { cardTitle } from "./tool-call-model.js";

const ITEM_THING = "Inbox item";

const INBOX_ITEMS = "Inbox items";

const SELECT_ALL = "Select all";

const UNREAD = "Unread";

const MARK_ALL_READ = "Mark all as read";

const READING_ITEMS = "Reading your inbox…";

const SKELETON_ROWS = [
  { task: "40%", title: "68%", preview: "84%" },
  { task: "32%", title: "52%", preview: "70%" },
  { task: "44%", title: "74%", preview: "90%" },
  { task: "28%", title: "46%", preview: "62%" },
  { task: "36%", title: "60%", preview: "78%" },
] as const;

const SKELETON_TIME = "20px";

const SCOPE_WORDS = {
  [INBOX_SHOW.NEEDS_ME]: { label: "Needs you", icon: <GLYPH.PERSON /> },
  [INBOX_SHOW.OPEN]: { label: "Open", icon: <GLYPH.TODOS /> },
  [INBOX_SHOW.ALL]: { label: "All", icon: <InboxIcon /> },
  [INBOX_SHOW.REMINDERS]: { label: "Reminders", icon: <GLYPH.TIME /> },
} as const satisfies Record<InboxShow, { label: string; icon: React.JSX.Element }>;

const INBOX_SCOPES = [
  INBOX_SHOW.NEEDS_ME,
  INBOX_SHOW.OPEN,
  INBOX_SHOW.ALL,
  INBOX_SHOW.REMINDERS,
] as const satisfies readonly InboxShow[];

const INBOX_TITLE = "Inbox";

function needsYouListed(head: InboxListHead): boolean {
  return head.view?.show === INBOX_SHOW.NEEDS_ME;
}

function narrowingWhose(view: InboxViewChoices | undefined): InboxWhoseChoice | undefined {
  return view !== undefined && narrowedByWhose(view.show) ? view : undefined;
}

function whoseWords(whose: InboxWhose): string {
  switch (whose.kind) {
    case INBOX_WHOSE.EVERYONE:
      return PEOPLE_FILTER_WORDS.ANYONE;
    case INBOX_WHOSE.MINE:
      return PEOPLE_FILTER_WORDS.ME;
    case INBOX_WHOSE.PERSON:
      return whose.name;
  }
}

function regionLabel(head: InboxListHead): string {
  const { view } = head;
  if (view === undefined) return INBOX_ITEMS;
  if (!narrowedByWhose(view.show)) return `${INBOX_ITEMS} · ${SCOPE_WORDS[view.show].label}`;
  return `${INBOX_ITEMS} · ${SCOPE_WORDS[view.show].label} · ${whoseWords(view.whose)}`;
}

export const NOTHING_HERE = "Nothing here";

const NO_REMINDERS = "No reminders";

const NOTHING_OPEN = "Nothing open";

const NOTHING_NEEDS_ME = "Nothing needs your response";

const SHOW_EMPTY = {
  [INBOX_WHOSE.MINE]: {
    [INBOX_SHOW.NEEDS_ME]: NOTHING_NEEDS_ME,
    [INBOX_SHOW.OPEN]: NOTHING_OPEN,
    [INBOX_SHOW.ALL]: "Nothing addressed to you",
    [INBOX_SHOW.REMINDERS]: NO_REMINDERS,
  },
  [INBOX_WHOSE.EVERYONE]: {
    [INBOX_SHOW.NEEDS_ME]: NOTHING_NEEDS_ME,
    [INBOX_SHOW.OPEN]: NOTHING_OPEN,
    [INBOX_SHOW.ALL]: NOTHING_HERE,
    [INBOX_SHOW.REMINDERS]: NO_REMINDERS,
  },
  [INBOX_WHOSE.PERSON]: {
    [INBOX_SHOW.NEEDS_ME]: NOTHING_NEEDS_ME,
    [INBOX_SHOW.OPEN]: "Nothing addressed to them",
    [INBOX_SHOW.ALL]: "Nothing addressed to them",
    [INBOX_SHOW.REMINDERS]: NO_REMINDERS,
  },
} as const satisfies Record<InboxWhose["kind"], Record<InboxShow, string>>;

const SHOW_INSTEAD = {
  OPEN: "Show open",
  ALL: "Show all",
  MINE: "Show mine",
  EVERYONE: "Show anyone's",
} as const;

const WHOSE = "Addressed to";

const CLEAR_WHOSE = "Show what's addressed to me";

const PANE_RESERVE = 560;

function drawnWidth(width: number, alone: boolean): string | undefined {
  if (alone) return undefined;
  return `min(${width}px, max(${INBOX_LIST_WIDTH.MIN}px, 100cqw - ${PANE_RESERVE}px))`;
}

const NO_TICKS: readonly number[] = [];

export function inboxRowDraft(
  draft: InboxRowDraft | undefined,
  item: InboxItem,
  open: boolean,
): { readonly drafted: boolean; readonly ticked: readonly number[] } {
  const picks = rowPicks(draft, item);
  const ticks =
    picks !== undefined &&
    holdsPicks(picks) &&
    ((picks.steps ?? []).length > 0 || picks.press !== undefined);
  return {
    drafted: !open && rowDrafted(draft, item),
    ticked: ticks ? inboxShownTicks(item, picks) : NO_TICKS,
  };
}

interface InboxChosen {
  readonly count: number;
  readonly acts: readonly SelectionAct[];
}

interface InboxHeadSelecting {
  readonly count: number;
  readonly total: number;
  readonly onAll: (all: boolean) => void;
  readonly acts: InboxSelection["acts"];
  readonly onClear: () => void;
  readonly controls: string;
}

export const InboxItemRow = memo(function InboxItemRow({
  listed,
  chosen,
  open = chosen,
  current = chosen,
  drafted = false,
  ticked = NO_TICKS,
  models,
  readerId,
  face = true,
  muted = false,
  needsYouShown = false,
  ref,
  selectKey,
  onChoose,
  onMark,
  onAskClose,
  onRemind,
  onPickRemind,
  several,
  place,
}: {
  listed: InboxListed;
  chosen: boolean;
  open?: boolean;
  current?: boolean;
  drafted?: boolean;
  ticked?: readonly number[];
  models: readonly CatalogModel[] | undefined;
  readerId: string | undefined;
  face?: boolean;
  muted?: boolean;
  needsYouShown?: boolean;
  ref?: React.RefCallback<HTMLElement> | undefined;
  selectKey?: string | undefined;
  onChoose: (listed: InboxListed) => void;
  onMark?: ((listed: InboxListed, unread: boolean) => void) | undefined;
  onAskClose?: ((item: InboxItem) => void) | undefined;
  onRemind?: InboxReminder | undefined;
  onPickRemind?: ((item: InboxItem) => void) | undefined;
  several?: InboxChosen | undefined;
  place?: VirtualRowPlace | undefined;
}): React.JSX.Element {
  const { holder, item } = listed;
  const unread = isUnread(item);
  const title = cardTitle(item.title);
  const directory = useMemberDirectory();
  const _reader = directory.readerId ?? readerId;
  const { nameOf } = useInboxStanding(listed, readerId);
  const lineKind = inboxLineKind(item);
  const preview = inboxPreview(item, nameOf, ticked);
  const heard = inboxPreviewHeard(item, nameOf, ticked);
  const addressedTo = inboxAddressedTo(item);
  const addressee = usePerson(addressedTo);
  const coarse = useCoarsePointer();
  const { groups } = useInboxItemActions(item, {
    onMark: onMark === undefined ? undefined : (_item, next) => onMark(listed, next),
    onAskClose,
    keyed: chosen,
    remind:
      onRemind === undefined || onPickRemind === undefined
        ? undefined
        : { onRemind, onPick: onPickRemind },
  });
  return (
    <RowHintOptions card={<InboxItemCard listed={listed} models={models} readerId={readerId} />}>
      <ListRow
        ref={ref}
        motionKey={listed.item.id}
        ink={LIST_ROW_INK.SIDEBAR}
        currentLook={LIST_ROW_CURRENT_LOOK.TINT}
        leading={<UnreadMark unread={unread} />}
        title={title}
        description={
          <span
            className="inbox-row-line [&>svg]:me-tight-gap [&>svg]:size-caption-glyph [&>svg]:align-[-0.125em] [&>svg]:text-attention data-[line=settled]:[&>svg]:text-complete"
            data-line={lineKind}
          >
            {inboxLineGlyph(lineKind)}
            {preview}
          </span>
        }
        describedAs={heard}
        lead={{
          icon: <HolderGlyph holder={holder} />,
          label:
            addressedTo === undefined
              ? holderName(holder)
              : `${holderName(holder)} · ${addressedWords(addressee)}`,
        }}
        leadAt={LIST_ROW_LEAD.ABOVE}
        meta={
          <InboxItemMarks
            listed={listed}
            readerId={readerId}
            open={open}
            face={face}
            standing={false}
            drafted={drafted}
            needsYouSaid={!needsYouShown}
          />
        }
        metaAt={LIST_ROW_META.TITLE}
        current={current ? LIST_ROW_CURRENT.PAGE : undefined}
        unread={unread}
        unreadWords={UNREAD}
        muted={muted}
        hint={{ Hint: RowHint, label: title }}
        selectKey={selectKey}
        selectBox={!coarse}
        onPress={() => onChoose(listed)}
        menu={
          several === undefined
            ? rowMenu(ITEM_THING, groups(), undefined, true)
            : {
                ...rowMenu(ITEM_THING, selectionMenu(several.acts), undefined, true),
                heading: countWords(several.count, TERM.INBOX_ITEM),
              }
        }
        more={!coarse}
        place={place}
      />
    </RowHintOptions>
  );
});

function whoseEntries(
  whose: InboxWhose,
  onWhose: (whose: InboxWhose) => void,
  reader: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): MenuAction[] {
  return peopleFilterActions({
    members: reader.members,
    readerId: reader.readerId ?? readerId,
    chosen:
      whose.kind === INBOX_WHOSE.EVERYONE
        ? { kind: PEOPLE_FILTER.ANYONE }
        : whose.kind === INBOX_WHOSE.MINE
          ? { kind: PEOPLE_FILTER.ME }
          : { kind: PEOPLE_FILTER.PERSON, userId: whose.userId },
    onChoose: (filter) =>
      onWhose(
        filter.kind === PEOPLE_FILTER.ANYONE
          ? EVERYONES
          : filter.kind === PEOPLE_FILTER.ME
            ? MINE
            : { kind: INBOX_WHOSE.PERSON, userId: filter.userId, name: filter.name },
      ),
    meWithoutId: true,
  }).map((action) => (action.key === undefined ? action : { ...action, replayMasked: true }));
}

function ViewOptions({
  shown,
  choices,
  readerId,
  asked,
}: {
  shown: boolean;
  choices: InboxViewChoices;
  readerId: string | undefined;
  asked?: { readonly ask: MenuAsk | undefined } | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  useAskedMenu(menu.show, asked?.ask);
  const reader = useMemberDirectory();
  const scope: MenuEntry[] = INBOX_SCOPES.map((value) => ({
    ...SCOPE_WORDS[value],
    checked: choices.show === value,
    onSelect: () => choices.onShow(value),
  }));
  return (
    <>
      {asked === undefined ? (
        <Tooltip label={VIEW_OPTIONS}>
          <IconButton icon={<SlidersHorizontalIcon />} label={VIEW_OPTIONS} {...menu.trigger()} />
        </Tooltip>
      ) : null}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={[scope, ...windowEntries(choices, reader, readerId)]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

function MarkAllReadButton({ readAll }: { readAll: InboxReadAll }): React.JSX.Element {
  return (
    <Tooltip label={MARK_ALL_READ}>
      <IconButton
        icon={<CheckCheckIcon />}
        label={MARK_ALL_READ}
        disabled={!readAll.unread}
        onClick={readAll.onMarkAll}
      />
    </Tooltip>
  );
}

function markAllAction(readAll: InboxReadAll): MenuAction {
  return {
    label: MARK_ALL_READ,
    icon: <CheckCheckIcon />,
    disabled: !readAll.unread,
    onSelect: readAll.onMarkAll,
  };
}

function windowEntries(
  choices: InboxViewChoices,
  reader: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): MenuEntry[][] {
  if (!narrowedByWhose(choices.show)) return [];
  return [
    [
      {
        label: WHOSE,
        icon: <UsersIcon />,
        items: whoseEntries(choices.whose, choices.onWhose, reader, readerId),
      },
    ],
  ];
}

const FILTER_CHIP_KEY = { TASK: "task", WHOSE: "whose" } as const;

const CLEAR_TASK = "Show every task's items";

const UNNAMED_TASK = "Task";

interface FilterChipEntry {
  readonly key: (typeof FILTER_CHIP_KEY)[keyof typeof FILTER_CHIP_KEY];
  readonly mark: React.ReactNode;
  readonly words: string;
  readonly removeLabel: string;
  readonly onRemove: () => void;
}

function stays(): void {}

function whoseChipEntries(
  { whose: chosen, onWhose }: InboxWhoseChoice,
  directory: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): FilterChipEntry[] {
  if (chosen.kind !== INBOX_WHOSE.PERSON) return [];
  const { members, former, readerId: known } = directory;
  const actor = personActor(chosen, members, known ?? readerId, former);
  return [
    {
      key: FILTER_CHIP_KEY.WHOSE,
      mark: <ActorMark actor={actor} size={ACTOR_SIZE.MARK} />,
      words: actorName(actor),
      removeLabel: CLEAR_WHOSE,
      onRemove: () => onWhose(MINE),
    },
  ];
}

function taskChipEntries(
  name: string | undefined,
  status: TaskStatus | undefined,
  onClear: (() => void) | undefined,
): FilterChipEntry[] {
  if (onClear === undefined) return [];
  return [
    {
      key: FILTER_CHIP_KEY.TASK,
      mark: <PlanGlyph status={status} />,
      words: name ?? UNNAMED_TASK,
      removeLabel: CLEAR_TASK,
      onRemove: onClear,
    },
  ];
}

function FilterChipLine({
  line,
  whose,
  task,
  readerId,
}: {
  line: RefObject<HTMLDivElement | null>;
  whose: InboxWhoseChoice | undefined;
  task: InboxTaskHead | undefined;
  readerId: string | undefined;
}): React.JSX.Element {
  const directory = useMemberDirectory();
  const chosen = whose?.whose;
  const onWhose = whose?.onWhose;
  const taskName = task?.name;
  const taskStatus = task?.status;
  const onClearTask = task?.onClear;
  const listed = useMemo(
    () => [
      ...taskChipEntries(taskName, taskStatus, onClearTask),
      ...(chosen === undefined || onWhose === undefined
        ? []
        : whoseChipEntries({ whose: chosen, onWhose }, directory, readerId)),
    ],
    [taskName, taskStatus, onClearTask, chosen, onWhose, directory, readerId],
  );
  const drawn = useLeaving(listed, (entry) => entry.key);
  return (
    <div ref={line} hidden={drawn.length === 0}>
      <div
        className="inbox-tasks-chips flex flex-wrap gap-tight-gap px-column-inset pt-row-inset"
        {...motionRows()}
      >
        {drawn.map(({ key, value, leaving }) => (
          <Chip
            key={key}
            motionKey={key}
            look={CHIP_LOOK.FILTER}
            removeLabel={value.removeLabel}
            onRemove={leaving ? stays : value.onRemove}
          >
            {value.mark}
            <ChipName>{value.words}</ChipName>
          </Chip>
        ))}
      </div>
    </div>
  );
}

function FilterChips({
  whose,
  task,
  readerId,
}: {
  whose: InboxWhoseChoice | undefined;
  task: InboxTaskHead | undefined;
  readerId: string | undefined;
}): React.JSX.Element {
  const line = useRef<HTMLDivElement | null>(null);
  return (
    <ListMotion root={line} way={LIST_MOTION_WAY.SCALE}>
      <FilterChipLine line={line} whose={whose} task={task} readerId={readerId} />
    </ListMotion>
  );
}

function emptyWayOn(
  view: InboxViewChoices,
  counts: InboxCounts,
  onList: () => void,
): EmptyStateAction | undefined {
  const turn = (label: string, change: () => void): EmptyStateAction => ({
    label,
    onClick: () => {
      onList();
      change();
    },
  });
  if (view.show === INBOX_SHOW.NEEDS_ME && counts[INBOX_SHOW.OPEN] > 0) {
    return turn(SHOW_INSTEAD.OPEN, () => view.onShow(INBOX_SHOW.OPEN));
  }
  if (view.show !== INBOX_SHOW.ALL && counts[INBOX_SHOW.ALL] > 0) {
    return turn(SHOW_INSTEAD.ALL, () => view.onShow(INBOX_SHOW.ALL));
  }
  if (!narrowedByWhose(view.show)) return undefined;
  if (view.whose.kind === INBOX_WHOSE.PERSON) {
    return turn(SHOW_INSTEAD.MINE, () => view.onWhose(MINE));
  }
  if (view.whose.kind === INBOX_WHOSE.MINE) {
    return turn(SHOW_INSTEAD.EVERYONE, () => view.onWhose(EVERYONES));
  }
  return undefined;
}

function ShowEmpty({
  view,
  counts,
  onList,
}: {
  view: InboxViewChoices;
  counts: InboxCounts;
  onList: () => void;
}): React.JSX.Element {
  return (
    <ReplayUnmask>
      <EmptyState replayUnmasked icon={<InboxIcon />} action={emptyWayOn(view, counts, onList)}>
        {SHOW_EMPTY[view.whose.kind][view.show]}
      </EmptyState>
    </ReplayUnmask>
  );
}

export function InboxListSkeleton({
  rows = SKELETON_ROWS.length,
}: {
  rows?: number;
}): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_ITEMS}>
      <List label={TAB_WORDS.INBOX}>
        {SKELETON_ROWS.slice(0, rows).map(({ task, title, preview }) => (
          <ListRow
            key={title}
            leading={<UnreadMark unread={false} />}
            lead={{ icon: null, label: <Skeleton width={task} /> }}
            leadAt={LIST_ROW_LEAD.ABOVE}
            title={<Skeleton width={title} />}
            description={<Skeleton width={preview} />}
            meta={<Skeleton width={SKELETON_TIME} />}
            metaAt={LIST_ROW_META.TITLE}
          />
        ))}
      </List>
    </SkeletonRegion>
  );
}

const SEARCH_INBOX = "Search inbox";

function ListSearch({ search }: { search: InboxSearchHead }): React.JSX.Element {
  const [words, setWords] = useState(search.query);
  const { onQuery } = search;
  const type = (next: string) => {
    setWords(next);
    startTransition(() => onQuery(next));
  };
  return (
    <search className="inbox-search block px-column-inset pb-row-inset">
      <SearchField
        label={SEARCH_INBOX}
        placeholder={SEARCH_INBOX}
        value={words}
        onChange={type}
        onClear={() => type("")}
        onEscape={words === "" ? undefined : () => type("")}
      />
    </search>
  );
}

function ListHead({
  head,
  readerId,
  selecting,
}: {
  head: InboxListHead;
  readerId: string | undefined;
  selecting?: InboxHeadSelecting | undefined;
}): React.JSX.Element {
  const { shown, view } = head;
  const title = INBOX_TITLE;
  const asked = useMenuAsk();
  const search = head.search === undefined ? null : <ListSearch search={head.search} />;
  const linkGroups: TabActionGroups =
    head.tab === true && head.link !== undefined ? [[head.link]] : [];
  useTabActions(linkGroups.length === 0 ? undefined : linkGroups);
  const phone = usePhoneRoom();
  if (head.tab === true && phone) return <>{search}</>;
  if (head.phone !== undefined) {
    const { readAll } = head.phone;
    return (
      <>
        <PhoneHead
          place="inbox"
          start={head.phone.start}
          title={
            <Text
              as={TEXT_ELEMENT.H1}
              variant={TEXT_VARIANT.TOOLBAR_TITLE}
              className="ui-toolbar-title"
            >
              <ReplayUnmask>{title}</ReplayUnmask>
            </Text>
          }
          end={
            <PlaceMore
              thing="Inbox"
              shown={shown}
              groups={(opener) =>
                [
                  view === undefined
                    ? []
                    : [
                        {
                          label: VIEW_OPTIONS,
                          icon: <SlidersHorizontalIcon />,
                          opens: true,
                          onSelect: () => asked.onAsk(opener),
                        },
                      ],
                  ...phoneFindGroups(),
                  readAll === undefined ? [] : [markAllAction(readAll)],
                ].filter((group) => group.length > 0)
              }
            />
          }
        />
        {view === undefined ? null : (
          <ViewOptions
            shown={shown}
            choices={view}
            readerId={readerId}
            asked={{ ask: asked.ask }}
          />
        )}
        {search}
        {view === undefined && head.task === undefined ? null : (
          <FilterChips whose={narrowingWhose(view)} task={head.task} readerId={readerId} />
        )}
      </>
    );
  }
  const options =
    view === undefined && head.readAll === undefined ? null : (
      <>
        {head.readAll === undefined ? null : <MarkAllReadButton readAll={head.readAll} />}
        {view === undefined ? null : (
          <ViewOptions shown={shown} choices={view} readerId={readerId} />
        )}
      </>
    );
  const choosing = selecting !== undefined && selecting.count > 0 ? selecting : undefined;
  const all =
    choosing === undefined ? null : (
      <Checkbox
        label={SELECT_ALL}
        checked={choosing.count === choosing.total}
        mixed={choosing.count < choosing.total}
        onChange={choosing.onAll}
      />
    );
  const actions =
    selecting === undefined ? (
      options
    ) : (
      <>
        <SelectionToolbar
          count={selecting.count}
          acts={selecting.acts}
          onClear={selecting.onClear}
          controls={selecting.controls}
        />
        {choosing === undefined ? options : null}
      </>
    );
  const heading = choosing === undefined ? title : selectedWords(choosing.count);
  const barTitle =
    choosing === undefined ? (
      title
    ) : (
      <ReplayUnmask>
        <Text variant={TEXT_VARIANT.LABEL}>{heading}</Text>
      </ReplayUnmask>
    );
  return (
    <>
      {head.tab === true ? (
        <PaneBar mark={all} title={heading} titleReplayUnmasked actions={actions} />
      ) : (
        <Toolbar
          lead={all}
          title={barTitle}
          titleReplayUnmasked
          actions={actions}
          end={TOOLBAR_INSET.COLUMN}
        />
      )}
      {search}
      {view === undefined && head.task === undefined ? null : (
        <FilterChips whose={narrowingWhose(view)} task={head.task} readerId={readerId} />
      )}
    </>
  );
}

function SearchEmpty({ searched }: { searched: string }): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.ROWS}>
      <ReplayUnmask>
        No items match “<ReplayMask>{searched.trim()}</ReplayMask>”.
      </ReplayUnmask>
    </NoteLine>
  );
}

const NEW_TASK_LABEL = "New task";

export function newTaskAction(onNewTask: (() => void) | undefined): EmptyStateAction | undefined {
  return onNewTask === undefined
    ? undefined
    : {
        label: NEW_TASK_LABEL,
        look: EMPTY_STATE_ACTION_LOOK.PRIMARY,
        icon: <ComposeIcon />,
        onClick: onNewTask,
      };
}

const CHOOSE_AN_ITEM = "Choose an item";

export function InboxPaneEmpty({
  listed,
  newTask,
  none = NEEDS_YOU.NONE,
}: {
  listed: number;
  newTask?: (() => void) | undefined;
  none?: string | undefined;
}): React.JSX.Element {
  const coarse = useCoarsePointer();
  if (listed === 0) {
    return (
      <ReplayUnmask>
        <EmptyState replayUnmasked icon={<InboxIcon />} action={newTaskAction(newTask)}>
          {none}
        </EmptyState>
      </ReplayUnmask>
    );
  }
  return (
    <ReplayUnmask>
      <EmptyState replayUnmasked icon={<InboxIcon />}>
        {coarse ? (
          CHOOSE_AN_ITEM
        ) : (
          <>
            {CHOOSE_AN_ITEM}, or step with{" "}
            <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEXT_INBOX_ITEM].chord} spoken />{" "}
            <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.PREVIOUS_INBOX_ITEM].chord} spoken />
          </>
        )}
      </EmptyState>
    </ReplayUnmask>
  );
}

export function InboxListNote({
  failed,
  reading,
  empty,
  alone,
  filteredOut,
  counts,
  onList,
  onRetry,
  searched,
  onNewTask,
  none = NEEDS_YOU.NONE,
}: {
  failed: boolean;
  reading: boolean;
  empty: boolean;
  alone: boolean;
  onNewTask?: (() => void) | undefined;
  filteredOut: InboxViewChoices | undefined;
  counts: InboxCounts;
  onList: () => void;
  onRetry: () => void;
  searched?: string | undefined;
  none?: string | undefined;
}): React.JSX.Element | null {
  if (failed) {
    return (
      <ReplayUnmask>
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.INBOX_READ)}
          onRetry={onRetry}
          placement={ERROR_STATE_PLACEMENT.ROWS}
        >
          {INBOX_NOT_READ}
        </ErrorState>
      </ReplayUnmask>
    );
  }
  if (!empty) return null;
  if (reading) return <InboxListSkeleton />;
  if (searched !== undefined) return <SearchEmpty searched={searched} />;
  if (filteredOut !== undefined)
    return <ShowEmpty view={filteredOut} counts={counts} onList={onList} />;
  if (!alone) return null;
  return (
    <ReplayUnmask>
      <EmptyState replayUnmasked icon={<InboxIcon />} action={newTaskAction(onNewTask)}>
        {none}
      </EmptyState>
    </ReplayUnmask>
  );
}

export interface InboxListHead {
  readonly shown: boolean;
  readonly view: InboxViewChoices | undefined;
  readonly search?: InboxSearchHead | undefined;
  readonly phone?:
    | { readonly start: React.ReactNode; readonly readAll?: InboxReadAll | undefined }
    | undefined;
  readonly readAll?: InboxReadAll | undefined;
  readonly tab?: boolean | undefined;
  readonly link?: MenuAction | undefined;
  readonly task?: InboxTaskHead | undefined;
}

interface InboxTaskHead {
  readonly name: string | undefined;
  readonly status: TaskStatus | undefined;
  readonly onClear: () => void;
}

interface InboxSearchHead {
  readonly query: string;
  readonly onQuery: (query: string) => void;
}

interface InboxReadAll {
  readonly unread: boolean;
  readonly onMarkAll: () => void;
}

interface RowFocus {
  readonly ref: React.RefObject<HTMLElement | null>;
  readonly onFocus: (event: React.FocusEvent) => void;
  readonly onBlur: () => void;
}

function useRowFocusKept(rows: InboxRowPresses): RowFocus {
  const ref = useRef<HTMLElement | null>(null);
  const focusedRow = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const list = ref.current;
    const row = focusedRow.current;
    if (list === null || row === undefined || list.hidden) return;
    if (rows.find(row)?.closest(LIST_LEAVING_SELECTOR) === null) return;
    focusedRow.current = undefined;
    const active = document.activeElement;
    if (
      active !== null &&
      active !== document.body &&
      active.closest(LIST_LEAVING_SELECTOR) === null
    )
      return;
    listHeadControl(list)?.focus();
  });
  return {
    ref,
    onFocus: (event) => {
      focusedRow.current = rows.itemOf(event.target);
    },
    onBlur: () => {
      focusedRow.current = undefined;
    },
  };
}

const LAID_OUT_DEPTH = 1;

function useLaidOut(items: readonly InboxListed[]): readonly InboxListed[] {
  const held = useRef(items);
  const steady = sameShape(held.current, items, LAID_OUT_DEPTH) ? held.current : items;
  useLayoutEffect(() => {
    held.current = steady;
  });
  return steady;
}

const ROW_ESTIMATE_PX = 72;

const ROW_GAP_PX = 4;

interface RowsPlace {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly body: RefObject<HTMLElement | null>;
  readonly finding: boolean;
  readonly holdRun: InboxRowPresses["holdRun"];
}

function InboxRows({
  items,
  place,
  row,
}: {
  items: readonly InboxListed[];
  place: RowsPlace;
  row: (listed: InboxListed, leaving: boolean, at: VirtualRowPlace) => React.ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(items, (listed) => listed.item.id);
  const keys = useMemo(() => drawn.map(({ key }) => key), [drawn]);
  const handle = useRef<VirtualRowsHandle>(null);
  const { holdRun } = place;
  useLayoutEffect(() => holdRun(handle), [holdRun]);
  return (
    <VirtualRows
      scroller={place.scroller}
      shiftedBy={place.body}
      keys={keys}
      estimate={ROW_ESTIMATE_PX}
      gap={ROW_GAP_PX}
      overscan={place.finding ? keys.length : undefined}
      anchor={VIRTUAL_ROWS_ANCHOR.START}
      listItems
      moves
      holdsFocus
      className="sidebar-tasks"
      handle={handle}
    >
      {(index, at) => {
        const entry = drawn[index];
        return entry === undefined ? null : row(entry.value, entry.leaving, at);
      }}
    </VirtualRows>
  );
}

export function InboxList({
  view,
  chosen,
  head,
  note,
  models,
  readerId,
  columns,
  rows,
  reading = false,
  onChoose,
  onMark,
  onClose,
  onRemind,
  onPointing,
}: {
  view: InboxListView;
  chosen: string | undefined;
  models: readonly CatalogModel[] | undefined;
  readerId: string | undefined;
  head: InboxListHead;
  note: React.ReactNode;
  reading?: boolean;
  columns: InboxColumnsShown;
  rows: InboxRowPresses;
  onChoose: (listed: InboxListed) => void;
  onMark?: InboxListMark | undefined;
  onClose?: InboxCloser | undefined;
  onRemind?: InboxReminder | undefined;
  onPointing?: ((pointing: boolean) => void) | undefined;
}): React.JSX.Element {
  const regionId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const drawn = view.items;
  const picks = drawn.filter(({ item }) => picked.has(item.id));
  if (picks.length !== picked.size) setPicked(new Set(picks.map(({ item }) => item.id)));
  const unpick = () => setPicked(new Set());
  const { width, onResize } = useInboxListWidth();
  const rowFocus = useRowFocusKept(rows);
  const drafts = useInboxRowDrafts();
  const marked = !useCoarsePointer() || columns !== INBOX_COLUMNS.LIST;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const roving = useRovingKeys<HTMLDivElement>({
    reach: (from, to) => {
      const ids = drawn.map(({ item }) => item.id);
      const id = reachedKey(ids, from === undefined ? undefined : rows.itemOf(from), to);
      if (id === undefined) return false;
      const press = rows.find(id);
      if (press !== undefined) {
        press.focus();
        return true;
      }
      return rows.bringIn(id, () => rows.find(id)?.focus());
    },
  });
  const rovingBody = useMemo(() => joinRefs(bodyRef, roving.ref), [roving.ref]);
  const finding = useFindOpen();
  const { holdRun } = rows;
  const rowsPlace = useMemo(
    (): RowsPlace => ({ scroller, body: bodyRef, finding, holdRun }),
    [finding, holdRun],
  );
  const edge = useResizeEdge({
    side: RESIZE_EDGE_SIDE.RIGHT,
    width,
    bounds: INBOX_LIST_WIDTH,
    reserve: () => PANE_RESERVE,
    label: "Resize inbox list",
    onResize,
  });
  const laidOut = useLaidOut(view.items);
  const choose = useSteadyDoor(onChoose);
  const mark = useSteadyDoor(onMark);
  const remind = useSteadyDoor(onRemind);
  const reminding = useInboxReminding({
    room: bodyRef,
    rowOf: rows.find,
    chosen: drawn.find(({ item }) => item.id === chosen)?.item,
    active: head.shown,
    onRemind,
  });
  const pickRemind = useSteadyDoor(reminding.onPick);
  const remindMany = useRemindMany(onRemind);
  const selection = useInboxSelection({
    listed: picks,
    shown: head.shown,
    onClear: unpick,
    onMark,
    onClose,
    onRemindMany: onRemind === undefined ? undefined : remindMany,
    onPick:
      onRemind === undefined
        ? undefined
        : (chosen, onAt) => {
            const anchor = chosen.find((item) => rows.find(item.id) !== undefined) ?? chosen[0];
            if (anchor !== undefined) reminding.onPick(anchor, onAt);
          },
  });
  const several: InboxChosen | undefined =
    picks.length > 1 ? { count: picks.length, acts: selection.acts } : undefined;
  const phone = usePhoneRoom();
  const footed = head.phone !== undefined || (head.tab === true && phone);
  const closing = useInboxCloseAsk(
    onClose,
    head.shown,
    (itemId) => listedItems(view).find(({ item }) => item.id === itemId)?.item,
  );
  const row = (listed: InboxListed, leaving: boolean, at?: VirtualRowPlace) => (
    <InboxItemRow
      key={listed.item.id}
      place={at}
      listed={listed}
      chosen={listed.item.id === chosen}
      open={listed.item.id === chosen && columns === INBOX_COLUMNS.BOTH}
      current={listed.item.id === chosen && marked}
      {...inboxRowDraft(
        drafts.get(listed.item.id),
        listed.item,
        listed.item.id === chosen && columns === INBOX_COLUMNS.BOTH,
      )}
      models={models}
      readerId={readerId}
      muted={isDone(listed.item)}
      needsYouShown={needsYouListed(head)}
      ref={leaving ? undefined : rows.hold(listed.item.id)}
      selectKey={leaving ? undefined : listed.item.id}
      onChoose={choose}
      onMark={mark}
      onAskClose={onClose === undefined ? undefined : closing.ask}
      onRemind={onRemind === undefined ? undefined : remind}
      onPickRemind={onRemind === undefined ? undefined : pickRemind}
      several={several !== undefined && picked.has(listed.item.id) ? several : undefined}
    />
  );
  const body = (
    <div
      {...roving}
      ref={rovingBody}
      className="inbox-tasks-body min-h-list-held-least px-column-inset pt-row-inset pb-column-inset data-[empty=true]:flex data-[empty=true]:min-h-full data-[empty=true]:flex-col"
      data-empty={String(listedItems(view).length === 0)}
      {...motionRows()}
    >
      <InboxRows items={view.items} place={rowsPlace} row={row} />
      {note}
    </div>
  );
  return (
    <nav
      ref={rowFocus.ref}
      className="inbox-tasks relative flex min-h-0 min-w-0 flex-col border-r border-border"
      aria-label={regionLabel(head)}
      hidden={columns === INBOX_COLUMNS.ITEM}
      onFocus={rowFocus.onFocus}
      onBlur={rowFocus.onBlur}
      onPointerEnter={() => onPointing?.(true)}
      onPointerLeave={() => onPointing?.(false)}
      style={{ width: drawnWidth(width, columns !== INBOX_COLUMNS.BOTH) }}
    >
      <ListHead
        head={head}
        readerId={readerId}
        selecting={
          footed
            ? undefined
            : {
                count: picks.length,
                total: drawn.length,
                onAll: (every) => setPicked(new Set(every ? drawn.map(({ item }) => item.id) : [])),
                acts: selection.acts,
                onClear: unpick,
                controls: regionId,
              }
        }
      />
      <ListMotion root={bodyRef} change={laidOut} reading={reading}>
        <SelectionRegion
          id={regionId}
          selection={{ selected: picked, onChange: setPicked }}
          order={[drawn.map(({ item }) => item.id)]}
          bringIn={rows.bringIn}
        >
          <ScrollArea ref={scroller} fade={SCROLL_FADE.START}>
            {body}
          </ScrollArea>
        </SelectionRegion>
      </ListMotion>
      {footed && picks.length > 0 ? (
        <Stack inset={INSET.COLUMN}>
          <ReplayUnmask>
            <SelectionBar
              count={picks.length}
              acts={selection.acts}
              onClear={unpick}
              controls={regionId}
            />
          </ReplayUnmask>
        </Stack>
      ) : null}
      {selection.dialog}
      {closing.dialog}
      {reminding.popover}
      {columns === INBOX_COLUMNS.BOTH ? <ResizeEdge edge={edge} /> : null}
    </nav>
  );
}
