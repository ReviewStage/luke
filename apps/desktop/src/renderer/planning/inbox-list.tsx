import { INBOX_STATUS } from "@luke/features/inbox-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { CatalogModel } from "@luke/features/models-wire";
import { DocumentIcon } from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE } from "@luke/ui/actor-model";
import {
  ArrowDownNarrowWideIcon,
  FactoryIcon,
  InboxIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { ActorMark, AutomationCard, automationActor } from "../actor-ref";
import { useAutomation } from "../automation-directory";
import { useCopyLinkItem } from "../copy-link-item";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { SidebarResizeEdge } from "../desktop/desktop-sidebar";
import {
  INBOX_LIST_WIDTH,
  type InboxPlanFolds,
  type InboxViewChoices,
  type InboxWaitingOnly,
  useInboxListWidth,
} from "../desktop/folded-groups";
import { SidebarGroupHeader } from "../desktop/sidebar-group-header";
import { EDGE_SIDE, useResizableEdge } from "../desktop/use-resizable-edge";
import { EmptyState } from "../empty-state";
import { Tooltip } from "../tooltip";
import { AgentRef, type AgentSubject, lineSubject, planlessSubject } from "./agent-ref";
import { INBOX_COLUMNS, type InboxColumnsShown } from "./inbox-columns";
import {
  holderKey,
  INBOX_GROUPING,
  INBOX_HOLDER,
  type InboxGrouping,
  type InboxHolder,
  type InboxListed,
  type InboxListView,
  NEEDS_YOU,
} from "./inbox-model";
import { useMinute } from "./plan-time";
import { RelativeTime } from "./relative-time";
import { cardTitle } from "./tool-call-model";

/**
 * inbox-list.tsx -- the Inbox's list of items: one row each, under its plan's group header or in one run, with what the list shows and how at its head.
 *
 * The list is drawn from the sidebar's own pieces, on the Inbox's own ground, so it reads as the
 * sidebar does. A plan's items stand under the sidebar's own group header
 * (`sidebar-group-header.tsx`), the plan's glyph giving way to its chevron
 * under the pointer, a press folding the group, and each fold kept across
 * launches as a sidebar group's is; an automation's agents stand under its
 * clock tile, which hangs its card. An item is a sidebar row: the tile of
 * the agent that posted it (`actor-ref.tsx`), as the plan's summary or
 * main's read of an agent with no plan names the agent, its title, and how
 * long ago it last changed; a press chooses it, for the pane beside the
 * list to show. The tile hangs the agent's tab's card while the pointer
 * rests on it (`agent-ref.tsx`), and leaves the press to its row, whose
 * pane opens the agent. An item that needs the developer's answer reads as a mail app's
 * unread mail does, a blue dot past its time beside its title in the
 * weight every unread row and tab reads in, in either grouping and
 * filtered or not; an answered one is settled, in the body's weight with
 * no dot. Only an item waiting on the developer wears the dot: a plan or a
 * tab with something unseen on it is unread, not waiting, and wears the
 * weight alone. A folded plan
 * counts what in it needs the developer, at rest, and says nothing where
 * none does. The head names the Inbox and, at its right, offers two
 * buttons: Needs you, pressed while the list holds only what needs the
 * developer, the way a mail app shows unread mail only, its glyph the
 * Inbox's own wearing the rows' blue dot while anything needs the
 * developer, filtered out or not, its pressed fill alone saying the filter
 * is on and its tooltip what a press does; and one whose menu says
 * how the list groups its items, by plan or newest first, the choice
 * checked; both are kept across launches. Where Needs you leaves out every
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

/** What the head's menu button is called. */
const VIEW_OPTIONS = "View options";

/** What a press on Needs you does, as its tooltip says: list only what needs the developer, or everything again. */
const NEEDS_YOU_PRESS = {
  ONLY: "Show only what needs you",
  ALL: "Show all",
} as const;

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

/** The agent that posted an item as its holder names it: the plan's summary's line, or main's line for an agent with no plan; none where neither holds it. */
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
      : planlessSubject(
          {
            title: line.agentTitle,
            model: line.agentModel,
            automationId: line.automationId,
            automationName: holder.automationId === null ? undefined : holder.name,
          },
          models,
        );
  }
  const line = holder.plan.agents?.agents.find((each) => each.id === agentId);
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
  return (
    <AgentRef subject={subject} models={models} onOpen={undefined}>
      <ActorMark actor={subject.tile} />
    </AgentRef>
  );
}

/**
 * One item as a sidebar row: the agent's mark, the title, and how long ago it
 * changed; one that needs the developer in the unread weight with a dot past
 * its time. The home page's Needs you names the item's plan after its title,
 * in `context`, since its rows stand under no plan's header. Its right-click offers
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
  onChoose,
}: {
  listed: InboxListed;
  chosen: boolean;
  now: number;
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards name no starter. */
  readerId: string | undefined;
  context?: string;
  onChoose: (listed: InboxListed) => void;
}): React.JSX.Element {
  const { holder, item } = listed;
  const title = cardTitle(item.title);
  const needsYou = item.status === INBOX_STATUS.OPEN;
  const menu = useActionMenu(true);
  const copyLink = useCopyLinkItem()(
    holder.kind === INBOX_HOLDER.PLAN
      ? { kind: LINK_PLACE.INBOX_ITEM, planId: holder.plan.id, itemId: item.id }
      : { kind: LINK_PLACE.INBOX_ITEM, agentId: item.agentId, itemId: item.id },
  );
  return (
    <li className="sidebar-plan-item inbox-row">
      <Tooltip label={title}>
        <button
          type="button"
          className="sidebar-plan"
          aria-current={chosen ? "page" : undefined}
          data-unread={String(needsYou)}
          data-item-id={item.id}
          onClick={() => onChoose(listed)}
          onContextMenu={copyLink === undefined ? undefined : menu.contextMenu()}
        >
          <span className="sidebar-plan-line">
            <span className="inbox-row-mark">
              <ItemMark
                holder={holder}
                agentId={item.agentId}
                models={models}
                readerId={readerId}
              />
            </span>
            <span className="sidebar-plan-name">{title}</span>
            {context === undefined ? null : <span className="home-row-context">{context}</span>}
            <RelativeTime
              className="sidebar-plan-time"
              at={item.updatedAt}
              now={now}
              hint={false}
            />
            {needsYou ? (
              <span className="inbox-row-dot">
                <span className="visually-hidden">{NEEDS_YOU.LABEL}</span>
              </span>
            ) : null}
          </span>
        </button>
      </Tooltip>
      {menu.drawn === undefined || copyLink === undefined ? null : (
        <ActionMenu
          label={ITEM_ACTIONS}
          menu={menu.drawn}
          groups={[[copyLink]]}
          onClose={menu.close}
        />
      )}
    </li>
  );
}

/**
 * A holder's group header: a plan's document glyph and name; an
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
  if (holder.kind === INBOX_HOLDER.PLAN) {
    return <SidebarGroupHeader glyph={<DocumentIcon />} name={holder.plan.name} {...shared} />;
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

/** The head's button that drops the menu of how the list groups its items, the choice checked. */
function ViewOptions({
  shown,
  grouping,
  onGrouping,
}: {
  shown: boolean;
  grouping: InboxGrouping;
  onGrouping: (grouping: InboxGrouping) => void;
}): React.JSX.Element {
  const menu = useActionMenu(shown);
  const choices: MenuAction[] = [
    {
      label: "Group by task",
      icon: <DocumentIcon />,
      checked: grouping === INBOX_GROUPING.PLAN,
      onSelect: () => onGrouping(INBOX_GROUPING.PLAN),
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
        <button type="button" className="icon-button" aria-label={VIEW_OPTIONS} {...menu.trigger()}>
          <SlidersHorizontalIcon className="icon-button-glyph" />
        </button>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={[choices]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The head's button that lists only what needs the developer while it is pressed, its glyph wearing the rows' dot while anything does. */
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
      <button
        type="button"
        className="icon-button inbox-needs-you-only"
        aria-label={NEEDS_YOU.LABEL}
        aria-pressed={waitingOnly}
        data-waiting={String(waiting)}
        onClick={() => onWaitingOnly(!waitingOnly)}
      >
        <InboxIcon className="icon-button-glyph">
          {/* Note that the dot's place and size are desktop.css's, beside the cut it stands in. */}
          {waiting ? <circle className="inbox-needs-you-dot" /> : null}
        </InboxIcon>
      </button>
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
      action={
        <button
          type="button"
          className="toolbar-button"
          onClick={() => {
            onList();
            needsYou.onWaitingOnly(false);
          }}
        >
          {NEEDS_YOU_PRESS.ALL}
        </button>
      }
    >
      {NEEDS_YOU.ANSWERED}
    </EmptyState>
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
    <header className="desktop-toolbar inbox-plans-bar">
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
  readonly view: { readonly choices: InboxViewChoices; readonly folds: InboxPlanFolds } | undefined;
  /** Whether any item needs the developer, filtered out or not, for Needs you's dot. */
  readonly waiting: boolean;
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
function useRowFocusKept(): RowFocus {
  const ref = useRef<HTMLElement | null>(null);
  const focusedRow = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const list = ref.current;
    const row = focusedRow.current;
    if (list === null || row === undefined || list.hidden) return;
    const rows = list.querySelectorAll<HTMLElement>("[data-item-id]");
    if ([...rows].some((each) => each.dataset.itemId === row)) return;
    focusedRow.current = undefined;
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    list.querySelector<HTMLElement>(".inbox-needs-you-only")?.focus();
  });
  return {
    ref,
    onFocus: (event) => {
      focusedRow.current =
        event.target instanceof HTMLElement ? event.target.dataset.itemId : undefined;
    },
    onBlur: () => {
      focusedRow.current = undefined;
    },
  };
}

/** The list: its head where it has one, then each plan's group of rows, or every row in one run, or a line where nothing is listed. */
export function InboxList({
  view,
  chosen,
  head,
  note,
  models,
  readerId,
  columns,
  onChoose,
}: {
  view: InboxListView;
  /** The id of the item the pane shows. */
  chosen: string | undefined;
  /** The catalog as last read, which names each agent's model on its card. */
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards name no starter, where a teammate's name theirs. */
  readerId: string | undefined;
  head: InboxListHead;
  /** What stands under the rows: the list's empty line, a spinner, or a read that did not answer. */
  note: React.ReactNode;
  /** Which of the Inbox's columns stand. */
  columns: InboxColumnsShown;
  onChoose: (listed: InboxListed) => void;
}): React.JSX.Element {
  const now = useMinute();
  const { width, onResize } = useInboxListWidth();
  const rowFocus = useRowFocusKept();
  const edge = useResizableEdge({
    side: EDGE_SIDE.RIGHT,
    width,
    bounds: INBOX_LIST_WIDTH,
    reserve: () => PANE_RESERVE,
    label: "Resize inbox list",
    onResize,
  });
  const row = (listed: InboxListed) => (
    <InboxItemRow
      key={listed.item.id}
      listed={listed}
      chosen={listed.item.id === chosen}
      now={now}
      models={models}
      readerId={readerId}
      onChoose={onChoose}
    />
  );
  return (
    <nav
      ref={rowFocus.ref}
      className="inbox-plans"
      aria-label="Inbox items"
      hidden={columns === INBOX_COLUMNS.ITEM}
      onFocus={rowFocus.onFocus}
      onBlur={rowFocus.onBlur}
      style={{ width: drawnWidth(width, columns !== INBOX_COLUMNS.BOTH) }}
    >
      <ListHead head={head} />
      <div className="inbox-plans-scroll scroll-fade-top">
        {view.grouping === INBOX_GROUPING.NEWEST ? (
          <ul className="sidebar-plans">{view.items.map(row)}</ul>
        ) : (
          view.groups.map(({ holder, items }) => {
            const key = holderKey(holder);
            const folded = head.view?.folds.folded(key) ?? false;
            return (
              <div key={key} className="sidebar-repository">
                <HolderHeader
                  holder={holder}
                  folded={folded}
                  count={items.filter(({ status }) => status === INBOX_STATUS.OPEN).length}
                  onToggle={() => head.view?.folds.toggle(key)}
                />
                {folded ? null : (
                  <ul className="sidebar-plans">{items.map((item) => row({ holder, item }))}</ul>
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
