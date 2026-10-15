import type { CodingAgentStatus } from "@luke/features/coding-agent-wire";
import { type MentionLines, sectionAnchors } from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import { TERMINAL_ASK } from "@luke/features/terminal-entry";
import { ACT_KIND } from "@luke/host/acts";
import { DOCUMENT_REGION, PLAN_MARK, PLANS_PAGE } from "@luke/ui/planning-model";
import { agentOfTab, sameTab } from "@luke/ui/tab-strip-model";
import { InboxIcon } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import { FindScope } from "../find-in-tab";
import { MemberDirectory } from "../member-directory";
import { ArchivedBanner } from "../planning/archived-plan";
import { INBOX_COLUMNS, useInboxColumns } from "../planning/inbox-columns";
import { InboxList } from "../planning/inbox-list";
import {
  firstChoice,
  INBOX_GROUPING,
  inboxList,
  listedItems,
  NEEDS_YOU,
  planHolder,
} from "../planning/inbox-model";
import { type InboxCodeDoors, InboxPane } from "../planning/inbox-pane";
import { PlanBody, type SectionLinks } from "../planning/plan-body";
import { PlanCrumb } from "../planning/plan-crumb";
import { PlanMentions, type PlanMentionsValue } from "../planning/plan-mentions";
import { useMinute } from "../planning/plan-time";
import { CallBar } from "../planning/planning-parts";
import { CHIP_PLACE, RepositoryChip } from "../planning/repository-chip";
import { SkillFiles } from "../planning/skill-chip";
import { TerminalCommands, useOpenTerminal } from "../planning/terminal-commands";
import { TOOL_TARGET, type ToolTarget } from "../planning/tool-call-model";
import { MAIN_TAB, type MainTab } from "../planning/use-main-tabs";
import { useOpenLink } from "../planning/use-open-link";
import { type PlanInboxControl, usePlanInbox } from "../planning/use-plan-inbox";
import type { PlanLooks } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
import { workRowsOf } from "../planning/work-model";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { ConfirmDialog } from "../settings/confirm-dialog";
import { Skeleton } from "../skeleton";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { DesktopHome } from "./desktop-home";
import { MainTabContent, MainTabStrip, mainTabLabel } from "./main-tabs";
import { PlanActions } from "./plan-actions";
import { planCardOf } from "./plan-card";
import { usePlanRename } from "./plan-name-field";
import { PlanSummary, SummaryButton, type SummaryPin, useSummaryLayout } from "./plan-summary";
import { changesTabOf, planCards, SidePanel, useSidePanelDrawing } from "./side-panel";
import { StartAgentButton } from "./start-agent-button";
import { StrandedPlanBanner } from "./stranded-plan-banner";
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
 * An archived plan reads and takes nothing until it is brought back: its
 * banner under the toolbar says so with Unarchive as its primary button,
 * and in the meantime the document is not edited, the plan is not renamed,
 * no repository is chosen, Start, a new agent, and the call's start are not
 * drawn, and a version viewed is not restored (`../planning/archived-plan.tsx`).
 */

/** Which of the plan's two columns holds the window's focus, which ⌘T, ⌘W, and ⌘F answer to. */
const COLUMN = {
  MAIN: "main",
  SIDE: "side",
} as const;

type Column = (typeof COLUMN)[keyof typeof COLUMN];

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

/**
 * The plan's own Inbox tab: its items newest first in the window's Inbox's
 * list, with neither head nor groups since they are one plan's, and the
 * chosen item read beside them in the same pane, on the plan's own held
 * read. With nothing chosen, the first item that waits stands chosen, else
 * the newest; a plan whose read holds nothing says so under the Inbox's
 * glyph. The pane's plan crumb chooses the plan's tab and its agent crumb
 * the agent's. Too narrow for both, it shows the list or the item a press
 * opened, as the window's Inbox does (`inbox-columns.ts`).
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
  const items = [...inbox.board.open, ...inbox.board.settled];
  const list = inboxList([{ holder: planHolder(plan), items }], {
    grouping: INBOX_GROUPING.NEWEST,
    waitingOnly: false,
    chosen: asked,
  });
  const chosen = listedItems(list).find(({ item }) => item.id === asked) ?? firstChoice(list);
  const columns = useInboxColumns(chosen?.item.id);
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
        head={undefined}
        models={plans.agents.models}
        readerId={plans.me}
        note={
          inbox.reading ? (
            <Spinner label="Loading inbox" size={SPINNER_SIZE.INLINE} />
          ) : inbox.failed && items.length === 0 ? (
            <div className="sidebar-note">
              <ReadFailure line="The inbox could not be read." onRetry={inbox.onRetry} />
            </div>
          ) : inbox.read && items.length === 0 && columns.shown !== INBOX_COLUMNS.BOTH ? (
            // Note that the list standing alone says what the hidden pane would.
            <p className="sidebar-note">{NEEDS_YOU.NONE}</p>
          ) : null
        }
        onChoose={({ item }) => {
          setAsked(item.id);
          columns.onOpen(item.id);
        }}
      />
      {chosen === undefined ? (
        <section
          className="inbox-view-items"
          aria-label="Inbox"
          hidden={columns.shown !== INBOX_COLUMNS.BOTH}
        >
          {inbox.read && items.length === 0 ? (
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
  const inboxPlanId = region.kind === DOCUMENT_REGION.READY ? region.plan.id : undefined;
  const inbox = usePlanInbox({
    planId: inboxPlanId,
    shown: plans.shown,
    waiting: plans.inbox.some((plan) => plan.planId === inboxPlanId),
    agents: plans.agents,
  });
  const [focus, setFocus] = useState<Column>(COLUMN.MAIN);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const summaryLayout = useSummaryLayout(summary, column, plans.sidePanel.fullScreen);
  const summaryCard = useId();
  // The clock the plan's tab's card counts its update back from.
  const now = useMinute();
  // The column the pointer or the focus last went into holds the keys. Note
  // that it is heard on the plan's area as it bubbles, because the columns
  // are no controls of their own to hear it.
  useEffect(() => {
    if (area === null) return;
    const hear = (event: Event) => {
      const side = event.target instanceof Element && event.target.closest(".side-panel") !== null;
      setFocus(side ? COLUMN.SIDE : COLUMN.MAIN);
    };
    area.addEventListener("pointerdown", hear);
    area.addEventListener("focusin", hear);
    return () => {
      area.removeEventListener("pointerdown", hear);
      area.removeEventListener("focusin", hear);
    };
  }, [area]);
  const planId = region.kind === DOCUMENT_REGION.READY ? region.plan.id : undefined;
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
        ? "The plan could not be read."
        : region.kind === DOCUMENT_REGION.MISSING
          ? "This plan no longer exists."
          : "Choose a plan, or start a new one.";
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
        <section className="desktop-empty">
          {region.kind === DOCUMENT_REGION.READING ? (
            <Spinner label="Loading plan" size={SPINNER_SIZE.REGION} />
          ) : region.kind === DOCUMENT_REGION.FAILED ? (
            <ReadFailure
              line={line}
              onRetry={plans.onRetryDocument}
              place={READ_FAILURE_PLACE.CENTRED}
            />
          ) : (
            <p role="alert">{line}</p>
          )}
          {/* A plan that cannot be drawn offers no menu, so its way back to
              the home page is said here. */}
          {region.kind === DOCUMENT_REGION.FAILED || region.kind === DOCUMENT_REGION.MISSING ? (
            <button type="button" className="toolbar-button" onClick={plans.onLeavePlan}>
              Close plan
            </button>
          ) : null}
        </section>
      </>
    );
  }
  const { plan } = region;
  const { mainTabs, sidePanel, agents } = plans;
  const home = plans.workspaces.find((each) => each.id === plan.workspaceId);
  // The slug the plan's links are written under; only the plan's id finds it, so its workspace's id stands in until the workspaces are read.
  const workspace = home?.slug ?? plan.workspaceId;
  const archived = plan.archivedAt !== undefined;
  // The plan as the list names it, its agents and pull requests among it, which its card reads.
  const listed = [...plans.plans, ...plans.archived].find((each) => each.id === plan.id) ?? plan;
  const unarchive = () => plans.onMarkPlan(plan.id, PLAN_MARK.UNARCHIVE);
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
  });
  // The panel's toggle is the window's (desktop-shell.tsx); while no panel
  // stands beside the toolbar, the toolbar is the one that leaves it room.
  // What every place on the page that picks or draws a mention reads (`plan-mentions.tsx`).
  const mentions: PlanMentionsValue = {
    planId: plan.id,
    planName: plan.name,
    workspace,
    repository: plan.repository,
    text: () => plan.document.body,
    doors: {
      planId: plan.id,
      place: { workspace, repository: plan.repository },
      anchors: new Set(
        sectionAnchors(planSections(plan.document.body).map((section) => section.heading)),
      ),
      onOpenPlan: openMention,
      onOpenFile: openMentionedFile,
    },
  };
  return (
    <MemberDirectory workspace={home} readerId={plans.me}>
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
            {/* The summary stands beside what the column shows, under the
            toolbar and over the call bar, which both span the column. */}
            <div className="desktop-plan-body">
              <FindScope
                className="desktop-plan-column"
                active={plans.shown && !sideFocused}
                subject={{ plan: plan.id, tab }}
              >
                {archived ? <ArchivedBanner onUnarchive={unarchive} /> : null}
                {/* The stranded plan's banner is the plan's own, so it stands over the plan's tab alone. */}
                {archived || tab !== MAIN_TAB.PLAN ? null : (
                  <StrandedPlanBanner plans={plans} plan={listed} />
                )}
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
                    agents={{ control: agents, onOpen: (agent) => mainTabs.onChoose({ agent }) }}
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
                    sectionLinks={sectionLinksOf(plan.id, workspace)}
                    crumb={
                      home === undefined ? undefined : (
                        <PlanCrumb
                          workspace={home}
                          repository={plan.repository}
                          archived={archived}
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
                        act(ACT_KIND.PLANNING_FILE, { planId: plan.id, ...window }),
                      onOpenFile: sidePanel.onOpenFile,
                    }}
                  />
                ) : null}
                {tab === MAIN_TAB.PLAN || tab === MAIN_TAB.INBOX ? null : (
                  <section
                    className="desktop-agent"
                    role="tabpanel"
                    aria-label={mainTabLabel(tab, agents)}
                    data-popover-room=""
                  >
                    <MainTabContent
                      tab={tab}
                      agents={agents}
                      shown={plans.shown && !sidePanel.fullScreen}
                      views={views}
                      onOpenDelegation={openDelegation}
                      onOpenChanges={openChanges}
                      onOpenTarget={openTarget}
                      cards={cards}
                    />
                  </section>
                )}
              </FindScope>
              <PlanSummary
                plans={plans}
                layout={summaryLayout}
                cardId={summaryCard}
                inbox={inbox.board}
                held={views.held}
                repository={plan.repository}
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
              planId={plan.id}
              repository={plan.repository}
              board={plans.board}
              shownCode={plans.shownCode}
              pages={plans.pages}
              transcript={plans.transcript}
              work={plans.work}
              agents={agents}
              openAgents={mainTabs.openAgents}
              views={views}
              shown={plans.shown}
              focused={sideFocused}
              onOpenTarget={openTarget}
              cards={cards}
            />
          ) : null}
        </div>
      </PlanMentions>
    </MemberDirectory>
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
    case PLANS_PAGE.DOCUMENT:
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
    case PLANS_PAGE.HOME:
      // A launch reopening the plan last open draws the window's ground
      // alone until it opens, so the home page never flashes before it.
      if (plans.restoring) return <div className="desktop-drag-strip" />;
      return (
        <>
          <div className="desktop-drag-strip" />
          <section className="home" aria-label="Home">
            <DesktopHome plans={plans} accountName={accountName} />
          </section>
          {secondCall}
        </>
      );
  }
}
