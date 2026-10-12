import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { DocumentIcon, PencilIcon } from "@sidecar/panel";
import { Fragment, useEffect, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { ArchivedBanner } from "../planning/archived-plan";
import { NewPlanForm } from "../planning/new-plan-form";
import { PlanBody } from "../planning/plan-body";
import { DOCUMENT_REGION, PLAN_MARK, PLANS_PAGE } from "../planning/planning-model";
import { CallBar } from "../planning/planning-parts";
import { CHIP_PLACE, RepositoryChip } from "../planning/repository-chip";
import type { PlanLooks } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { PlanActionsButton } from "./plan-actions";
import { PlanNameField, usePlanRename } from "./plan-name-field";
import { SidePanel, useSidePanelDrawing } from "./side-panel";
import { StartAgentButton } from "./start-agent-button";
import { MenuTab, Tab, TabStrip } from "./tab-strip";

/**
 * The work column while Plans is chosen: the open plan's document, with its
 * toolbar above and the call bar below, and the side panel beside all three,
 * the window's full height, while that is open (or over them, while it fills
 * the window); or, with none open, the new-plan page, which is the window's home.
 * The plan list itself is the sidebar's, and so is moving between plans: the
 * toolbar offers no way out of the open plan, only its actions: Start, which
 * hands the plan to a coding agent, and the ⋯ menu, where Copy plan and the
 * rest stand. Its one tab is the plan's, named for it, whose right-click
 * renames the plan in place, as the ⋯ menu's Rename does. The toolbar is
 * one row, the side panel's bar's height exactly; the plan's repository is the sidebar's row's to name, so
 * the toolbar draws the repository chip only while the plan has none, and
 * otherwise only the chip's menu, which Change repository… opens.
 *
 * An archived plan reads and takes nothing until it is brought back: its
 * banner under the toolbar says so with Unarchive as its primary button,
 * and in the meantime the document is not edited, the plan is not renamed,
 * no repository is chosen, Start and the call's start are not drawn, and
 * a version viewed is not restored (`../planning/archived-plan.tsx`).
 */

/**
 * The strip across the top of the work column, which is also the window's
 * drag handle: the plan's tab at its left and the plan's actions at its right.
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

/**
 * The plan's one tab, standing while no plan is drawn yet as well, so the
 * row does not move when one is. It is the column's only tab and never
 * closes: the plan is always the column's content, and the sidebar is the
 * way to another plan. Note that there is no "+" beside it, because the
 * column has no second kind of tab to open. Being the only tab, it is
 * quiet: no fill marks it chosen, only the pointer's hover.
 */
function PlanTabStrip({ tab }: { tab: React.JSX.Element }): React.JSX.Element {
  return (
    <TabStrip label="Plan" className="desktop-toolbar-heading">
      {tab}
    </TabStrip>
  );
}

/** What a press on the plan's tab does: nothing, since it is the column's one tab and always the one chosen. */
const CHOOSE_PLAN = () => undefined;

/**
 * The open plan's tab: its name, and its repository in the hint the pointer
 * resting on it raises. A press chooses it, as a press on any tab does,
 * rather than renaming the plan; its right-click offers Rename, as the ⋯
 * menu does, which opens the name as its field. A key that ends the edit
 * hands focus back to the tab.
 */
function PlanTab({
  plan,
  rename,
}: {
  plan: PlanSummary;
  /** The rename the tab's menu opens; none while the plan is archived, which renames nothing. */
  rename: ReturnType<typeof usePlanRename> | undefined;
}): React.JSX.Element {
  const tab = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  const editing = rename?.editing === true;
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    tab.current?.focus();
  }, [editing]);
  const editor =
    rename?.editing === true ? (
      <PlanNameField
        name={plan.name}
        className="tab-field"
        onEnd={(edit) => {
          refocus.current = edit.byKey;
          rename.end(edit);
        }}
      />
    ) : undefined;
  const look = {
    icon: <DocumentIcon />,
    label: plan.name,
    selected: true,
    quiet: true,
    tooltip: plan.repository ?? undefined,
    editor,
    tabRef: tab,
    onSelect: CHOOSE_PLAN,
  };
  return (
    <PlanTabStrip
      tab={
        rename === undefined ? (
          <Tab {...look} />
        ) : (
          <MenuTab
            {...look}
            groups={[[{ label: "Rename", icon: <PencilIcon />, onSelect: rename.begin }]]}
          />
        )
      }
    />
  );
}

/**
 * The open plan's region: its document, or the state standing in its place.
 * The captions, handed in while the plan is drawn, stand just above the call
 * bar.
 */
function PlanDocument({
  plans,
  looks,
  captions,
}: {
  plans: PlansControl;
  looks: PlanLooks;
  captions: React.ReactNode;
}): React.JSX.Element {
  const { region } = plans;
  const drawing = useSidePanelDrawing(plans.sidePanel);
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
      region.kind === DOCUMENT_REGION.READING
        ? "Reading the plan…"
        : region.kind === DOCUMENT_REGION.FAILED
          ? "The plan could not be read."
          : region.kind === DOCUMENT_REGION.MISSING
            ? "This plan no longer exists."
            : "Choose a plan, or start a new one.";
    return (
      <>
        <Toolbar
          heading={
            <PlanTabStrip
              tab={
                <Tab icon={<DocumentIcon />} label="Plan" selected quiet onSelect={CHOOSE_PLAN} />
              }
            />
          }
        />
        <section className="desktop-empty" aria-busy={region.kind === DOCUMENT_REGION.READING}>
          <p role={region.kind === DOCUMENT_REGION.READING ? undefined : "alert"}>{line}</p>
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
  const { sidePanel } = plans;
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
  // The panel's toggle is the window's (desktop-shell.tsx); while no panel
  // stands beside the toolbar, the toolbar is the one that leaves it room.
  return (
    <div className="desktop-plan" data-panel-open={String(sidePanel.open)}>
      {/* Note that the document is hidden rather than left out while the
          panel fills the window, and keeps its layout beneath the panel, so
          leaving full screen uncovers it as it was. */}
      <div className="desktop-plan-main" hidden={sidePanel.fullScreen}>
        <Toolbar heading={<PlanTab plan={plan} rename={archived ? undefined : rename} />}>
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
                <StartAgentButton control={plans.agents} />
              </>
            )}
            <PlanActionsButton plans={plans} plan={plan} onRename={rename.begin} />
          </Fragment>
        </Toolbar>
        {archived ? <ArchivedBanner onUnarchive={unarchive} /> : null}
        <section className="desktop-document" role="tabpanel" aria-label={plan.name}>
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
          agents={plans.agents}
          shown={plans.shown}
        />
      ) : null}
    </div>
  );
}

export function DesktopPlans({
  plans,
  looks,
  captions,
}: {
  plans: PlansControl;
  /** The open plan's sections changed since the developer last looked, held by the shell across the plan's version history. */
  looks: PlanLooks;
  /** The live captions, while they ride the open plan's call bar. */
  captions?: React.ReactNode;
}): React.JSX.Element {
  switch (plans.page) {
    case PLANS_PAGE.DOCUMENT:
      return <PlanDocument plans={plans} looks={looks} captions={captions} />;
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
