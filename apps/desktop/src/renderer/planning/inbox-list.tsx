import { INBOX_STATUS } from "@luke/features/inbox-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import type { PlanSummary } from "@luke/features/plan-wire";
import { DocumentIcon } from "@luke/ui";
import { ArrowDownNarrowWideIcon, InboxIcon, SlidersHorizontalIcon } from "lucide-react";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { SidebarResizeEdge } from "../desktop/desktop-sidebar";
import {
  INBOX_LIST_WIDTH,
  type InboxPlanFolds,
  type InboxViewChoices,
  useInboxListWidth,
} from "../desktop/folded-groups";
import { SidebarGroupHeader } from "../desktop/sidebar-group-header";
import { EDGE_SIDE, useResizableEdge } from "../desktop/use-resizable-edge";
import { Tooltip } from "../tooltip";
import { AgentRef, lineSubject } from "./agent-ref";
import {
  INBOX_GROUPING,
  type InboxGrouping,
  type InboxListed,
  type InboxListView,
  NEEDS_YOU,
} from "./inbox-model";
import { useMinute } from "./plan-time";
import { RelativeTime } from "./relative-time";
import { AgentGlyph } from "./tab-look";
import { cardTitle } from "./tool-call-model";

/**
 * inbox-list.tsx -- the Inbox's list of items: one row each, under its plan's group header or in one run, with what the list shows and how at its head.
 *
 * The list is drawn from the sidebar's own pieces, so it reads as the
 * sidebar does. A plan's items stand under the sidebar's own group header
 * (`sidebar-group-header.tsx`), the plan's glyph giving way to its chevron
 * under the pointer, a press folding the group, and each fold kept across
 * launches as a sidebar group's is. An item is a sidebar row: the mark of
 * the agent that posted it, as the plan's summary names the agent, its
 * title, and how long ago it last changed; a press chooses it, for the
 * pane beside the list to show. The mark hangs the agent's tab's card
 * while the pointer rests on it (`agent-ref.tsx`), where the plan's row
 * names the agent, and leaves the press to its row, whose pane opens the
 * agent. An item that needs the developer's answer reads as a mail app's
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
 * checked; both are kept across launches. The plan page's own Inbox lists
 * one plan's items, so its list has neither head nor groups. Either list
 * is resized from its right edge as the sidebar is, and keeps one width
 * between them across launches.
 */

/** What the head's menu button is called. */
const VIEW_OPTIONS = "View options";

/** What a press on Needs you does, as its tooltip says: list only what needs the developer, or everything again. */
const NEEDS_YOU_PRESS = {
  ONLY: "Show only what needs you",
  ALL: "Show all",
} as const;

/**
 * What the list leaves the pane beside it, in CSS pixels: the list is
 * dragged no wider than the Inbox less this.
 */
const PANE_RESERVE = 360;

/**
 * The width the list is drawn at: the one kept, held no wider than the
 * Inbox less the pane's reserve, though never under the least, so a window
 * narrowed under a wide list still leaves the pane its room, and widened
 * again gives the list back as it was kept. The Inbox is the container the
 * width is measured against (`.inbox-view` in desktop.css).
 */
function drawnWidth(width: number): string {
  return `min(${width}px, max(${INBOX_LIST_WIDTH.MIN}px, 100cqw - ${PANE_RESERVE}px))`;
}

/** The mark of the agent that posted an item, as the plan's summary lists it, hanging the agent's card, else the mark of an agent this window does not list. */
function ItemGlyph({
  plan,
  agentId,
  models,
}: {
  plan: PlanSummary;
  agentId: string;
  models: readonly CatalogModel[] | undefined;
}): React.JSX.Element {
  const agent = plan.agents?.agents.find((each) => each.id === agentId);
  if (agent === undefined) return <AgentGlyph agent={undefined} />;
  return (
    <AgentRef subject={lineSubject(agent, models)} models={models} onOpen={undefined}>
      <AgentGlyph agent={agent} />
    </AgentRef>
  );
}

/**
 * One item as a sidebar row: the agent's mark, the title, and how long ago it
 * changed; one that needs the developer in the unread weight with a dot past
 * its time. The home page's Needs you names the item's plan after its title,
 * in `context`, since its rows stand under no plan's header.
 */
export function InboxItemRow({
  listed,
  chosen,
  now,
  models,
  context,
  onChoose,
}: {
  listed: InboxListed;
  chosen: boolean;
  now: number;
  models: readonly CatalogModel[] | undefined;
  context?: string;
  onChoose: (listed: InboxListed) => void;
}): React.JSX.Element {
  const { plan, item } = listed;
  const title = cardTitle(item.title);
  const needsYou = item.status === INBOX_STATUS.OPEN;
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
        >
          <span className="sidebar-plan-line">
            <span className="sidebar-pinned-tab-glyph">
              <ItemGlyph plan={plan} agentId={item.agentId} models={models} />
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
    </li>
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
      label: "Group by plan",
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

/**
 * The window's head: the Inbox's name, and Needs you and the view's menu
 * at the list's top right. Its heading and its buttons glide as the
 * sidebar folds, the name moving to the list's middle, clear of the
 * sidebar's toggle, and the buttons keeping to the list's edge.
 */
function ListHead({
  shown,
  choices,
  waiting,
}: {
  shown: boolean;
  choices: InboxViewChoices;
  waiting: boolean;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar inbox-plans-bar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">Inbox</h1>
      </div>
      <div className="desktop-toolbar-actions">
        <NeedsYouOnly
          waiting={waiting}
          waitingOnly={choices.waitingOnly}
          onWaitingOnly={choices.onWaitingOnly}
        />
        <ViewOptions shown={shown} grouping={choices.grouping} onGrouping={choices.onGrouping} />
      </div>
    </header>
  );
}

/** What the list's head offers, on the window's Inbox: absent on a plan's own, which lists one plan's items alone. */
export interface InboxListHead {
  /** Whether the list is on screen, for its menu not to outlive it. */
  readonly shown: boolean;
  readonly choices: InboxViewChoices;
  readonly folds: InboxPlanFolds;
  /** Whether any item needs the developer, filtered out or not, for Needs you's dot. */
  readonly waiting: boolean;
}

/** The list: its head where it has one, then each plan's group of rows, or every row in one run, or a line where nothing is listed. */
export function InboxList({
  view,
  chosen,
  head,
  note,
  models,
  onChoose,
}: {
  view: InboxListView;
  /** The id of the item the pane shows. */
  chosen: string | undefined;
  /** The catalog as last read, which names each agent's model on its card. */
  models: readonly CatalogModel[] | undefined;
  head: InboxListHead | undefined;
  /** What stands under the rows: the list's empty line, a spinner, or a read that did not answer. */
  note: React.ReactNode;
  onChoose: (listed: InboxListed) => void;
}): React.JSX.Element {
  const now = useMinute();
  const { width, onResize } = useInboxListWidth();
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
      onChoose={onChoose}
    />
  );
  return (
    <nav className="inbox-plans" aria-label="Inbox items" style={{ width: drawnWidth(width) }}>
      {head === undefined ? null : (
        <ListHead shown={head.shown} choices={head.choices} waiting={head.waiting} />
      )}
      <div className="inbox-plans-scroll">
        {view.grouping === INBOX_GROUPING.NEWEST ? (
          <ul className="sidebar-plans">{view.items.map(row)}</ul>
        ) : (
          view.groups.map(({ plan, items }) => {
            const folded = head?.folds.folded(plan.id) ?? false;
            return (
              <div key={plan.id} className="sidebar-repository">
                <SidebarGroupHeader
                  glyph={<DocumentIcon />}
                  name={plan.name}
                  folded={folded}
                  count={items.filter(({ status }) => status === INBOX_STATUS.OPEN).length}
                  noun={NEEDS_YOU.COUNT}
                  steady
                  onToggle={() => head?.folds.toggle(plan.id)}
                />
                {folded ? null : (
                  <ul className="sidebar-plans">{items.map((item) => row({ plan, item }))}</ul>
                )}
              </div>
            );
          })
        )}
        {note}
      </div>
      <SidebarResizeEdge edge={edge} />
    </nav>
  );
}
