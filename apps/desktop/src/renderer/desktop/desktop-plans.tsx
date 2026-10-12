import type { CodingAgentStatus } from "@sidecar/hosted/coding-agent-wire";
import { DocumentIcon } from "@sidecar/panel";
import { Fragment, useEffect, useId, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { ArchivedBanner } from "../planning/archived-plan";
import { NewPlanForm } from "../planning/new-plan-form";
import { PlanBody } from "../planning/plan-body";
import { DOCUMENT_REGION, PLAN_MARK, PLANS_PAGE } from "../planning/planning-model";
import { CallBar } from "../planning/planning-parts";
import { CHIP_PLACE, RepositoryChip } from "../planning/repository-chip";
import { MAIN_TAB } from "../planning/use-main-tabs";
import type { PlanLooks } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { MainTabContent, MainTabStrip, mainTabLabel } from "./main-tabs";
import { PlanActionsButton } from "./plan-actions";
import { usePlanRename } from "./plan-name-field";
import { PlanSummary, SummaryButton, type SummaryPin, useSummaryLayout } from "./plan-summary";
import { SidePanel, useSidePanelDrawing } from "./side-panel";
import { StartAgentButton } from "./start-agent-button";
import { useTabViews } from "./strip-tabs";
import { Tab, TabStrip } from "./tab-strip";

/**
 * The work column while Plans is chosen: the open plan's column, its
 * toolbar above and the call bar below, and the side panel beside it, the
 * window's full height, while that is open (or over it, while it fills the
 * window); or, with none open, the new-plan page, which is the window's home.
 * The plan list itself is the sidebar's, and so is moving between plans: the
 * toolbar offers no way out of the open plan, only its actions: Start, which
 * hands the plan to a coding agent, and the ⋯ menu, where Copy plan and the
 * rest stand. The toolbar is one row, the side panel's bar's height exactly;
 * the plan's repository is the sidebar's row's to name, so the toolbar draws
 * the repository chip only while the plan has none, and otherwise only the
 * chip's menu, which Change repository… opens.
 *
 * The column's summary stands at its right, under the toolbar and over the
 * call bar, listing what both "+" menus open, with its button last in the
 * toolbar, after the ⋯ menu (`plan-summary.tsx`).
 *
 * The column holds tabs as the side panel does (`main-tabs.tsx`): the
 * plan's own first, showing its document, then one per coding agent,
 * showing its transcript and its composer at the document's measure, and
 * the draft agent's. The toolbar's actions are the plan's, and so is the call
 * bar, so both stand on every tab: a call is about the plan whichever tab is
 * read. The document stays laid out while an agent's tab is shown, so
 * coming back to it finds it where it was left.
 *
 * ⌘T opens the "+" of the column holding the window's focus, and ⌘W closes
 * its chosen tab: the side panel's once the pointer or the focus went into
 * it, else this column's, which a panel shut hands them back to.
 *
 * An archived plan reads and takes nothing until it is brought back: its
 * banner under the toolbar says so with Unarchive as its primary button,
 * and in the meantime the document is not edited, the plan is not renamed,
 * no repository is chosen, Start, a new agent, and the call's start are not
 * drawn, and a version viewed is not restored (`../planning/archived-plan.tsx`).
 */

/** Which of the plan's two columns holds the window's focus, which ⌘T and ⌘W answer to. */
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

/** What a press on the stand-in tab does: nothing, since it is the column's one tab while no plan is drawn. */
const CHOOSE_PLAN = () => undefined;

/**
 * The open plan's region: its column, or the state standing in its place,
 * whose strip holds a stand-in for the plan's tab, so the row does not move
 * when the plan is drawn. The captions, handed in while the plan is drawn,
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
  const [focus, setFocus] = useState<Column>(COLUMN.MAIN);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const summaryLayout = useSummaryLayout(summary, column, plans.sidePanel.fullScreen);
  const summaryCard = useId();
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
  const rename = usePlanRename(planId, plans.onRenamePlan);
  // A refusal is said beside the chip, under the plan it was about and no
  // other. Note that it is held above the states with no document, because
  // a plan opened from the list is drawn reading before its read lands, and
  // a hook that only the ready page reached would be one more hook than
  // the reading page had, which React refuses by unmounting the window.
  const [refusal, setRefusal] = useState<{ planId: string; note: string } | undefined>(undefined);
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
            <TabStrip label="Plan" className="desktop-toolbar-heading">
              <Tab icon={<DocumentIcon />} label="Plan" selected quiet onSelect={CHOOSE_PLAN} />
            </TabStrip>
          }
        />
        <section className="desktop-empty">
          {region.kind === DOCUMENT_REGION.READING ? (
            <Spinner label="Loading plan" size={SPINNER_SIZE.REGION} />
          ) : (
            <p role="alert">{line}</p>
          )}
          {region.kind === DOCUMENT_REGION.FAILED ? (
            <button type="button" className="primary-button" onClick={plans.onRetryDocument}>
              Try again
            </button>
          ) : null}
          {/* A plan that cannot be drawn offers no menu, so its way back to
              the new-plan page is said here. */}
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
  const archived = plan.archivedAt !== undefined;
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
  const { tab } = mainTabs;
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
  // A coding agent's start on the Work tab opens the agent's tab in this
  // column, which a panel filling the window over it first gives way to,
  // and hands the keys to this column, so ⌘W closes the tab it opened.
  const openAgent = (agentId: string) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onChoose({ agent: agentId });
    setFocus(COLUMN.MAIN);
  };
  // The panel's toggle is the window's (desktop-shell.tsx); while no panel
  // stands beside the toolbar, the toolbar is the one that leaves it room.
  return (
    <div ref={setArea} className="desktop-plan" data-panel-open={String(sidePanel.open)}>
      {/* Note that the column is hidden rather than left out while the
          panel fills the window, and keeps its layout beneath the panel, so
          leaving full screen uncovers it as it was. */}
      <div ref={setColumn} className="desktop-plan-main" hidden={sidePanel.fullScreen}>
        <Toolbar
          heading={
            <MainTabStrip
              plan={plan}
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
            />
          }
        >
          {rename.note !== undefined ? (
            <p className="desktop-toolbar-note" role="alert">
              {rename.note}
            </p>
          ) : null}
          {repositoryNote !== undefined ? (
            <p className="desktop-toolbar-note" role="alert">
              {repositoryNote}
            </p>
          ) : null}
          <CopyChord copy={plans.copy} />
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
                <StartAgentButton control={agents} />
              </>
            )}
            <PlanActionsButton plans={plans} plan={plan} onRename={rename.begin} />
          </Fragment>
          <SummaryButton layout={summaryLayout} cardId={summaryCard} />
        </Toolbar>
        {/* The summary stands beside what the column shows, under the
            toolbar and over the call bar, which both span the column. */}
        <div className="desktop-plan-body">
          <div className="desktop-plan-column">
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
                onShowHistory={() => plans.history.onOpen(plan.id)}
                {...(archived ? {} : { onEdit: (request) => plans.edit(plan.id, request) })}
                looks={looks}
              />
            </section>
            {tab === MAIN_TAB.PLAN ? null : (
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
                />
              </section>
            )}
          </div>
          <PlanSummary plans={plans} layout={summaryLayout} cardId={summaryCard} />
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
          transcript={plans.transcript}
          work={plans.work}
          agents={agents}
          openAgents={mainTabs.openAgents}
          views={views}
          shown={plans.shown}
          focused={sideFocused}
          onOpenAgent={openAgent}
        />
      ) : null}
    </div>
  );
}

export function DesktopPlans({
  plans,
  looks,
  captions,
  summary,
}: {
  plans: PlansControl;
  /** The open plan's sections changed since the developer last looked, held by the shell across the plan's version history. */
  looks: PlanLooks;
  /** The live captions, while they ride the open plan's call bar. */
  captions?: React.ReactNode;
  /** Whether the plan's summary stands pinned beside its column where it fits, rather than collapsed to its rail, and whether it fits, held by the shell, whose panes glide as either turns. */
  summary: SummaryPin;
}): React.JSX.Element {
  switch (plans.page) {
    case PLANS_PAGE.DOCUMENT:
      return <PlanDocument plans={plans} looks={looks} captions={captions} summary={summary} />;
    // The page names itself in its heading, so its strip is the drag handle alone.
    case PLANS_PAGE.NEW:
      return (
        <>
          <div className="desktop-drag-strip" />
          <div className="desktop-compose">
            <NewPlanForm newPlan={plans.newPlan} repositories={plans.repositories} />
          </div>
        </>
      );
  }
}
