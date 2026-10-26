import { LINK_PLACE } from "@luke/features/link-grammar";
import type { CatalogModel } from "@luke/features/models-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  EmptyState,
  GAP,
  IconButton,
  joinRefs,
  LAYOUT_ELEMENT,
  LIST_LEAVING_SELECTOR,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
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
  SCROLL_FADE,
  ScrollArea,
  SearchField,
  SelectionRegion,
  Skeleton,
  SkeletonRegion,
  Stack,
  Tooltip,
  useLeaving,
  useMenu,
  useMinute,
  useResizeEdge,
  useRovingKeys,
  VisuallyHidden,
} from "@luke/ui";
import {
  CheckIcon,
  GLYPH,
  InboxIcon,
  MailIcon,
  MailOpenIcon,
  PenLineIcon,
  SlidersHorizontalIcon,
  SquareCheckIcon,
} from "@luke/ui/icons";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInboxItemDraft } from "../composer-drafts.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ActionMenu, type MenuEntry, rowMenu } from "../desktop/action-menu.js";
import {
  INBOX_LIST_WIDTH,
  type InboxShowChoice,
  useInboxListWidth,
} from "../desktop/folded-groups.js";
import { type MenuAsk, useAskedMenu, useMenuAsk } from "../desktop/phone-head.js";
import { useTabActions } from "../desktop/strip-tabs.js";
import { useMemberDirectory } from "../member-directory.js";
import { usePhoneRoom } from "../stage-room.js";
import { type InboxCloser, useInboxClose } from "./inbox-close.js";
import {
  INBOX_COLUMNS,
  type InboxColumnsShown,
  type InboxRowPresses,
  listHeadControl,
  VIEW_OPTIONS,
} from "./inbox-columns.js";
import { HolderGlyph, InboxItemCard, InboxItemEnd, useInboxStanding } from "./inbox-item-parts.js";
import {
  holderName,
  INBOX_HOLDER,
  INBOX_LINE,
  INBOX_SHOW,
  type InboxCounts,
  type InboxLineKind,
  type InboxListed,
  type InboxListView,
  type InboxShow,
  inboxLineKind,
  inboxPreview,
  inboxShownTicks,
  isDone,
  isUnread,
} from "./inbox-model.js";
import { type InboxListMark, InboxSelectionBar } from "./inbox-selection.js";
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

/** What the list says where its scope leaves out every item it holds. */
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
 * teammate's item wears their face before its time, the mark of their open
 * item being theirs to wear. The title hangs in the
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
 * do not head is the person page's. Its menu, opened by the row's ⋯, a right-click, and the menu key
 * alike (`ListRow`'s `menu`), offers
 * Copy link, the item's link under the task or the agent that holds it, where
 * the list hands down a workspace to write it under. Where the list hands
 * down `onClose`, an open item's row offers to close it without an
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
  chip = false,
  muted = false,
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
  /** Whether the row names its task, or its automation, on a line of its own over its preview, as a list its tasks do not head does. */
  chip?: boolean;
  /** Whether the row is drawn gray, its item done with (`isDone`), as the Inbox's own list draws it; nothing says so in words, since its marks and its card do. */
  muted?: boolean;
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
            <span
              className="inbox-row-line [&>svg]:me-tight-gap [&>svg]:size-caption-glyph [&>svg]:align-[-0.125em] [&>svg]:text-attention data-[line=settled]:[&>svg]:text-complete"
              data-line={lineKind}
            >
              {lineGlyph(lineKind)}
              {preview}
            </span>
          }
          lead={
            chip ? { icon: <HolderGlyph holder={holder} />, label: holderName(holder) } : undefined
          }
          leadAt={LIST_ROW_LEAD.LINE}
          meta={
            <InboxItemEnd
              listed={listed}
              now={now}
              readerId={readerId}
              open={open}
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

/** The head's button that drops the view's menu: the scopes the Inbox offers, For you and All, the one shown checked. */
function ViewOptions({
  shown,
  show,
  asked,
}: {
  shown: boolean;
  show: InboxShowChoice;
  /** Where a phone's ⋯ stands for the button, the menu drawn under the ⋯ each time it asks (`phone-head.tsx`), and no button of its own; none elsewhere. */
  asked?: { readonly ask: MenuAsk | undefined } | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  useAskedMenu(menu.show, asked?.ask);
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
        <ActionMenu label={VIEW_OPTIONS} menu={menu.drawn} groups={[scope]} onClose={menu.close} />
      )}
    </>
  );
}

/** What the list stands where its scope leaves out every item it holds: that nothing is there, and the press that shows the scope that holds something, which keeps the list standing where the Inbox shows one column. */
export function ShowEmpty({
  show,
  counts,
  onList,
}: {
  show: InboxShowChoice;
  counts: InboxCounts;
  /** Asks the Inbox for its list, so the item chosen once the rows return does not stand in their place. */
  onList: () => void;
}): React.JSX.Element {
  const instead = insteadOf(show.show, counts);
  return (
    <EmptyState
      icon={<InboxIcon />}
      action={
        instead === undefined
          ? undefined
          : {
              label: SHOW_INSTEAD[instead],
              onClick: () => {
                onList();
                show.onShow(instead);
              },
            }
      }
    >
      {SHOW_EMPTY[show.show]}
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

/** The words naming the list's search. */
const SEARCH_INBOX = "Search inbox";

/**
 * The list's search under its head, a phone's as a desk's: a field always standing, as Settings'
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
 * For you, and the view's menu at its top right, which chooses the scope,
 * the list's search standing under it. On a phone the task's header heads
 * the tab, its ⋯ taking View options (`useTabActions`), so the list draws no
 * head of its own there, only its search under where the head stood.
 */
function ListHead({ head }: { head: InboxListHead }): React.JSX.Element {
  const { shown, show } = head;
  const title = inboxTitle(show.show);
  const asked = useMenuAsk();
  const search = <ListSearch search={head.search} />;
  const phone = usePhoneRoom();
  useTabActions(
    phone
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
  if (phone) {
    return (
      <>
        <ViewOptions shown={shown} show={show} asked={{ ask: asked.ask }} />
        {search}
      </>
    );
  }
  return (
    <>
      <PaneBar title={title} actions={<ViewOptions shown={shown} show={show} />} />
      {search}
    </>
  );
}

/** What a list its search left empty says, under its rows. */
export function SearchEmpty({ searched }: { searched: string }): React.JSX.Element {
  return <NoteLine look={NOTE_LINE_LOOK.ROWS}>{`No items match “${searched.trim()}”.`}</NoteLine>;
}

/** What the list's head offers: its scopes and its search. */
interface InboxListHead {
  /** Whether the list is on screen, for its menu not to outlive it. */
  readonly shown: boolean;
  /** The scope the list shows, and the choice that shows another. */
  readonly show: InboxShowChoice;
  /** The list's search, under its head. */
  readonly search: InboxSearchHead;
}

/** The words a list's search holds, and the change that narrows the list to them. */
interface InboxSearchHead {
  readonly query: string;
  readonly onQuery: (query: string) => void;
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

/** The list: its head, then every row in one run, or a line where nothing is listed. */
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
}): React.JSX.Element {
  const now = useMinute();
  const regionId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  // Note that only rows drawn stay chosen, so an item gone from the list or filtered out is never acted on, and stays unchosen once back.
  const picks = view.items.filter(({ item }) => picked.has(item.id));
  if (picks.length !== picked.size) setPicked(new Set(picks.map(({ item }) => item.id)));
  const unpick = () => setPicked(new Set());
  const { width, onResize } = useInboxListWidth();
  const rowFocus = useRowFocusKept(rows);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Note that the rows are one Tab stop that ↑↓ walk.
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
  // Note that a row whose item is done with is drawn gray, the chosen row kept on For you and every such row on All alike.
  // A row leaving the list is the list's motion's rather than one of the keyboard's rows (`ListMotion`).
  const row = (listed: InboxListed, leaving: boolean) => (
    <InboxItemRow
      key={listed.item.id}
      listed={listed}
      chosen={listed.item.id === chosen}
      open={listed.item.id === chosen && columns === INBOX_COLUMNS.BOTH}
      now={now}
      models={models}
      readerId={readerId}
      muted={isDone(listed.item)}
      ref={leaving ? undefined : rows.hold(listed.item.id)}
      selectKey={leaving ? undefined : listed.item.id}
      onChoose={onChoose}
      onMark={onMark}
      onClose={onClose}
    />
  );
  return (
    <nav
      ref={rowFocus.ref}
      className="inbox-tasks relative flex min-h-0 min-w-0 flex-col border-r border-border"
      aria-label="Inbox items"
      hidden={columns === INBOX_COLUMNS.ITEM}
      onFocus={rowFocus.onFocus}
      onBlur={rowFocus.onBlur}
      style={{ width: drawnWidth(width, columns !== INBOX_COLUMNS.BOTH) }}
    >
      <ListHead head={head} />
      <ListMotion root={bodyRef} change={view} reading={reading}>
        <SelectionRegion id={regionId} selection={{ selected: picked, onChange: setPicked }}>
          <ScrollArea fade={SCROLL_FADE.START}>
            <div
              {...roving}
              ref={rovingBody}
              className="inbox-tasks-body min-h-list-held-least px-column-inset pt-row-inset pb-column-inset data-[empty=true]:flex data-[empty=true]:min-h-full data-[empty=true]:flex-col"
              data-empty={String(view.items.length === 0)}
              {...motionRows()}
            >
              <InboxRows items={view.items} row={row} />
              {note}
            </div>
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
      {columns === INBOX_COLUMNS.BOTH ? <ResizeEdge edge={edge} /> : null}
    </nav>
  );
}
