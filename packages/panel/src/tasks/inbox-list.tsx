import { type InboxItem, inboxAddressedTo } from "@luke/features/inbox-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { agoText } from "@luke/features/time-format";
import { sameShape } from "@luke/features/turn-rows";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  ANNOUNCE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  Chip,
  ChipName,
  ComposeIcon,
  EMPTY_STATE_ACTION_LOOK,
  EmptyState,
  type EmptyStateAction,
  ERROR_STATE_PLACEMENT,
  ErrorLine,
  ErrorState,
  FramePlace,
  IconButton,
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
  ROVING_REACH,
  RowHint,
  RowHintOptions,
  SCROLL_FADE,
  ScrollArea,
  SearchField,
  SelectionRegion,
  Shortcut,
  Skeleton,
  SkeletonRegion,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TOOLBAR_INSET,
  Toolbar,
  type ToolbarPlace,
  Tooltip,
  UnreadMark,
  useLeaving,
  useMenu,
  useMinute,
  useResizeEdge,
  useRovingKeys,
} from "@luke/ui";
import { actorName, personActor } from "@luke/ui/actor-model";
import { CheckCheckIcon, GLYPH, InboxIcon, SlidersHorizontalIcon, UsersIcon } from "@luke/ui/icons";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "@luke/ui/virtual-rows";
import {
  Fragment,
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
  useAskedMenu,
  useMenuAsk,
} from "../desktop/phone-head.js";
import { type TabActionGroups, useTabActions } from "../desktop/strip-tabs.js";
import { TitleBarPlace, useTitleBar } from "../desktop/title-bar.js";
import { refusedShown, unreadShown } from "../failure-report.js";
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
} from "./inbox-model.js";
import { type InboxListMark, InboxSelectionBar } from "./inbox-selection.js";
import { cardTitle } from "./tool-call-model.js";

/**
 * inbox-list.tsx -- the Inbox's list of items: one row each, in one run, the latest changed first, with what the list shows at its head.
 *
 * The list is drawn from the sidebar's own pieces, on the Inbox's own ground, so it reads as the
 * sidebar does. An item is a row, as a
 * mail app lists a thread: the tile of the agent that posted it
 * (`actor-ref.tsx`), as the task's summary or main's read of an agent with
 * no task names the agent, its title, and how long ago it last changed,
 * and before its time the face of the teammate whose agent asks it, as the
 * sidebar marks a teammate's task, the reader's own wearing none; under
 * them, muted, the last word in its thread, who said it first
 * (`inboxPreview`); a press chooses it, for the pane beside the list to
 * show. The tile hangs the agent's tab's card while the pointer rests on
 * it (`agent-ref.tsx`), and leaves the press to its row, whose pane opens
 * the agent. An item that needs the developer's answer, an open one their
 * own agent asks (`needsReader`), wears the attention mark before its time
 * (`attention-mark.tsx`), filtered or not; a
 * teammate's open item waits on the teammate, whose face stands in that
 * place, and any member may still answer it; an answered one wears
 * neither. Apart from whether it waits, an item is unread where it changed
 * since the developer last read it, or they marked it so: the blue dot in
 * a gutter before its tile, its title in the unread weight; opening it
 * reads it, and its row, its menu, U, and Mark all as read, which the
 * sidebar's Inbox row and each channel's row offer on a right-click, ⌘K, and a
 * phone's ⋯, mark it read or unread (`use-inbox-read-marks.ts`). An item settled
 * and read is done with (`isDone`), and its row stands back, gray, with no
 * word saying so: the chosen row Open keeps once it is answered or read,
 * until another is chosen (`use-held-inbox-list.ts`), and every such row All lists.
 * The head names the Inbox, whatever it lists, and, at its right, offers the view's
 * menu: first what the list shows, Open, every thread still open, a
 * question or an update not yet opened, or All, every item; then Addressed
 * to, the developer's own, anyone's, or one teammate's by face and name,
 * which a chip over the list then says, its × listing the developer's own
 * again. Open addressed to the developer is Needs you, the threads the
 * sidebar's Inbox row counts, where the Inbox opens. Each choice stands
 * checked, and every choice is kept across launches. An Inbox narrowed to one
 * task names it in a chip over the list too, before Addressed to's, its ×
 * listing every task's items again. Every row, in the window's Inbox and a
 * task's own alike, names its task on its first line, over its title.
 * Where the scope leaves out every
 * item listed, the list says so in the Inbox's empty state, offering the
 * view that holds something, as a mail app's empty unread view does; the
 * item the pane shows keeps its place there, though no row. A channel
 * and a task's own Inbox list every item they hold, with no view's menu,
 * and say "Nothing here" where they hold none. Either list
 * is resized from its right edge as the sidebar is, and keeps one width
 * between them across launches; an Inbox showing one column at a time
 * draws its list the whole Inbox wide, with no edge, and hides it while an
 * item stands in its place (`inbox-columns.ts`). A list on a page chooses
 * rows as a Mac's list does (`SelectionRegion`): ⌘-click one in or out,
 * ⇧-click a run, ⇧↑↓ grow it, ⌘A every row drawn, and Esc none,
 * while a plain press still opens its item; while any is
 * chosen, a bar at the list's foot marks them all read or unread, or
 * resolves them, at once (`inbox-selection.tsx`).
 */

/** What an item's row is, which names its ⋯ and its menu "Inbox item actions". */
const ITEM_THING = "Inbox item";

/** What an archived channel's head offers, and says while it is under way. */
const ARCHIVED_WORDS = {
  UNARCHIVE: "Unarchive",
  UNARCHIVING: "Unarchiving",
} as const;

/** What the list's region is named. */
const INBOX_ITEMS = "Inbox items";

/** What an unread row says to a reader, its dot being drawn for the eye alone. */
const UNREAD = "Unread";

/** What a phone's ⋯ offers to clear every dot with, as the sidebar's rows offer it on a right-click. */
const MARK_ALL_READ = "Mark all as read";

/** What the list's placeholder rows say to a reader while its items are first read. */
const READING_ITEMS = "Reading your inbox…";

/** How wide each placeholder row's task line, the title under it, and the preview under that stand, as shares of their lines, so the rows read as items of their own. */
const SKELETON_ROWS = [
  { task: "40%", title: "68%", preview: "84%" },
  { task: "32%", title: "52%", preview: "70%" },
  { task: "44%", title: "74%", preview: "90%" },
  { task: "28%", title: "46%", preview: "62%" },
  { task: "36%", title: "60%", preview: "78%" },
] as const;

/** How wide a placeholder row's time stands, as wide as a short "2h". */
const SKELETON_TIME = "20px";

/** What each scope is called, in the view's menu and the list's region's name, and its glyph in the menu. */
const SCOPE_WORDS = {
  [INBOX_SHOW.OPEN]: { label: "Open", icon: <GLYPH.TODOS /> },
  [INBOX_SHOW.ALL]: { label: "All", icon: <InboxIcon /> },
} as const satisfies Record<InboxShow, { label: string; icon: React.JSX.Element }>;

/** The scopes the window's Inbox's view's menu offers, in its order. */
const INBOX_SCOPES = [INBOX_SHOW.OPEN, INBOX_SHOW.ALL] as const satisfies readonly InboxShow[];

/** The Inbox's name at its head, whatever it lists, the view's menu saying the rest. */
const INBOX_TITLE = "Inbox";

/**
 * Whether the list holds only what needs the reader, the window's Inbox's
 * Open addressed to them: its rows then leave Needs you unsaid
 * (`needsYouShown`), and its region says it once.
 */
function needsYouListed(head: InboxListHead): boolean {
  return head.view?.show === INBOX_SHOW.OPEN && head.view.whose.kind === INBOX_WHOSE.MINE;
}

/** Whom Addressed to names, in the words a reader hears after the list's region's name. */
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

/**
 * The list's region's name, saying what it lists, since the head names the
 * Inbox alone: Needs you where it holds only what needs the reader, whose
 * rows leave it unsaid (`needsYouShown`), so a reader hears it once; else
 * the window's Inbox's scope and whom Addressed to names. A channel and a
 * task's own Inbox list everything, so their region is named alone.
 */
function regionLabel(head: InboxListHead): string {
  const { view } = head;
  if (view === undefined) return INBOX_ITEMS;
  if (needsYouListed(head)) return `${INBOX_ITEMS} · ${NEEDS_YOU.LABEL}`;
  return `${INBOX_ITEMS} · ${SCOPE_WORDS[view.show].label} · ${whoseWords(view.whose)}`;
}

/** What a channel or a task's own Inbox says holding nothing, since it lists everything it holds. */
export const NOTHING_HERE = "Nothing here";

/**
 * What the list says where its scope and Addressed to leave out every item
 * it holds, by whom Addressed to names: the reader's Open is Needs you, and
 * anyone's Open every thread still open.
 */
const SHOW_EMPTY = {
  [INBOX_WHOSE.MINE]: {
    [INBOX_SHOW.OPEN]: NEEDS_YOU.NONE,
    [INBOX_SHOW.ALL]: "Nothing addressed to you",
  },
  [INBOX_WHOSE.EVERYONE]: { [INBOX_SHOW.OPEN]: "Nothing open", [INBOX_SHOW.ALL]: NOTHING_HERE },
  [INBOX_WHOSE.PERSON]: {
    [INBOX_SHOW.OPEN]: "Nothing addressed to them",
    [INBOX_SHOW.ALL]: "Nothing addressed to them",
  },
} as const satisfies Record<InboxWhose["kind"], Record<InboxShow, string>>;

/** What the empty state's presses say: All of whom Addressed to names, the reader's own again, or anyone's. */
const SHOW_INSTEAD = {
  ALL: "Show all",
  MINE: "Show mine",
  EVERYONE: "Show anyone's",
} as const;

/** What the view's submenu of whom the items are addressed to is called. */
const WHOSE = "Addressed to";

/** What the chip over the list says its × does, in full, since a reader hears it apart from the empty state's short press. */
const CLEAR_WHOSE = "Show what's addressed to me";

/**
 * What the list leaves the item beside it, in CSS pixels: the list is
 * dragged no wider than the Inbox less this, so the item keeps the room a
 * question, a code card, and its options read in. An Inbox too narrow for
 * both at their least shows one at a time (`inbox-columns.ts`).
 */
const PANE_RESERVE = 560;

/**
 * The width the list is drawn at: the one kept, held no wider than the
 * Inbox less the pane's reserve, though never under the least, so a window
 * narrowed under a wide list still leaves the pane its room, and widened
 * again gives the list back as it was kept; the whole Inbox wide where it
 * stands alone. The Inbox is the container the width is measured against
 * (`.inbox-view` in desktop.css).
 */
function drawnWidth(width: number, alone: boolean): string | undefined {
  if (alone) return undefined;
  return `min(${width}px, max(${INBOX_LIST_WIDTH.MIN}px, 100cqw - ${PANE_RESERVE}px))`;
}

/** No step ticked, the one list every row ticking none is handed, so its props hold while its draft ticks nothing. */
const NO_TICKS: readonly number[] = [];

/**
 * What an item's row shows of its draft as its list read every row's at
 * once (`useInboxRowDrafts`): whether it wears the pencil, which it does
 * not while its box stands `open` beside the list, and the steps of its
 * open to-do the draft ticks. Note that a draft of words alone ticks
 * nothing, so a word typed in the open box hands its row nothing new.
 */
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

/**
 * One item as a `ListRow` of three lines, as a mail app lists a thread,
 * one thing to a line so nothing is cut short to make room for another:
 * what holds it, its task's status and whole name, and whom its agent
 * addressed it to, with how long ago it changed at that line's end, as a
 * mail app puts the time on the sender's line; then the title; then the
 * last word in its thread, muted, led on a thread by what its open ask
 * asks, the steps its draft ticks counted (`inboxPreview`). The agent
 * that asked, and whether it needs the developer, are its card's to say
 * (`InboxItemCard`), a reader still hearing the latter, since an open item
 * nearly always does and a mark on every row would say nothing. A
 * teammate's item wears their face before its time where `face` allows it,
 * the mark of their open item being theirs to wear. The title hangs in the
 * window's pill, since a narrow list cuts it short. An unread item, changed
 * since the developer last read it or marked unread, wears the blue dot in
 * a gutter before its words, its title in the unread weight and its
 * preview in the body's ink; the gutter stands on every row, so the words
 * line up whether a row wears a dot or not. Where
 * an answer or a message waits unsent in the item's box and that box is not
 * the one standing beside the list, which shows its own words, the row wears
 * the Draft pencil before its marks, as a sidebar task's row does
 * (`draft-mark.tsx`).
 * The row's acts stand in its menu alone, its ⋯ the one press over its
 * time while the pointer rests on it or it holds the keyboard, so the title
 * keeps the room a row of buttons would cover. A finger's row draws no ⋯,
 * as a phone's mail list draws none, its time running to the row's edge:
 * a long press opens its menu, the menu key on the row still does, and the
 * open item's own bar keeps its ⋯. Where the list hands down
 * `onMark`, the row offers to mark it read or unread: an item of its menu,
 * which names the key that does the same to the chosen item
 * (`APP_COMMAND.TOGGLE_READ`). Its menu, opened by the row's ⋯, a
 * right-click, a long press, and the menu key
 * alike (`ListRow`'s `menu`), offers
 * Copy link, the item's link under the task or the agent that holds it, where
 * the list hands down a workspace to write it under. Where the list
 * hands down `onAskClose`, an open item's row offers to close it without an
 * answer, asked first through the list's one question (`inbox-close.tsx`),
 * as the last item of its menu. The row is drawn again only where it is
 * handed another prop (`memo`), as ⌘K's rows are: its listed item, which the
 * list keeps while the item and its holder do (`inboxListed`), whether it
 * is chosen, and what it shows of its draft as the list read it once for
 * every row (`inboxRowDraft`); its time counts from the window's minute on
 * its own (`Time`). Note that this is what keeps a long Inbox quick, because only
 * the rows whose item or state moved need draw again when the list does.
 */
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
  onAskMove,
  place,
}: {
  listed: InboxListed;
  chosen: boolean;
  /** Whether the item's box stands beside the list, so its draft is in sight and unmarked: the chosen item's unless said, and none while the list stands alone. */
  open?: boolean;
  /** Whether the row is drawn as the open one: the chosen item's unless said, and none where no item stands open on a screen with no hover, whose open row shows its acts in its time's place. */
  current?: boolean;
  /** Whether the row wears the Draft pencil, its item's box holding a draft and standing elsewhere than beside the list (`inboxRowDraft`). */
  drafted?: boolean;
  /** The steps of its open to-do its draft ticks (`inboxRowDraft`); none where it ticks none. */
  ticked?: readonly number[];
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards and rows name no starter, and whose own open items alone need them. */
  readerId: string | undefined;
  /** Whether a teammate's item wears their face, which a person's group header says instead. */
  face?: boolean;
  /** Whether the row is drawn gray, its item done with (`isDone`), as the Inbox's own list draws it; nothing says so in words, since its marks and its card do. */
  muted?: boolean;
  /** Whether the row stands under a name that already says Needs you, the scope's or a section's, so it leaves the words unsaid. */
  needsYouShown?: boolean;
  /** Handed the row's press, by which the list finds the row of an item. */
  ref?: React.RefCallback<HTMLElement> | undefined;
  /** What the row is chosen by where its list chooses rows (`SelectionRegion`); none where it is never chosen. */
  selectKey?: string | undefined;
  onChoose: (listed: InboxListed) => void;
  /** Marks the item read or unread; none where the row offers no mark. */
  onMark?: ((listed: InboxListed, unread: boolean) => void) | undefined;
  /** Asks to close an open item without an answer, through the list's one question; none where the row offers no close. */
  onAskClose?: ((item: InboxItem) => void) | undefined;
  /** Asks which channel to move the item's thread to; none where the row offers no move, as with Channels off. */
  onAskMove?: ((listed: InboxListed) => void) | undefined;
  /** Where the row stands in a run drawing only the rows near the view (`VirtualRows`); none where every row is drawn. */
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
  // Note that U acts only on the chosen item, so only its row names the chord.
  const { groups } = useInboxItemActions(item, {
    onMark: onMark === undefined ? undefined : (_item, next) => onMark(listed, next),
    onMove: onAskMove === undefined ? undefined : () => onAskMove(listed),
    onAskClose,
    keyed: chosen,
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
          // Note that a thread its agent addressed by name says so after its task, since its task's assignee may be someone else.
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
        onPress={() => onChoose(listed)}
        menu={rowMenu(ITEM_THING, groups())}
        more={!coarse}
        place={place}
      />
    </RowHintOptions>
  );
});

/** Addressed to's choices, as every filter by person offers them: Anyone, Me, then each teammate, the choice checked. Note that Me stands though the reader's id is unknown, since the reader's own items are read without one (`readersItem`). */
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
  });
}

/**
 * The window's Inbox's head's button that drops the view's menu: first what
 * it shows, Open or All, the one shown checked; then Addressed to, a
 * submenu of Anyone, Me, or a teammate by face and name, its choice checked.
 */
function ViewOptions({
  shown,
  choices,
  readerId,
  asked,
}: {
  shown: boolean;
  choices: InboxViewChoices;
  readerId: string | undefined;
  /** Where a phone's ⋯ stands for the button, the menu drawn under the ⋯ each time it asks (`phone-head.tsx`), and no button of its own; none elsewhere. */
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
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={[scope, ...windowEntries(choices, reader, readerId)]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** Mark all as read, as a phone's ⋯ offers it, a phone having no right-click, pressable while anything is unread. */
function markAllAction(readAll: InboxReadAll): MenuAction {
  return {
    label: MARK_ALL_READ,
    icon: <CheckCheckIcon />,
    disabled: !readAll.unread,
    onSelect: readAll.onMarkAll,
  };
}

/** The window's Inbox's own group of its view's menu, after its scopes: Addressed to. */
function windowEntries(
  choices: InboxViewChoices,
  reader: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): MenuEntry[][] {
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

/** The keys the chips over the list are followed by, as each arrives and leaves. */
const FILTER_CHIP_KEY = { TASK: "task", WHOSE: "whose" } as const;

/** What the task's chip's × says it does. */
const CLEAR_TASK = "Show every task's items";

/** What the task's chip names while the task is not listed yet. */
const UNNAMED_TASK = "Task";

/** A chip over the list as last drawn, so it leaves looking as it did: its mark, its words, and its ×. */
interface FilterChipEntry {
  readonly key: (typeof FILTER_CHIP_KEY)[keyof typeof FILTER_CHIP_KEY];
  readonly mark: React.ReactNode;
  readonly words: string;
  readonly removeLabel: string;
  readonly onRemove: () => void;
}

/** What a press on the chip leaving does, out of reach as it is: nothing. */
function stays(): void {}

/** The chip Addressed to calls for, the teammate's face and name; none while it names the reader or anyone. */
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

/** The chip the task the Inbox is narrowed to calls for, by its name; none while it lists every task's. */
function taskChipEntries(
  name: string | undefined,
  onClear: (() => void) | undefined,
): FilterChipEntry[] {
  if (onClear === undefined) return [];
  return [
    {
      key: FILTER_CHIP_KEY.TASK,
      mark: <GLYPH.TASK />,
      words: name ?? UNNAMED_TASK,
      removeLabel: CLEAR_TASK,
      onRemove: onClear,
    },
  ];
}

/**
 * The chips themselves. Note that this is its own component under the line's
 * `ListMotion`, because `useLeaving` finds the motion through the context
 * the motion provides.
 */
function FilterChipLine({
  line,
  whose,
  task,
  readerId,
}: {
  line: RefObject<HTMLDivElement | null>;
  whose: InboxWhoseChoice;
  task: InboxTaskHead | undefined;
  readerId: string | undefined;
}): React.JSX.Element {
  const directory = useMemberDirectory();
  const { whose: chosen, onWhose } = whose;
  const taskName = task?.name;
  const onClearTask = task?.onClear;
  // Note that the entries are made once for what they are made from, because `useLeaving` reads a new list as a change.
  const listed = useMemo(
    () => [
      ...taskChipEntries(taskName, onClearTask),
      ...whoseChipEntries({ whose: chosen, onWhose }, directory, readerId),
    ],
    [taskName, onClearTask, chosen, onWhose, directory, readerId],
  );
  const drawn = useLeaving(listed, (entry) => entry.key);
  // Note that the box around the row stands hidden while no task and no teammate is chosen, so the row's padding takes no room, and the chip arriving arrives into a row that stands.
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

/**
 * The chips over the list: the task the Inbox is narrowed to, by its name,
 * and a × that lists every task's items again; and, while Addressed to
 * names a teammate, their face and name, and a × that lists the reader's
 * own again (`@luke/ui`'s removable filter chip, as the sidebar's Created
 * by stands over its tasks). Each scales in as it is chosen and out as its
 * × lifts it, as the Tasks page's filter chips do.
 */
function FilterChips({
  whose,
  task,
  readerId,
}: {
  whose: InboxWhoseChoice;
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

/**
 * The way on from an empty scope: All of whom Addressed to names where it
 * holds anything; else back to the reader's own from a teammate's, or to
 * anyone's from the reader's own; none from anyone's, where nothing else
 * holds anything.
 */
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
  if (view.show !== INBOX_SHOW.ALL && counts[INBOX_SHOW.ALL] > 0) {
    return turn(SHOW_INSTEAD.ALL, () => view.onShow(INBOX_SHOW.ALL));
  }
  if (view.whose.kind === INBOX_WHOSE.PERSON) {
    return turn(SHOW_INSTEAD.MINE, () => view.onWhose(MINE));
  }
  if (view.whose.kind === INBOX_WHOSE.MINE) {
    return turn(SHOW_INSTEAD.EVERYONE, () => view.onWhose(EVERYONES));
  }
  return undefined;
}

/** What the list stands where its scope and Addressed to leave out every item it holds: that nothing is there, in the words of whom it names (`SHOW_EMPTY`), and the press that shows what holds something (`emptyWayOn`), which keeps the list standing where the Inbox shows one column. */
function ShowEmpty({
  view,
  counts,
  onList,
}: {
  view: InboxViewChoices;
  counts: InboxCounts;
  /** Asks the Inbox for its list, so the item chosen once the rows return does not stand in their place. */
  onList: () => void;
}): React.JSX.Element {
  return (
    <EmptyState icon={<InboxIcon />} action={emptyWayOn(view, counts, onList)}>
      {SHOW_EMPTY[view.whose.kind][view.show]}
    </EmptyState>
  );
}

/**
 * The list while its items are first read: rows in an item's own row, a
 * block where its task line and its time, its title, and its preview will stand,
 * so the
 * items land where the blocks stood rather than a lone ring in the list's
 * corner. The rows open nothing and the region says what is being read. A
 * short list asks for fewer rows than the five a whole Inbox stands.
 */
export function InboxListSkeleton({
  rows = SKELETON_ROWS.length,
  reading = READING_ITEMS,
  list = TAB_WORDS.INBOX,
}: {
  /** How many placeholder rows stand, at most five. */
  rows?: number;
  /** What a reader hears is being read, where the list is another's than the Inbox's. */
  reading?: string;
  /** What the list is called, where it is another's than the Inbox's. */
  list?: string;
}): React.JSX.Element {
  return (
    <SkeletonRegion label={reading}>
      <List label={list}>
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

/** The words naming the list's search. */
const SEARCH_INBOX = "Search inbox";

/**
 * The list's search under a page's head, on the window's Inbox and a task's
 * own, a phone's head's as a desk's: a field always standing, as Settings'
 * search does, so nothing in the head moves or hides as it is used. It
 * narrows the list as it is typed in, and Escape empties it; an empty one
 * leaves Escape to the surface behind it. Note that the field holds its own
 * words and hands them to the list in a transition, so a key paints in the
 * field at once and the list is ranked for it a render behind, in a render
 * the next key may cut short, as ⌘K ranks its rows.
 */
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

/**
 * The list's head: the Inbox's name, whatever it lists, or a channel's, and
 * on the window's Inbox the view's menu at the list's top right, which
 * chooses the scope and whom the items are addressed to; a channel and a
 * task's own Inbox list everything they hold, and offer no menu. On the window's Inbox its heading and its button glide as the
 * sidebar folds, the name moving to the list's middle, clear of the
 * sidebar's toggle, and the button keeping to the list's edge. Where the
 * list offers a search, its field stands under the head (`ListSearch`).
 */
function ListHead({
  head,
  readerId,
}: {
  head: InboxListHead;
  readerId: string | undefined;
}): React.JSX.Element {
  const { shown, view, channel } = head;
  const title = channel === undefined ? INBOX_TITLE : `#${channel.name}`;
  const asked = useMenuAsk();
  const search = head.search === undefined ? null : <ListSearch search={head.search} />;
  // A task's own Inbox tab hands the open item's link to the tab's ⋯.
  const linkGroups: TabActionGroups =
    head.tab === true && head.link !== undefined ? [[head.link]] : [];
  useTabActions(linkGroups.length === 0 ? undefined : linkGroups);
  // On a phone the task's header, whose title already names the tab, stands for its head; its search field stands over the list as on every page.
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
              className="luke-toolbar-title"
            >
              {title}
            </Text>
          }
          end={
            <PlaceMore
              thing={channel === undefined ? "Inbox" : `#${channel.name}`}
              shown={shown}
              groups={(opener) =>
                [
                  channel?.unarchive === undefined
                    ? []
                    : [
                        {
                          label: ARCHIVED_WORDS.UNARCHIVE,
                          icon: <GLYPH.ARCHIVE />,
                          onSelect: channel.unarchive.onUnarchive,
                        },
                      ],
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
        <ErrorLine
          level={ANNOUNCE.ALERT}
          error={refusedShown(channel?.refusal, FAILURE_SURFACE.CHANNEL_POST)}
        />
        {view === undefined ? null : (
          <FilterChips whose={view} task={head.task} readerId={readerId} />
        )}
      </>
    );
  }
  const unarchive = channel?.unarchive;
  const options = (
    <>
      {unarchive === undefined ? null : (
        <Button
          size={BUTTON_SIZE.COMPACT}
          variant={BUTTON_VARIANT.OUTLINE}
          busy={unarchive.busy}
          busyLabel={ARCHIVED_WORDS.UNARCHIVING}
          onClick={unarchive.onUnarchive}
        >
          {ARCHIVED_WORDS.UNARCHIVE}
        </Button>
      )}
      {view === undefined ? null : <ViewOptions shown={shown} choices={view} readerId={readerId} />}
    </>
  );
  return (
    <>
      {/* Note that a task's own Inbox is a tab, whose bar is every tab's; the window's Inbox is a page, whose head glides with the sidebar. */}
      {head.tab === true ? (
        <PaneBar title={title} actions={options} />
      ) : channel?.archivedAt === undefined ? (
        <InboxBar title={title} detail={channel?.detail} task={head.task} actions={options} />
      ) : (
        <ArchivedChannelBar title={title} archivedAt={channel.archivedAt} actions={options} />
      )}
      {search}
      <ErrorLine
        level={ANNOUNCE.ALERT}
        error={refusedShown(channel?.refusal, FAILURE_SURFACE.CHANNEL_POST)}
      />
      {view === undefined ? null : (
        <FilterChips whose={view} task={head.task} readerId={readerId} />
      )}
    </>
  );
}

/**
 * The window's Inbox's bar, its actions at its end, and the Inbox's name:
 * at the bar's head, or in the window's title bar where one stands, the
 * task the Inbox is narrowed to after it, the Inbox's own name a press
 * back to every task's items, as the task's chip under the bar clears it.
 */
function InboxBar({
  title,
  detail,
  task,
  actions,
}: {
  title: string;
  detail: string | undefined;
  task?: InboxTaskHead | undefined;
  actions: React.ReactNode;
}): React.JSX.Element {
  const up = useTitleBar() !== null;
  const trail: ToolbarPlace[] | undefined =
    task === undefined ? undefined : [{ label: title, onPress: task.onClear }];
  return (
    <>
      <TitleBarPlace>
        <FramePlace
          title={task === undefined ? title : (task.name ?? UNNAMED_TASK)}
          trail={trail}
          detail={detail}
        />
      </TitleBarPlace>
      <Toolbar
        title={up ? undefined : title}
        detail={up ? undefined : detail}
        actions={actions}
        end={TOOLBAR_INSET.COLUMN}
      />
    </>
  );
}

/**
 * The window's Inbox's bar over a channel archived, saying when it was in
 * its purpose's place, counted from the window's minute, which draws this
 * bar alone again as it moves.
 */
function ArchivedChannelBar({
  title,
  archivedAt,
  actions,
}: {
  title: string;
  archivedAt: number;
  actions: React.ReactNode;
}): React.JSX.Element {
  return (
    <InboxBar
      title={title}
      detail={`Archived ${agoText(archivedAt, useMinute())}`}
      actions={actions}
    />
  );
}

/** What a list its search left empty says, under its rows, on the window's Inbox. */
function SearchEmpty({ searched }: { searched: string }): React.JSX.Element {
  return <NoteLine look={NOTE_LINE_LOOK.ROWS}>{`No items match “${searched.trim()}”.`}</NoteLine>;
}

/** The words of the way on from an Inbox with nothing in it. */
const NEW_TASK_LABEL = "New task";

/**
 * The way on from an Inbox with nothing in it, where the window rests with
 * no task open (`resting-page.ts`): New task, opening its dialog, primary
 * because starting one is all there is to do from an Inbox with nothing to
 * answer. None where nothing can start.
 */
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

/** What the pane beside a list with items in it says while none is chosen. */
const CHOOSE_AN_ITEM = "Choose an item";

/**
 * The pane beside the list while nothing is chosen, as a mail app's stands
 * empty: how to choose an item, by a press or by stepping with the keys that
 * step through the list (J and K), or, holding none, that nothing needs the
 * reader, over New task where one can start, or "Nothing here" on a list of
 * everything a channel or a task holds. Under a finger there is no
 * keyboard to step with, so it names the press alone.
 */
export function InboxPaneEmpty({
  listed,
  newTask,
  none = NEEDS_YOU.NONE,
}: {
  /** How many items the list holds. */
  listed: number;
  newTask?: (() => void) | undefined;
  /** What it says holding none: that nothing needs the reader, or `NOTHING_HERE` on a list of everything its place holds. */
  none?: string | undefined;
}): React.JSX.Element {
  const coarse = useCoarsePointer();
  if (listed === 0) {
    return (
      <EmptyState icon={<InboxIcon />} action={newTaskAction(newTask)}>
        {none}
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={<InboxIcon />}>
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
  );
}

/** What stands under the list's rows: a read that did not answer, placeholder rows while nothing is read, the scope's empty state where it leaves out every item, or the Inbox's empty state where the list stands alone; nothing for an empty Inbox beside the pane, which says it. */
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
  /** Whether the list stands alone, the Inbox too narrow for the pane beside it. */
  alone: boolean;
  /** Opens New task, the way on from the Inbox's empty state where the list stands alone; none where nothing can start. */
  onNewTask?: (() => void) | undefined;
  /** The scope shown and whom the items are addressed to, where they leave out every item the Inbox holds, for its empty state to show another. */
  filteredOut: InboxViewChoices | undefined;
  /** How many items each scope lists, for the empty state to offer one that lists something. */
  counts: InboxCounts;
  /** Asks for the list, so the scope its empty state shows leaves it standing. */
  onList: () => void;
  onRetry: () => void;
  /** The words the list's search narrows it by, where it narrows it, which an empty list says found nothing. */
  searched?: string | undefined;
  /** What the list standing alone says holding none: that nothing needs the reader, or `NOTHING_HERE` on a channel's. */
  none?: string | undefined;
}): React.JSX.Element | null {
  if (failed) {
    return (
      <ErrorState
        failure={unreadShown(FAILURE_SURFACE.INBOX_READ)}
        onRetry={onRetry}
        placement={ERROR_STATE_PLACEMENT.ROWS}
      >
        {INBOX_NOT_READ}
      </ErrorState>
    );
  }
  if (!empty) return null;
  if (reading) return <InboxListSkeleton />;
  if (searched !== undefined) return <SearchEmpty searched={searched} />;
  if (filteredOut !== undefined)
    return <ShowEmpty view={filteredOut} counts={counts} onList={onList} />;
  // Note that beside the pane the list stands bare, since the pane's empty state says it once.
  if (!alone) return null;
  // Note that the list standing alone is the whole Inbox, so it says so as the hidden pane would.
  return (
    <EmptyState icon={<InboxIcon />} action={newTaskAction(onNewTask)}>
      {none}
    </EmptyState>
  );
}

/** What the list's head offers: on the window's Inbox, its scope and whom the items are addressed to. */
export interface InboxListHead {
  /** Whether the list is on screen, for its menu not to outlive it. */
  readonly shown: boolean;
  /** The window's Inbox's view choices, and the presses that change them; none on a channel or a task's own, which list every item they hold. */
  readonly view: InboxViewChoices | undefined;
  /** The list's search, under its head, on the window's Inbox and a task's own alike; none where the list offers none. */
  readonly search?: InboxSearchHead | undefined;
  /**
   * A phone's head (`phone-head.tsx`), where the window's Inbox stands on a
   * phone's places: its one start control, New task, the title centred, and
   * the ⋯ holding View options and Mark all as read, which a phone has no
   * right-click to reach, the search standing under it; none elsewhere.
   */
  readonly phone?:
    | { readonly start: React.ReactNode; readonly readAll?: InboxReadAll | undefined }
    | undefined;
  /**
   * Whether the list stands in a task's own Inbox tab, which a phone heads
   * with the task's header, so the list draws no head of its own there, only
   * its search under where the head stood.
   */
  readonly tab?: boolean | undefined;
  /** Copy link, the open item's, which a task's own Inbox tab hands its ⋯ first (`useTabActions`); none while no item is open, since a link names no task's Inbox whole. */
  readonly link?: MenuAction | undefined;
  /** The channel the window's Inbox is narrowed to, which names its head; none where it lists every channel. */
  readonly channel?: InboxChannelHead | undefined;
  /** The task the window's Inbox is narrowed to, which a chip over the list names and clears; none where it lists every task's items. */
  readonly task?: InboxTaskHead | undefined;
}

/** The task the window's Inbox is narrowed to, as the chip over its list names it: its name, none while it is not listed yet, and the × that clears it. */
export interface InboxTaskHead {
  readonly id: string;
  readonly name: string | undefined;
  readonly onClear: () => void;
}

/** A channel heading the Inbox narrowed to it: its name, the words after it, and what its head offers of its own. */
export interface InboxChannelHead {
  readonly name: string;
  /** Its purpose; none where it has none, or where it is archived, which its head says in its place. */
  readonly detail: string | undefined;
  /** When it was archived; none on an open one. */
  readonly archivedAt: number | undefined;
  /** An archived channel's Unarchive, and whether it is under way; none on an open one. */
  readonly unarchive: { readonly busy: boolean; readonly onUnarchive: () => void } | undefined;
  /** What refused the head's action, under the head; none where nothing did. */
  readonly refusal: string | undefined;
}

/** The words a list's search holds, and the change that narrows the list to them. */
interface InboxSearchHead {
  readonly query: string;
  readonly onQuery: (query: string) => void;
}

/** Mark all as read as a phone's ⋯ offers it: whether any item is unread, filtered out or not, and the mark. */
interface InboxReadAll {
  readonly unread: boolean;
  readonly onMarkAll: () => void;
}

/** What the list wears to keep the keyboard: its element, and its handlers for focus arriving and leaving. */
interface RowFocus {
  readonly ref: React.RefObject<HTMLElement | null>;
  readonly onFocus: (event: React.FocusEvent) => void;
  readonly onBlur: () => void;
}

/**
 * Keeps the keyboard in the list when the row holding it is no longer
 * drawn, as Needs you leaves out an item answered on another Mac while its
 * row is focused: the keyboard goes to View options, the control that
 * chooses what the list leaves out, as it does from a row leaving the list
 * while it fades. Note that a removed row fires no blur, so the row last focused is
 * remembered and looked for after every render.
 */
function useRowFocusKept(rows: InboxRowPresses): RowFocus {
  const ref = useRef<HTMLElement | null>(null);
  const focusedRow = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const list = ref.current;
    const row = focusedRow.current;
    if (list === null || row === undefined || list.hidden) return;
    // Note that a row leaving, or one in a group leaving, is drawn on, out of reach, while it fades, so the keyboard still in it is in no row.
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

/** How deep two runs of rows are read alike (`sameShape`): each row as the same holder and item. */
const LAID_OUT_DEPTH = 1;

/**
 * The rows as last drawn while a draw leaves them reading alike
 * (`sameShape`), each row read as the same listed item (`inboxListed`),
 * else as they are now. Note that this is what the list's motion is
 * handed, because it measures every row before and after a commit whose
 * `change` moved, and the list is handed a view built anew on every draw,
 * though it lists the same rows.
 */
function useLaidOut(items: readonly InboxListed[]): readonly InboxListed[] {
  const held = useRef(items);
  const steady = sameShape(held.current, items, LAID_OUT_DEPTH) ? held.current : items;
  useLayoutEffect(() => {
    held.current = steady;
  });
  return steady;
}

/** How tall a row is taken to be before it is drawn, in pixels: its three lines and its insets. */
const ROW_ESTIMATE_PX = 72;

/**
 * The room between two rows, in pixels: the tight gap (`--luke-tight-gap`),
 * a step further apart than a list's, because a row of three lines standing
 * clear on its ground is told from the next by the room between them alone.
 */
const ROW_GAP_PX = 4;

/**
 * Where the list's runs of rows stand: the scroller they stand in, the
 * list's body, whose resizing moves the runs below a group that grew or
 * folded, whether a find bar stands open, which draws every row so the find
 * covers them, and where each run is held while it stands, so a row out of
 * view can be brought in (`InboxRowPresses`).
 */
interface RowsPlace {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly body: RefObject<HTMLElement | null>;
  readonly finding: boolean;
  readonly holdRun: InboxRowPresses["holdRun"];
}

/**
 * A run of rows, each drawn on after it is no longer listed until its exit
 * has played (`ListMotion`), drawing only the rows near the view
 * (`VirtualRows`), as a mail app's list does, so a long list, or another
 * channel's, draws as quickly as a short one; every row while a find bar
 * stands open, and the row holding the keyboard wherever the list is
 * scrolled.
 */
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

/** The list: its head where it has one, then every row in one run, or a line where nothing is listed. */
export function InboxList({
  view,
  scene,
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
  onAskMove,
  onPointing,
}: {
  view: InboxListView;
  /** What the list lists, the channel it is narrowed to, none where it lists every channel's: another is another list, whose rows stand at once rather than move (`ListMotion`'s `scene`). */
  scene?: string | undefined;
  /** The id of the item the pane shows. */
  chosen: string | undefined;
  /** The catalog as last read, which names each agent's model on its card. */
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards name no starter, where a teammate's name theirs. */
  readerId: string | undefined;
  head: InboxListHead;
  /** What stands under the rows: the list's empty line, placeholder rows while it is read, or a read that did not answer. */
  note: React.ReactNode;
  /** Whether the list is still being read, as its reads land one after another while the window opens, so a row arriving fades in where it stands rather than sliding in as a new one does. */
  reading?: boolean;
  /** Which of the Inbox's columns stand. */
  columns: InboxColumnsShown;
  /** Where each row's press is kept, by the item it opens. */
  rows: InboxRowPresses;
  onChoose: (listed: InboxListed) => void;
  /** Marks an item read or unread from its row or the selection's bar, answering whether the service took it; none where the rows offer no mark. */
  onMark?: InboxListMark | undefined;
  /** Closes an open item without an answer from its row or the selection's bar; none where the rows offer no close. */
  onClose?: InboxCloser | undefined;
  /** Asks which channel a row's thread moves to, from its ⋯; none where the rows offer no move. */
  onAskMove?: ((listed: InboxListed) => void) | undefined;
  /** Told as the pointer comes onto the list and leaves it, while which its rows hold their places (`use-held-inbox-list.ts`); none where nothing holds them. */
  onPointing?: ((pointing: boolean) => void) | undefined;
}): React.JSX.Element {
  const regionId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const drawn = view.items;
  // Note that only rows drawn stay chosen, so an item gone from the list or filtered out is never acted on, and stays unchosen once back.
  const picks = drawn.filter(({ item }) => picked.has(item.id));
  if (picks.length !== picked.size) setPicked(new Set(picks.map(({ item }) => item.id)));
  const unpick = () => setPicked(new Set());
  const { width, onResize } = useInboxListWidth();
  const rowFocus = useRowFocusKept(rows);
  // Note that every row's draft is read here once, rather than by each row, so a word typed in the box beside the list draws no row.
  const drafts = useInboxRowDrafts();
  // Note that a finger's list standing alone marks no row open, since no item is, and the chosen row would show its acts in its time's place at rest (`list-row.css`).
  const marked = !useCoarsePointer() || columns !== INBOX_COLUMNS.LIST;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  // Note that the rows of every group are one Tab stop that ↑↓ walk, a key reaching past the rows drawn
  // going on to the list's own first or last row, or the one after or before, brought into view where it is not drawn.
  const roving = useRovingKeys<HTMLDivElement>({
    reach: (from, to) => {
      const ids = drawn.map(({ item }) => item.id);
      const at = from === undefined ? -1 : ids.indexOf(rows.itemOf(from) ?? "");
      const index =
        to === ROVING_REACH.FIRST
          ? 0
          : to === ROVING_REACH.LAST
            ? ids.length - 1
            : at < 0
              ? -1
              : (at + (to === ROVING_REACH.NEXT ? 1 : ids.length - 1)) % ids.length;
      const id = ids[index];
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
  // Note that the runs draw only the rows near the view, and every row while a find bar stands open over the list.
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
  // Note that the motion replays a commit only where the rows stand otherwise, never one that drew them where they stood.
  const laidOut = useLaidOut(view.items);
  // Note that the rows are handed doors that stand across draws, each calling the newest the list was handed,
  // because the page hands new ones on every draw and a row handed a new door draws again (`InboxItemRow`).
  const choose = useSteadyDoor(onChoose);
  const mark = useSteadyDoor(onMark);
  const askMove = useSteadyDoor(onAskMove);
  // Note that every row asks its close through the list's one question, rather than each drawing its own shut.
  const closing = useInboxCloseAsk(
    onClose,
    head.shown,
    (itemId) => listedItems(view).find(({ item }) => item.id === itemId)?.item,
  );
  // Note that a row whose item is done with is drawn gray, the chosen row kept on Needs you and every such row on All alike.
  // A row leaving the list is the list's motion's rather than one of the keyboard's rows (`ListMotion`).
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
      onAskMove={askMove}
    />
  );
  // Note that each scene draws its rows anew, so the rows of the channel left go with it rather than leave one by one.
  const body = (
    <div
      {...roving}
      ref={rovingBody}
      className="inbox-tasks-body min-h-list-held-least px-column-inset pt-row-inset pb-column-inset data-[empty=true]:flex data-[empty=true]:min-h-full data-[empty=true]:flex-col"
      data-empty={String(listedItems(view).length === 0)}
      {...motionRows()}
    >
      <Fragment key={scene ?? ""}>
        <InboxRows items={view.items} place={rowsPlace} row={row} />
      </Fragment>
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
      <ListHead head={head} readerId={readerId} />
      <ListMotion root={bodyRef} change={laidOut} scene={scene} reading={reading}>
        <SelectionRegion
          id={regionId}
          selection={{ selected: picked, onChange: setPicked }}
          order={drawn.map(({ item }) => item.id)}
          bringIn={rows.bringIn}
        >
          <ScrollArea ref={scroller} fade={SCROLL_FADE.START}>
            {body}
          </ScrollArea>
        </SelectionRegion>
      </ListMotion>
      {/* Note that the bar stands at the list's foot rather than over its rows, so choosing a row moves none under the pointer. */}
      <InboxSelectionBar
        listed={picks}
        controls={regionId}
        shown={head.shown}
        onClear={unpick}
        onMark={onMark}
        onClose={onClose}
      />
      {closing.dialog}
      {columns === INBOX_COLUMNS.BOTH ? <ResizeEdge edge={edge} /> : null}
    </nav>
  );
}
