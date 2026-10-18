import { INBOX_STATUS, type InboxItem } from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { CatalogModel } from "@luke/features/models-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  DocumentIcon,
  EmptyState,
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_META,
  ListRow,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
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
import {
  ArrowDownNarrowWideIcon,
  CheckCheckIcon,
  FactoryIcon,
  InboxIcon,
  MailIcon,
  MailOpenIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { ACTOR_SIZE, ActorMark, AutomationCard, automationActor } from "../actor-ref";
import { AttentionMark } from "../attention-mark";
import { useAutomation } from "../automation-directory";
import { useCopyLinkItem } from "../copy-link-item";
import { ActionMenu, type MenuAction } from "../desktop/action-menu";
import { SidebarResizeEdge } from "../desktop/desktop-sidebar";
import {
  INBOX_LIST_WIDTH,
  type InboxTaskFolds,
  type InboxViewChoices,
  type InboxWaitingOnly,
  useInboxListWidth,
} from "../desktop/folded-groups";
import { SidebarGroupHeader } from "../desktop/sidebar-group-header";
import { EDGE_SIDE, useResizableEdge } from "../desktop/use-resizable-edge";
import { useMemberDirectory } from "../member-directory";
import { Tooltip } from "../tooltip";
import { AgentMarkRef, type AgentSubject, lineSubject, tasklessSubject } from "./agent-ref";
import {
  INBOX_COLUMNS,
  type InboxColumnsShown,
  type InboxRowPresses,
  needsYouButton,
} from "./inbox-columns";
import {
  holderKey,
  holderName,
  INBOX_GROUPING,
  INBOX_HOLDER,
  type InboxGrouping,
  type InboxHolder,
  type InboxListed,
  type InboxListView,
  type InboxPersonGroup,
  type InboxStarter,
  inboxPreview,
  isUnread,
  NEEDS_YOU,
  needsReader,
  readersItem,
} from "./inbox-model";
import { RelativeTime } from "./relative-time";
import { markReadItem } from "./task-menu-items";
import { useMinute } from "./task-time";
import { cardTitle } from "./tool-call-model";

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
 * none does. The head names the Inbox and, at its right, offers two
 * buttons: Needs you, pressed while the list holds only what needs the
 * developer, the way a mail app shows unread mail only, its glyph the
 * Inbox's own wearing a dot in the attention mark's orange while anything
 * needs the developer, filtered out or not, its pressed fill alone saying the filter
 * is on and its tooltip what a press does; and one whose menu says
 * how the list groups its items, by plan, by person, or newest first, the
 * choice checked, and under them Mark all as read, which clears the dots
 * alone; both choices are kept across launches. Grouped by person, each
 * person's items stand under their face, the reader's own first as You, and
 * a row names its plan where it wears no face, since the header says whose
 * it is. Where Needs you leaves out every
 * item listed, the list says so in the Inbox's empty state, with Show all to
 * turn the filter off, as a mail app's empty unread view does; the item the
 * pane shows keeps its place there, though no row. A task's own Inbox lists one
 * task's items in one run, so its head offers Needs you alone, kept apart
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

/** What the view's menu offers to clear every dot with. */
const MARK_ALL_READ = "Mark all as read";

/** What the head's menu button is called. */
const VIEW_OPTIONS = "View options";

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

/** How wide a placeholder row's mark stands, an agent's tile at its inline size (`.actor-mark`). */
const SKELETON_MARK = "16px";

/** What a press on Needs you does, as its tooltip says: list only what needs the developer, or everything again. */
const NEEDS_YOU_PRESS = {
  ONLY: "Show only what needs you",
  ALL: "Show all",
} as const;

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
 * leaving the press to its row; a bare tile of no known harness where the
 * holder names no such agent.
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
  if (subject === undefined) return <ActorMark actor={UNNAMED_AGENT} />;
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
 * the list hands down `onMark`, the row offers to mark it read or unread:
 * a press over its time while the pointer rests on it or it holds the
 * keyboard, the time and its marks stepping aside, and the first item of
 * its right-click menu, which names the key that does the same to the
 * chosen item (`APP_COMMAND.TOGGLE_INBOX_ITEM_READ`). The home page's Inbox
 * names the item's plan at the row's end, in `context`, since its rows stand
 * under no plan's header, as a person's group does. Its right-click offers
 * Copy link, the item's link under the task or the agent that holds it, where
 * the list hands down a workspace to write it under.
 */
export function InboxItemRow({
  listed,
  chosen,
  now,
  models,
  readerId,
  context,
  face = true,
  ref,
  onChoose,
  onMark,
}: {
  listed: InboxListed;
  chosen: boolean;
  now: number;
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards and rows name no starter, and whose own open items alone need them. */
  readerId: string | undefined;
  context?: string;
  /** Whether a teammate's item wears their face, which a person's group header says instead. */
  face?: boolean;
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
  const needsYou = needsReader(item, reader);
  const starter = readersItem(item, reader)
    ? undefined
    : personActor(item.startedBy, directory.members, reader, directory.former);
  const preview = inboxPreview(item, (member) =>
    actorName(personActor(member, directory.members, reader, directory.former)),
  );
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

/** The head's button that drops the menu of how the list groups its items, the choice checked. */
function ViewOptions({
  shown,
  grouping,
  onGrouping,
  readAll,
}: {
  shown: boolean;
  grouping: InboxGrouping;
  onGrouping: (grouping: InboxGrouping) => void;
  readAll: InboxReadAll | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const choices: MenuAction[] = [
    {
      label: "Group by task",
      icon: <DocumentIcon />,
      checked: grouping === INBOX_GROUPING.TASK,
      onSelect: () => onGrouping(INBOX_GROUPING.TASK),
    },
    {
      label: "Group by person",
      icon: <UsersIcon />,
      checked: grouping === INBOX_GROUPING.PERSON,
      onSelect: () => onGrouping(INBOX_GROUPING.PERSON),
    },
    {
      label: "Newest first",
      icon: <ArrowDownNarrowWideIcon />,
      checked: grouping === INBOX_GROUPING.NEWEST,
      onSelect: () => onGrouping(INBOX_GROUPING.NEWEST),
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
          groups={
            readAll === undefined
              ? [choices]
              : [
                  choices,
                  [
                    {
                      label: MARK_ALL_READ,
                      icon: <CheckCheckIcon />,
                      disabled: !readAll.unread,
                      onSelect: readAll.onMarkAll,
                    },
                  ],
                ]
          }
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The head's button that lists only what needs the developer while it is pressed, its glyph wearing a dot in the attention mark's orange while anything does. */
function NeedsYouOnly({
  waiting,
  waitingOnly,
  onWaitingOnly,
}: {
  waiting: boolean;
  waitingOnly: boolean;
  onWaitingOnly: (waitingOnly: boolean) => void;
}): React.JSX.Element {
  return (
    <Tooltip label={waitingOnly ? NEEDS_YOU_PRESS.ALL : NEEDS_YOU_PRESS.ONLY}>
      <IconButton
        icon={
          <InboxIcon className="inbox-needs-you-glyph" data-waiting={String(waiting)}>
            {/* Note that the dot's place and size are desktop.css's, beside the cut it stands in. */}
            {waiting ? <circle className="inbox-needs-you-dot" /> : null}
          </InboxIcon>
        }
        label={NEEDS_YOU.LABEL}
        pressed={waitingOnly}
        onClick={() => onWaitingOnly(!waitingOnly)}
      />
    </Tooltip>
  );
}

/** What the list stands where Needs you leaves out every item listed: nothing needs the developer, and Show all, which turns the filter off and keeps the list standing where the Inbox shows one column. */
export function NeedsYouEmpty({
  needsYou,
  onList,
}: {
  needsYou: InboxWaitingOnly;
  /** Asks the Inbox for its list, so the item chosen once the rows return does not stand in their place. */
  onList: () => void;
}): React.JSX.Element {
  return (
    <EmptyState
      icon={<InboxIcon />}
      title={NEEDS_YOU.NONE}
      action={{
        label: NEEDS_YOU_PRESS.ALL,
        onClick: () => {
          onList();
          needsYou.onWaitingOnly(false);
        },
      }}
    >
      {NEEDS_YOU.ANSWERED}
    </EmptyState>
  );
}

/**
 * The list while its items are first read: rows in an item's own row, a
 * block where its agent's tile, its title, its time, and the line under
 * them will stand, so the
 * items land where the blocks stood rather than a lone ring in the list's
 * corner. The rows open nothing and the region says what is being read.
 */
export function InboxListSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_ITEMS}>
      <ul className="sidebar-tasks">
        {SKELETON_ROWS.map(({ title, preview }) => (
          <ListRow
            key={title}
            leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_MARK} />}
            title={<Skeleton width={title} />}
            description={<Skeleton width={preview} />}
            meta={<Skeleton width={SKELETON_TIME} />}
            metaAt={LIST_ROW_META.TITLE}
          />
        ))}
      </ul>
    </SkeletonRegion>
  );
}

/**
 * The list's head: the Inbox's name, and Needs you and, on the window's
 * Inbox, the view's menu at the list's top right; a task's own Inbox lists
 * one task's items in one run, so it has no menu. On the window's Inbox its
 * heading and its buttons glide as the sidebar folds, the name moving to the
 * list's middle, clear of the sidebar's toggle, and the buttons keeping to
 * the list's edge.
 */
function ListHead({ head }: { head: InboxListHead }): React.JSX.Element {
  const { shown, needsYou, view, waiting } = head;
  return (
    <header className="desktop-toolbar inbox-tasks-bar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">Inbox</h1>
      </div>
      <div className="desktop-toolbar-actions">
        <NeedsYouOnly
          waiting={waiting}
          waitingOnly={needsYou.waitingOnly}
          onWaitingOnly={needsYou.onWaitingOnly}
        />
        {view === undefined ? null : (
          <ViewOptions
            shown={shown}
            grouping={view.choices.grouping}
            onGrouping={view.choices.onGrouping}
            readAll={head.readAll}
          />
        )}
      </div>
    </header>
  );
}

/** What the list's head offers: Needs you on every Inbox, and on the window's how it groups its items and which plans are folded. */
export interface InboxListHead {
  /** Whether the list is on screen, for its menu not to outlive it. */
  readonly shown: boolean;
  readonly needsYou: InboxWaitingOnly;
  /** The window's Inbox's grouping and its plans' folds; none on a task's own, which lists one task's items in one run. */
  readonly view: { readonly choices: InboxViewChoices; readonly folds: InboxTaskFolds } | undefined;
  /** Whether any item needs the developer, filtered out or not, for Needs you's dot. */
  readonly waiting: boolean;
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
 * row is focused: the keyboard goes to Needs you, the control that left it
 * out. Note that a removed row fires no blur, so the row last focused is
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
    needsYouButton(list)?.focus();
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
  const edge = useResizableEdge({
    side: EDGE_SIDE.RIGHT,
    width,
    bounds: INBOX_LIST_WIDTH,
    reserve: () => PANE_RESERVE,
    label: "Resize inbox list",
    onResize,
  });
  const row = (listed: InboxListed, byPerson = false) => (
    <InboxItemRow
      key={listed.item.id}
      listed={listed}
      chosen={listed.item.id === chosen}
      now={now}
      models={models}
      readerId={readerId}
      face={!byPerson}
      ref={rows.hold(listed.item.id)}
      {...(byPerson ? { context: holderName(listed.holder) } : undefined)}
      onChoose={onChoose}
      onMark={onMark}
    />
  );
  const needingYou = (items: readonly InboxItem[]) =>
    items.filter((item) => needsReader(item, view.readerId)).length;
  const personSection = ({ key, starter, items }: InboxPersonGroup) => {
    const folded = head.view?.folds.folded(key) ?? false;
    return (
      <div key={key} className="sidebar-repository">
        <PersonHeader
          starter={starter}
          readerId={readerId}
          folded={folded}
          count={needingYou(items.map(({ item }) => item))}
          onToggle={() => head.view?.folds.toggle(key)}
        />
        {folded ? null : (
          <ul className="sidebar-tasks">{items.map((listed) => row(listed, true))}</ul>
        )}
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
      <ListHead head={head} />
      <div className="inbox-tasks-scroll scroll-fade-top">
        {view.grouping === INBOX_GROUPING.NEWEST ? (
          <ul className="sidebar-tasks">{view.items.map((listed) => row(listed))}</ul>
        ) : view.grouping === INBOX_GROUPING.PERSON ? (
          view.groups.map(personSection)
        ) : (
          view.groups.map(({ holder, items }) => {
            const key = holderKey(holder);
            const folded = head.view?.folds.folded(key) ?? false;
            return (
              <div key={key} className="sidebar-repository">
                <HolderHeader
                  holder={holder}
                  folded={folded}
                  count={needingYou(items)}
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
      {columns === INBOX_COLUMNS.BOTH ? <SidebarResizeEdge edge={edge} /> : null}
    </nav>
  );
}
