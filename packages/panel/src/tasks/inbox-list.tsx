import { type InboxItem, type InboxPerson, inboxAddressedTo } from "@luke/features/inbox-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { agoText } from "@luke/features/time-format";
import { sameShape } from "@luke/features/turn-rows";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  ANNOUNCE,
  AttentionMark,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  Chip,
  ChipName,
  ComposeIcon,
  DocumentIcon,
  EMPTY_STATE_ACTION_LOOK,
  EmptyState,
  type EmptyStateAction,
  ERROR_STATE_PLACEMENT,
  ErrorLine,
  ErrorState,
  GAP,
  GROUP_SURFACE,
  GroupHeader,
  HoverCard,
  HoverCardHead,
  IconButton,
  joinRefs,
  LAYOUT_ELEMENT,
  LIST_LEAVING_SELECTOR,
  LIST_MOTION_WAY,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  List,
  ListMotion,
  ListRow,
  motionKey,
  motionRows,
  NOTE_LINE_LOOK,
  NoteLine,
  PaneBar,
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  RowHint,
  RowHintOptions,
  SCROLL_FADE,
  ScrollArea,
  SearchField,
  SelectionRegion,
  Shortcut,
  Skeleton,
  SkeletonRegion,
  Stack,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TOOLBAR_INSET,
  Toolbar,
  Tooltip,
  UnreadMark,
  useLeaving,
  useMenu,
  useMinute,
  useResizeEdge,
  useRovingKeys,
  VisuallyHidden,
} from "@luke/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  actorName,
  memberActor,
  personActor,
} from "@luke/ui/actor-model";
import {
  CheckCheckIcon,
  ClockArrowDownIcon,
  ClockArrowUpIcon,
  GLYPH,
  HourglassIcon,
  InboxIcon,
  ListIcon,
  MailIcon,
  MailOpenIcon,
  SlidersHorizontalIcon,
  UserIcon,
  UsersIcon,
} from "@luke/ui/icons";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
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
import { ACTOR_SIZE, ActorMark, AutomationCard, actorCard, automationActor } from "../actor-ref.js";
import { useAutomation } from "../automation-directory.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
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
  type InboxShowChoice,
  type InboxTaskFolds,
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
import { groupCount, sidebarFold } from "../desktop/sidebar-fold.js";
import { type TabActionGroups, useTabActions } from "../desktop/strip-tabs.js";
import { refusedShown, unreadShown } from "../failure-report.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { PEOPLE_FILTER, PEOPLE_FILTER_WORDS, peopleFilterActions } from "../member-rows.js";
import { usePhoneRoom } from "../stage-room.js";
import { useSteadyDoor } from "../steady-door.js";
import { TaskChipCard } from "./chip-cards.js";
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
  holderAutomationId,
  holderName,
  INBOX_GROUPING,
  INBOX_HOLDER,
  INBOX_NOT_READ,
  INBOX_SHOW,
  INBOX_SORT,
  INBOX_STATUS_GROUP,
  INBOX_WHOSE,
  type InboxCounts,
  type InboxGrouping,
  type InboxHolder,
  type InboxListed,
  type InboxListView,
  type InboxPersonGroup,
  type InboxShow,
  type InboxSort,
  type InboxStatusGroup,
  type InboxStatusGroupKind,
  type InboxWhose,
  inboxLineKind,
  inboxPreview,
  inboxShownTicks,
  isDone,
  isUnread,
  listedItems,
  NEEDS_YOU,
  needsYou as needsYouOf,
} from "./inbox-model.js";
import { type InboxListMark, InboxSelectionBar } from "./inbox-selection.js";
import { PlanGlyph } from "./tab-look.js";
import { cardTitle } from "./tool-call-model.js";

/**
 * inbox-list.tsx -- the Inbox's list of items: one row each, under its task's group header or in one run, with what the list shows and how at its head.
 *
 * The list is drawn from the sidebar's own pieces, on the Inbox's own ground, so it reads as the
 * sidebar does. A task's items stand under the sidebar's own group header
 * (`GroupHeader`), the task's glyph giving way to its chevron
 * under the pointer, a press folding the group, and each fold kept across
 * launches as a sidebar group's is; an automation's agents stand under its
 * clock tile, which hangs its card. An item is a row of two lines, as a
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
 * (`attention-mark.tsx`), in either grouping and filtered or not; a
 * teammate's open item waits on the teammate, whose face stands in that
 * place, and any member may still answer it; an answered one wears
 * neither. Apart from whether it waits, an item is unread where it changed
 * since the developer last read it, or they marked it so: the blue dot in
 * a gutter before its tile, its title in the unread weight; opening it
 * reads it, and its row, its menu, U, and Mark all as read in the view's
 * menu mark it read or unread (`use-inbox-read-marks.ts`). An item settled
 * and read is done with (`isDone`), and its row stands back, gray, with no
 * word saying so: the chosen row Needs you keeps once it is answered or read,
 * until another is chosen (`use-held-inbox-list.ts`), and every such row All lists. A folded task
 * counts what in it needs the developer, at rest, and says nothing where
 * none does. The head names the Inbox and, at its right, offers the view's
 * menu: first what the list holds, Needs you, the open threads that wait on
 * the developer, a question or an update not yet opened, as the sidebar's
 * Inbox row counts them, or All, every item,
 * the head naming All after the Inbox's name; then Group by, None, one
 * run, by task, by person, or by status (what needs the developer
 * under the attention mark, what waits on others, what is answered, each
 * folding as a task's group does); Order by, the latest
 * change first or the oldest first; Whose, everyone's
 * items, the developer's own, or one teammate's by face and name, which a
 * chip over the list then says, its × listing everyone's again; each
 * choice checked; and under them Mark all as read,
 * which clears the dots alone. Every
 * choice is kept across launches. An Inbox narrowed to one task names it in a
 * chip over the list too, before Whose's, its × listing every task's items
 * again. Grouped by person, each person's items
 * stand under their face, the reader's own first as You. Every row, in
 * any grouping and in a task's own Inbox alike, names its task on its
 * first line, over its title. Where the scope leaves out every
 * item listed, the list says so in the Inbox's empty state, offering the
 * scope that holds something, as a mail app's empty unread view does; the
 * item the pane shows keeps its place there, though no row. A task's own
 * Inbox lists one task's items in one run, so its view's menu offers Needs you
 * and All alone, kept apart
 * from the window's, and its list has no groups. Either list
 * is resized from its right edge as the sidebar is, and keeps one width
 * between them across launches; an Inbox showing one column at a time
 * draws its list the whole Inbox wide, with no edge, and hides it while an
 * item stands in its place (`inbox-columns.ts`). A list on a page chooses
 * rows as a Mac's list does (`SelectionRegion`): ⌘-click one in or out,
 * ⇧-click a run, ⇧↑↓ grow it, ⌘A every row drawn, and Esc none, across
 * every group, while a plain press still opens its item; while any is
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

/** What an unread row says to a reader, its dot being drawn for the eye alone. */
const UNREAD = "Unread";

/** What a row's swipe button says it does: marks the item read, or unread. */
const SWIPE_WORDS = { READ: "Read", UNREAD: "Unread" } as const;

/** What the view's menu offers to clear every dot with. */
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

/** What each scope is called, in the view's menu and, but for Needs you, after the Inbox's name at its head, and its glyph in the menu. */
const SCOPE_WORDS = {
  [INBOX_SHOW.TO_DO]: { label: NEEDS_YOU.LABEL, icon: <GLYPH.TODOS /> },
  [INBOX_SHOW.ALL]: { label: "All", icon: <InboxIcon /> },
} as const satisfies Record<InboxShow, { label: string; icon: React.JSX.Element }>;

/** The scopes every Inbox's view's menu offers, in its order. */
const INBOX_SCOPES = [INBOX_SHOW.TO_DO, INBOX_SHOW.ALL] as const satisfies readonly InboxShow[];

/** The Inbox's name at its head: the scope after it, but for Needs you, where the Inbox opens, since no other control on the head says it. */
function inboxTitle(show: InboxShow): string {
  return show === INBOX_SHOW.TO_DO ? "Inbox" : `Inbox · ${SCOPE_WORDS[show].label}`;
}

/** A channel's name at the head of the Inbox narrowed to it: the scope after it, but for All, where a channel opens. */
function channelTitle(name: string, show: InboxShow): string {
  return show === INBOX_SHOW.ALL ? `#${name}` : `#${name} · ${SCOPE_WORDS[show].label}`;
}

/**
 * What the list says where its scope leaves out every item it holds.
 * All leaves out only what Whose does.
 */
const SHOW_EMPTY = {
  [INBOX_SHOW.TO_DO]: NEEDS_YOU.NONE,
  [INBOX_SHOW.ALL]: "Nothing here",
} as const satisfies Record<InboxShow, string>;

/** What the empty state's press says, by the scope it shows instead. */
const SHOW_INSTEAD = {
  [INBOX_SHOW.ALL]: "Show all",
} as const;

/** The scope an empty scope offers instead: All from Needs you where it holds anything; none where nothing is there to show. */
function insteadOf(show: InboxShow, counts: InboxCounts): keyof typeof SHOW_INSTEAD | undefined {
  return show !== INBOX_SHOW.ALL && counts[INBOX_SHOW.ALL] > 0 ? INBOX_SHOW.ALL : undefined;
}

/** What All says where Whose, naming the reader or a teammate, leaves out every item, in the words that name whose. */
const NOTHING_WHOSE = {
  YOURS: "Nothing in the inbox is yours",
  THEIRS: "Nothing in the inbox is theirs",
} as const;

/** What each status group is called, and its glyph, a list grouped by status heading it. */
const STATUS_WORDS = {
  [INBOX_STATUS_GROUP.NEEDS_YOU]: NEEDS_YOU.LABEL,
  [INBOX_STATUS_GROUP.WAITING]: "Waiting on others",
  [INBOX_STATUS_GROUP.ANSWERED]: "Answered",
  [INBOX_STATUS_GROUP.CLOSED]: "Closed",
} as const satisfies Record<InboxStatusGroupKind, string>;

/** What the view's submenu of whose items is called. */
const WHOSE = "Whose";

/** What the chip over the list says its × does, and the empty state's press where Whose left out every item. */
const CLEAR_WHOSE = "Show everyone's items";

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
 * (`APP_COMMAND.TOGGLE_READ`); and a swipe right, a
 * short one leaving the row open on a Read or Unread button, a long one
 * marking it as it is let go (`@luke/ui`'s `ListRow` swipe). Its menu,
 * opened by the row's ⋯, a right-click, a long press, and the menu key
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
  ref,
  selectKey,
  onChoose,
  onMark,
  onAskClose,
  onAskMove,
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
}): React.JSX.Element {
  const { holder, item } = listed;
  const unread = isUnread(item);
  const title = cardTitle(item.title);
  const directory = useMemberDirectory();
  const _reader = directory.readerId ?? readerId;
  const { nameOf } = useInboxStanding(listed, readerId);
  const lineKind = inboxLineKind(item);
  const preview = inboxPreview(item, nameOf, ticked);
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
            before={unread ? <VisuallyHidden>{UNREAD}</VisuallyHidden> : null}
          />
        }
        metaAt={LIST_ROW_META.TITLE}
        swipe={
          onMark === undefined
            ? undefined
            : {
                label: unread ? SWIPE_WORDS.READ : SWIPE_WORDS.UNREAD,
                icon: unread ? <MailOpenIcon /> : <MailIcon />,
                onAct: () => onMark(listed, !unread),
              }
        }
        current={current ? LIST_ROW_CURRENT.PAGE : undefined}
        unread={unread}
        muted={muted}
        hint={{ Hint: RowHint, label: title }}
        selectKey={selectKey}
        onPress={() => onChoose(listed)}
        menu={rowMenu(ITEM_THING, groups())}
        more={!coarse}
      />
    </RowHintOptions>
  );
});

/**
 * What every group head of the list is handed beside its glyph and name: its
 * fold, as the list keeps it, and how many of its items need the reader, which
 * a narrow column counts only while the group is folded or the head is under
 * the pointer, and leaves out at none, since "0 need you" is no news.
 */
function groupHead(folded: boolean, count: number, onToggle: () => void) {
  return {
    fold: sidebarFold(folded, onToggle),
    count: count === 0 ? undefined : groupCount(count, NEEDS_YOU.COUNT),
    surface: GROUP_SURFACE.NARROW,
  };
}

/**
 * A holder's group header: a task's status's mark and name; for the agents
 * with no task, their automation's clock tile, wearing how its last run
 * went and hanging its card where the window reads the automation, Luke's
 * face for the member's operator, and the automation glyph for the agents
 * no automation names, since that group names no one actor.
 * A press folds the group, which then fades its rows out, as every group
 * header's does.
 */
function HolderHeader({
  holder,
  folded,
  count,
  onToggle,
  children,
}: {
  holder: InboxHolder;
  folded: boolean;
  count: number;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const automationId = holderAutomationId(holder);
  const known = useAutomation(automationId ?? undefined);
  const shared = { ...groupHead(folded, count, onToggle), children };
  const name = holderName(holder);
  if (holder.kind === INBOX_HOLDER.TASK) {
    const glyph = <PlanGlyph status={holder.task.status} />;
    const fallback = (
      <HoverCard data-task-card="">
        <HoverCardHead glyph={glyph} name={holder.task.name} />
      </HoverCard>
    );
    return (
      <GroupHeader
        glyph={glyph}
        label={holder.task.name}
        card={<TaskChipCard taskId={holder.task.id} fallback={fallback} />}
        {...shared}
      />
    );
  }
  if (automationId === null) {
    return <GroupHeader glyph={<HolderGlyph holder={holder} />} label={name} {...shared} />;
  }
  const actor =
    known === undefined
      ? { kind: ACTOR_KIND.AUTOMATION, name, state: ACTOR_STATE.REST }
      : automationActor(known.automation);
  return (
    <GroupHeader
      glyph={<ActorMark actor={actor} />}
      label={name}
      card={known === undefined ? undefined : <AutomationCard {...known} />}
      {...shared}
    />
  );
}

/** The glyph each status group's header wears. */
const STATUS_GLYPH = {
  [INBOX_STATUS_GROUP.NEEDS_YOU]: <AttentionMark />,
  [INBOX_STATUS_GROUP.WAITING]: <HourglassIcon />,
  [INBOX_STATUS_GROUP.ANSWERED]: <GLYPH.SETTLED />,
  [INBOX_STATUS_GROUP.CLOSED]: <GLYPH.DISMISSED />,
} as const satisfies Record<InboxStatusGroupKind, React.JSX.Element>;

/**
 * A status's group header: Needs you by the attention mark, Waiting on
 * others by the hourglass, Answered by a check, and Closed by the slashed
 * circle a withdrawn ask wears. A press folds the group, which then fades
 * its rows out, as every group header's does.
 */
function StatusHeader({
  status,
  folded,
  count,
  onToggle,
  children,
}: {
  status: InboxStatusGroupKind;
  folded: boolean;
  count: number;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <GroupHeader
      glyph={STATUS_GLYPH[status]}
      label={STATUS_WORDS[status]}
      {...groupHead(folded, count, onToggle)}
    >
      {children}
    </GroupHeader>
  );
}

/**
 * A person's group header: their face and name, the reader's own as You, a
 * member who left on the quiet outline, as the sidebar's group by creator
 * heads its groups, hanging their card as an automation's header hangs its
 * own. A press folds the group, which then fades its rows out, as every
 * group header's does.
 */
function PersonHeader({
  person,
  readerId,
  folded,
  count,
  onToggle,
  children,
}: {
  person: InboxPerson | undefined;
  readerId: string | undefined;
  folded: boolean;
  count: number;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const { members, former, readerId: known } = useMemberDirectory();
  const reader = known ?? readerId;
  const you = members?.find((each) => each.userId === reader);
  const actor: Actor =
    person !== undefined
      ? personActor(person, members, reader, former)
      : you !== undefined
        ? memberActor(you, reader)
        : { kind: ACTOR_KIND.PERSON, userId: reader ?? "", name: "", you: true };
  return (
    <GroupHeader
      glyph={<ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />}
      label={actorName(actor)}
      card={person === undefined && you === undefined ? undefined : actorCard(actor)}
      {...groupHead(folded, count, onToggle)}
    >
      {children}
    </GroupHeader>
  );
}

/** Whose's choices, as every filter by person offers them: Anyone, Me, then each teammate, the choice checked. Note that Me stands though the reader's id is unknown, since the reader's own items are read without one (`readersItem`). */
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
            ? { kind: INBOX_WHOSE.MINE }
            : { kind: INBOX_WHOSE.PERSON, userId: filter.userId, name: filter.name },
      ),
    meWithoutId: true,
  });
}

/**
 * The head's button that drops the view's menu: first the scopes the Inbox
 * offers, Needs you and All, the one shown checked;
 * then, on the window's Inbox, Group by and Order by, each a submenu with its
 * choice checked; Whose, Anyone, Me, or a teammate by face and name;
 * and Mark all as read at its foot.
 */
function ViewOptions({
  shown,
  show,
  choices,
  readerId,
  readAll,
  asked,
}: {
  shown: boolean;
  show: InboxShowChoice;
  /** The window's Inbox's other choices; none on a task's own, whose menu offers its scopes alone. */
  choices: InboxViewChoices | undefined;
  readerId: string | undefined;
  readAll: InboxReadAll | undefined;
  /** Where a phone's ⋯ stands for the button, the menu drawn under the ⋯ each time it asks (`phone-head.tsx`), and no button of its own; none elsewhere. */
  asked?: { readonly ask: MenuAsk | undefined } | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  useAskedMenu(menu.show, asked?.ask);
  const reader = useMemberDirectory();
  const scope: MenuEntry[] = INBOX_SCOPES.map((value) => ({
    ...SCOPE_WORDS[value],
    checked: show.show === value,
    onSelect: () => show.onShow(value),
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
          groups={[
            scope,
            ...(choices === undefined ? [] : windowEntries(choices, reader, readerId)),
            readAll === undefined ? [] : markAllEntries(readAll),
          ].filter((group) => group.length > 0)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** Mark all as read, as the view's menu offers it at its foot, pressable while anything is unread. */
function markAllEntries(readAll: InboxReadAll): MenuEntry[] {
  return [
    {
      label: MARK_ALL_READ,
      icon: <CheckCheckIcon />,
      disabled: !readAll.unread,
      onSelect: readAll.onMarkAll,
    },
  ];
}

/** The window's Inbox's own groups of its view's menu, after its scopes: Group by and Order by, and Whose. */
function windowEntries(
  choices: InboxViewChoices,
  reader: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): MenuEntry[][] {
  const groupBy = (label: string, icon: React.JSX.Element, value: InboxGrouping): MenuAction => ({
    label,
    icon,
    checked: choices.grouping === value,
    onSelect: () => choices.onGrouping(value),
  });
  const sortBy = (label: string, icon: React.JSX.Element, value: InboxSort): MenuAction => ({
    label,
    icon,
    checked: choices.sort === value,
    onSelect: () => choices.onSort(value),
  });
  const view: MenuEntry[] = [
    {
      ...commandHead(PANEL_COMMAND.GROUP_BY),
      items: [
        groupBy("None", <ListIcon />, INBOX_GROUPING.NONE),
        groupBy("Task", <DocumentIcon />, INBOX_GROUPING.TASK),
        groupBy("Person", <UsersIcon />, INBOX_GROUPING.PERSON),
        groupBy("Status", <GLYPH.STATUS />, INBOX_GROUPING.STATUS),
      ],
    },
    {
      ...commandHead(PANEL_COMMAND.ORDER_BY),
      items: [
        sortBy("Latest first", <ClockArrowDownIcon />, INBOX_SORT.LATEST),
        sortBy("Oldest first", <ClockArrowUpIcon />, INBOX_SORT.OLDEST),
      ],
    },
  ];
  const whose: MenuEntry[] = [
    {
      label: WHOSE,
      icon: <UsersIcon />,
      items: whoseEntries(choices.whose, choices.onWhose, reader, readerId),
    },
  ];
  return [view, whose];
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

/** The chip Whose calls for, Me by the reader's face, or the teammate's face and name; none while the list holds everyone's. */
function whoseChipEntries(
  { whose: chosen, onWhose }: InboxWhoseChoice,
  directory: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): FilterChipEntry[] {
  if (chosen.kind === INBOX_WHOSE.EVERYONE) return [];
  const { members, former, readerId: known } = directory;
  const reader = known ?? readerId;
  const me = members?.find((member) => member.userId === reader);
  const actor: Actor | undefined =
    chosen.kind === INBOX_WHOSE.PERSON
      ? personActor(chosen, members, reader, former)
      : me === undefined
        ? undefined
        : memberActor(me, reader);
  const words =
    chosen.kind === INBOX_WHOSE.MINE
      ? PEOPLE_FILTER_WORDS.ME
      : actor === undefined
        ? chosen.name
        : actorName(actor);
  const mark =
    actor === undefined ? <UserIcon /> : <ActorMark actor={actor} size={ACTOR_SIZE.MARK} />;
  return [
    {
      key: FILTER_CHIP_KEY.WHOSE,
      mark,
      words,
      removeLabel: CLEAR_WHOSE,
      onRemove: () => onWhose(EVERYONES),
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
  // Note that the box around the row stands hidden while the list holds everyone's, so the row's padding takes no room, and the chip arriving arrives into a row that stands.
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
 * and a × that lists every task's items again; and, while Whose leaves out
 * anyone's items, Me by the reader's face, or the teammate's face and name,
 * and a × that lists everyone's again (`@luke/ui`'s removable filter chip,
 * as the sidebar's Created by stands over its tasks). Each scales in as it
 * is chosen and out as its × lifts it, as the Tasks page's filter chips do.
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

/** What the list stands where its scope leaves out every item it holds: that nothing is there, and the press that shows the scope that holds something, which keeps the list standing where the Inbox shows one column. */
export function ShowEmpty({
  show,
  counts,
  whose,
  onList,
}: {
  show: InboxShowChoice;
  counts: InboxCounts;
  /** Whose items the window's Inbox lists, which offers everyone's again where no scope holds any of theirs; none on a task's own. */
  whose?: InboxWhoseChoice | undefined;
  /** Asks the Inbox for its list, so the item chosen once the rows return does not stand in their place. */
  onList: () => void;
}): React.JSX.Element {
  const whoseNames =
    whose !== undefined && whose.whose.kind !== INBOX_WHOSE.EVERYONE ? whose : undefined;
  const line =
    show.show === INBOX_SHOW.ALL && whoseNames !== undefined
      ? whoseNames.whose.kind === INBOX_WHOSE.MINE
        ? NOTHING_WHOSE.YOURS
        : NOTHING_WHOSE.THEIRS
      : SHOW_EMPTY[show.show];
  const instead = insteadOf(show.show, counts);
  const everyone = instead === undefined ? whoseNames : undefined;
  return (
    <EmptyState
      icon={<InboxIcon />}
      action={
        instead !== undefined
          ? {
              label: SHOW_INSTEAD[instead],
              onClick: () => {
                onList();
                show.onShow(instead);
              },
            }
          : everyone !== undefined
            ? {
                label: CLEAR_WHOSE,
                onClick: () => {
                  onList();
                  everyone.onWhose(EVERYONES);
                },
              }
            : undefined
      }
    >
      {line}
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
 * The list's head: the Inbox's name, the scope after it where that is not
 * Needs you, and the view's menu at the list's top right, which chooses the
 * scope and, on the window's Inbox, the rest of how it lists; a task's own
 * Inbox lists one task's items in one run, so its menu offers its scopes
 * alone. On the window's Inbox its heading and its button glide as the
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
  const { shown, show, view, channel } = head;
  const title =
    channel === undefined ? inboxTitle(show.show) : channelTitle(channel.name, show.show);
  const asked = useMenuAsk();
  const search = head.search === undefined ? null : <ListSearch search={head.search} />;
  // A task's own Inbox tab on a phone hands its View options to the task's header, whose title
  // already names it; its search field stands over the list as on every page.
  const phone = usePhoneRoom();
  const handed = head.tab === true && phone;
  const linkGroups = head.tab === true && head.link !== undefined ? [[head.link]] : [];
  const viewGroups: TabActionGroups = handed
    ? [
        [
          {
            label: VIEW_OPTIONS,
            icon: <SlidersHorizontalIcon />,
            opens: true,
            detail: title,
            onAsk: asked.onAsk,
          },
        ],
      ]
    : [];
  const tabGroups = [...linkGroups, ...viewGroups];
  useTabActions(tabGroups.length === 0 ? undefined : tabGroups);
  if (handed) {
    return (
      <>
        <ViewOptions
          shown={shown}
          show={show}
          choices={view?.choices}
          readerId={readerId}
          readAll={head.readAll}
          asked={{ ask: asked.ask }}
        />
        {search}
      </>
    );
  }
  if (head.phone !== undefined) {
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
                  [
                    {
                      label: VIEW_OPTIONS,
                      icon: <SlidersHorizontalIcon />,
                      opens: true,
                      onSelect: () => asked.onAsk(opener),
                    },
                  ],
                ].filter((group) => group.length > 0)
              }
            />
          }
        />
        <ViewOptions
          shown={shown}
          show={show}
          choices={view?.choices}
          readerId={readerId}
          readAll={head.readAll}
          asked={{ ask: asked.ask }}
        />
        {search}
        <ErrorLine
          level={ANNOUNCE.ALERT}
          error={refusedShown(channel?.refusal, FAILURE_SURFACE.CHANNEL_POST)}
        />
        {view === undefined ? null : (
          <FilterChips whose={view.choices} task={head.task} readerId={readerId} />
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
      <ViewOptions
        shown={shown}
        show={show}
        choices={view?.choices}
        readerId={readerId}
        readAll={head.readAll}
      />
    </>
  );
  return (
    <>
      {/* Note that a task's own Inbox is a tab, whose bar is every tab's; the window's Inbox is a page, whose head glides with the sidebar. */}
      {view === undefined ? (
        <PaneBar title={title} actions={options} />
      ) : channel?.archivedAt === undefined ? (
        <Toolbar
          title={title}
          detail={channel?.detail}
          actions={options}
          end={TOOLBAR_INSET.COLUMN}
        />
      ) : (
        <ArchivedChannelBar title={title} archivedAt={channel.archivedAt} actions={options} />
      )}
      {search}
      <ErrorLine
        level={ANNOUNCE.ALERT}
        error={refusedShown(channel?.refusal, FAILURE_SURFACE.CHANNEL_POST)}
      />
      {view === undefined ? null : (
        <FilterChips whose={view.choices} task={head.task} readerId={readerId} />
      )}
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
    <Toolbar
      title={title}
      detail={`Archived ${agoText(archivedAt, useMinute())}`}
      actions={actions}
      end={TOOLBAR_INSET.COLUMN}
    />
  );
}

/** What a list its search left empty says, under its rows, on the window's Inbox and a task's own alike. */
export function SearchEmpty({ searched }: { searched: string }): React.JSX.Element {
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
 * reader, over New task where one can start. Under a finger there is no
 * keyboard to step with, so it names the press alone.
 */
export function InboxPaneEmpty({
  listed,
  newTask,
}: {
  /** How many items the list holds. */
  listed: number;
  newTask?: (() => void) | undefined;
}): React.JSX.Element {
  const coarse = useCoarsePointer();
  if (listed === 0) {
    return (
      <EmptyState icon={<InboxIcon />} action={newTaskAction(newTask)}>
        {NEEDS_YOU.NONE}
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
}: {
  failed: boolean;
  reading: boolean;
  empty: boolean;
  /** Whether the list stands alone, the Inbox too narrow for the pane beside it. */
  alone: boolean;
  /** Opens New task, the way on from the Inbox's empty state where the list stands alone; none where nothing can start. */
  onNewTask?: (() => void) | undefined;
  /** The scope shown and whose items, where they leave out every item the Inbox holds, for its empty state to show another. */
  filteredOut: InboxViewChoices | undefined;
  /** How many items each scope lists, for the empty state to offer one that lists something. */
  counts: InboxCounts;
  /** Asks for the list, so the scope its empty state shows leaves it standing. */
  onList: () => void;
  onRetry: () => void;
  /** The words the list's search narrows it by, where it narrows it, which an empty list says found nothing. */
  searched?: string | undefined;
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
    return <ShowEmpty show={filteredOut} counts={counts} whose={filteredOut} onList={onList} />;
  // Note that beside the pane the list stands bare, since the pane's empty state says it once.
  if (!alone) return null;
  // Note that the list standing alone is the whole Inbox, so it says so as the hidden pane would.
  return (
    <EmptyState icon={<InboxIcon />} action={newTaskAction(onNewTask)}>
      {NEEDS_YOU.NONE}
    </EmptyState>
  );
}

/** What the list's head offers: its scopes on every Inbox, and on the window's how it groups its items and which plans are folded. */
export interface InboxListHead {
  /** Whether the list is on screen, for its menu not to outlive it. */
  readonly shown: boolean;
  /** The scope the list shows, and the choice that shows another. */
  readonly show: InboxShowChoice;
  /** The window's Inbox's grouping and its plans' folds; none on a task's own, which lists one task's items in one run. */
  readonly view: { readonly choices: InboxViewChoices; readonly folds: InboxTaskFolds } | undefined;
  /** Mark all as read, in the view's menu, where the list marks its items. */
  readonly readAll?: InboxReadAll | undefined;
  /** The list's search, under its head, on the window's Inbox and a task's own alike; none where the list offers none. */
  readonly search?: InboxSearchHead | undefined;
  /**
   * A phone's head (`phone-head.tsx`), where the window's Inbox stands on a
   * phone's places: its one start control, New task, the title centred, and
   * the ⋯ holding View options, the search standing under it; none elsewhere.
   */
  readonly phone?: { readonly start: React.ReactNode } | undefined;
  /**
   * Whether the list stands in a task's own Inbox tab, which a phone heads
   * with the task's header, whose ⋯ takes the head's View options
   * (`useTabActions`), so the list draws no head of its own there, only its
   * search under where the head stood.
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

/** Mark all as read as the view's menu offers it: whether any item is unread, filtered out or not, and the mark. */
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

/** The items whose rows the list draws, in their order: every item listed but those of a group folded. */
function drawnItems(view: InboxListView, folded: (key: string) => boolean): readonly InboxListed[] {
  if (view.grouping === INBOX_GROUPING.NONE) return view.items;
  const keyed: readonly { readonly key: string; readonly items: readonly InboxListed[] }[] =
    view.groups;
  return keyed.flatMap(({ key, items }) => (folded(key) ? [] : items));
}

/** No group folded, as a list in one run folds none. */
const NO_KEYS: readonly string[] = [];

/** The keys of the list's groups folded, in their order; none for a list in one run. */
function foldedKeys(view: InboxListView, folded: (key: string) => boolean): readonly string[] {
  if (view.grouping === INBOX_GROUPING.NONE) return NO_KEYS;
  const keyed: readonly { readonly key: string }[] = view.groups;
  return keyed.flatMap(({ key }) => (folded(key) ? [key] : []));
}

/** What stands the list's rows where they are: the items it lists under which heads, and which of its groups are folded. */
interface LaidOut {
  readonly view: InboxListView;
  readonly folded: readonly string[];
}

/**
 * How deep two layouts are read alike (`sameShape`): the layout, its view,
 * each group, and each group's head and rows, a row read as the same listed
 * item (`inboxListed`) and a head as the same holder, person, or status.
 */
const LAID_OUT_DEPTH = 4;

/**
 * The rows' layout as last drawn while a draw leaves it reading alike
 * (`sameShape`), else as it is now. Note that this is what the list's
 * motion is handed, because it measures every row before and after a commit
 * whose `change` moved, and the list is handed a view built anew on every
 * draw, though it lists the same rows.
 */
function useLaidOut(laidOut: LaidOut): LaidOut {
  const held = useRef(laidOut);
  const steady = sameShape(held.current, laidOut, LAID_OUT_DEPTH) ? held.current : laidOut;
  useLayoutEffect(() => {
    held.current = steady;
  });
  return steady;
}

/** A group's key, by which it leaves the list (`ListMotion`). */
function groupKey({ key }: { readonly key: string }): string {
  return key;
}

/** A run of rows, each drawn on after it is no longer listed until its exit has played (`ListMotion`). */
function InboxRows({
  items,
  row,
}: {
  items: readonly InboxListed[];
  row: (listed: InboxListed, leaving: boolean) => React.ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(items, (listed) => listed.item.id);
  // Note that the rows stand a step further apart than a list's, because a row of three lines standing clear on its ground is told from the next by the room between them alone.
  return (
    <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.TIGHT} className="sidebar-tasks" moves>
      {drawn.map(({ value, leaving }) => row(value, leaving))}
    </Stack>
  );
}

/** The list's groups, each drawn on after its last row took it out of the list until its exit has played. */
function InboxGroups<G>({
  groups,
  keyOf,
  group,
}: {
  groups: readonly G[];
  keyOf: (group: G) => string;
  group: (group: G) => React.ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(groups, keyOf);
  return <>{drawn.map(({ value }) => group(value))}</>;
}

/** The list: its head where it has one, then each task's or each person's group of rows, or every row in one run, or a line where nothing is listed. */
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
  onAskMove,
  onPointing,
}: {
  view: InboxListView;
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
  const isFolded = (key: string) => head.view?.folds.folded(key) ?? false;
  const drawn = drawnItems(view, isFolded);
  // Note that only rows drawn stay chosen, so an item gone from the list, filtered out, or folded away is never acted on, and stays unchosen once back.
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
  // Note that the rows of every group are one Tab stop that ↑↓ walk.
  const roving = useRovingKeys<HTMLDivElement>();
  const rovingBody = useMemo(() => joinRefs(bodyRef, roving.ref), [roving.ref]);
  const edge = useResizeEdge({
    side: RESIZE_EDGE_SIDE.RIGHT,
    width,
    bounds: INBOX_LIST_WIDTH,
    reserve: () => PANE_RESERVE,
    label: "Resize inbox list",
    onResize,
  });
  // Note that the motion replays a commit only where the rows stand otherwise, never one that drew them where they stood.
  const laidOut = useLaidOut({ view, folded: foldedKeys(view, isFolded) });
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
  // Note that a row wears a teammate's face wherever no person's header stands over it.
  // A row whose item is done with is drawn gray, the chosen row kept on Needs you and every such row on All alike.
  // A row leaving the list is the list's motion's rather than one of the keyboard's rows (`ListMotion`).
  const row = (listed: InboxListed, leaving: boolean) => (
    <InboxItemRow
      key={listed.item.id}
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
      face={view.grouping !== INBOX_GROUPING.PERSON}
      muted={isDone(listed.item)}
      ref={leaving ? undefined : rows.hold(listed.item.id)}
      selectKey={leaving ? undefined : listed.item.id}
      onChoose={choose}
      onMark={mark}
      onAskClose={onClose === undefined ? undefined : closing.ask}
      onAskMove={askMove}
    />
  );
  const needingYou = (items: readonly InboxListed[]) =>
    items.filter((listed) => needsYouOf(listed, view.readerId)).length;
  const statusSection = ({ key, status, items }: InboxStatusGroup) => {
    const folded = head.view?.folds.folded(key) ?? false;
    return (
      <div key={key} className="sidebar-repository" {...motionKey(key)}>
        <StatusHeader
          status={status}
          folded={folded}
          count={needingYou(items)}
          onToggle={() => head.view?.folds.toggle(key)}
        >
          <InboxRows items={items} row={row} />
        </StatusHeader>
      </div>
    );
  };
  const personSection = ({ key, person, items }: InboxPersonGroup) => {
    const folded = head.view?.folds.folded(key) ?? false;
    return (
      <div key={key} className="sidebar-repository" {...motionKey(key)}>
        <PersonHeader
          person={person}
          readerId={readerId}
          folded={folded}
          count={needingYou(items)}
          onToggle={() => head.view?.folds.toggle(key)}
        >
          <InboxRows items={items} row={row} />
        </PersonHeader>
      </div>
    );
  };
  // Note that each grouping draws its groups anew, keyed by it, so a group of one grouping never leaves into another's.
  const body = (
    <div
      {...roving}
      ref={rovingBody}
      className="inbox-tasks-body min-h-list-held-least px-column-inset pt-row-inset pb-column-inset data-[empty=true]:flex data-[empty=true]:min-h-full data-[empty=true]:flex-col"
      data-empty={String(listedItems(view).length === 0)}
      {...motionRows()}
    >
      {view.grouping === INBOX_GROUPING.NONE ? (
        <InboxRows items={view.items} row={row} />
      ) : view.grouping === INBOX_GROUPING.PERSON ? (
        <InboxGroups
          key={view.grouping}
          groups={view.groups}
          keyOf={groupKey}
          group={personSection}
        />
      ) : view.grouping === INBOX_GROUPING.STATUS ? (
        <InboxGroups
          key={view.grouping}
          groups={view.groups}
          keyOf={groupKey}
          group={statusSection}
        />
      ) : (
        <InboxGroups
          key={view.grouping}
          groups={view.groups}
          keyOf={groupKey}
          group={({ key, holder, items }) => {
            const folded = head.view?.folds.folded(key) ?? false;
            return (
              <div key={key} className="sidebar-repository" {...motionKey(key)}>
                <HolderHeader
                  holder={holder}
                  folded={folded}
                  count={needingYou(items)}
                  onToggle={() => head.view?.folds.toggle(key)}
                >
                  <InboxRows items={items} row={row} />
                </HolderHeader>
              </div>
            );
          }}
        />
      )}
      {note}
    </div>
  );
  return (
    <nav
      ref={rowFocus.ref}
      className="inbox-tasks relative flex min-h-0 min-w-0 flex-col border-r border-border"
      aria-label="Inbox items"
      hidden={columns === INBOX_COLUMNS.ITEM}
      onFocus={rowFocus.onFocus}
      onBlur={rowFocus.onBlur}
      onPointerEnter={() => onPointing?.(true)}
      onPointerLeave={() => onPointing?.(false)}
      style={{ width: drawnWidth(width, columns !== INBOX_COLUMNS.BOTH) }}
    >
      <ListHead head={head} readerId={readerId} />
      <ListMotion root={bodyRef} change={laidOut} reading={reading}>
        <SelectionRegion id={regionId} selection={{ selected: picked, onChange: setPicked }}>
          <ScrollArea fade={SCROLL_FADE.START}>{body}</ScrollArea>
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
