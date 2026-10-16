import type { CodingAgentStatus } from "@luke/features/coding-agent-wire";
import { type MentionLines, sectionAnchors } from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import { TERMINAL_ASK } from "@luke/features/terminal-entry";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { agentOfTab, followedAgent, sameTab } from "@luke/ui/tab-strip-model";
import { repositoryGroups, repositoryLabel, taskRow } from "@luke/ui/task-list-model";
import { DOCUMENT_REGION, TASK_MARK, TASKS_PAGE } from "@luke/ui/tasks-model";
import { InboxIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { AutomationDirectory } from "../automation-directory";
import { LinkWorkspaceProvider } from "../copy-link-item";
import { EmptyState } from "../empty-state";
import { FIND_PAGE, FindScope, PageFind } from "../find-in-tab";
import { MemberDirectory } from "../member-directory";
import { NOT_FOUND_THING, NotFound } from "../not-found";
import { AgentCard, agentSubject } from "../planning/agent-ref";
import { ArchivedBanner } from "../planning/archived-plan";
import { agentActor, agentTabLabel } from "../planning/coding-agent-model";
import { INBOX_COLUMNS, useInboxColumns } from "../planning/inbox-columns";
import { InboxList, ItemMark, NeedsYouEmpty } from "../planning/inbox-list";
import {
  firstChoice,
  INBOX_GROUPING,
  type InboxListed,
  inboxList,
  listedItems,
  NEEDS_YOU,
  planHolder,
} from "../planning/inbox-model";
import { inboxNext, useInboxPager } from "../planning/inbox-pager";
import { type InboxCodeDoors, InboxPane } from "../planning/inbox-pane";
import { PlanBody, type SectionLinks } from "../planning/plan-body";
import { PlanCrumb } from "../planning/plan-crumb";
import {
  mentionablePullRequests,
  PlanMentions,
  type PlanMentionsValue,
  useMentionAgentsReader,
} from "../planning/plan-mentions";
import { planLinkPlace } from "../planning/plan-menu-items";
import { useMinute } from "../planning/plan-time";
import { CallBar } from "../planning/planning-parts";
import { CHIP_PLACE, RepositoryChip } from "../planning/repository-chip";
import { SkillFiles } from "../planning/skill-chip";
import { TerminalCommands, useOpenTerminal } from "../planning/terminal-commands";
import { TOOL_TARGET, type ToolTarget } from "../planning/tool-call-model";
import { MAIN_TAB, type MainTab } from "../planning/use-main-tabs";
import { useOpenLink } from "../planning/use-open-link";
import { type PlanInboxControl, usePlanInbox } from "../planning/use-plan-inbox";
import { type PlanLooks, useReadMarks } from "../planning/use-plan-looks";
import { AUTOMATIONS_PAGE, type PlansControl } from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
import { workRowsOf } from "../planning/work-model";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { ConfirmDialog } from "../settings/confirm-dialog";
import { Skeleton } from "../skeleton";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { useExperiment } from "../use-app-state";
import { DesktopHome } from "./desktop-home";
import { useTaskInboxWaitingOnly } from "./folded-groups";
import { AgentPane, MainTabStrip, mainTabLabel } from "./main-tabs";
import { PlanActions } from "./plan-actions";
import { planCardOf } from "./plan-card";
import { usePlanRename } from "./plan-name-field";
import {
  SummaryButton,
  type SummaryPin,
  summaryHolds,
  TaskSummary,
  useSummaryLayout,
} from "./plan-summary";
import {
  COLUMN,
  changesTabOf,
  planCards,
  SIDE_PANEL_HOLDER,
  SidePanel,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel";
import { StartAgentButton } from "./start-agent-button";
import { useStrandedPlanBanner } from "./stranded-plan-banner";
import { useTabViews } from "./strip-tabs";

/**
 * The work column while Plans is chosen: the open plan's column, its
 * toolbar above and the call bar below, and the side panel beside it, the
 * window's full height, while that is open (or over it, while it fills the
 * window); or, with none open, the home page (`desktop-home.tsx`).
 * The plan list itself is the sidebar's, and so is moving between plans: the
 * toolbar offers no way out of the open plan, only its actions: Start, which
 * hands the plan to a coding agent, and the ⋯ menu, where Copy plan and the
 * rest stand. The toolbar is one row, the side panel's bar's height exactly;
 * the plan's repository is the sidebar's row's to name, so the toolbar draws
 * the repository chip only while the plan has none, and otherwise only the
 * chip's menu, which Change repository opens.
 *
 * The column's summary stands at its right, under the toolbar and over the
 * call bar, listing what both "+" menus open, with its button last in the
 * toolbar, after the ⋯ menu (`plan-summary.tsx`).
 *
 * The column holds tabs as the side panel does (`main-tabs.tsx`): the
 * plan's own first, showing its document, then one per coding agent,
 * showing its transcript and its composer at the document's measure, and
 * the draft agent's. Start and the ⋯ menu are the plan's, not an agent's,
 * so only the plan's own tab draws them, while their chords (Copy plan,
 * Archive, Permanently delete) answer on every tab; the call bar is the
 * plan's too, and stands on every tab: a call is about the plan whichever
 * tab is read. The document stays laid out while an agent's tab is shown,
 * so coming back to it finds it where it was left.
 *
 * ⌘T opens the "+" of the column holding the window's focus, ⌘W closes
 * its chosen tab, and ⌘F finds in that tab (`../find-in-tab.tsx`): the side
 * panel's once the pointer or the focus went into it, else this column's,
 * which a panel shut hands them back to.
 *
 * A skill named in a message to a coding agent, in either column, opens
 * its `SKILL.md` in a File tab of the side panel (`../planning/skill-chip.tsx`).
 *
 * What is wrong with the plan itself, whichever tab is read, is said in one
 * line under the toolbar, over every tab of the column, and under the side
 * panel's bar while the panel covers the column (`plan-banner.tsx`): a
 * plan whose repository belongs to another of the account's workspaces says
 * which, with the press that moves it there (`stranded-plan-banner.tsx`).
 *
 * An archived plan reads and takes nothing until it is brought back: its
 * banner under the toolbar says so with Unarchive as its primary button,
 * and in the meantime the document is not edited, the plan is not renamed,
 * no repository is chosen, Start, a new agent, and the call's start are not
 * drawn, and a version viewed is not restored (`../planning/archived-plan.tsx`).
 */

/**
 * The strip across the top of the work column, which is also the window's
 * drag handle: the column's tabs at its left and the plan's actions at its right.
 */
function Toolbar({
  heading,
  children,
}: {
  heading: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar">
      {heading}
      {children ? <div className="desktop-toolbar-actions">{children}</div> : null}
    </header>
  );
}

/**
 * Copy plan's chord, the toolbar's while a plan is drawn: the press itself
 * stands in the ⋯ menu, and what came of it is said in the window's toast.
 */
function CopyChord({ copy }: { copy: PlansControl["copy"] }): null {
  useAppCommand(APP_COMMAND.COPY_PLAN, copy.onPress);
  return null;
}

/** ⌘T's offer while a plan is drawn: the "+" of the column holding the window's focus. */
function NewTabChord({ onNewTab }: { onNewTab: () => void }): null {
  useAppCommand(APP_COMMAND.NEW_TAB, onNewTab);
  return null;
}

/** The plan's own Inbox lists one plan's items in one run, so nothing in it folds. */
const NO_FOLDS = () => false;

/**
 * The plan's own Inbox tab: its items newest first in the window's Inbox's
 * list, under the window's head with its Needs you alone, which keeps a
 * choice of its own (`folded-groups.ts`), and no groups since they are one
 * plan's, and the chosen item read beside them in the same pane, on the
 * plan's own held read. With nothing chosen, the first item listed that
 * waits stands chosen, else the newest; a plan whose read holds nothing
 * says so under the Inbox's glyph, and one whose items Needs you leaves out
 * says so in its list and offers Show all, the item chosen still shown
 * beside it. The pane's plan crumb chooses the plan's tab and its agent crumb
 * the agent's. Too narrow for both, it shows the chosen item, and the list
 * once its way back is taken, as the window's Inbox does
 * (`inbox-columns.ts`); holding one item, it is that item, with no list to
 * go back to. K and J, and the pager where the item stands alone, step
 * through the list (`inbox-pager.tsx`).
 */
function PlanInboxTab({
  plans,
  plan,
  inbox,
  onOpenPlan,
  onOpenAgent,
  openLink,
  code,
}: {
  plans: PlansControl;
  plan: PlansControl["plans"][number];
  inbox: PlanInboxControl;
  onOpenPlan: () => void;
  onOpenAgent: (agentId: string) => void;
  openLink: (url: string) => void;
  code: InboxCodeDoors;
}): React.JSX.Element {
  const now = useMinute();
  const [asked, setAsked] = useState<string | undefined>(undefined);
  const needsYou = useTaskInboxWaitingOnly();
  const items = [...inbox.board.open, ...inbox.board.settled];
  const groups = [{ holder: planHolder(plan), items }];
  const filter = { grouping: INBOX_GROUPING.NEWEST, waitingOnly: needsYou.waitingOnly };
  // The rows hold what the filter lists alone, while the steps keep the item the pane shows in its place.
  const list = inboxList(groups, { ...filter, chosen: undefined });
  const steps = inboxList(groups, { ...filter, chosen: asked });
  const listed = listedItems(list);
  const chosen = listedItems(steps).find(({ item }) => item.id === asked) ?? firstChoice(list);
  // Note that the item standing chosen is kept as asked, so the pane keeps it shown once it is answered, as the window's Inbox keeps its stand-in.
  if (chosen !== undefined && chosen.item.id !== asked) setAsked(chosen.item.id);
  const filteredOut = needsYou.waitingOnly && listed.length === 0 && items.length > 0;
  // Note that the way back counts every item, filtered out or not, since the list holds Needs you.
  const columns = useInboxColumns(chosen?.item.id, items.length > 1);
  const shown = plans.shown && !plans.sidePanel.fullScreen;
  const choose = ({ item }: InboxListed) => setAsked(item.id);
  // A row's press and Next's open their item alike, the keyboard following it.
  const open = (listed: InboxListed) => {
    choose(listed);
    columns.onOpen(listed.item.id);
  };
  // Note that the column is hidden, though drawn, while the side panel fills the window.
  const pager = useInboxPager(steps, list, chosen?.item.id, choose, {
    shown,
    folded: NO_FOLDS,
  });
  const next = inboxNext(
    steps,
    chosen,
    ({ holder, item }) => (
      <ItemMark
        holder={holder}
        agentId={item.agentId}
        models={plans.agents.models}
        readerId={plans.me}
      />
    ),
    open,
    NO_FOLDS,
  );
  return (
    <section
      ref={columns.ref}
      className="inbox-view"
      role="tabpanel"
      aria-label="Inbox"
      data-columns={columns.shown}
    >
      <InboxList
        view={list}
        chosen={chosen?.item.id}
        columns={columns.shown}
        head={{
          shown,
          needsYou,
          view: undefined,
          waiting: inbox.board.open.length > 0,
        }}
        models={plans.agents.models}
        readerId={plans.me}
        note={
          inbox.reading ? (
            <Spinner label="Loading inbox" size={SPINNER_SIZE.INLINE} />
          ) : inbox.failed && listed.length === 0 ? (
            <div className="sidebar-note">
              <ReadFailure line="The inbox could not be read." onRetry={inbox.onRetry} />
            </div>
          ) : inbox.read && filteredOut ? (
            <NeedsYouEmpty needsYou={needsYou} onList={columns.onList} />
          ) : inbox.read && listed.length === 0 && columns.shown !== INBOX_COLUMNS.BOTH ? (
            // Note that the list standing alone says what the hidden pane would, as the pane says it.
            <EmptyState icon={<InboxIcon />}>{NEEDS_YOU.NONE}</EmptyState>
          ) : null
        }
        onChoose={open}
      />
      {chosen === undefined ? (
        <section
          className="inbox-view-items"
          aria-label="Inbox"
          hidden={columns.shown !== INBOX_COLUMNS.BOTH}
        >
          {/* The empty pane keeps a bar the list's head's height, as the window's Inbox does. */}
          <header className="desktop-toolbar" />
          {/* Note that the list says what Needs you left out, so the pane beside it stands bare. */}
          {inbox.read && listed.length === 0 && !filteredOut ? (
            <EmptyState icon={<InboxIcon />}>{NEEDS_YOU.NONE}</EmptyState>
          ) : null}
        </section>
      ) : (
        <InboxPane
          holder={planHolder(plan)}
          item={chosen.item}
          control={inbox}
          agents={plans.agents}
          hidden={columns.shown === INBOX_COLUMNS.LIST}
          onBack={columns.onBack}
          pager={columns.shown === INBOX_COLUMNS.ITEM ? pager : undefined}
          next={next}
          doors={{
            onOpenHolder: onOpenPlan,
            planCard: planCardOf(plans, plan, now),
            onOpenAgent,
            openLink,
            code,
          }}
        />
      )}
    </section>
  );
}

/**
 * The open plan's region: its column, or the state standing in its place.
 * While the plan is read, its strip holds one tab-shaped skeleton where the
 * plan's tab will stand, so the row does not move when the plan is drawn,
 * and no name is guessed before the read says it; a plan that could not be
 * drawn has no tab at all. The captions, handed in while the plan is drawn,
 * stand just above the call bar.
 */
function PlanDocument({
  plans,
  looks,
  captions,
  summary,
}: {
  plans: PlansControl;
  looks: PlanLooks;
  captions: React.ReactNode;
  summary: SummaryPin;
}): React.JSX.Element {
  const { region } = plans;
  const drawing = useSidePanelDrawing(plans.sidePanel);
  const views = useTabViews();
  const { act } = useAct();
  const openLink = useOpenLink();
  const inboxPlanId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  const inbox = usePlanInbox({
    planId: inboxPlanId,
    shown: plans.shown,
    waiting: plans.inbox.some((plan) => plan.taskId === inboxPlanId),
    agents: plans.agents,
  });
  const { onArea: setArea, focus, setFocus } = useColumnFocus();
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const summaryLayout = useSummaryLayout(
    summary,
    column,
    plans.sidePanel.fullScreen,
    summaryHolds(plans, inbox.board),
  );
  const summaryCard = useId();
  // The clock the plan's tab's card counts its update back from.
  const now = useMinute();
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  const reads = useReadMarks();
  const { onOpen: onOpenAutomations } = plans.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  const planId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  // What waits in the plan's inbox opens its Inbox tab where an item did
  // not wait at the last read (`use-main-tabs.ts`). Note that only a read
  // that answered counts, because a plan just opened holds nothing yet, and
  // nothing would forget what waited there.
  const waiting = useMemo(() => inbox.board.open.map((item) => item.id), [inbox.board.open]);
  const { onInboxRead } = plans.mainTabs;
  useEffect(() => {
    if (planId !== undefined && inbox.read) onInboxRead(planId, waiting);
  }, [planId, inbox.read, waiting, onInboxRead]);
  const rename = usePlanRename(planId, plans.onRenamePlan);
  // A terminal shown hands the keys to the side panel, where it stands; an
  // agent's tab's Open terminal always opens that agent's own.
  const showSide = () => setFocus(COLUMN.SIDE);
  const openTerminal = useOpenTerminal(plans.sidePanel, showSide);
  // A refusal is said beside the chip, under the plan it was about and no
  // other. Note that it is held above the states with no document, because
  // a plan opened from the list is drawn reading before its read lands, and
  // a hook that only the ready page reached would be one more hook than
  // the reading page had, which React refuses by unmounting the window.
  const [refusal, setRefusal] = useState<{ planId: string; note: string } | undefined>(undefined);
  // The one slot the toolbar keeps for a ⋯: the plan's on its tab, and on
  // another the chosen tab's own, drawn there from the tab (`strip-tabs.tsx`).
  // Held above the states with no document for the same reason.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  // The plan as the list names it, its owner, agents, and pull requests
  // among it, which its card and its banner read. Held above the states
  // with no document for the same reason.
  const opened = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  const listedOpen =
    opened === undefined
      ? undefined
      : ([...plans.plans, ...plans.archived].find((each) => each.id === opened.id) ?? opened);
  const stranded = useStrandedPlanBanner(plans, listedOpen);
  // The workspace's agents an `@` offers after the task's own, named by the tasks the window lists, archived ones among them.
  const mentionTasks = useMemo(
    () => [...plans.plans, ...plans.archived],
    [plans.plans, plans.archived],
  );
  const readMentionAgents = useMentionAgentsReader(
    opened?.workspaceId,
    mentionTasks,
    plans.agents.models,
  );
  const openMention = plans.onShowMention;
  const revealed = plans.sectionReveal;
  // A file a mention names opens in its tab, its lines at the commit the mention pins them to.
  const openMentionedFile = (path: string, lines: MentionLines | undefined) =>
    lines === undefined
      ? plans.sidePanel.onOpenFile({ path })
      : plans.sidePanel.onOpenFile(
          { path, startLine: lines.startLine, endLine: lines.endLine },
          lines.commit,
        );
  const sectionLinksOf = (shown: string, workspace: string): SectionLinks => ({
    workspace,
    onOpen: openMention,
    onOpenFile: openMentionedFile,
    reveal: revealed?.planId === shown ? revealed.reveal : undefined,
    onRevealed: plans.onSectionRevealed,
  });
  if (region.kind !== DOCUMENT_REGION.READY) {
    const line =
      region.kind === DOCUMENT_REGION.FAILED
        ? "The task could not be read."
        : "Choose a task, or start a new one.";
    // A plan that cannot be drawn offers no menu, so its way back to the home page is said here.
    const close = (
      <button type="button" className="toolbar-button" onClick={plans.onLeavePlan}>
        Close task
      </button>
    );
    return (
      <>
        <Toolbar
          heading={
            <div className="desktop-toolbar-heading">
              {region.kind === DOCUMENT_REGION.READING ? (
                <Skeleton className="tab-skeleton" />
              ) : null}
            </div>
          }
        />
        {/* A plan the service would not hand the reader is not there for them, whether it was deleted or never theirs. */}
        {region.kind === DOCUMENT_REGION.MISSING ? (
          <NotFound thing={NOT_FOUND_THING.TASK} action={close} />
        ) : (
          <section className="desktop-empty">
            {region.kind === DOCUMENT_REGION.READING ? (
              <Spinner label="Loading task" size={SPINNER_SIZE.REGION} />
            ) : region.kind === DOCUMENT_REGION.FAILED ? (
              <ReadFailure
                line={line}
                onRetry={plans.onRetryDocument}
                place={READ_FAILURE_PLACE.CENTRED}
              />
            ) : (
              <p role="alert">{line}</p>
            )}
            {region.kind === DOCUMENT_REGION.FAILED ? close : null}
          </section>
        )}
      </>
    );
  }
  const { task: plan } = region;
  const { mainTabs, sidePanel, agents } = plans;
  const home = plans.workspaces.find((each) => each.id === plan.workspaceId);
  // The slug the plan's links are written under, as its ⋯ menu's Copy link to plan writes it.
  const { workspace } = planLinkPlace(plans.workspaces, plan);
  const archived = plan.archivedAt !== undefined;
  const listed = listedOpen ?? plan;
  // What the crumb opens is the plan's own workspace's, so the window lists
  // that workspace first where another is listed. Note that the switch
  // reopens nothing, because the plan open is that workspace's own.
  const listHome = () => {
    if (home !== undefined && plans.workspace?.id !== home.id) plans.onChooseWorkspace(home.id);
  };
  const unarchive = () => plans.onMarkPlan(plan.id, TASK_MARK.UNARCHIVE);
  const repositoryNote = refusal?.planId === plan.id ? refusal.note : undefined;
  const chooseRepository = (repository: string) => {
    const { id: planId } = plan;
    setRefusal(undefined);
    plans.onSetRepository(planId, repository).then(
      (note) => setRefusal(note === undefined ? undefined : { planId, note }),
      () => undefined,
    );
  };
  const menuRequest =
    plans.repositoryMenu?.planId === plan.id ? plans.repositoryMenu.request : undefined;
  // The panel holds the keys while the focus went into it last, or while it
  // fills the window over this column; shut, it hands them back.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  // The agent a terminal command means from where the developer is: the one
  // whose own tab, Changes tab, or Terminal tab holds the keys, if any.
  const terminalHere = agentOfTab(
    sideFocused && sidePanel.tab !== undefined ? sidePanel.tab : mainTabs.tab,
  );
  const { tab } = mainTabs;
  // Start and the plan's ⋯ are the plan's, not an agent's, so only the
  // plan's own tab draws them; the plan's chords stand on every tab.
  const onPlanTab = tab === MAIN_TAB.PLAN;
  // A delegation's row in an agent's transcript opens its worker in the side
  // panel, where every subagent stands; where the worker stands seeds its glyph.
  const openDelegation = (
    agent: string,
    callId: string,
    task: string,
    status: CodingAgentStatus,
  ) => {
    views.onWorkerStatus(callId, status);
    sidePanel.onChoose({ subagent: callId, delegation: { agent, task } });
  };
  // An agent's Changes chip opens its pull request's changes in the side panel, beside its
  // tab, in the one tab the "+" offers for that pull request (`changesTabOf`).
  const openChanges = (agentId: string) =>
    sidePanel.onChoose(changesTabOf(agents, agentId, sidePanel.changes));
  // A row that opens a tab of this column, as a coding agent's start on the
  // Call tab opens the agent's, first has a panel filling the window over it
  // give way, and hands the keys to this column, so ⌘W closes the tab it opened.
  const openColumnTab = (opened: MainTab) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onChoose(opened);
    setFocus(COLUMN.MAIN);
  };
  // A call's row in a transcript opens what the call is about where the
  // window already draws it: the plan, an agent, or the Inbox in this
  // column, the rest in the side panel.
  const openTarget = (target: ToolTarget) => {
    switch (target.kind) {
      case TOOL_TARGET.AGENT:
        return openColumnTab({ agent: target.agent });
      case TOOL_TARGET.PLAN:
        return openColumnTab(MAIN_TAB.PLAN);
      case TOOL_TARGET.INBOX:
        return openColumnTab(MAIN_TAB.INBOX);
      case TOOL_TARGET.BOARD:
        return sidePanel.onChoose(SIDE_PANEL_TAB.BOARD);
      case TOOL_TARGET.PAGE:
        return sidePanel.onChoose({ page: target.page });
      case TOOL_TARGET.SHOWN_CODE: {
        // The lines are read at the commit Luke read them at, as the Code tab's snippet opens them.
        const showing = plans.shownCode?.find((each) => each.callId === target.call);
        return sidePanel.onOpenFile(target.ref, showing?.code.commit);
      }
    }
  };
  // A row in a transcript that opens a tab hangs that tab's card, read as
  // the tab reads it, so an agent, a subagent, or a file is previewed alike wherever named.
  const cards = planCards({
    agents,
    workRows: workRowsOf(plans.work.conversation, plans.work.callLive),
    held: views.held,
    chosen: (opened) =>
      sameTab(opened, tab) || (sidePanel.tab !== undefined && sameTab(opened, sidePanel.tab)),
    shownCode: plans.shownCode ?? [],
    task: { name: plan.name, card: planCardOf(plans, listed, now) },
  });
  // The panel's toggle is the window's (desktop-shell.tsx); while no panel
  // stands beside the toolbar, the toolbar is the one that leaves it room.
  // An agent a mention names wears its tab's tile and hangs its tab's card, read as its tab reads them.
  const agentLook = (agentId: string) => {
    const subject = agentSubject(agents, agentId, views.held, false);
    return { actor: subject.tile, card: <AgentCard subject={subject} models={agents.models} /> };
  };
  // What every place on the page that picks or draws a mention reads (`plan-mentions.tsx`).
  const mentions: PlanMentionsValue = {
    planId: plan.id,
    planName: plan.name,
    workspace,
    repository: plan.repository,
    text: () => plan.document.body,
    pages: plans.pages,
    agents: (agents.agents ?? []).map((agent) => {
      const name = agentTabLabel(agent, agents.models);
      return { id: agent.id, name, actor: agentActor(agent, name) };
    }),
    readAgents: readMentionAgents,
    pullRequests: mentionablePullRequests(agents),
    doors: {
      planId: plan.id,
      place: { workspace, repository: plan.repository },
      anchors: new Set(
        sectionAnchors(planSections(plan.document.body).map((section) => section.heading)),
      ),
      onOpenPlan: openMention,
      onOpenFile: openMentionedFile,
      agentOf: agentLook,
    },
  };
  return (
    <LinkWorkspaceProvider value={workspace}>
      <MemberDirectory workspace={home} readerId={plans.me}>
        <AutomationDirectory
          workspace={home}
          on={automationsOn}
          wanted={[...(agents.agents ?? []), ...(agents.archived ?? [])].some(
            (each) => each.automationId !== undefined,
          )}
          onOpen={openAutomation}
        >
          <PlanMentions value={mentions}>
            <div ref={setArea} className="desktop-plan" data-panel-open={String(sidePanel.open)}>
              {/* Note that the column is hidden rather than left out while the
          panel fills the window, and keeps its layout beneath the panel, so
          leaving full screen uncovers it as it was. */}
              <div ref={setColumn} className="desktop-plan-main" hidden={sidePanel.fullScreen}>
                <Toolbar
                  heading={
                    <MainTabStrip
                      plan={plan}
                      planCard={planCardOf(plans, listed, now)}
                      main={mainTabs}
                      agents={agents}
                      unread={plans.unreadTabs}
                      views={views}
                      pins={{
                        pinned: sidePanel.pins,
                        onPin: sidePanel.onPin,
                        onUnpin: sidePanel.onUnpin,
                      }}
                      rename={archived ? undefined : rename}
                      keys={plans.shown && !sideFocused}
                      shown={plans.shown}
                      inbox={inbox.board.open.length}
                      actionsSlot={actionsSlot}
                      onOpenTerminal={(agentId) => openTerminal(agentId, TERMINAL_ASK.SHOW)}
                    />
                  }
                >
                  {rename.note !== undefined ? (
                    <p className="error-message" role="alert">
                      {rename.note}
                    </p>
                  ) : null}
                  {repositoryNote !== undefined ? (
                    <p className="error-message" role="alert">
                      {repositoryNote}
                    </p>
                  ) : null}
                  <CopyChord copy={plans.copy} />
                  <TerminalCommands
                    here={terminalHere}
                    agents={agents}
                    sidePanel={sidePanel}
                    onShown={showSide}
                  />
                  {/* A version drawn in the plan's place is the version's page, which opens no tab. */}
                  {plans.history.viewing === undefined ? (
                    <NewTabChord onNewTab={sideFocused ? sidePanel.onNewTab : mainTabs.onNewTab} />
                  ) : null}
                  {/* Keyed once for the chip and the menu alike, so another plan
              starts both afresh and the same plan keeps them. */}
                  <Fragment key={plan.id}>
                    {archived ? null : (
                      <>
                        <RepositoryChip
                          place={CHIP_PLACE.TOOLBAR}
                          value={plan.repository}
                          chooser={plans.repositories}
                          onChoose={chooseRepository}
                          openRequest={menuRequest}
                        />
                        {onPlanTab ? <StartAgentButton control={agents} /> : null}
                      </>
                    )}
                    <span ref={setActionsSlot} className="toolbar-tab-actions">
                      <PlanActions
                        plans={plans}
                        plan={plan}
                        button={onPlanTab}
                        onRename={rename.begin}
                      />
                    </span>
                  </Fragment>
                  <SummaryButton layout={summaryLayout} cardId={summaryCard} />
                </Toolbar>
                {/* The plan's banner is the whole plan's, so it stands over every
            tab of the column, and over the panel's while that fills the window. */}
                {sidePanel.fullScreen ? null : stranded.banner}
                {/* The summary stands beside what the column shows, under the
            toolbar and over the call bar, which both span the column. */}
                <div className="desktop-plan-body">
                  <FindScope
                    className="desktop-plan-column"
                    active={plans.shown && !sideFocused}
                    subject={{ plan: plan.id, tab }}
                  >
                    {archived ? <ArchivedBanner onUnarchive={unarchive} /> : null}
                    <section
                      className="desktop-document"
                      role="tabpanel"
                      aria-label={plan.name}
                      hidden={tab !== MAIN_TAB.PLAN}
                    >
                      {/* Keyed by the archive, so an editor still open when the plan is
                  archived elsewhere is let go rather than left taking words. */}
                      <PlanBody
                        key={String(archived)}
                        plan={plan}
                        live={plans.live}
                        reader={{ readerId: plans.me }}
                        agents={{
                          control: agents,
                          onOpen: (agent) => mainTabs.onChoose({ agent }),
                        }}
                        onShowHistory={(save) => plans.history.onOpen(plan.id, save)}
                        {...(archived
                          ? {}
                          : {
                              onEdit: (request) => plans.edit(plan.id, request),
                              // The title renames as the chip's field does, so a refusal is said beside it.
                              onRename: (name) => rename.end({ name, byKey: true }),
                              onDraftName: (name) => plans.onDraftName(plan.id, name),
                            })}
                        looks={looks}
                        readMark={{
                          unread: reads.markedUnread(plan.id),
                          onMark: (unread) => reads.mark(plan, unread),
                        }}
                        sectionLinks={sectionLinksOf(plan.id, workspace)}
                        crumb={
                          home === undefined ? undefined : (
                            <PlanCrumb
                              workspace={home}
                              repository={plan.repository}
                              archived={archived}
                              created={plan}
                              doors={{
                                personal: plans.workspaces[0]?.id === home.id,
                                onOpenWorkspace: () => {
                                  listHome();
                                  plans.onGoHome();
                                },
                                repository: {
                                  label: (repository) =>
                                    repositoryLabel(
                                      repository,
                                      repositoryGroups(plans.listed.plans.map(taskRow)),
                                    ),
                                  pictures: plans.repositories.pictures,
                                  read: plans.newPlan.repositoriesIn(home.id).read,
                                },
                              }}
                            />
                          )
                        }
                      />
                    </section>
                    {tab === MAIN_TAB.INBOX ? (
                      <PlanInboxTab
                        plans={plans}
                        plan={listed}
                        inbox={inbox}
                        onOpenPlan={() => mainTabs.onChoose(MAIN_TAB.PLAN)}
                        onOpenAgent={(agent) => mainTabs.onChoose({ agent })}
                        openLink={openLink}
                        code={{
                          repository: plan.repository,
                          readFile: (window) =>
                            act(ACT_KIND.TASKS_FILE, { taskId: plan.id, ...window }),
                          onOpenFile: sidePanel.onOpenFile,
                        }}
                      />
                    ) : null}
                    {tab === MAIN_TAB.PLAN || tab === MAIN_TAB.INBOX ? null : (
                      <AgentPane
                        label={mainTabLabel(tab, agents)}
                        tabbed
                        tab={tab}
                        agents={agents}
                        shown={plans.shown && !sidePanel.fullScreen}
                        views={views}
                        onOpenDelegation={openDelegation}
                        onOpenChanges={openChanges}
                        onOpenTarget={openTarget}
                        cards={cards}
                      />
                    )}
                  </FindScope>
                  <TaskSummary
                    plans={plans}
                    layout={summaryLayout}
                    cardId={summaryCard}
                    inbox={inbox.board}
                    held={views.held}
                    repository={plan.repository}
                    onOpenAgent={(agent) => openColumnTab({ agent })}
                  />
                </div>
                {/* Note that a call of the plan's own still stands, so it can be
            ended, when only a race left one on a plan just archived. */}
                {archived && !plans.stop.shown ? null : (
                  <div className="desktop-call-bar">
                    {captions}
                    <CallBar
                      status={plans.status}
                      microphone={plans.microphone}
                      speaker={plans.speaker}
                      stop={plans.stop}
                    />
                  </div>
                )}
              </div>
              {drawing.panel ? (
                <SidePanel
                  {...drawing}
                  panel={drawing.panel}
                  unread={plans.unreadTabs}
                  holder={SIDE_PANEL_HOLDER.PLAN}
                  planId={plan.id}
                  repository={plan.repository}
                  board={plans.board}
                  shownCode={plans.shownCode}
                  pages={plans.pages}
                  transcript={plans.transcript}
                  work={plans.work}
                  agents={agents}
                  openAgents={mainTabs.openAgents}
                  shownAgent={followedAgent(mainTabs.tab, {
                    shown: plans.shown,
                    covered: sidePanel.fullScreen,
                  })}
                  views={views}
                  shown={plans.shown}
                  focused={sideFocused}
                  onOpenTarget={openTarget}
                  cards={cards}
                  banner={stranded.banner}
                />
              ) : null}
              {stranded.dialog}
            </div>
          </PlanMentions>
        </AutomationDirectory>
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}

export function DesktopPlans({
  plans,
  looks,
  captions,
  summary,
  accountName,
}: {
  plans: PlansControl;
  /** The signed-in account's name, which the home page greets. */
  accountName?: string | undefined;
  /** The open plan's sections changed since the developer last looked, held by the shell across the plan's version history. */
  looks: PlanLooks;
  /** The live captions, while they ride the open plan's call bar. */
  captions?: React.ReactNode;
  /** Whether the plan's summary stands pinned beside its column where it fits, rather than collapsed to its rail, and whether it fits, held by the shell, whose panes glide as either turns. */
  summary: SummaryPin;
}): React.JSX.Element {
  // The second call's question stands over either page: a Talk press on a
  // plan's page asks it, and so does a plan started from the New plan dialog.
  const secondCall = (
    <ConfirmDialog confirm={plans.secondCall.confirm} question={plans.secondCall.question} />
  );
  switch (plans.page) {
    case TASKS_PAGE.DOCUMENT:
      return (
        <SkillFiles
          source={plans.agents.readSkills}
          // Note that a skill's file opens as a file the palette finds does, whole,
          // so its tab stands on this plan though Luke never showed it.
          onOpen={(skill) => plans.sidePanel.onOpenFile({ path: skill.path })}
        >
          <PlanDocument plans={plans} looks={looks} captions={captions} summary={summary} />
          {secondCall}
        </SkillFiles>
      );
    // With no plan open the column says so and offers New plan, whose
    // dialog stands over it as it stands over a plan.
    case TASKS_PAGE.HOME:
      // A launch reopening the plan last open draws the window's ground
      // alone until it opens, so the home page never flashes before it.
      if (plans.restoring) return <div className="desktop-drag-strip" />;
      return (
        <>
          <div className="desktop-drag-strip" />
          <PageFind page={FIND_PAGE.HOME} active={plans.shown}>
            <section className="home" aria-label="Home">
              <DesktopHome plans={plans} accountName={accountName} />
            </section>
          </PageFind>
          {secondCall}
        </>
      );
  }
}
