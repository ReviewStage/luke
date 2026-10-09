import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { useEffect, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { NewPlanForm } from "../planning/new-plan-form";
import { PlanBody } from "../planning/plan-body";
import {
  COPY_FAILED_NOTE,
  COPY_SHOWN,
  DOCUMENT_REGION,
  PLANS_PAGE,
} from "../planning/planning-model";
import { MicrophoneRow } from "../planning/planning-parts";
import { CHIP_PLACE, RepositoryChip } from "../planning/repository-chip";
import type { PlansControl } from "../planning/use-plans-tab";
import { PlanActionsButton } from "./plan-actions";
import { PlanNameField, usePlanRename } from "./plan-name-field";
import { SidePanel, SidePanelToggle, useSidePanelDrawing } from "./side-panel";
import { StartAgentButton } from "./start-agent-button";

/**
 * The work column while Plans is chosen: the open plan's document, with its
 * toolbar above and the call bar below, and the side panel beside all three,
 * the window's full height, while that is open (or over them, while it fills
 * the window); or, with none open, the new-plan page, which is the window's home.
 * The plan list itself is the sidebar's, and so is moving between plans: the
 * toolbar offers no way out of the open plan, only its actions: Start, which
 * hands the plan to a coding agent, and the ⋯ menu, where Copy plan and the
 * rest stand. Its title is the plan's name, and a press on it renames the
 * plan in place. The toolbar is one row, the side panel's bar's height
 * exactly; the plan's repository is the sidebar's row's to name, so the
 * toolbar draws the repository chip only while the plan has none, and
 * otherwise only the chip's menu, which Change repository… opens.
 */

/** The strip across the top of the work column, which is also the window's drag handle. */
function Toolbar({
  title,
  children,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">{title}</h1>
      </div>
      {children ? <div className="desktop-toolbar-actions">{children}</div> : null}
    </header>
  );
}

/**
 * Copy's chord and what the last Copy came to, said in the toolbar: the
 * press itself stands in the ⋯ menu, so a copy's check mark and a copy that
 * failed are said here, where the menu was.
 */
function CopyNote({ copy }: { copy: PlansControl["copy"] }): React.JSX.Element | null {
  useAppCommand(APP_COMMAND.COPY_PLAN, copy.onPress);
  if (copy.shown === COPY_SHOWN.FAILED) {
    return (
      <p className="desktop-toolbar-note" role="alert">
        {COPY_FAILED_NOTE}
      </p>
    );
  }
  if (copy.shown === COPY_SHOWN.COPIED) {
    return (
      <p className="desktop-toolbar-word" role="status">
        Copied
      </p>
    );
  }
  return null;
}

/**
 * The open plan's name as the toolbar's title, which a press, or the ⋯
 * menu's Rename, opens as its field; a key that ends the edit hands focus
 * back to the title.
 */
function PlanTitle({
  plan,
  rename,
}: {
  plan: PlanSummary;
  rename: ReturnType<typeof usePlanRename>;
}): React.JSX.Element {
  const title = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    title.current?.focus();
  }, [rename.editing]);
  if (rename.editing) {
    return (
      <PlanNameField
        name={plan.name}
        className="desktop-toolbar-title-field"
        onEnd={(edit) => {
          refocus.current = edit.byKey;
          rename.end(edit);
        }}
      />
    );
  }
  return (
    <button
      ref={title}
      type="button"
      className="desktop-toolbar-title-button"
      onClick={rename.begin}
    >
      {plan.name}
    </button>
  );
}

/** The open plan's region: its document, or the state standing in its place. */
function PlanDocument({ plans }: { plans: PlansControl }): React.JSX.Element {
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
        <Toolbar title="Plan" />
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
  return (
    <div className="desktop-plan">
      {/* Note that the document is hidden rather than left out while the
          panel fills the window, and keeps its layout beneath the panel, so
          leaving full screen uncovers it as it was. */}
      <div className="desktop-plan-main" hidden={sidePanel.fullScreen}>
        <Toolbar title={<PlanTitle plan={plan} rename={rename} />}>
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
          <CopyNote copy={plans.copy} />
          <RepositoryChip
            key={plan.id}
            place={CHIP_PLACE.TOOLBAR}
            value={plan.repository}
            chooser={plans.repositories}
            onChoose={chooseRepository}
            openRequest={menuRequest}
          />
          <StartAgentButton control={plans.agents} />
          <PlanActionsButton key={plan.id} plans={plans} plan={plan} onRename={rename.begin} />
          {/* The open panel holds its own toggle in its own top row. */}
          {sidePanel.open ? null : <SidePanelToggle panel={sidePanel} />}
        </Toolbar>
        <section className="desktop-document" aria-label={plan.name}>
          <PlanBody plan={plan} live={plans.live} />
        </section>
        <div className="desktop-call-bar" data-live={String(plans.status !== undefined)}>
          <MicrophoneRow status={plans.status} microphone={plans.microphone} stop={plans.stop} />
        </div>
      </div>
      {drawing.panel ? (
        <SidePanel
          {...drawing}
          panel={drawing.panel}
          unread={plans.unreadTabs}
          planId={plan.id}
          board={plans.board}
          code={plans.code}
          transcript={plans.transcript}
          agents={plans.agents}
          shown={plans.shown}
        />
      ) : null}
    </div>
  );
}

export function DesktopPlans({ plans }: { plans: PlansControl }): React.JSX.Element {
  switch (plans.page) {
    case PLANS_PAGE.DOCUMENT:
      return <PlanDocument plans={plans} />;
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
