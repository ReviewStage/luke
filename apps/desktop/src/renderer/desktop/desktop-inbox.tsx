import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxParams,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { PLAN_CALL_FAILURE, type PlanningFileAnswer } from "@luke/features/planning-view";
import { ACT_KIND } from "@luke/host/acts";
import type { AppInboxPlanHolding } from "@luke/host/app-state";
import { EXPERIMENT } from "@luke/settings";
import { InboxIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import { MemberDirectory } from "../member-directory";
import { INBOX_COLUMNS, useInboxColumns } from "../planning/inbox-columns";
import { InboxList } from "../planning/inbox-list";
import {
  anyNeedsYou,
  firstChoice,
  INBOX_HOLDER,
  type InboxGroup,
  type InboxHolder,
  type InboxListed,
  inboxList,
  listedItems,
  NEEDS_YOU,
  planHolder,
  planlessGroups,
} from "../planning/inbox-model";
import { InboxPane, type InboxPaneDoors } from "../planning/inbox-pane";
import { useMinute } from "../planning/plan-time";
import { useCodingAgents } from "../planning/use-coding-agents";
import { useInboxItems } from "../planning/use-inbox-items";
import { useOpenLink } from "../planning/use-open-link";
import { usePlanInbox } from "../planning/use-plan-inbox";
import { usePlanlessInboxItems } from "../planning/use-planless-inbox-items";
import { AUTOMATIONS_PAGE, type InboxChoice, type PlansControl } from "../planning/use-plans-tab";
import { ReadFailure } from "../read-failure";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { useExperiment } from "../use-app-state";
import { useInboxPlanFolds, useInboxViewChoices } from "./folded-groups";
import { planCardOf } from "./plan-card";

/**
 * desktop-inbox.tsx -- the window's Inbox: every item of every plan of the listed workspace holding one in a list of its own, and the chosen item read beside it.
 *
 * It stands in the plan's place beside the sidebar, whose Inbox row is
 * marked while it does, the way a mail app's mailbox stands beside its
 * folders. The list (`inbox-list.tsx`) holds the items of each plan of the
 * workspace the sidebar lists that main says holds one (the switcher counts
 * what waits in the others), needing the developer or settled, each plan read whole
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
 * and so does any row of the sidebar. Too narrow for the list and the item
 * side by side, it shows one at a time (`inbox-columns.ts`): the list, and
 * the item a press opens, whose way back, Back's chord, or Escape gives the
 * list back before Escape leaves the Inbox. Everything in it that names a
 * person, an answer and an agent's starter, reads them against the listed
 * workspace's members (`member-directory.tsx`).
 */

/** What the list says where a plan's read did not answer. */
const NOT_READ = "Some items could not be read.";

/** The plans the list holds items of, in main's order: each holding one that the listed workspace's list holds, so an archived plan, one not yet read, or another workspace's is listed nowhere. */
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

/** A planless item's code reads no file, there being no plan whose repository it reads through. */
const UNREAD_FILE = (): Promise<PlanningFileAnswer> =>
  Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED });

/** The window's Inbox, in the plan's place: every plan's items and every automation's, and the chosen one read beside them. */
export function DesktopInbox({ plans }: { plans: PlansControl }): React.JSX.Element {
  const view = plans.inboxView;
  useAppCommand(APP_COMMAND.EXIT_INBOX, view.onClose);
  const { act } = useAct();
  const openLink = useOpenLink();
  const now = useMinute();
  const choices = useInboxViewChoices();
  const folds = useInboxPlanFolds();
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  const readInbox = useCallback(
    (params: CodingAgentInboxParams) => act(ACT_KIND.CODING_AGENTS_INBOX, params),
    [act],
  );
  const { inboxPlans, plans: listedPlans } = plans.listed;
  const holdings = useMemo(
    () => listedHoldings(inboxPlans, listedPlans),
    [inboxPlans, listedPlans],
  );
  const read = useInboxItems({ holdings, readInbox });
  const planless = usePlanlessInboxItems(plans.inboxPlanless);
  const asked = view.chosen;
  const chosenPlan =
    asked !== undefined && "planId" in asked
      ? plans.plans.find((plan) => plan.id === asked.planId)
      : undefined;
  const planId = chosenPlan?.id;
  const chosenAgentId = asked !== undefined && "agentId" in asked ? asked.agentId : undefined;
  const agents = useCodingAgents({
    acts: { act },
    planId,
    ...(chosenAgentId === undefined ? undefined : { agentId: chosenAgentId }),
    repository: chosenPlan?.repository ?? null,
    archived: false,
    onUnarchive: () => undefined,
    // The Inbox draws no agent's composer, so nothing here opens Settings.
    onOpenIntegrations: () => undefined,
    onOpenApiKeys: () => undefined,
    onStarted: () => undefined,
    me: plans.me,
  });
  const readAgentInbox = useCallback(
    (after: string) =>
      chosenAgentId === undefined
        ? Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const)
        : act(ACT_KIND.CODING_AGENTS_AGENT_INBOX, { agentId: chosenAgentId, after }),
    [act, chosenAgentId],
  );
  // Note that an agent with no plan holds its own read, by its id, as a plan's is held by the plan's.
  const live = usePlanInbox({
    planId: planId ?? chosenAgentId,
    ...(chosenAgentId === undefined ? undefined : { reader: readAgentInbox }),
    shown: plans.shown,
    waiting:
      plans.inbox.some((each) => each.planId === planId) ||
      plans.inboxPlanless.some((each) => each.agentId === chosenAgentId),
    agents,
  });
  // Note that the models come from the open plan's agents where this plan's have not read them, so an agent is named alike in both.
  const named = { ...agents, models: agents.models ?? plans.agents.models };
  // The chosen holder's own held read stands in for the list's once it answered, so an answer shows
  // at once, and only while it holds, since one that failed stops hearing what changed.
  const liveItems: readonly InboxItem[] = [...live.board.open, ...live.board.settled];
  const holdsLive = live.read && !live.failed;
  const planEntries: InboxGroup[] = holdings.flatMap((holding) => {
    const plan = plans.plans.find((each) => each.id === holding.planId);
    if (plan === undefined) return [];
    const items =
      holdsLive && holding.planId === planId ? liveItems : read.items.get(holding.planId);
    return [{ holder: planHolder(plan), items: items ?? [] }];
  });
  const planlessRead =
    holdsLive && chosenAgentId !== undefined
      ? new Map(planless.items).set(chosenAgentId, liveItems)
      : planless.items;
  const entries = [
    ...planEntries,
    ...planlessGroups(plans.inboxPlanless, planlessRead, plans.workspace?.id),
  ];
  const list = inboxList(entries, {
    grouping: choices.grouping,
    waitingOnly: choices.waitingOnly,
    chosen: asked?.itemId,
  });
  const chosen = listedItems(list).find(({ item }) => item.id === asked?.itemId);
  // Note that a chosen item whose plan or agent is listed but not read yet keeps its place, because
  // it may be listed once the read lands; one whose plan left the list, archived elsewhere, gives way.
  const chosenWaits =
    (planId !== undefined &&
      holdings.some((holding) => holding.planId === planId) &&
      !read.items.has(planId) &&
      !live.read) ||
    (chosenAgentId !== undefined && !planless.items.has(chosenAgentId) && !live.read);
  const standIn = chosen === undefined && !chosenWaits ? firstChoice(list) : undefined;
  const { onChoose } = view;
  const choose = useCallback(
    ({ holder, item }: InboxListed) =>
      onChoose(
        holder.kind === INBOX_HOLDER.PLAN
          ? { planId: holder.plan.id, itemId: item.id }
          : { agentId: item.agentId, itemId: item.id },
      ),
    [onChoose],
  );
  useEffect(() => {
    if (standIn !== undefined) choose(standIn);
  }, [standIn, choose]);
  const reading =
    holdings.some((holding) => !read.items.has(holding.planId)) ||
    plans.inboxPlanless.some((each) => !planless.items.has(each.agentId));
  const columns = useInboxColumns(chosen?.item.id);
  // A choice that asks for its item opens it once, the one column the Inbox shows being the
  // item's; Back from it then stands on the list, the choice taken already.
  const opensItem = asked?.opened === true && chosen?.item.id === asked.itemId;
  const taken = useRef<InboxChoice | undefined>(undefined);
  const openColumn = columns.onOpen;
  useEffect(() => {
    if (!opensItem || asked === undefined || taken.current === asked) return;
    taken.current = asked;
    openColumn(asked.itemId);
  }, [opensItem, asked, openColumn]);
  const onRetry = () => {
    read.onRetry();
    planless.onRetry();
  };
  return (
    <MemberDirectory workspace={plans.workspace} readerId={plans.me}>
      <div className="inbox-view" ref={columns.ref} data-columns={columns.shown}>
        <InboxList
          view={list}
          chosen={chosen?.item.id}
          columns={columns.shown}
          head={{ shown: plans.shown, choices, folds, waiting: anyNeedsYou(entries) }}
          models={named.models}
          readerId={plans.me}
          note={
            <ListNote
              failed={read.failed || planless.failed}
              reading={reading}
              empty={listedItems(list).length === 0}
              onRetry={onRetry}
            />
          }
          onChoose={(listed) => {
            choose(listed);
            columns.onOpen(listed.item.id);
          }}
        />
        {chosen === undefined ? (
          <section
            className="inbox-view-items"
            aria-label="Inbox"
            hidden={columns.shown !== INBOX_COLUMNS.BOTH}
          >
            <header className="desktop-toolbar" />
            {reading ? null : <EmptyState icon={<InboxIcon />}>{NEEDS_YOU.NONE}</EmptyState>}
          </section>
        ) : (
          <InboxPane
            holder={chosen.holder}
            item={chosen.item}
            control={live}
            agents={named}
            hidden={columns.shown === INBOX_COLUMNS.LIST}
            onBack={columns.onBack}
            doors={paneDoors(plans, chosen.holder, { act, openLink, now, automationsOn })}
          />
        )}
      </div>
    </MemberDirectory>
  );
}

/**
 * The pane's doors for what holds its item: a plan's open the plan, its
 * agents' tabs, and its files; an automation's open its page where the
 * Automations experiment is on, its agents' own pages, and no file, there
 * being no plan whose repository a file is read through.
 */
function paneDoors(
  plans: PlansControl,
  holder: InboxHolder,
  seams: {
    act: ReturnType<typeof useAct>["act"];
    openLink: (url: string) => void;
    now: number;
    automationsOn: boolean;
  },
): InboxPaneDoors {
  if (holder.kind === INBOX_HOLDER.PLAN) {
    const { plan } = holder;
    return {
      onOpenHolder: () => plans.onShowPlan(plan.id),
      planCard: planCardOf(plans, plan, seams.now),
      onOpenAgent: (agentId) => plans.onShowAgent(plan.id, agentId),
      openLink: seams.openLink,
      code: {
        repository: plan.repository,
        readFile: (window) => seams.act(ACT_KIND.PLANNING_FILE, { planId: plan.id, ...window }),
        onOpenFile: (ref, commit) => plans.onShowFile(plan.id, ref, commit),
      },
    };
  }
  const { automationId } = holder;
  return {
    onOpenHolder:
      seams.automationsOn && automationId !== null
        ? () => plans.automationsView.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId })
        : undefined,
    planCard: undefined,
    onOpenAgent: (agentId) => plans.agentView.onOpen(agentId),
    openLink: seams.openLink,
    code: { repository: null, readFile: UNREAD_FILE, onOpenFile: () => undefined },
  };
}
