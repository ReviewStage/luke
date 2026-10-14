import type { CodingAgentInboxParams } from "@sidecar/features/coding-agent-view";
import type { InboxItem } from "@sidecar/features/inbox-wire";
import { InboxIcon } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { AppInboxPlanHolding } from "#shared/messages/app-state";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import { InboxList } from "../planning/inbox-list";
import {
  anyNeedsYou,
  firstChoice,
  type InboxListed,
  type InboxPlanItems,
  inboxList,
  listedItems,
  NEEDS_YOU,
} from "../planning/inbox-model";
import { InboxPane } from "../planning/inbox-pane";
import { useMinute } from "../planning/plan-time";
import { useCodingAgents } from "../planning/use-coding-agents";
import { useInboxItems } from "../planning/use-inbox-items";
import { useOpenLink } from "../planning/use-open-link";
import { usePlanInbox } from "../planning/use-plan-inbox";
import type { PlansControl } from "../planning/use-plans-tab";
import { ReadFailure } from "../read-failure";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { useInboxPlanFolds, useInboxViewChoices } from "./folded-groups";
import { planCardOf } from "./plan-card";

/**
 * desktop-inbox.tsx -- the window's Inbox: every item of every plan holding one in a list of its own, and the chosen item read beside it.
 *
 * It stands in the plan's place beside the sidebar, whose Inbox row is
 * marked while it does, the way a mail app's mailbox stands beside its
 * folders. The list (`inbox-list.tsx`) holds the items of each plan main
 * says holds one, needing the developer or settled, each plan read whole
 * as main says it changed (`use-inbox-items.ts`), under its plan or newest
 * first, all or only what needs them, as the developer last chose; Needs
 * you is the Inbox's one name for an item not yet answered
 * (`inbox-model.ts`'s `NEEDS_YOU`), and the sidebar's Inbox row counts the
 * same items. A press on a row chooses it, and the pane beside the
 * list (`inbox-pane.tsx`) shows it as a thread, answered in place, on its
 * plan's own held read, which stands in for the list's read of that plan
 * so an answer shows at once. With nothing chosen, the first item listed
 * that waits stands chosen, else the first listed. The pane's crumbs open
 * the plan or the agent's tab, and a code block's Open its file, each
 * leaving the Inbox. With nothing listed, it says so under the Inbox's
 * glyph (`empty-state.tsx`). Escape leaves it for the plan it stood over,
 * and so does any row of the sidebar.
 */

/** What the list says where a plan's read did not answer. */
const NOT_READ = "Some items could not be read.";

/** The plans the list holds items of, in main's order: each holding one that the account's list holds, so an archived plan, or one not yet read, is listed nowhere. */
function listedHoldings(
  holdings: PlansControl["inboxPlans"],
  listed: PlansControl["plans"],
): readonly AppInboxPlanHolding[] {
  return holdings.filter((holding) => listed.some((plan) => plan.id === holding.planId));
}

/** What stands under the list's rows: a read that did not answer, the spinner while nothing is read, or the filter's empty line. */
function ListNote({
  failed,
  reading,
  empty,
  onRetry,
}: {
  failed: boolean;
  reading: boolean;
  empty: boolean;
  onRetry: () => void;
}): React.JSX.Element | null {
  if (failed) {
    return (
      <div className="sidebar-note">
        <ReadFailure line={NOT_READ} onRetry={onRetry} />
      </div>
    );
  }
  if (!empty) return null;
  if (reading) return <Spinner label="Loading inbox" size={SPINNER_SIZE.INLINE} />;
  return <p className="sidebar-note">{NEEDS_YOU.NONE}</p>;
}

/** The window's Inbox, in the plan's place: every plan's items, and the chosen one read beside them. */
export function DesktopInbox({ plans }: { plans: PlansControl }): React.JSX.Element {
  const view = plans.inboxView;
  useAppCommand(APP_COMMAND.EXIT_INBOX, view.onClose);
  const { act } = useAct();
  const openLink = useOpenLink();
  const now = useMinute();
  const choices = useInboxViewChoices();
  const folds = useInboxPlanFolds();
  const readInbox = useCallback(
    (params: CodingAgentInboxParams) => act(ACT_KIND.CODING_AGENTS_INBOX, params),
    [act],
  );
  const { inboxPlans, plans: listedPlans } = plans;
  const holdings = useMemo(
    () => listedHoldings(inboxPlans, listedPlans),
    [inboxPlans, listedPlans],
  );
  const read = useInboxItems({ holdings, readInbox });
  const chosenPlan = plans.plans.find((plan) => plan.id === view.chosen?.planId);
  const planId = chosenPlan?.id;
  const agents = useCodingAgents({
    acts: { act },
    planId,
    repository: chosenPlan?.repository ?? null,
    archived: false,
    onUnarchive: () => undefined,
    // The Inbox draws no agent's composer, so nothing here opens Settings.
    onOpenIntegrations: () => undefined,
    onOpenApiKeys: () => undefined,
    onStarted: () => undefined,
  });
  const live = usePlanInbox({
    planId,
    shown: plans.shown,
    waiting: plans.inbox.some((each) => each.planId === planId),
    agents,
  });
  // Note that the models come from the open plan's agents where this plan's have not read them, so an agent is named alike in both.
  const named = { ...agents, models: agents.models ?? plans.agents.models };
  // The chosen plan's own held read stands in for the list's once it answered, so an answer shows
  // at once, and only while it holds, since one that failed stops hearing what changed.
  const liveItems: readonly InboxItem[] = [...live.board.open, ...live.board.settled];
  const entries: InboxPlanItems[] = holdings.flatMap((holding) => {
    const plan = plans.plans.find((each) => each.id === holding.planId);
    if (plan === undefined) return [];
    const items =
      live.read && !live.failed && holding.planId === planId
        ? liveItems
        : read.items.get(holding.planId);
    return [{ plan, items: items ?? [] }];
  });
  const list = inboxList(entries, {
    grouping: choices.grouping,
    waitingOnly: choices.waitingOnly,
    chosen: view.chosen?.itemId,
  });
  const chosen = listedItems(list).find(({ item }) => item.id === view.chosen?.itemId);
  // Note that a chosen item whose plan is listed but not read yet keeps its place, because it may
  // be listed once the read lands; one whose plan left the list, archived elsewhere, gives way.
  const chosenWaits =
    planId !== undefined &&
    holdings.some((holding) => holding.planId === planId) &&
    !read.items.has(planId) &&
    !live.read;
  const standIn = chosen === undefined && !chosenWaits ? firstChoice(list) : undefined;
  const { onChoose } = view;
  const choose = useCallback(
    ({ plan, item }: InboxListed) => onChoose({ planId: plan.id, itemId: item.id }),
    [onChoose],
  );
  useEffect(() => {
    if (standIn !== undefined) choose(standIn);
  }, [standIn, choose]);
  const reading = holdings.some((holding) => !read.items.has(holding.planId));
  return (
    <div className="inbox-view">
      <InboxList
        view={list}
        chosen={chosen?.item.id}
        head={{ shown: plans.shown, choices, folds, waiting: anyNeedsYou(entries) }}
        models={named.models}
        note={
          <ListNote
            failed={read.failed}
            reading={reading}
            empty={listedItems(list).length === 0}
            onRetry={read.onRetry}
          />
        }
        onChoose={choose}
      />
      {chosen === undefined ? (
        <section className="inbox-view-items" aria-label="Inbox">
          <header className="desktop-toolbar" />
          {reading ? null : <EmptyState icon={<InboxIcon />}>{NEEDS_YOU.NONE}</EmptyState>}
        </section>
      ) : (
        <InboxPane
          plan={chosen.plan}
          item={chosen.item}
          control={live}
          agents={named}
          doors={{
            onOpenPlan: () => plans.onShowPlan(chosen.plan.id),
            planCard: planCardOf(plans, chosen.plan, now),
            onOpenAgent: (agentId) => plans.onShowAgent(chosen.plan.id, agentId),
            openLink,
            code: {
              repository: chosen.plan.repository,
              readFile: (window) =>
                act(ACT_KIND.PLANNING_FILE, { planId: chosen.plan.id, ...window }),
              onOpenFile: (ref, commit) => plans.onShowFile(chosen.plan.id, ref, commit),
            },
          }}
        />
      )}
    </div>
  );
}
