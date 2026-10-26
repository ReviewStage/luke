import type { InboxPerson } from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import type { CatalogModel } from "@luke/features/models-wire";
import { readFailedWords, TERM } from "@luke/features/words";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  CHIP_LOOK,
  Chip,
  ChipName,
  ComposeIcon,
  DocumentIcon,
  EMPTY_STATE_ACTION_LOOK,
  EmptyState,
  type EmptyStateAction,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  GAP,
  GROUP_ACTIONS,
  GROUP_HEADING,
  GROUP_SURFACE,
  GroupHeader,
  HoverCard,
  HoverCardHead,
  IconButton,
  joinRefs,
  LAYOUT_ELEMENT,
  LIST_LEAVING_SELECTOR,
  LIST_MOTION_WAY,
  LIST_ROW_ACTIONS,
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
  Skeleton,
  SkeletonRegion,
  Stack,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TOOLBAR_INSET,
  Toolbar,
  Tooltip,
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
  CheckIcon,
  ClockArrowDownIcon,
  ClockArrowUpIcon,
  GLYPH,
  HourglassIcon,
  ImagesIcon,
  InboxIcon,
  ListIcon,
  MailIcon,
  MailOpenIcon,
  PenLineIcon,
  Rows2Icon,
  SlidersHorizontalIcon,
  SquareCheckIcon,
  UserIcon,
  UsersIcon,
} from "@luke/ui/icons";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import {
  type RefObject,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ACTOR_SIZE, ActorMark, AutomationCard, actorCard, automationActor } from "../actor-ref.js";
import { AttentionMark } from "../attention-mark.js";
import { useAutomation } from "../automation-directory.js";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useInboxItemDraft } from "../composer-drafts.js";
import { useCopyLinkItem } from "../copy-link-item.js";
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
import { useTabActions } from "../desktop/strip-tabs.js";
import { useMemberDirectory } from "../member-directory.js";
import { PEOPLE_FILTER, PEOPLE_FILTER_WORDS, peopleFilterActions } from "../member-rows.js";
import { usePhoneRoom } from "../stage-room.js";
import { TaskChipCard } from "./chip-cards.js";
import { type InboxCloser, useInboxClose } from "./inbox-close.js";
import {
  INBOX_COLUMNS,
  type InboxColumnsShown,
  type InboxRowPresses,
  listHeadControl,
  VIEW_OPTIONS,
} from "./inbox-columns.js";
import { NEW_THREAD } from "./inbox-compose.js";
import { HolderGlyph, InboxItemCard, InboxItemEnd, useInboxStanding } from "./inbox-item-parts.js";
import {
  EVERYONES,
  holderKey,
  holderName,
  INBOX_GROUPING,
  INBOX_HOLDER,
  INBOX_LINE,
  INBOX_SHOW,
  INBOX_SORT,
  INBOX_STATUS_GROUP,
  INBOX_WHOSE,
  type InboxCounts,
  type InboxGrouping,
  type InboxHolder,
  type InboxLineKind,
  type InboxListed,
  type InboxListView,
  type InboxPersonGroup,
  type InboxShow,
  type InboxSort,
  type InboxStatusGroup,
  type InboxStatusGroupKind,
  type InboxWhose,
  inboxLineKind,
  inboxMedia,
  inboxPreview,
  inboxShownTicks,
  isDone,
  isUnread,
  listedItems,
  NEEDS_YOU,
  needsYou as needsYouOf,
} from "./inbox-model.js";
import {
  RowMedia,
  type RowMediaReads,
  useRowMediaAsks,
  useRowMediaReads,
} from "./inbox-row-media.js";
import { type InboxListMark, InboxSelectionBar } from "./inbox-selection.js";
import { PlanGlyph } from "./tab-look.js";
import { markReadItem } from "./task-menu-items.js";
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
 * word saying so: the chosen row For you keeps once it is answered or read,
 * until another is chosen (`use-held-inbox-list.ts`), and every such row All lists. A folded task
 * counts what in it needs the developer, at rest, and says nothing where
 * none does. The head names the Inbox and, at its right, offers the view's
 * menu: first what the list holds, For you, the developer's own items they are
 * not done with, asks waiting on them and anything of theirs unread, a
 * settled thread its agent wrote on again among them, or All, every item,
 * the head naming All after the Inbox's name; then Group by, None, one
 * run, by task, by person, or by status (what needs the developer
 * under the attention mark, what waits on others, what is answered, each
 * folding as a task's group does); Order by, the latest
 * change first or the oldest first; Whose, everyone's
 * items, the developer's own, or one teammate's by face and name, which a
 * chip over the list then says, its × listing everyone's again; each
 * choice checked; Media previews, off until first pressed and checked while
 * each row shows the pictures and pages its item carries, drawn small under
 * its preview (`inbox-row-media.tsx`); and under them Mark all as read,
 * which clears the dots alone. Every
 * choice is kept across launches. Grouped by person, each person's items
 * stand under their face, the reader's own first as You. Grouped by
 * anything but task, a row names its task in a chip before its preview,
 * since no task's header stands over it. Where the scope leaves out every
 * item listed, the list says so in the Inbox's empty state, offering the
 * scope that holds something, as a mail app's empty unread view does; the
 * item the pane shows keeps its place there, though no row. A task's own
 * Inbox lists one task's items in one run, so its view's menu offers For you
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

/** What an unread row says to a reader, its dot being drawn for the eye alone. */
const UNREAD = "Unread";

/** What a row's swipe button says it does: marks the item read, or unread. */
const SWIPE_WORDS = { READ: "Read", UNREAD: "Unread" } as const;

/** What the view's menu offers to clear every dot with. */
const MARK_ALL_READ = "Mark all as read";

/** What the view's menu offers to show or hide the media under each row's preview with. */
const MEDIA_PREVIEWS = "Media previews";

/** What the view's menu offers to show or hide each row's second line with, its rows one line where it is off. */
const SECOND_LINE = "Second line";

/** The items whose media the rows show while they show none, kept as one so the reads see no change. */
const NO_ITEMS: readonly string[] = [];

/** What the list's placeholder rows say to a reader while its items are first read. */
const READING_ITEMS = "Reading your inbox…";

/** How wide each placeholder row's title and the preview under it stand, as shares of their lines, so the rows read as items of their own. */
const SKELETON_ROWS = [
  { title: "68%", preview: "84%" },
  { title: "52%", preview: "70%" },
  { title: "74%", preview: "90%" },
  { title: "46%", preview: "62%" },
  { title: "60%", preview: "78%" },
] as const;

/** How wide a placeholder row's time stands, as wide as a short "2h". */
const SKELETON_TIME = "20px";

/** What each scope is called, in the view's menu and, but for For you, after the Inbox's name at its head, and its glyph in the menu. */
const SCOPE_WORDS = {
  [INBOX_SHOW.TO_DO]: { label: "For you", icon: <GLYPH.TODOS /> },
  [INBOX_SHOW.ALL]: { label: "All", icon: <InboxIcon /> },
} as const satisfies Record<InboxShow, { label: string; icon: React.JSX.Element }>;

/** The scopes every Inbox's view's menu offers, in its order. */
const INBOX_SCOPES = [INBOX_SHOW.TO_DO, INBOX_SHOW.ALL] as const satisfies readonly InboxShow[];

/** The Inbox's name at its head: the scope after it, but for For you, where the Inbox opens, since no other control on the head says it. */
function inboxTitle(show: InboxShow): string {
  return show === INBOX_SHOW.TO_DO ? "Inbox" : `Inbox · ${SCOPE_WORDS[show].label}`;
}

/**
 * What the list says where its scope leaves out every item it holds.
 * All leaves out only what Whose does.
 */
const SHOW_EMPTY = {
  [INBOX_SHOW.TO_DO]: "Nothing to do",
  [INBOX_SHOW.ALL]: "Nothing here",
} as const satisfies Record<InboxShow, string>;

/** What the empty state's press says, by the scope it shows instead. */
const SHOW_INSTEAD = {
  [INBOX_SHOW.ALL]: "Show all",
} as const;

/** The scope an empty scope offers instead: All from For you where it holds anything; none where nothing is there to show. */
function insteadOf(show: InboxShow, counts: InboxCounts): keyof typeof SHOW_INSTEAD | undefined {
  return show !== INBOX_SHOW.ALL && counts[INBOX_SHOW.ALL] > 0 ? INBOX_SHOW.ALL : undefined;
}

/** What All says where Whose, naming someone, leaves out every item. */
const NOTHING_THEIRS = "Nothing in the inbox is theirs";

/** What the empty state's press says where it lists everyone's items again, Whose having left out every item. */
const SHOW_EVERYONES = "Show everyone's";

/** What each status group is called, and its glyph, a list grouped by status heading it. */
const STATUS_WORDS = {
  [INBOX_STATUS_GROUP.NEEDS_YOU]: NEEDS_YOU.LABEL,
  [INBOX_STATUS_GROUP.WAITING]: "Waiting on others",
  [INBOX_STATUS_GROUP.ANSWERED]: "Answered",
  [INBOX_STATUS_GROUP.CLOSED]: "Closed",
} as const satisfies Record<InboxStatusGroupKind, string>;

/** What the view's submenu of whose items is called. */
const WHOSE = "Whose";

/** What the chip over the list says its × does. */
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

/** The glyph leading an item's second line: its open ask's kind, a tick where an answer settled it, and none before words alone. */
function lineGlyph(kind: InboxLineKind): React.JSX.Element | null {
  switch (kind) {
    case INBOX_LINE.DECIDE:
      return <GLYPH.DECIDE />;
    case INBOX_LINE.DO:
      return <SquareCheckIcon aria-hidden="true" />;
    case INBOX_LINE.ANSWER:
      return <PenLineIcon aria-hidden="true" />;
    case INBOX_LINE.SETTLED:
      return <CheckIcon aria-hidden="true" />;
    case INBOX_LINE.SAID:
      return null;
  }
}

/**
 * One item as a `ListRow` of up to three lines, as a mail app lists a
 * thread, one thing to a line so nothing is cut short to make room for
 * another: the title and how long ago it changed; then, in a list its tasks
 * do not head, what holds it, its task's status and whole name (`chip`);
 * then the last word in its thread, muted, led on a thread by what its open
 * ask asks, the steps its draft ticks counted (`inboxPreview`). The agent
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
 * Where the list hands down `onMark`, the row offers to mark it read or unread:
 * a press over its time while the pointer rests on it or it holds the
 * keyboard, the time and its marks stepping aside, and the first item of
 * its menu, which names the key that does the same to the
 * chosen item (`APP_COMMAND.TOGGLE_INBOX_ITEM_READ`); and a swipe right, a
 * short one leaving the row open on a Read or Unread button, a long one
 * marking it as it is let go (`@luke/ui`'s `ListRow` swipe). A list its tasks
 * do not head is the person page's, or the Inbox's own grouped by anything
 * but task. Its menu, opened by the row's ⋯, a right-click, and the menu key
 * alike (`ListRow`'s `menu`), offers
 * Copy link, the item's link under the task or the agent that holds it, where
 * the list hands down a workspace to write it under. Where the list hands
 * down its media reads (`media`), the row shows the pictures and pages its
 * item carries under its preview (`inbox-row-media.tsx`). Where the list
 * hands down `onClose`, an open item's row offers to close it without an
 * answer, asked first (`inbox-close.tsx`): a press beside its mark while
 * the pointer rests on it or it holds the keyboard, and the last item of
 * its menu.
 */
export function InboxItemRow({
  listed,
  chosen,
  open = chosen,
  now,
  models,
  readerId,
  face = true,
  chip = false,
  line = true,
  muted = false,
  media,
  ref,
  selectKey,
  onChoose,
  onMark,
  onClose,
}: {
  listed: InboxListed;
  chosen: boolean;
  /** Whether the item's box stands beside the list, so its draft is in sight and unmarked: the chosen item's unless said, and none while the list stands alone. */
  open?: boolean;
  now: number;
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards and rows name no starter, and whose own open items alone need them. */
  readerId: string | undefined;
  /** Whether a teammate's item wears their face, which a person's group header says instead. */
  face?: boolean;
  /** Whether the row names its task, or its automation, on a line of its own over its preview, as a list its tasks do not head does. */
  chip?: boolean;
  /** Whether the row draws its second line, what its item asks or how it ended; off, the row is its title's line alone, as the view's menu may choose. */
  line?: boolean;
  /** Whether the row is drawn gray, its item done with (`isDone`), as the Inbox's own list draws it; nothing says so in words, since its marks and its card do. */
  muted?: boolean;
  /** The list's reads of its rows' media, where the row shows its item's; none where it shows none. */
  media?: RowMediaReads | undefined;
  /** Handed the row's press, by which the list finds the row of an item. */
  ref?: React.RefCallback<HTMLElement> | undefined;
  /** What the row is chosen by where its list chooses rows (`SelectionRegion`); none where it is never chosen. */
  selectKey?: string | undefined;
  onChoose: (listed: InboxListed) => void;
  /** Marks the item read or unread; none where the row offers no mark. */
  onMark?: ((listed: InboxListed, unread: boolean) => void) | undefined;
  /** Closes an open item without an answer; none where the row offers no close. */
  onClose?: InboxCloser | undefined;
}): React.JSX.Element {
  const { holder, item } = listed;
  const unread = isUnread(item);
  const title = cardTitle(item.title);
  const directory = useMemberDirectory();
  const _reader = directory.readerId ?? readerId;
  const { nameOf } = useInboxStanding(listed, readerId);
  const ticked = inboxShownTicks(item, useInboxItemDraft(item));
  const lineKind = inboxLineKind(item);
  const preview = inboxPreview(item, nameOf, ticked);
  const carried = useMemo(() => inboxMedia(item), [item]);
  useRowMediaAsks(item.id, item.updatedAt, carried, media);
  const copyLink = useCopyLinkItem()(
    holder.kind === INBOX_HOLDER.TASK
      ? { kind: LINK_PLACE.INBOX_ITEM, planId: holder.task.id, itemId: item.id }
      : { kind: LINK_PLACE.INBOX_ITEM, agentId: item.agentId, itemId: item.id },
  );
  const read =
    onMark === undefined
      ? undefined
      : {
          ...markReadItem({ unread, onMark: (next) => onMark(listed, next) }),
          // Note that U acts only on the chosen item, so only its row names the chord.
          ...(chosen ? { command: APP_COMMAND.TOGGLE_INBOX_ITEM_READ } : {}),
        };
  const close = useInboxClose(item, onClose, true);
  const groups = [
    read === undefined ? [] : [read],
    copyLink === undefined ? [] : [copyLink],
    close.action === undefined ? [] : [close.action],
  ].filter((group) => group.length > 0);
  // Note that the row's item is its press's parent, which its card counts as its control, as a sidebar task's row does.
  const region = useRef<HTMLElement | null>(null);
  const hold = useCallback(
    (element: HTMLElement | null) => {
      region.current = element?.parentElement ?? null;
      ref?.(element);
    },
    [ref],
  );
  return (
    <>
      <RowHintOptions
        card={<InboxItemCard listed={listed} now={now} models={models} readerId={readerId} />}
        cardBeside
        cardRegion={region}
      >
        <ListRow
          ref={hold}
          motionKey={listed.item.id}
          ink={LIST_ROW_INK.SIDEBAR}
          leading={<InboxRowLeading unread={unread} />}
          title={title}
          description={
            line ? (
              <span
                className="inbox-row-line [&>svg]:me-tight-gap [&>svg]:size-caption-glyph [&>svg]:align-[-0.125em] [&>svg]:text-attention data-[line=settled]:[&>svg]:text-complete"
                data-line={lineKind}
              >
                {lineGlyph(lineKind)}
                {preview}
              </span>
            ) : undefined
          }
          lead={
            line && chip
              ? { icon: <HolderGlyph holder={holder} />, label: holderName(holder) }
              : undefined
          }
          leadAt={LIST_ROW_LEAD.LINE}
          attachments={
            !line || media === undefined || carried.length === 0 ? undefined : (
              <RowMedia media={carried} reads={media} />
            )
          }
          meta={
            <InboxItemEnd
              listed={listed}
              now={now}
              readerId={readerId}
              open={open}
              face={face}
              standing={false}
              before={unread ? <VisuallyHidden>{UNREAD}</VisuallyHidden> : null}
            />
          }
          metaAt={LIST_ROW_META.TITLE}
          actions={
            read === undefined && close.action === undefined ? undefined : (
              <>
                {read === undefined ? null : (
                  <Tooltip label={read.label} command={read.command}>
                    <IconButton
                      icon={unread ? <MailOpenIcon /> : <MailIcon />}
                      label={read.label}
                      size={BUTTON_SIZE.COMPACT}
                      onClick={read.onSelect}
                    />
                  </Tooltip>
                )}
                {close.action === undefined ? null : (
                  <Tooltip label={close.action.label}>
                    <IconButton
                      icon={close.action.icon}
                      label={close.action.label}
                      size={BUTTON_SIZE.COMPACT}
                      onClick={close.action.onSelect}
                    />
                  </Tooltip>
                )}
              </>
            )
          }
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          swipe={
            onMark === undefined
              ? undefined
              : {
                  label: unread ? SWIPE_WORDS.READ : SWIPE_WORDS.UNREAD,
                  icon: unread ? <MailOpenIcon /> : <MailIcon />,
                  onAct: () => onMark(listed, !unread),
                }
          }
          current={chosen ? LIST_ROW_CURRENT.PAGE : undefined}
          unread={unread}
          muted={muted}
          hint={{ Hint: RowHint, label: title }}
          selectKey={selectKey}
          onPress={() => onChoose(listed)}
          menu={rowMenu(ITEM_THING, groups)}
        />
      </RowHintOptions>
      {close.dialog}
    </>
  );
}

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
 * A holder's group header: a task's status's mark and name; an
 * automation's clock tile, wearing how its last run went and hanging its
 * card where the window reads the automation; and the automation glyph for
 * the agents no automation names, since that group names no one actor.
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
  const known = useAutomation(
    holder.kind === INBOX_HOLDER.AUTOMATION ? (holder.automationId ?? undefined) : undefined,
  );
  const shared = { ...groupHead(folded, count, onToggle), children };
  if (holder.kind === INBOX_HOLDER.TASK) {
    const glyph = <PlanGlyph status={holder.task.status} />;
    const fallback = (
      <HoverCard>
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
  if (holder.automationId === null) {
    return <GroupHeader glyph={<GLYPH.AUTOMATION />} label={holder.name} {...shared} />;
  }
  const actor =
    known === undefined
      ? { kind: ACTOR_KIND.AUTOMATION, name: holder.name, state: ACTOR_STATE.REST }
      : automationActor(known.automation);
  return (
    <GroupHeader
      glyph={<ActorMark actor={actor} />}
      label={holder.name}
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
 * offers, For you and All, the one shown checked;
 * then, on the window's Inbox, Group by and Order by, each a submenu with its
 * choice checked; Whose, Anyone, Me, or a teammate by face and name;
 * Media previews; and Mark all as read at its foot.
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

/** The window's Inbox's own groups of its view's menu, after its scopes: Group by and Order by, Whose, and Media previews. */
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
  const looks: MenuEntry[] = [
    {
      label: SECOND_LINE,
      icon: <Rows2Icon />,
      checked: choices.secondLine,
      onSelect: () => choices.onSecondLine(!choices.secondLine),
    },
    {
      label: MEDIA_PREVIEWS,
      icon: <ImagesIcon />,
      checked: choices.mediaPreviews,
      onSelect: () => choices.onMediaPreviews(!choices.mediaPreviews),
    },
  ];
  return [view, whose, looks];
}

/** The key the chip over the list is followed by, as it arrives and leaves. */
const WHOSE_CHIP_KEY = "whose";

/** The chip over the list as last drawn, so it leaves looking as it did: its mark, if the person is known, and its words. */
interface WhoseChipEntry {
  readonly key: typeof WHOSE_CHIP_KEY;
  readonly actor: Actor | undefined;
  readonly words: string;
}

/** What a press on the chip leaving does, out of reach as it is: nothing. */
function stays(): void {}

/** The chip Whose calls for, Me by the reader's face, or the teammate's face and name; none while the list holds everyone's. */
function whoseChipEntries(
  chosen: InboxWhoseChoice["whose"],
  directory: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): WhoseChipEntry[] {
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
  return [{ key: WHOSE_CHIP_KEY, actor, words }];
}

/**
 * The chip itself. Note that this is its own component under the line's
 * `ListMotion`, because `useLeaving` finds the motion through the context
 * the motion provides.
 */
function WhoseChipLine({
  line,
  whose,
  readerId,
}: {
  line: RefObject<HTMLDivElement | null>;
  whose: InboxWhoseChoice;
  readerId: string | undefined;
}): React.JSX.Element {
  const directory = useMemberDirectory();
  const chosen = whose.whose;
  // Note that the entries are made once for what they are made from, because `useLeaving` reads a new list as a change.
  const listed = useMemo(
    () => whoseChipEntries(chosen, directory, readerId),
    [chosen, directory, readerId],
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
            removeLabel={CLEAR_WHOSE}
            onRemove={leaving ? stays : () => whose.onWhose(EVERYONES)}
          >
            {value.actor === undefined ? (
              <UserIcon />
            ) : (
              <ActorMark actor={value.actor} size={ACTOR_SIZE.MARK} />
            )}
            <ChipName>{value.words}</ChipName>
          </Chip>
        ))}
      </div>
    </div>
  );
}

/**
 * The chip over the list while Whose leaves out anyone's items: Me by the
 * reader's face, or the teammate's face and name, and a × that lists
 * everyone's again (`@luke/ui`'s removable filter chip, as the sidebar's
 * Created by stands over its tasks). It scales in as Whose chooses someone
 * and out as the × lifts it, as the Tasks page's filter chips do.
 */
function WhoseChip({
  whose,
  readerId,
}: {
  whose: InboxWhoseChoice;
  readerId: string | undefined;
}): React.JSX.Element {
  const line = useRef<HTMLDivElement | null>(null);
  return (
    <ListMotion root={line} way={LIST_MOTION_WAY.SCALE}>
      <WhoseChipLine line={line} whose={whose} readerId={readerId} />
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
      ? NOTHING_THEIRS
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
                label: SHOW_EVERYONES,
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
 * An item row's leading: the gutter the unread dot stands in, on every row so
 * the words line up whether a row wears the dot or not. The list's rows and
 * its placeholder rows both lead with it, so a title lands where its block
 * stood. The gutter sets its line in the
 * title's type, so its baseline is the title's, and the dot stands centred
 * on the title's capitals rather than on its line's box. The dot is the
 * accent's ink rather than its fill, because the web's cyan fill reads at
 * 1.7:1 on its light page, under a mark's 3:1.
 */
function InboxRowLeading({ unread }: { unread: boolean }): React.JSX.Element {
  return (
    <span className="inbox-row-gutter block w-status-dot flex-none text-center text-label">
      {unread ? (
        <span className="inbox-row-unread inline-block size-status-dot rounded-disc bg-accent-ink align-[calc(0.5cap-var(--spacing-status-dot)/2)]" />
      ) : null}
    </span>
  );
}

/**
 * The list while its items are first read: rows in an item's own row, a
 * block where its title, its time, and the line under them will stand,
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
        {SKELETON_ROWS.slice(0, rows).map(({ title, preview }) => (
          <ListRow
            key={title}
            leading={<InboxRowLeading unread={false} />}
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

/** The words naming the list's search, on its field and the sidebar's magnifier alike. */
const SEARCH_INBOX = "Search inbox";

/**
 * The list's search under a page's head, on the window's Inbox and a task's
 * own, a phone's head's as a desk's: a field always standing, as Settings'
 * search does, so nothing in the head moves or hides as it is used. It
 * narrows the list as it is typed in, and Escape empties it; an empty one
 * leaves Escape to the surface behind it.
 */
function ListSearch({ search }: { search: InboxSearchHead }): React.JSX.Element {
  return (
    <search className="inbox-search block px-column-inset pb-row-inset">
      <SearchField
        label={SEARCH_INBOX}
        placeholder={SEARCH_INBOX}
        value={search.query}
        onChange={search.onQuery}
        onClear={() => search.onQuery("")}
        onEscape={search.query === "" ? undefined : () => search.onQuery("")}
      />
    </search>
  );
}

/**
 * The list's head: the Inbox's name, the scope after it where that is not
 * For you, and the view's menu at the list's top right, which chooses the
 * scope and, on the window's Inbox, the rest of how it lists; a task's own
 * Inbox lists one task's items in one run, so its menu offers its scopes
 * alone. On the window's Inbox its heading and its button glide as the
 * sidebar folds, the name moving to the list's middle, clear of the
 * sidebar's toggle, and the button keeping to the list's edge. Where the
 * list offers a search, a page stands its field under the head
 * (`ListSearch`), and the sidebar's head, too tight for one, a magnifier
 * after the name that unfolds a field over it (`FoldingSearch`), the
 * buttons after it standing still either way.
 */
function ListHead({
  head,
  readerId,
  placement,
}: {
  head: InboxListHead;
  readerId: string | undefined;
  placement: InboxListPlacement;
}): React.JSX.Element {
  const { shown, show, view } = head;
  const title = inboxTitle(show.show);
  const asked = useMenuAsk();
  const search = head.search === undefined ? null : <ListSearch search={head.search} />;
  // A task's own Inbox tab on a phone hands its View options to the task's header, whose title
  // already names it; its search field stands over the list as on every page.
  const phone = usePhoneRoom();
  const handed = head.tab === true && phone;
  useTabActions(
    handed
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
      : undefined,
  );
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
  if (head.phone !== undefined && placement === INBOX_LIST_PLACEMENT.PAGE) {
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
              thing="Inbox"
              shown={shown}
              groups={(opener) => [
                [
                  ...(head.onCompose === undefined
                    ? []
                    : [{ label: NEW_THREAD, icon: <ComposeIcon />, onSelect: head.onCompose }]),
                  {
                    label: VIEW_OPTIONS,
                    icon: <SlidersHorizontalIcon />,
                    opens: true,
                    onSelect: () => asked.onAsk(opener),
                  },
                ],
              ]}
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
        {view === undefined ? null : <WhoseChip whose={view.choices} readerId={readerId} />}
      </>
    );
  }
  const options = (
    <>
      {head.onCompose === undefined ? null : (
        <Tooltip label={NEW_THREAD}>
          <IconButton icon={<ComposeIcon />} label={NEW_THREAD} onClick={head.onCompose} />
        </Tooltip>
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
  const sidebar = placement === INBOX_LIST_PLACEMENT.SIDEBAR;
  return (
    <>
      {/* In the sidebar the list is headed as the sidebar's own sections are, under its places, rather than as a page. */}
      {sidebar ? (
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          label={title}
          actionsShown={GROUP_ACTIONS.AT_REST}
          actions={options}
          search={
            head.search === undefined
              ? undefined
              : { label: SEARCH_INBOX, value: head.search.query, onChange: head.search.onQuery }
          }
        />
      ) : (
        <>
          {/* Note that a task's own Inbox is a tab, whose bar is every tab's; the window's Inbox is a page, whose head glides with the sidebar. */}
          {view === undefined ? (
            <PaneBar title={title} actions={options} />
          ) : (
            <Toolbar title={title} actions={options} end={TOOLBAR_INSET.COLUMN} />
          )}
          {search}
        </>
      )}
      {view === undefined ? null : <WhoseChip whose={view.choices} readerId={readerId} />}
    </>
  );
}

/** What a list its search left empty says, under its rows, on the window's Inbox and a task's own alike. */
export function SearchEmpty({ searched }: { searched: string }): React.JSX.Element {
  return <NoteLine look={NOTE_LINE_LOOK.ROWS}>{`No items match “${searched.trim()}”.`}</NoteLine>;
}

/** What the Inbox says where a read of its items, or of the tasks holding them, did not answer. */
export const INBOX_NOT_READ = readFailedWords(`some ${TERM.INBOX_ITEM.many}`);

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

/** What stands under the list's rows: a read that did not answer, placeholder rows while nothing is read, the scope's empty state where it leaves out every item, or the empty line, the Inbox's empty state where the list stands alone. */
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
      <ErrorState onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.ROWS}>
        {INBOX_NOT_READ}
      </ErrorState>
    );
  }
  if (!empty) return null;
  if (reading) return <InboxListSkeleton />;
  if (searched !== undefined) return <SearchEmpty searched={searched} />;
  if (filteredOut !== undefined)
    return <ShowEmpty show={filteredOut} counts={counts} whose={filteredOut} onList={onList} />;
  // Note that the list standing alone is the whole Inbox, so it says so as the hidden pane would.
  if (alone) {
    return (
      <EmptyState icon={<InboxIcon />} action={newTaskAction(onNewTask)}>
        {NEEDS_YOU.NONE}
      </EmptyState>
    );
  }
  return <NoteLine look={NOTE_LINE_LOOK.ROWS}>{NEEDS_YOU.NONE}</NoteLine>;
}

/** Where a list of the window's Inbox stands: a column of its own on the Inbox's page, or the sidebar, which the inbox-first sidebar makes it. */
export const INBOX_LIST_PLACEMENT = {
  PAGE: "page",
  SIDEBAR: "sidebar",
} as const;

export type InboxListPlacement = (typeof INBOX_LIST_PLACEMENT)[keyof typeof INBOX_LIST_PLACEMENT];

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
  /** The list's search, under a page's head or unfolded from the sidebar's magnifier, on the window's Inbox and a task's own alike; none where the list offers none. */
  readonly search?: InboxSearchHead | undefined;
  /** Opens a New thread in the pane, from the head's compose button; none where the list offers none. */
  readonly onCompose?: (() => void) | undefined;
  /**
   * A phone's head (`phone-head.tsx`), where the window's Inbox stands on a
   * phone's places: its one start control, New task, the title centred, and
   * the ⋯ holding New thread and View options, the search standing under it; none elsewhere.
   */
  readonly phone?: { readonly start: React.ReactNode } | undefined;
  /**
   * Whether the list stands in a task's own Inbox tab, which a phone heads
   * with the task's header, whose ⋯ takes the head's View options
   * (`useTabActions`), so the list draws no head of its own there, only its
   * search under where the head stood.
   */
  readonly tab?: boolean | undefined;
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
 * drawn, as For you leaves out an item answered on another Mac while its
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
  if (view.grouping === INBOX_GROUPING.PERSON) {
    return view.groups.flatMap(({ key, items }) => (folded(key) ? [] : items));
  }
  if (view.grouping === INBOX_GROUPING.STATUS) {
    return view.groups.flatMap(({ key, items }) => (folded(key) ? [] : items));
  }
  return view.groups.flatMap(({ holder, items }) =>
    folded(holderKey(holder)) ? [] : items.map((item) => ({ holder, item })),
  );
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
  placement = INBOX_LIST_PLACEMENT.PAGE,
  onChoose,
  onMark,
  onClose,
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
  /** Where the list stands: its own column on the Inbox's page, or the sidebar, which scrolls it with the rest and draws the chosen item's open beside it. */
  placement?: InboxListPlacement;
  onChoose: (listed: InboxListed) => void;
  /** Marks an item read or unread from its row or the selection's bar, answering whether the service took it; none where the rows offer no mark. */
  onMark?: InboxListMark | undefined;
  /** Closes an open item without an answer from its row or the selection's bar; none where the rows offer no close. */
  onClose?: InboxCloser | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const regionId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  // Note that only the list on a page chooses rows; the sidebar's leaves its rows to open alone.
  const choosing = placement === INBOX_LIST_PLACEMENT.PAGE;
  const drawn = choosing ? drawnItems(view, (key) => head.view?.folds.folded(key) ?? false) : [];
  // Note that only rows drawn stay chosen, so an item gone from the list, filtered out, or folded away is never acted on, and stays unchosen once back.
  const picks = drawn.filter(({ item }) => picked.has(item.id));
  if (picks.length !== picked.size) setPicked(new Set(picks.map(({ item }) => item.id)));
  const unpick = () => setPicked(new Set());
  const { width, onResize } = useInboxListWidth();
  const rowFocus = useRowFocusKept(rows);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Note that the rows of every group are one Tab stop that ↑↓ walk on a page, and in the sidebar join the sidebar's own walk, a box around them.
  const roving = useRovingKeys<HTMLDivElement>();
  const rovingBody = useMemo(() => joinRefs(bodyRef, roving.ref), [roving.ref]);
  // Note that only the window's Inbox shows its rows' media, as its view's menu chooses; a task's own shows none.
  // The reads hold the pictures of the items listed alone, and none while the rows show no media.
  const previews = head.view?.choices.mediaPreviews === true;
  const mediaReads = useRowMediaReads(
    previews ? listedItems(view).map(({ item }) => item.id) : NO_ITEMS,
  );
  const media = previews ? mediaReads : undefined;
  const edge = useResizeEdge({
    side: RESIZE_EDGE_SIDE.RIGHT,
    width,
    bounds: INBOX_LIST_WIDTH,
    reserve: () => PANE_RESERVE,
    label: "Resize inbox list",
    onResize,
  });
  const sidebar = placement === INBOX_LIST_PLACEMENT.SIDEBAR;
  // Note that a row names its task wherever no task's header stands over it, and a teammate's face wherever no person's does.
  // A row whose item is done with is drawn gray, the chosen row kept on For you and every such row on All alike.
  // A row leaving the list is the list's motion's rather than one of the keyboard's rows (`ListMotion`).
  const row = (listed: InboxListed, leaving: boolean) => (
    <InboxItemRow
      key={listed.item.id}
      listed={listed}
      chosen={listed.item.id === chosen}
      open={listed.item.id === chosen && (sidebar || columns === INBOX_COLUMNS.BOTH)}
      now={now}
      models={models}
      readerId={readerId}
      face={view.grouping !== INBOX_GROUPING.PERSON}
      chip={head.view !== undefined && view.grouping !== INBOX_GROUPING.TASK}
      line={head.view?.choices.secondLine !== false}
      muted={isDone(listed.item)}
      media={media}
      ref={leaving ? undefined : rows.hold(listed.item.id)}
      selectKey={choosing && !leaving ? listed.item.id : undefined}
      onChoose={onChoose}
      onMark={onMark}
      onClose={onClose}
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
      {...(sidebar ? {} : roving)}
      ref={sidebar ? bodyRef : rovingBody}
      className={
        sidebar
          ? "inbox-tasks-body min-h-list-held-least p-0"
          : "inbox-tasks-body min-h-list-held-least px-column-inset pt-row-inset pb-column-inset data-[empty=true]:flex data-[empty=true]:min-h-full data-[empty=true]:flex-col"
      }
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
          keyOf={({ holder }) => holderKey(holder)}
          group={({ holder, items }) => {
            const key = holderKey(holder);
            const folded = head.view?.folds.folded(key) ?? false;
            return (
              <div key={key} className="sidebar-repository" {...motionKey(key)}>
                <HolderHeader
                  holder={holder}
                  folded={folded}
                  count={needingYou(items.map((item) => ({ holder, item })))}
                  onToggle={() => head.view?.folds.toggle(key)}
                >
                  <InboxRows items={items.map((item) => ({ holder, item }))} row={row} />
                </HolderHeader>
              </div>
            );
          }}
        />
      )}
      {note}
    </div>
  );
  // Note that in the sidebar the list scrolls with the sidebar's own scroller, under its pins, and takes the sidebar's width.
  return (
    <nav
      ref={rowFocus.ref}
      className="inbox-tasks relative flex min-h-0 min-w-0 flex-col border-r border-border data-[placement=sidebar]:block data-[placement=sidebar]:border-r-0 data-[placement=sidebar]:[&_.inbox-tasks-chips]:px-0"
      data-placement={placement}
      aria-label="Inbox items"
      hidden={!sidebar && columns === INBOX_COLUMNS.ITEM}
      onFocus={rowFocus.onFocus}
      onBlur={rowFocus.onBlur}
      style={sidebar ? undefined : { width: drawnWidth(width, columns !== INBOX_COLUMNS.BOTH) }}
    >
      <ListHead head={head} readerId={readerId} placement={placement} />
      <ListMotion root={bodyRef} change={view} reading={reading}>
        {sidebar ? (
          body
        ) : (
          <SelectionRegion id={regionId} selection={{ selected: picked, onChange: setPicked }}>
            <ScrollArea fade={SCROLL_FADE.START}>{body}</ScrollArea>
          </SelectionRegion>
        )}
      </ListMotion>
      {/* Note that the bar stands at the list's foot rather than over its rows, so choosing a row moves none under the pointer. */}
      {choosing ? (
        <InboxSelectionBar
          listed={picks}
          controls={regionId}
          shown={head.shown}
          onClear={unpick}
          onMark={onMark}
          onClose={onClose}
        />
      ) : null}
      {!sidebar && columns === INBOX_COLUMNS.BOTH ? <ResizeEdge edge={edge} /> : null}
    </nav>
  );
}
