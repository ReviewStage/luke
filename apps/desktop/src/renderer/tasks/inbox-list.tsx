import { INBOX_STATUS } from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { CatalogModel } from "@luke/features/models-wire";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor } from "@luke/panel/actor-ref";
import { AttentionMark } from "@luke/panel/attention-mark";
import { useAutomation } from "@luke/panel/automation-directory";
import { useInboxItemDrafted } from "@luke/panel/composer-drafts";
import { useCopyLinkItem } from "@luke/panel/copy-link-item";
import { ActionMenu, type MenuAction, type MenuEntry } from "@luke/panel/desktop/action-menu";
import {
  INBOX_LIST_WIDTH,
  type InboxShowChoice,
  type InboxTaskFolds,
  type InboxViewChoices,
  type InboxWhoseChoice,
  useInboxListWidth,
} from "@luke/panel/desktop/folded-groups";
import { SidebarGroupHeader } from "@luke/panel/desktop/sidebar-group-header";
import { EDGE_SIDE, useResizableEdge } from "@luke/panel/desktop/use-resizable-edge";
import { DraftMark } from "@luke/panel/draft-mark";
import { useMemberDirectory } from "@luke/panel/member-directory";
import { providerOf } from "@luke/panel/tasks/coding-agent-model";
import {
  INBOX_COLUMNS,
  type InboxColumnsShown,
  type InboxRowPresses,
  listHeadControl,
} from "@luke/panel/tasks/inbox-columns";
import {
  EVERYONES,
  holderKey,
  holderName,
  INBOX_GROUPING,
  INBOX_HOLDER,
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
  type InboxStarter,
  type InboxStatusGroup,
  type InboxStatusGroupKind,
  type InboxWhose,
  inboxMedia,
  inboxPreview,
  isUnread,
  listedItems,
  NEEDS_YOU,
  needsYou as needsYouOf,
  readersItem,
} from "@luke/panel/tasks/inbox-model";
import { RelativeTime } from "@luke/panel/tasks/relative-time";
import { markReadItem } from "@luke/panel/tasks/task-menu-items";
import { useMinute } from "@luke/panel/tasks/task-time";
import { cardTitle } from "@luke/panel/tasks/tool-call-model";
import { Tooltip } from "@luke/panel/tooltip";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  CHIP_LOOK,
  Chip,
  ChipName,
  DocumentIcon,
  EmptyState,
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_META,
  List,
  ListRow,
  SCROLL_FADE,
  ScrollArea,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  TAB_COUNT_TONE,
  TABS_DENSITY,
  TABS_INSET,
  TabCount,
  Tabs,
  useMenu,
} from "@luke/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  actorName,
  memberActor,
  personActor,
} from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import {
  ArrowDownNarrowWideIcon,
  CheckCheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ClockIcon,
  FactoryIcon,
  HourglassIcon,
  ImagesIcon,
  InboxIcon,
  ListIcon,
  MailIcon,
  MailOpenIcon,
  SlidersHorizontalIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useId, useLayoutEffect, useMemo, useRef } from "react";
import { SidebarResizeEdge } from "../desktop/desktop-sidebar";
import { AgentMarkRef, type AgentSubject, lineSubject, tasklessSubject } from "./agent-ref";
import { RowMedia, type RowMediaReads, useRowMediaAsks, useRowMediaReads } from "./inbox-row-media";
import { ReadAgentModel } from "./mentioned-agent-card";

/**
 * inbox-list.tsx -- the Inbox's list of items: one row each, under its task's group header or in one run, with what the list shows and how at its head.
 *
 * The list is drawn from the sidebar's own pieces, on the Inbox's own ground, so it reads as the
 * sidebar does. A task's items stand under the sidebar's own group header
 * (`sidebar-group-header.tsx`), the task's glyph giving way to its chevron
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
 * menu mark it read or unread (`use-inbox-read-marks.ts`). A folded task
 * counts what in it needs the developer, at rest, and says nothing where
 * none does. The head names the Inbox and, at its right, offers the view's
 * menu: Group by, by task, by person, by status (what needs the developer
 * under the attention mark, what waits on others, what is answered, each
 * folding as a task's group does), or None, one run; Sort, the latest
 * activity first or the open items waiting longest first; Whose, everyone's
 * items, the developer's own, or one teammate's by face and name, which a
 * chip over the list then says, its × listing everyone's again; each
 * choice checked; Media previews, off until first pressed and checked while
 * each row shows the pictures and pages its item carries, drawn small under
 * its preview (`inbox-row-media.tsx`); and under them Mark all as read,
 * which clears the dots alone. Under the head stand the tabs that choose what the list
 * holds, each counting its own of whose items Whose lists: Needs you, the reader's own open items,
 * its count in the attention mark's orange while anything needs them;
 * Unread, anyone's; All open; and Everything, settled items too. Every
 * choice is kept across launches. Grouped by person, each person's items
 * stand under their face, the reader's own first as You. Grouped by
 * anything but task, a row names its task in a chip before its preview,
 * since no task's header stands over it. Where the tab leaves out every
 * item listed, the list says so in the Inbox's empty state, offering the
 * tab that holds something, as a mail app's empty unread view does; the
 * item the pane shows keeps its place there, though no row. A task's own
 * Inbox lists one task's items in one run, so its head offers its tabs
 * alone, kept apart
 * from the window's, and its list has no groups. Either list
 * is resized from its right edge as the sidebar is, and keeps one width
 * between them across launches; an Inbox showing one column at a time
 * draws its list the whole Inbox wide, with no edge, and hides it while an
 * item stands in its place (`inbox-columns.ts`).
 */

/** What an item's row's right-click menu is called. */
const ITEM_ACTIONS = "Inbox item actions";

/** What an unread row says to a reader, its dot being drawn for the eye alone. */
const UNREAD = "Unread";

/** What a row's swipe button says it does: marks the item read, or unread. */
const SWIPE_WORDS = { READ: "Read", UNREAD: "Unread" } as const;

/** What the view's menu offers to clear every dot with. */
const MARK_ALL_READ = "Mark all as read";

/** What the view's menu offers to show or hide the media under each row's preview with. */
const MEDIA_PREVIEWS = "Media previews";

/** The items whose media the rows show while they show none, kept as one so the reads see no change. */
const NO_ITEMS: readonly string[] = [];

/** What the head's menu button is called. */
const VIEW_OPTIONS = "View options";

/** What the view's submenu of groupings is called. */
const GROUP_BY = "Group by";

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

/** How wide a placeholder row's context stands, as wide as a short plan's name in a row's caption type. */
const SKELETON_CONTEXT = "7em";

/** How wide a placeholder row's mark stands, an agent's tile at its inline size (`.actor-mark`). */
const SKELETON_MARK = "16px";

/** What the row of tabs under the Inbox's title is called. */
const SHOW_TABS = "Show";

/** The tabs under the Inbox's title, in the order they stand, each by what it is called. */
const SHOW_TAB_WORDS = [
  { show: INBOX_SHOW.NEEDS_YOU, label: NEEDS_YOU.LABEL },
  { show: INBOX_SHOW.UNREAD, label: "Unread" },
  { show: INBOX_SHOW.OPEN, label: "All open" },
  { show: INBOX_SHOW.ALL, label: "Everything" },
  { show: INBOX_SHOW.ARCHIVED, label: "Archived" },
] as const;

/**
 * What the list says where its tab leaves out every item it holds: a title,
 * and the line under it. Everything leaves out only what Whose does.
 */
const SHOW_EMPTY = {
  [INBOX_SHOW.NEEDS_YOU]: { title: NEEDS_YOU.NONE, body: NEEDS_YOU.ANSWERED },
  [INBOX_SHOW.UNREAD]: { title: "Nothing unread", body: "You've read everything" },
  [INBOX_SHOW.OPEN]: { title: "Nothing open", body: "Every item is answered" },
  [INBOX_SHOW.ALL]: { title: "Nothing here", body: "Nothing in the Inbox is theirs" },
  [INBOX_SHOW.ARCHIVED]: {
    title: "Nothing archived",
    body: "An archived task's items stand here until it is unarchived",
  },
} as const satisfies Record<InboxShow, { title: string; body: string }>;

/** What the empty state's press says, by the tab it shows instead. */
const SHOW_INSTEAD = {
  [INBOX_SHOW.OPEN]: "Show all open",
  [INBOX_SHOW.ALL]: "Show everything",
  [INBOX_SHOW.ARCHIVED]: "Show archived",
} as const;

/**
 * The tab an empty tab offers instead: All open from Needs you or Unread
 * where anything is open, else Everything where it holds anything, else
 * Archived where only an archived task holds items; none from Archived,
 * whose items the other tabs never list, nor where nothing is there to show.
 */
function insteadOf(show: InboxShow, counts: InboxCounts): keyof typeof SHOW_INSTEAD | undefined {
  if (show === INBOX_SHOW.ARCHIVED) return undefined;
  if (show !== INBOX_SHOW.OPEN && show !== INBOX_SHOW.ALL && counts[INBOX_SHOW.OPEN] > 0)
    return INBOX_SHOW.OPEN;
  if (show !== INBOX_SHOW.ALL && counts[INBOX_SHOW.ALL] > 0) return INBOX_SHOW.ALL;
  return (counts[INBOX_SHOW.ARCHIVED] ?? 0) > 0 ? INBOX_SHOW.ARCHIVED : undefined;
}

/** What the empty state's press says where it lists everyone's items again, Whose having left out every item. */
const SHOW_EVERYONES = "Show everyone's";

/** What each status group is called, and its glyph, a list grouped by status heading it. */
const STATUS_WORDS = {
  [INBOX_STATUS_GROUP.NEEDS_YOU]: NEEDS_YOU.LABEL,
  [INBOX_STATUS_GROUP.WAITING]: "Waiting on others",
  [INBOX_STATUS_GROUP.ANSWERED]: "Answered",
} as const satisfies Record<InboxStatusGroupKind, string>;

/** What the view's submenu of sorts and of whose items are called. */
const SORT_BY = "Sort";
const WHOSE = "Whose";

/** What the chip over the list says its × does. */
const CLEAR_WHOSE = "Show everyone's items";

/** What a teammate's open item says to a reader beside their face, which is drawn for the eye alone: it waits on them, not the reader. */
function waitingOn(starter: Actor): string {
  return `Waiting on ${actorName(starter, { sentence: true })}`;
}

/** The tile of an agent the window names nothing of. */
const UNNAMED_AGENT = {
  kind: ACTOR_KIND.AGENT,
  name: "",
  provider: undefined,
  state: ACTOR_STATE.REST,
} as const;

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

/** The agent that posted an item as its holder names it: the task's summary's line, or main's line for an agent with no task; none where neither holds it. */
function itemSubject(
  holder: InboxHolder,
  agentId: string,
  models: readonly CatalogModel[] | undefined,
  readerId: string | undefined,
): AgentSubject | undefined {
  if (holder.kind === INBOX_HOLDER.AUTOMATION) {
    const line = holder.agents.get(agentId);
    return line === undefined
      ? undefined
      : tasklessSubject(
          {
            title: line.agentTitle,
            model: line.agentModel,
            automationId: line.automationId,
            automationName: holder.automationId === null ? undefined : holder.name,
          },
          models,
        );
  }
  const line = holder.task.agents?.agents.find((each) => each.id === agentId);
  return line === undefined ? undefined : lineSubject(line, models, readerId);
}

/**
 * The tile of the agent that posted an item, hanging the agent's card and
 * leaving the press to its row; where the holder names no such agent, an
 * archived one say, whose items still stand, a bare tile of the harness
 * read for it on its task (`ReadAgentModel`), and of no known harness
 * while that is read and where nothing is.
 */
export function ItemMark({
  holder,
  agentId,
  models,
  readerId,
}: {
  holder: InboxHolder;
  agentId: string;
  models: readonly CatalogModel[] | undefined;
  readerId: string | undefined;
}): React.JSX.Element {
  const subject = itemSubject(holder, agentId, models, readerId);
  if (subject === undefined) {
    if (holder.kind !== INBOX_HOLDER.TASK) return <ActorMark actor={UNNAMED_AGENT} />;
    return (
      <ReadAgentModel agentId={agentId} taskId={holder.task.id}>
        {(model) => (
          <ActorMark
            actor={{
              ...UNNAMED_AGENT,
              provider: model === undefined ? undefined : providerOf(model),
            }}
          />
        )}
      </ReadAgentModel>
    );
  }
  return <AgentMarkRef subject={subject} models={models} />;
}

/**
 * One item as a `ListRow` of two lines, as a mail app lists a thread: the
 * agent's mark, the title, and how long ago it changed, then the last word
 * in its thread, muted (`inboxPreview`). One that needs the developer wears
 * the attention mark before its time, and a teammate's item their face
 * there where `face` allows it, the mark of their open item being theirs to
 * wear. The title hangs in the window's pill, since a narrow list cuts it
 * short. An unread item, changed since the developer last read it or marked
 * unread, wears the blue dot in a gutter before its tile, its title in the
 * unread weight and its preview in the body's ink; the gutter stands on
 * every row, so the tiles line up whether a row wears a dot or not. Where
 * an answer or a message waits unsent in the item's box and that box is not
 * the one standing beside the list, which shows its own words, the row wears
 * the Draft pencil before its marks, as a sidebar task's row does
 * (`draft-mark.tsx`).
 * Where the list hands down `onMark`, the row offers to mark it read or unread:
 * a press over its time while the pointer rests on it or it holds the
 * keyboard, the time and its marks stepping aside, and the first item of
 * its right-click menu, which names the key that does the same to the
 * chosen item (`APP_COMMAND.TOGGLE_INBOX_ITEM_READ`); and a swipe right, a
 * short one leaving the row open on a Read or Unread button, a long one
 * marking it as it is let go (`@luke/ui`'s `ListRow` swipe). The home page's Inbox
 * names the item's plan at the row's end, in `context`, since its rows stand
 * under no plan's header; the Inbox's own list, grouped by anything but
 * task, names it in a chip before the preview instead (`chip`), its glyph
 * and its name cut short, so the title keeps its whole line. Its right-click offers
 * Copy link, the item's link under the task or the agent that holds it, where
 * the list hands down a workspace to write it under. Where the list hands
 * down its media reads (`media`), the row shows the pictures and pages its
 * item carries under its preview (`inbox-row-media.tsx`).
 */
export function InboxItemRow({
  listed,
  chosen,
  open = chosen,
  now,
  models,
  readerId,
  context,
  face = true,
  chip = false,
  media,
  ref,
  onChoose,
  onMark,
}: {
  listed: InboxListed;
  chosen: boolean;
  /** Whether the item's box stands beside the list, so its draft is in sight and unmarked: the chosen item's unless said, and none while the list stands alone. */
  open?: boolean;
  now: number;
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards and rows name no starter, and whose own open items alone need them. */
  readerId: string | undefined;
  context?: string;
  /** Whether a teammate's item wears their face, which a person's group header says instead. */
  face?: boolean;
  /** Whether the row names its task, or its automation, in a chip before its preview, as a list its tasks do not head does. */
  chip?: boolean;
  /** The list's reads of its rows' media, where the row shows its item's; none where it shows none. */
  media?: RowMediaReads | undefined;
  /** Handed the row's press, by which the list finds the row of an item. */
  ref?: React.RefCallback<HTMLElement> | undefined;
  onChoose: (listed: InboxListed) => void;
  /** Marks the item read or unread; none where the row offers no mark. */
  onMark?: ((listed: InboxListed, unread: boolean) => void) | undefined;
}): React.JSX.Element {
  const { holder, item } = listed;
  const unread = isUnread(item);
  const title = cardTitle(item.title);
  const directory = useMemberDirectory();
  const reader = directory.readerId ?? readerId;
  const needsYou = needsYouOf(listed, reader);
  const drafted = useInboxItemDrafted(item) && !open;
  const starter = readersItem(item, reader)
    ? undefined
    : personActor(item.startedBy, directory.members, reader, directory.former);
  const preview = inboxPreview(item, (member) =>
    actorName(personActor(member, directory.members, reader, directory.former)),
  );
  const carried = useMemo(() => inboxMedia(item), [item]);
  useRowMediaAsks(item.id, item.updatedAt, carried, media);
  const menu = useMenu(true);
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
          command: APP_COMMAND.TOGGLE_INBOX_ITEM_READ,
        };
  const groups = [
    read === undefined ? [] : [read],
    copyLink === undefined ? [] : [copyLink],
  ].filter((group) => group.length > 0);
  const press = useRef<HTMLElement | null>(null);
  const hold = useCallback(
    (element: HTMLElement | null) => {
      press.current = element;
      ref?.(element);
    },
    [ref],
  );
  return (
    <>
      <ListRow
        ref={hold}
        leading={
          <>
            {/* Note that the gutter stands on every row, so the tiles line up whether a row wears the dot or not. */}
            <span className="inbox-row-gutter">
              {unread ? <span className="inbox-row-unread" /> : null}
            </span>
            <span className="inbox-row-mark">
              <ItemMark
                holder={holder}
                agentId={item.agentId}
                models={models}
                readerId={readerId}
              />
            </span>
          </>
        }
        title={title}
        description={preview}
        lead={
          chip ? { icon: <HolderGlyph holder={holder} />, label: holderName(holder) } : undefined
        }
        attachments={
          media === undefined || carried.length === 0 ? undefined : (
            <RowMedia media={carried} reads={media} />
          )
        }
        meta={
          <span className="home-row-meta">
            {unread ? <span className="visually-hidden">{UNREAD}</span> : null}
            {context === undefined ? null : <span className="home-row-context">{context}</span>}
            {starter === undefined || !face ? null : (
              <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />
            )}
            {starter === undefined || item.status !== INBOX_STATUS.OPEN ? null : (
              <span className="visually-hidden">{waitingOn(starter)}</span>
            )}
            {drafted ? <DraftMark /> : null}
            {needsYou ? (
              <span className="inbox-row-attention">
                <AttentionMark />
                <span className="visually-hidden">{NEEDS_YOU.LABEL}</span>
              </span>
            ) : null}
            <RelativeTime at={item.updatedAt} now={now} hint={false} />
          </span>
        }
        metaAt={LIST_ROW_META.TITLE}
        actions={
          read === undefined ? undefined : (
            <Tooltip label={read.label} command={read.command}>
              <IconButton
                icon={unread ? <MailOpenIcon /> : <MailIcon />}
                label={read.label}
                size={BUTTON_SIZE.COMPACT}
                onClick={read.onSelect}
              />
            </Tooltip>
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
        hint={{ Hint: Tooltip, label: title }}
        onPress={() => onChoose(listed)}
        onContextMenu={groups.length === 0 ? undefined : menu.contextMenu(press)}
      />
      {menu.drawn === undefined || groups.length === 0 ? null : (
        <ActionMenu label={ITEM_ACTIONS} menu={menu.drawn} groups={groups} onClose={menu.close} />
      )}
    </>
  );
}

/**
 * A holder's glyph as a row's chip draws it: a task's document, an
 * automation's clock tile, and the Factory's glyph for the agents no
 * automation names, as the holder's group header draws them.
 */
function HolderGlyph({ holder }: { holder: InboxHolder }): React.JSX.Element {
  const known = useAutomation(
    holder.kind === INBOX_HOLDER.AUTOMATION ? (holder.automationId ?? undefined) : undefined,
  );
  if (holder.kind === INBOX_HOLDER.TASK) return <DocumentIcon />;
  if (holder.automationId === null) return <FactoryIcon />;
  return (
    <ActorMark
      actor={
        known === undefined
          ? { kind: ACTOR_KIND.AUTOMATION, name: holder.name, state: ACTOR_STATE.REST }
          : automationActor(known.automation)
      }
    />
  );
}

/**
 * A holder's group header: a task's document glyph and name; an
 * automation's clock tile, wearing how its last run went and hanging its
 * card where the window reads the automation; and the Factory's glyph, the
 * sidebar's row listing every agent, for the agents no automation names,
 * since that group names no one actor.
 * A press folds the group, as every group header's does.
 */
function HolderHeader({
  holder,
  folded,
  count,
  onToggle,
}: {
  holder: InboxHolder;
  folded: boolean;
  count: number;
  onToggle: () => void;
}): React.JSX.Element {
  const known = useAutomation(
    holder.kind === INBOX_HOLDER.AUTOMATION ? (holder.automationId ?? undefined) : undefined,
  );
  const shared = { folded, count, noun: NEEDS_YOU.COUNT, steady: true, onToggle };
  if (holder.kind === INBOX_HOLDER.TASK) {
    return <SidebarGroupHeader glyph={<DocumentIcon />} name={holder.task.name} {...shared} />;
  }
  if (holder.automationId === null) {
    return (
      <SidebarGroupHeader
        glyph={<FactoryIcon aria-hidden="true" />}
        name={holder.name}
        {...shared}
      />
    );
  }
  const actor =
    known === undefined
      ? { kind: ACTOR_KIND.AUTOMATION, name: holder.name, state: ACTOR_STATE.REST }
      : automationActor(known.automation);
  return (
    <SidebarGroupHeader
      glyph={<ActorMark actor={actor} />}
      name={holder.name}
      card={known === undefined ? undefined : <AutomationCard {...known} />}
      {...shared}
    />
  );
}

/**
 * A status's group header: Needs you by the attention mark, Waiting on
 * others by the hourglass, and Answered by a check. A press folds the
 * group, as every group header's does.
 */
function StatusHeader({
  status,
  folded,
  count,
  onToggle,
}: {
  status: InboxStatusGroupKind;
  folded: boolean;
  count: number;
  onToggle: () => void;
}): React.JSX.Element {
  const glyph =
    status === INBOX_STATUS_GROUP.NEEDS_YOU ? (
      <AttentionMark />
    ) : status === INBOX_STATUS_GROUP.WAITING ? (
      <HourglassIcon />
    ) : (
      <CircleCheckIcon />
    );
  return (
    <SidebarGroupHeader
      glyph={glyph}
      name={STATUS_WORDS[status]}
      folded={folded}
      count={count}
      noun={NEEDS_YOU.COUNT}
      steady
      onToggle={onToggle}
    />
  );
}

/**
 * A person's group header: their face and name, the reader's own as You, a
 * member who left on the quiet outline, as the sidebar's group by creator
 * heads its groups. A press folds the group, as every group header's does.
 */
function PersonHeader({
  starter,
  readerId,
  folded,
  count,
  onToggle,
}: {
  starter: InboxStarter | undefined;
  readerId: string | undefined;
  folded: boolean;
  count: number;
  onToggle: () => void;
}): React.JSX.Element {
  const { members, former, readerId: known } = useMemberDirectory();
  const reader = known ?? readerId;
  const you = members?.find((each) => each.userId === reader);
  const actor: Actor =
    starter !== undefined
      ? personActor(starter, members, reader, former)
      : you !== undefined
        ? memberActor(you, reader)
        : { kind: ACTOR_KIND.PERSON, userId: reader ?? "", name: "", you: true };
  return (
    <SidebarGroupHeader
      glyph={<ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />}
      name={actorName(actor)}
      folded={folded}
      count={count}
      noun={NEEDS_YOU.COUNT}
      steady
      onToggle={onToggle}
    />
  );
}

/** Whose's choices: Everyone, then Mine, then each teammate the workspace lists by face and name, the choice checked. */
function whoseEntries(
  whose: InboxWhose,
  onWhose: (whose: InboxWhose) => void,
  reader: ReturnType<typeof useMemberDirectory>,
  readerId: string | undefined,
): MenuAction[] {
  const you = reader.readerId ?? readerId;
  const me = reader.members?.find((member) => member.userId === you);
  const others = (reader.members ?? []).filter((member) => member.userId !== you);
  return [
    {
      label: "Everyone",
      icon: <UsersIcon />,
      checked: whose.kind === INBOX_WHOSE.EVERYONE,
      onSelect: () => onWhose(EVERYONES),
    },
    {
      label: "Mine",
      icon:
        me === undefined ? (
          <UserIcon />
        ) : (
          <ActorMark actor={memberActor(me, you)} size={ACTOR_SIZE.INLINE} />
        ),
      checked: whose.kind === INBOX_WHOSE.MINE,
      onSelect: () => onWhose({ kind: INBOX_WHOSE.MINE }),
    },
    ...others.map((member) => ({
      label: member.name,
      icon: <ActorMark actor={memberActor(member, you)} size={ACTOR_SIZE.INLINE} />,
      checked: whose.kind === INBOX_WHOSE.PERSON && whose.userId === member.userId,
      onSelect: () =>
        onWhose({ kind: INBOX_WHOSE.PERSON, userId: member.userId, name: member.name }),
    })),
  ];
}

/**
 * The head's button that drops the view's menu: Group by and Sort, each a
 * submenu with its choice checked; Whose, Everyone, Mine, or a teammate by
 * face and name; Media previews; and Mark all as read at its foot.
 */
function ViewOptions({
  shown,
  choices,
  readerId,
  readAll,
}: {
  shown: boolean;
  choices: InboxViewChoices;
  readerId: string | undefined;
  readAll: InboxReadAll | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const reader = useMemberDirectory();
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
      label: GROUP_BY,
      icon: <ListIcon />,
      items: [
        groupBy("Task", <DocumentIcon />, INBOX_GROUPING.TASK),
        groupBy("Person", <UsersIcon />, INBOX_GROUPING.PERSON),
        groupBy("Status", <CircleDotIcon />, INBOX_GROUPING.STATUS),
        groupBy("None", <ListIcon />, INBOX_GROUPING.NONE),
      ],
    },
    {
      label: SORT_BY,
      icon: <ArrowDownNarrowWideIcon />,
      items: [
        sortBy("Latest activity", <ClockIcon />, INBOX_SORT.LATEST),
        sortBy("Waiting longest", <HourglassIcon />, INBOX_SORT.WAITING),
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
      label: MEDIA_PREVIEWS,
      icon: <ImagesIcon />,
      checked: choices.mediaPreviews,
      onSelect: () => choices.onMediaPreviews(!choices.mediaPreviews),
    },
  ];
  const markAll: MenuEntry[] =
    readAll === undefined
      ? []
      : [
          {
            label: MARK_ALL_READ,
            icon: <CheckCheckIcon />,
            disabled: !readAll.unread,
            onSelect: readAll.onMarkAll,
          },
        ];
  return (
    <>
      <Tooltip label={VIEW_OPTIONS}>
        <IconButton icon={<SlidersHorizontalIcon />} label={VIEW_OPTIONS} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={[view, whose, looks, markAll].filter((group) => group.length > 0)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The chip over the list while Whose leaves out anyone's items: Mine by the
 * reader's face, or the teammate's face and name, and a × that lists
 * everyone's again (`@luke/ui`'s removable filter chip, as the sidebar's
 * Created by stands over its tasks).
 */
function WhoseChip({
  whose,
  readerId,
}: {
  whose: InboxWhoseChoice;
  readerId: string | undefined;
}): React.JSX.Element | null {
  const { members, former, readerId: known } = useMemberDirectory();
  const reader = known ?? readerId;
  const chosen = whose.whose;
  if (chosen.kind === INBOX_WHOSE.EVERYONE) return null;
  const me = members?.find((member) => member.userId === reader);
  const actor: Actor | undefined =
    chosen.kind === INBOX_WHOSE.PERSON
      ? personActor(chosen, members, reader, former)
      : me === undefined
        ? undefined
        : memberActor(me, reader);
  return (
    <div className="inbox-tasks-chips">
      <Chip
        look={CHIP_LOOK.FILTER}
        removeLabel={CLEAR_WHOSE}
        onRemove={() => whose.onWhose(EVERYONES)}
      >
        {actor === undefined ? <UserIcon /> : <ActorMark actor={actor} size={ACTOR_SIZE.MARK} />}
        <ChipName>
          {chosen.kind === INBOX_WHOSE.MINE
            ? "Mine"
            : actor === undefined
              ? chosen.name
              : actorName(actor)}
        </ChipName>
      </Chip>
    </div>
  );
}

/** The ids the list's tabs are drawn by: the one each tab's id starts with, and the list's rows, the panel every tab controls. */
interface ShowTabIds {
  readonly tabs: string;
  readonly panel: string;
}

/** A tab's element id, under the list's own. */
function showTabId(tabs: string, show: InboxShow): string {
  return `${tabs}-${show}`;
}

/**
 * The row of tabs under the Inbox's title, each listing its own items and
 * counting them: Needs you, its count in the attention mark's orange while
 * anything needs the developer, Unread, All open, and Everything; and
 * Archived, the archived tasks' items, where the Inbox counts them, which
 * only the window's does. The list under them is the panel every tab shows.
 */
function ShowTabs({
  show,
  counts,
  ids,
}: {
  show: InboxShowChoice;
  counts: InboxCounts;
  ids: ShowTabIds;
}): React.JSX.Element {
  return (
    <Tabs<InboxShow>
      label={SHOW_TABS}
      tabs={SHOW_TAB_WORDS.flatMap(({ show: value, label }) => {
        const count = counts[value];
        if (count === undefined) return [];
        return [
          {
            value,
            label,
            count: (
              <TabCount
                tone={
                  value === INBOX_SHOW.NEEDS_YOU && count > 0
                    ? TAB_COUNT_TONE.ATTENTION
                    : TAB_COUNT_TONE.QUIET
                }
              >
                {String(count)}
              </TabCount>
            ),
          },
        ];
      })}
      value={show.show}
      onChange={show.onShow}
      ids={(value) => ({ tab: showTabId(ids.tabs, value), panel: ids.panel })}
      inset={TABS_INSET.COLUMN}
      density={TABS_DENSITY.COMPACT}
    />
  );
}

/** What the list stands where its tab leaves out every item it holds: that nothing is there, and the press that shows the tab that holds something, which keeps the list standing where the Inbox shows one column. */
export function ShowEmpty({
  show,
  counts,
  whose,
  onList,
}: {
  show: InboxShowChoice;
  counts: InboxCounts;
  /** Whose items the window's Inbox lists, which offers everyone's again where no tab holds any of theirs; none on a task's own. */
  whose?: InboxWhoseChoice | undefined;
  /** Asks the Inbox for its list, so the item chosen once the rows return does not stand in their place. */
  onList: () => void;
}): React.JSX.Element {
  const { title, body } = SHOW_EMPTY[show.show];
  const instead = insteadOf(show.show, counts);
  const everyone =
    instead === undefined && whose !== undefined && whose.whose.kind !== INBOX_WHOSE.EVERYONE
      ? whose
      : undefined;
  return (
    <EmptyState
      icon={<InboxIcon />}
      title={title}
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
      {body}
    </EmptyState>
  );
}

/**
 * The list while its items are first read: rows in an item's own row, a
 * block where its agent's tile, its title, its time, and the line under
 * them will stand, so the
 * items land where the blocks stood rather than a lone ring in the list's
 * corner. The rows open nothing and the region says what is being read. A
 * list whose rows name what each item is about, as Home's do, asks for a
 * block before each time where that name will stand, and a short list asks
 * for fewer rows than the five a whole Inbox stands.
 */
export function InboxListSkeleton({
  rows = SKELETON_ROWS.length,
  context = false,
}: {
  /** How many placeholder rows stand, at most five. */
  rows?: number;
  /** Whether each row holds a block for its context before its time, as an item row given a `context` draws it. */
  context?: boolean;
}): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_ITEMS}>
      <List label={TAB_WORDS.INBOX}>
        {SKELETON_ROWS.slice(0, rows).map(({ title, preview }) => (
          <ListRow
            key={title}
            leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_MARK} />}
            title={<Skeleton width={title} />}
            description={<Skeleton width={preview} />}
            meta={
              context ? (
                <span className="home-row-meta">
                  <Skeleton width={SKELETON_CONTEXT} />
                  <Skeleton width={SKELETON_TIME} />
                </span>
              ) : (
                <Skeleton width={SKELETON_TIME} />
              )
            }
            metaAt={LIST_ROW_META.TITLE}
          />
        ))}
      </List>
    </SkeletonRegion>
  );
}

/**
 * The list's head: the Inbox's name, the view's menu at the list's top
 * right on the window's Inbox, and under them the tabs that choose what it
 * lists; a task's own Inbox lists one task's items in one run, so it has no
 * menu. On the window's Inbox its heading and its button glide as the
 * sidebar folds, the name moving to the list's middle, clear of the
 * sidebar's toggle, and the button keeping to the list's edge.
 */
function ListHead({
  head,
  ids,
  readerId,
}: {
  head: InboxListHead;
  ids: ShowTabIds;
  readerId: string | undefined;
}): React.JSX.Element {
  const { shown, show, view, counts } = head;
  return (
    <>
      <header className="desktop-toolbar inbox-tasks-bar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">Inbox</h1>
        </div>
        <div className="desktop-toolbar-actions">
          {view === undefined ? null : (
            <ViewOptions
              shown={shown}
              choices={view.choices}
              readerId={readerId}
              readAll={head.readAll}
            />
          )}
        </div>
      </header>
      <ShowTabs show={show} counts={counts} ids={ids} />
      {view === undefined ? null : <WhoseChip whose={view.choices} readerId={readerId} />}
    </>
  );
}

/** What the list's head offers: its tabs on every Inbox, and on the window's how it groups its items and which plans are folded. */
export interface InboxListHead {
  /** Whether the list is on screen, for its menu not to outlive it. */
  readonly shown: boolean;
  /** The tab the list shows, and the press that shows another. */
  readonly show: InboxShowChoice;
  /** How many items each tab lists, filtered out or not. */
  readonly counts: InboxCounts;
  /** The window's Inbox's grouping and its plans' folds; none on a task's own, which lists one task's items in one run. */
  readonly view: { readonly choices: InboxViewChoices; readonly folds: InboxTaskFolds } | undefined;
  /** Mark all as read, in the view's menu, where the list marks its items. */
  readonly readAll?: InboxReadAll | undefined;
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
 * row is focused: the keyboard goes to the tab shown, the control that left
 * it out. Note that a removed row fires no blur, so the row last focused is
 * remembered and looked for after every render.
 */
function useRowFocusKept(rows: InboxRowPresses): RowFocus {
  const ref = useRef<HTMLElement | null>(null);
  const focusedRow = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const list = ref.current;
    const row = focusedRow.current;
    if (list === null || row === undefined || list.hidden) return;
    if (rows.find(row) !== undefined) return;
    focusedRow.current = undefined;
    if (document.activeElement !== null && document.activeElement !== document.body) return;
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
  onChoose,
  onMark,
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
  /** Which of the Inbox's columns stand. */
  columns: InboxColumnsShown;
  /** Where each row's press is kept, by the item it opens. */
  rows: InboxRowPresses;
  onChoose: (listed: InboxListed) => void;
  /** Marks an item read or unread from its row; none where the rows offer no mark. */
  onMark?: ((listed: InboxListed, unread: boolean) => void) | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const { width, onResize } = useInboxListWidth();
  const rowFocus = useRowFocusKept(rows);
  // Note that only the window's Inbox shows its rows' media, as its view's menu chooses; a task's own shows none.
  // The reads hold the pictures of the items listed alone, and none while the rows show no media.
  const previews = head.view?.choices.mediaPreviews === true;
  const mediaReads = useRowMediaReads(
    previews ? listedItems(view).map(({ item }) => item.id) : NO_ITEMS,
  );
  const media = previews ? mediaReads : undefined;
  const edge = useResizableEdge({
    side: EDGE_SIDE.RIGHT,
    width,
    bounds: INBOX_LIST_WIDTH,
    reserve: () => PANE_RESERVE,
    label: "Resize inbox list",
    onResize,
  });
  const panel = useId();
  const tabs = useId();
  // Note that a row names its task wherever no task's header stands over it, and a teammate's face wherever no person's does.
  const row = (listed: InboxListed) => (
    <InboxItemRow
      key={listed.item.id}
      listed={listed}
      chosen={listed.item.id === chosen}
      open={listed.item.id === chosen && columns === INBOX_COLUMNS.BOTH}
      now={now}
      models={models}
      readerId={readerId}
      face={view.grouping !== INBOX_GROUPING.PERSON}
      chip={head.view !== undefined && view.grouping !== INBOX_GROUPING.TASK}
      media={media}
      ref={rows.hold(listed.item.id)}
      onChoose={onChoose}
      onMark={onMark}
    />
  );
  const needingYou = (items: readonly InboxListed[]) =>
    items.filter((listed) => needsYouOf(listed, view.readerId)).length;
  const statusSection = ({ key, status, items }: InboxStatusGroup) => {
    const folded = head.view?.folds.folded(key) ?? false;
    return (
      <div key={key} className="sidebar-repository">
        <StatusHeader
          status={status}
          folded={folded}
          count={needingYou(items)}
          onToggle={() => head.view?.folds.toggle(key)}
        />
        {folded ? null : <ul className="sidebar-tasks">{items.map(row)}</ul>}
      </div>
    );
  };
  const personSection = ({ key, starter, items }: InboxPersonGroup) => {
    const folded = head.view?.folds.folded(key) ?? false;
    return (
      <div key={key} className="sidebar-repository">
        <PersonHeader
          starter={starter}
          readerId={readerId}
          folded={folded}
          count={needingYou(items)}
          onToggle={() => head.view?.folds.toggle(key)}
        />
        {folded ? null : <ul className="sidebar-tasks">{items.map(row)}</ul>}
      </div>
    );
  };
  return (
    <nav
      ref={rowFocus.ref}
      className="inbox-tasks"
      aria-label="Inbox items"
      hidden={columns === INBOX_COLUMNS.ITEM}
      onFocus={rowFocus.onFocus}
      onBlur={rowFocus.onBlur}
      style={{ width: drawnWidth(width, columns !== INBOX_COLUMNS.BOTH) }}
    >
      <ListHead head={head} ids={{ tabs, panel }} readerId={readerId} />
      <ScrollArea
        id={panel}
        role="tabpanel"
        aria-labelledby={showTabId(tabs, head.show.show)}
        fade={SCROLL_FADE.START}
      >
        <div className="inbox-tasks-body">
          {view.grouping === INBOX_GROUPING.NONE ? (
            <ul className="sidebar-tasks">{view.items.map(row)}</ul>
          ) : view.grouping === INBOX_GROUPING.PERSON ? (
            view.groups.map(personSection)
          ) : view.grouping === INBOX_GROUPING.STATUS ? (
            view.groups.map(statusSection)
          ) : (
            view.groups.map(({ holder, items }) => {
              const key = holderKey(holder);
              const folded = head.view?.folds.folded(key) ?? false;
              return (
                <div key={key} className="sidebar-repository">
                  <HolderHeader
                    holder={holder}
                    folded={folded}
                    count={needingYou(items.map((item) => ({ holder, item })))}
                    onToggle={() => head.view?.folds.toggle(key)}
                  />
                  {folded ? null : (
                    <ul className="sidebar-tasks">{items.map((item) => row({ holder, item }))}</ul>
                  )}
                </div>
              );
            })
          )}
          {note}
        </div>
      </ScrollArea>
      {columns === INBOX_COLUMNS.BOTH ? <SidebarResizeEdge edge={edge} /> : null}
    </nav>
  );
}
