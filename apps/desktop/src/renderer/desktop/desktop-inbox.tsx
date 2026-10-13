import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { ExternalLinkIcon, InboxIcon } from "lucide-react";
import { useEffect } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import { InboxBoard } from "../planning/inbox-board";
import { useMinute } from "../planning/plan-time";
import { useCodingAgents } from "../planning/use-coding-agents";
import { useOpenLink } from "../planning/use-open-link";
import { usePlanInbox } from "../planning/use-plan-inbox";
import type { PlansControl } from "../planning/use-plans-tab";
import { SidebarPlan } from "./plan-actions";

/**
 * desktop-inbox.tsx -- the window's Inbox: every plan holding an inbox item in a column of its own, and the chosen plan's items beside it.
 *
 * It stands in the plan's place beside the sidebar, whose Inbox row is
 * marked while it does, the way a mail app's mailbox stands beside its
 * folders. The column lists each plan holding an item, waiting or settled,
 * the plan whose item changed latest first, each on the sidebar's own plan
 * row (`plan-actions.tsx`), its card, menu, and buttons with it: the name,
 * in the heavier weight while an item waits on the developer, and how many
 * wait in the time's place. Waiting is the Inbox's one word for an item not
 * yet answered, and the sidebar's Inbox row counts the same items. Its head
 * names the Inbox and offers All and Waiting, which lists only the plans
 * with an item waiting; the plan chosen stays listed as its items are
 * answered, so what the developer answers does not slip away from under
 * them.
 *
 * The chosen plan's items stand beside the column, drawn by the per-plan
 * Inbox tab's own board (`inbox-board.tsx`), answered in place, under a
 * toolbar naming the plan with Open plan at its end. They are read on the
 * plan's own held read, whichever plan the host has open. An
 * agent's name opens the plan on its tab, and a code block's Open its
 * file, each leaving the Inbox. With nothing listed, it says so under the
 * Inbox's glyph (`empty-state.tsx`). Escape leaves it for the plan it
 * stood over, and so does any row of the sidebar.
 */

/** What the Inbox says with no plan holding an item, or none waiting under the filter. */
const NOTHING_WAITING = "Nothing is waiting on you.";

/** The column's two lists, as its segments name them. */
const INBOX_FILTER = {
  ALL: "All",
  WAITING: "Waiting",
} as const;

/** One plan the column lists: the plan, and how many of its items wait on the developer. */
interface InboxPlanRow {
  readonly plan: PlanSummary;
  readonly waiting: number;
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
    return [{ plan, waiting }];
  });
}

/** The column: its head with the filter, then a sidebar plan row for each plan, or the filter's note where none waits. */
function InboxPlanList({
  plans,
  rows,
  chosen,
  waitingOnly,
  onChoose,
  onWaitingOnly,
}: {
  plans: PlansControl;
  rows: readonly InboxPlanRow[];
  chosen: string | undefined;
  waitingOnly: boolean;
  onChoose: (planId: string) => void;
  onWaitingOnly: (waitingOnly: boolean) => void;
}): React.JSX.Element {
  const now = useMinute();
  return (
    <nav className="inbox-plans" aria-label="Plans with inbox items">
      <header className="desktop-toolbar inbox-plans-bar">
        <h1 className="desktop-toolbar-title">Inbox</h1>
        <fieldset className="settings-segments" aria-label="Show">
          {[INBOX_FILTER.ALL, INBOX_FILTER.WAITING].map((filter) => (
            <button
              key={filter}
              type="button"
              className="settings-segment"
              aria-pressed={(filter === INBOX_FILTER.WAITING) === waitingOnly}
              onClick={() => onWaitingOnly(filter === INBOX_FILTER.WAITING)}
            >
              {filter}
            </button>
          ))}
        </fieldset>
      </header>
      <div className="inbox-plans-scroll">
        {rows.length === 0 && waitingOnly ? (
          <p className="sidebar-note">{NOTHING_WAITING}</p>
        ) : null}
        <ul className="sidebar-plans">
          {rows.map(({ plan, waiting }) => (
            <SidebarPlan
              key={plan.id}
              plans={plans}
              plan={plan}
              current={plan.id === chosen}
              unread={waiting > 0}
              now={now}
              onOpen={() => onChoose(plan.id)}
              inbox={{ waiting, onOpenPlan: () => plans.onShowPlan(plan.id) }}
            />
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * The chosen plan's items under a toolbar naming the plan, with Open plan
 * at its end, read on the plan's own held read.
 */
function InboxPlanItems({
  plans,
  plan,
}: {
  plans: PlansControl;
  plan: PlanSummary;
}): React.JSX.Element {
  const { act } = useAct();
  const openLink = useOpenLink();
  const planId = plan.id;
  const agents = useCodingAgents({
    acts: { act },
    planId,
    repository: plan.repository,
    archived: false,
    onUnarchive: () => undefined,
    // The inbox draws no agent's composer, so nothing here opens Settings.
    onOpenIntegrations: () => undefined,
    onStarted: () => undefined,
  });
  const inbox = usePlanInbox({
    planId,
    shown: plans.shown,
    waiting: plans.inbox.some((each) => each.planId === planId),
    agents,
  });
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
          openLink={openLink}
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
  // The plan chosen stays listed under Waiting as it is answered; with none chosen, the list's first stands in.
  const listed = view.waitingOnly ? rows.filter((row) => row.waiting > 0 || row === asked) : rows;
  const chosen = asked ?? listed[0];
  // Note that the plan standing in is chosen outright, because one answered under
  // Waiting would otherwise leave the list and hand its place to the next.
  const { onChoose } = view;
  const standIn = chosen !== undefined && chosen !== asked ? chosen.plan.id : undefined;
  useEffect(() => {
    if (standIn !== undefined) onChoose(standIn);
  }, [standIn, onChoose]);
  return (
    <div className="inbox-view">
      <InboxPlanList
        plans={plans}
        rows={listed}
        chosen={chosen?.plan.id}
        waitingOnly={view.waitingOnly}
        onChoose={view.onChoose}
        onWaitingOnly={view.onWaitingOnly}
      />
      {chosen === undefined ? (
        <section className="inbox-view-items" aria-label="Inbox">
          <header className="desktop-toolbar" />
          <EmptyState icon={<InboxIcon />}>{NOTHING_WAITING}</EmptyState>
        </section>
      ) : (
        <InboxPlanItems key={chosen.plan.id} plans={plans} plan={chosen.plan} />
      )}
    </div>
  );
}
