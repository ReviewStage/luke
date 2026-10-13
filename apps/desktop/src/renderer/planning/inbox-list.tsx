import { INBOX_STATUS } from "@sidecar/hosted/inbox-wire";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { DocumentIcon } from "@sidecar/panel";
import { ArrowDownNarrowWideIcon, ListFilterIcon, SlidersHorizontalIcon } from "lucide-react";
import { ActionMenu, dropBelow, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { SidebarResizeEdge } from "../desktop/desktop-sidebar";
import {
  INBOX_LIST_WIDTH,
  type InboxPlanFolds,
  type InboxViewChoices,
  useInboxListWidth,
} from "../desktop/folded-groups";
import { type CountNoun, SidebarGroupHeader } from "../desktop/sidebar-group-header";
import { EDGE_SIDE, useResizableEdge } from "../desktop/use-resizable-edge";
import { GLYPH_STATE, StateGlyph } from "../state-glyph";
import { Tooltip } from "../tooltip";
import { AgentGlyph, AgentMark } from "./agent-tab";
import {
  INBOX_GROUPING,
  type InboxGrouping,
  type InboxListed,
  type InboxListView,
} from "./inbox-model";
import { sinceText, useMinute } from "./plan-time";
import { cardTitle } from "./tool-call-model";

/**
 * inbox-list.tsx -- the Inbox's list of items: one row each, under its plan's group header or in one run, with what the list shows and how at its head.
 *
 * The list is drawn from the sidebar's own pieces, so it reads as the
 * sidebar does. A plan's items stand under the sidebar's own group header
 * (`sidebar-group-header.tsx`), the plan's glyph giving way to its chevron
 * under the pointer, a press folding the group, a folded group counting
 * its items while hovered, and each fold kept across launches as a
 * sidebar group's is. An item is a sidebar row: the mark of the agent that
 * posted it, as the plan's summary names the agent, its title, in the
 * heavier weight while it waits on the developer, and how long ago it
 * last changed; a press chooses it, for the pane beside the list to show.
 * The head names the Inbox and, at its right, offers two buttons: Waiting
 * only, pressed while the list holds only what waits, the way a mail app
 * shows unread mail only, and one whose menu says how the list groups its
 * items, by plan or newest first, the choice checked; both are kept across
 * launches. The plan page's own Inbox lists one plan's items, so its list
 * has neither head nor groups. Either list is resized from its right edge
 * as the sidebar is, and keeps one width between them across launches.
 */

/** What a folded plan's count is read as. */
const ITEM_NOUN: CountNoun = { one: "item", many: "items" };

/** What the head's menu button is called. */
const VIEW_OPTIONS = "View options";

/** What the head's filter button is called. */
const WAITING_ONLY = "Waiting only";

/**
 * What the list leaves the pane beside it, in CSS pixels: the list is
 * dragged no wider than the Inbox less this.
 */
const PANE_RESERVE = 360;

/** The mark of the agent that posted an item, as the plan's summary lists it, else the mark of an agent of no known harness. */
function ItemGlyph({ plan, agentId }: { plan: PlanSummary; agentId: string }): React.JSX.Element {
  const agent = plan.agents?.agents.find((each) => each.id === agentId);
  if (agent !== undefined) return <AgentGlyph agent={agent} />;
  return <StateGlyph glyph={<AgentMark provider={undefined} />} state={GLYPH_STATE.REST} />;
}

/** One item as a sidebar row: the agent's mark, the title, in the heavier weight while it waits, and how long ago it changed. */
function ItemRow({
  listed,
  chosen,
  now,
  onChoose,
}: {
  listed: InboxListed;
  chosen: boolean;
  now: number;
  onChoose: (listed: InboxListed) => void;
}): React.JSX.Element {
  const { plan, item } = listed;
  const title = cardTitle(item.title);
  return (
    <li className="sidebar-plan-item inbox-row">
      <Tooltip label={title}>
        <button
          type="button"
          className="sidebar-plan"
          aria-current={chosen ? "page" : undefined}
          data-unread={String(item.status === INBOX_STATUS.OPEN)}
          data-item-id={item.id}
          onClick={() => onChoose(listed)}
        >
          <span className="sidebar-plan-line">
            <span className="sidebar-pinned-tab-glyph">
              <ItemGlyph plan={plan} agentId={item.agentId} />
            </span>
            <span className="sidebar-plan-name">{title}</span>
            <span className="sidebar-plan-time">{sinceText(item.updatedAt, now)}</span>
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
        <button
          type="button"
          className="icon-button"
          aria-label={VIEW_OPTIONS}
          aria-haspopup="menu"
          aria-expanded={menu.open !== undefined}
          onClick={(event) => {
            if (menu.open !== undefined) {
              menu.close(true);
              return;
            }
            menu.show(dropBelow(event.currentTarget), event.currentTarget);
          }}
        >
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

/** The head's button that lists only what waits while it is pressed. */
function WaitingOnly({
  waitingOnly,
  onWaitingOnly,
}: {
  waitingOnly: boolean;
  onWaitingOnly: (waitingOnly: boolean) => void;
}): React.JSX.Element {
  return (
    <Tooltip label={WAITING_ONLY}>
      <button
        type="button"
        className="icon-button inbox-waiting-only"
        aria-label={WAITING_ONLY}
        aria-pressed={waitingOnly}
        onClick={() => onWaitingOnly(!waitingOnly)}
      >
        <ListFilterIcon className="icon-button-glyph" />
      </button>
    </Tooltip>
  );
}

/**
 * The window's head: the Inbox's name, and Waiting only and the view's menu
 * at the list's top right. Its heading and its buttons glide as the
 * sidebar folds, the name making way for the sidebar's toggle and the
 * buttons keeping to the list's edge.
 */
function ListHead({
  shown,
  choices,
}: {
  shown: boolean;
  choices: InboxViewChoices;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar inbox-plans-bar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">Inbox</h1>
      </div>
      <div className="desktop-toolbar-actions">
        <WaitingOnly waitingOnly={choices.waitingOnly} onWaitingOnly={choices.onWaitingOnly} />
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
}

/** The list: its head where it has one, then each plan's group of rows, or every row in one run, or a line where nothing is listed. */
export function InboxList({
  view,
  chosen,
  head,
  note,
  onChoose,
}: {
  view: InboxListView;
  /** The id of the item the pane shows. */
  chosen: string | undefined;
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
    <ItemRow
      key={listed.item.id}
      listed={listed}
      chosen={listed.item.id === chosen}
      now={now}
      onChoose={onChoose}
    />
  );
  return (
    <nav className="inbox-plans" aria-label="Inbox items" style={{ width }}>
      {head === undefined ? null : <ListHead shown={head.shown} choices={head.choices} />}
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
                  count={items.length}
                  noun={ITEM_NOUN}
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
