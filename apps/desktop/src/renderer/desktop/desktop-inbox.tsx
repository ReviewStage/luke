import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { ExternalLinkIcon, InboxIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import { InboxBoard } from "../planning/inbox-board";
import { useCodingAgents } from "../planning/use-coding-agents";
import { usePlanInbox } from "../planning/use-plan-inbox";
import type { PlansControl } from "../planning/use-plans-tab";

/**
 * desktop-inbox.tsx -- the window's Inbox: every plan holding an inbox item in a column of its own, and the chosen plan's items beside it.
 *
 * It stands in the plan's place beside the sidebar, whose Inbox row is
 * marked while it does, the way a mail app's mailbox stands beside its
 * folders. The column lists each plan holding an item, waiting or settled,
 * the plan whose item changed latest first, one line each: a dot while an
 * item waits there the developer has not seen, the plan's name, in the
 * heavier weight then as an unread plan's is in the sidebar, and how many
 * items wait at its end, muted in even figures as a row's time is. Its
 * head names the Inbox and offers All and Unread, which lists only the
 * plans with an unread item; the plan chosen stays listed as it is read, so
 * what the developer reads does not slip away from under them.
 *
 * The chosen plan's items stand beside the column, drawn by the per-plan
 * Inbox tab's own board (`inbox-board.tsx`), answered in place, under a
 * toolbar naming the plan with Open plan at its end. They are read on the
 * plan's own held read, whichever plan the host has open, and the waiting
 * ones on screen count as read once that read lands (`inbox-reads.ts`). An
 * agent's name opens the plan on its tab, and a code block's Open its
 * file, each leaving the Inbox. With nothing listed, it says so under the
 * Inbox's glyph (`empty-state.tsx`). Escape leaves it for the plan it
 * stood over, and so does any row of the sidebar.
 */

/** What the Inbox says with no plan holding an item, or none unread under the filter. */
const NOTHING_HELD = "Nothing is waiting on you.";
const NOTHING_UNREAD = "No unread items.";

/** The column's two lists, as its segments name them. */
const INBOX_FILTER = {
  ALL: "All",
  UNREAD: "Unread",
} as const;

/** One plan the column lists: the plan, how many of its items wait, and how many of those are unread. */
interface InboxPlanRow {
  readonly plan: PlanSummary;
  readonly waiting: number;
  readonly unread: number;
}

/**
 * The column's rows in main's order, the plan whose item changed latest
 * first: each plan holding an item that the account's list holds. A plan
 * out of the list, archived or not yet read, is listed nowhere, as a pinned
 * tab of one is not.
 */
function inboxRows(plans: PlansControl): InboxPlanRow[] {
  return plans.inboxPlans.flatMap((holding): InboxPlanRow[] => {
    const plan = plans.plans.find((each) => each.id === holding.planId);
    if (plan === undefined) return [];
    const waiting = plans.inbox.find((each) => each.planId === holding.planId)?.items.length ?? 0;
    return [{ plan, waiting, unread: plans.inboxReads.unread(plan.id) }];
  });
}

/** One plan of the column, one line: its unread dot, its name, and how many of its items wait. */
function InboxPlanItem({
  row,
  chosen,
  onChoose,
}: {
  row: InboxPlanRow;
  chosen: boolean;
  onChoose: () => void;
}): React.JSX.Element {
  const { plan, waiting, unread } = row;
  return (
    <li className="sidebar-plan-item">
      <button
        type="button"
        className="sidebar-plan inbox-plan"
        aria-current={chosen ? "page" : undefined}
        data-unread={String(unread > 0)}
        onClick={onChoose}
      >
        <span className="sidebar-plan-line">
          <span className="inbox-unread-dot" aria-hidden="true" />
          <span className="sidebar-plan-name">{plan.name}</span>
          {unread > 0 ? <span className="visually-hidden">, unread</span> : null}
          {waiting === 0 ? null : (
            <span className="sidebar-inbox-count">
              {waiting}
              <span className="visually-hidden"> waiting</span>
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** The column: its head with the filter, then a line for each plan, or the filter's note where none is unread. */
function InboxPlanList({
  rows,
  chosen,
  unreadOnly,
  onChoose,
  onUnreadOnly,
}: {
  rows: readonly InboxPlanRow[];
  chosen: string | undefined;
  unreadOnly: boolean;
  onChoose: (planId: string) => void;
  onUnreadOnly: (unreadOnly: boolean) => void;
}): React.JSX.Element {
  return (
    <nav className="inbox-plans" aria-label="Plans with inbox items">
      <header className="desktop-toolbar inbox-plans-bar">
        <h1 className="desktop-toolbar-title">Inbox</h1>
        <fieldset className="settings-segments" aria-label="Show">
          {[INBOX_FILTER.ALL, INBOX_FILTER.UNREAD].map((filter) => (
            <button
              key={filter}
              type="button"
              className="settings-segment"
              aria-pressed={(filter === INBOX_FILTER.UNREAD) === unreadOnly}
              onClick={() => onUnreadOnly(filter === INBOX_FILTER.UNREAD)}
            >
              {filter}
            </button>
          ))}
        </fieldset>
      </header>
      <div className="inbox-plans-scroll">
        {rows.length === 0 && unreadOnly ? <p className="sidebar-note">{NOTHING_UNREAD}</p> : null}
        <ul className="sidebar-plans">
          {rows.map((row) => (
            <InboxPlanItem
              key={row.plan.id}
              row={row}
              chosen={row.plan.id === chosen}
              onChoose={() => onChoose(row.plan.id)}
            />
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * The chosen plan's items under a toolbar naming the plan, with Open plan
 * at its end, read on the plan's own held read and marked read as that
 * read lands with them on screen.
 */
function InboxPlanItems({
  plans,
  plan,
}: {
  plans: PlansControl;
  plan: PlanSummary;
}): React.JSX.Element {
  const { act, tell } = useAct();
  const planId = plan.id;
  const agents = useCodingAgents({
    acts: { act },
    planId,
    repository: plan.repository,
    archived: false,
    onUnarchive: () => undefined,
    onStarted: () => undefined,
  });
  const inbox = usePlanInbox({
    planId,
    shown: plans.shown,
    waiting: plans.inbox.some((each) => each.planId === planId),
    agents,
  });
  const open = useMemo(() => inbox.board.open.map((item) => item.id), [inbox.board.open]);
  const { onSeen } = plans.inboxReads;
  useEffect(() => {
    if (plans.shown && inbox.read) onSeen(planId, open);
  }, [plans.shown, inbox.read, planId, open, onSeen]);
  // Note that the models come from the open plan's agents where this plan's have not read them, so an agent is named alike in both.
  const named = { ...agents, models: agents.models ?? plans.agents.models };
  return (
    <section className="inbox-view-items" aria-label={plan.name}>
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">{plan.name}</h1>
        </div>
        <div className="desktop-toolbar-actions">
          <button type="button" className="toolbar-button" onClick={() => plans.onShowPlan(planId)}>
            <ExternalLinkIcon />
            Open plan
          </button>
        </div>
      </header>
      <section className="desktop-inbox" aria-label="Inbox items">
        <InboxBoard
          control={inbox}
          agents={named}
          onOpenAgent={(agentId) => plans.onShowAgent(planId, agentId)}
          openGitHub={(url) => tell(ACT_KIND.GITHUB_OPEN, { url })}
          code={{
            repository: plan.repository,
            readFile: (window) => act(ACT_KIND.PLANNING_FILE, { planId, ...window }),
            onOpenFile: (ref, commit) => plans.onShowFile(planId, ref, commit),
          }}
        />
      </section>
    </section>
  );
}

/** The window's Inbox, in the plan's place: the plans holding items, and the chosen one's items. */
export function DesktopInbox({ plans }: { plans: PlansControl }): React.JSX.Element {
  const view = plans.inboxView;
  useAppCommand(APP_COMMAND.EXIT_INBOX, view.onClose);
  const rows = inboxRows(plans);
  const asked = rows.find((row) => row.plan.id === view.planId);
  // The plan chosen stays listed under Unread as it is read; with none chosen, the list's first stands in.
  const listed = view.unreadOnly ? rows.filter((row) => row.unread > 0 || row === asked) : rows;
  const chosen = asked ?? listed[0];
  // Note that the plan standing in is chosen outright, because one read under
  // Unread would otherwise leave the list and hand its place to the next.
  const { onChoose } = view;
  const standIn = chosen !== undefined && chosen !== asked ? chosen.plan.id : undefined;
  useEffect(() => {
    if (standIn !== undefined) onChoose(standIn);
  }, [standIn, onChoose]);
  return (
    <div className="inbox-view">
      <InboxPlanList
        rows={listed}
        chosen={chosen?.plan.id}
        unreadOnly={view.unreadOnly}
        onChoose={view.onChoose}
        onUnreadOnly={view.onUnreadOnly}
      />
      {chosen === undefined ? (
        <section className="inbox-view-items" aria-label="Inbox">
          <header className="desktop-toolbar" />
          <EmptyState icon={<InboxIcon />}>
            {rows.length === 0 ? NOTHING_HELD : NOTHING_UNREAD}
          </EmptyState>
        </section>
      ) : (
        <InboxPlanItems key={chosen.plan.id} plans={plans} plan={chosen.plan} />
      )}
    </div>
  );
}
