import { CheckIcon, CopyIcon } from "@sidecar/panel";
import { NewPlanForm } from "../planning/new-plan-form";
import { PlanBody } from "../planning/plan-body";
import {
  COPY_FAILED_NOTE,
  COPY_SHOWN,
  DOCUMENT_REGION,
  folderLine,
  PLANS_PAGE,
} from "../planning/planning-model";
import { MicrophoneRow } from "../planning/planning-parts";
import type { PlansControl } from "../planning/use-plans-tab";
import { PlanActionsButton } from "./plan-actions";
import { SidePanel, SidePanelToggle } from "./side-panel";

/**
 * The work column while Plans is chosen: the open plan's document, with its
 * toolbar above and the call bar below, and the side panel beside all three,
 * the window's full height, while that is open (or over them, while it fills
 * the window); or, with none open, the new-plan page, which is the window's home.
 * The plan list itself is the sidebar's, and so is moving between plans: the
 * toolbar offers no way out of the open plan, only its actions.
 */

/** The strip across the top of the work column, which is also the window's drag handle. */
function Toolbar({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">{title}</h1>
        {subtitle !== undefined ? <p className="desktop-toolbar-subtitle">{subtitle}</p> : null}
      </div>
      {children ? <div className="desktop-toolbar-actions">{children}</div> : null}
    </header>
  );
}

/** Copy, the plan's own action and so never folded into its menu, with its refusal said beside it. */
function CopyButton({ copy }: { copy: PlansControl["copy"] }): React.JSX.Element {
  const copied = copy.shown === COPY_SHOWN.COPIED;
  return (
    <>
      {copy.shown === COPY_SHOWN.FAILED ? (
        <p className="desktop-toolbar-note" role="alert">
          {COPY_FAILED_NOTE}
        </p>
      ) : null}
      <button
        type="button"
        className="toolbar-button"
        data-copied={copied ? "true" : undefined}
        onClick={copy.onPress}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy plan"}
      </button>
    </>
  );
}

/** The open plan's region: its document, or the state standing in its place. */
function PlanDocument({ plans }: { plans: PlansControl }): React.JSX.Element {
  const { region } = plans;
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
  const folderPath = plans.folders[plan.id];
  const { sidePanel } = plans;
  return (
    <div className="desktop-plan">
      {/* Note that the document is hidden rather than left out while the
          panel fills the window, so leaving full screen finds it as it was. */}
      <div className="desktop-plan-main" hidden={sidePanel.fullScreen}>
        <Toolbar
          title={plan.name}
          subtitle={folderPath === undefined ? undefined : folderLine(folderPath)}
        >
          {folderPath === undefined ? (
            <button
              type="button"
              className="toolbar-button"
              onClick={() => plans.onChooseFolder(plan.id)}
            >
              Choose folder…
            </button>
          ) : null}
          <CopyButton copy={plans.copy} />
          <PlanActionsButton key={plan.id} plans={plans} planId={plan.id} />
          {/* The open panel holds its own toggle in its own top row. */}
          {sidePanel.open ? null : <SidePanelToggle open={false} onToggle={sidePanel.onToggle} />}
        </Toolbar>
        <section className="desktop-document" aria-label={plan.name}>
          <PlanBody plan={plan} live={plans.live} />
        </section>
        <div className="desktop-call-bar" data-live={String(plans.status !== undefined)}>
          <MicrophoneRow status={plans.status} microphone={plans.microphone} stop={plans.stop} />
        </div>
      </div>
      {sidePanel.open ? (
        <SidePanel
          panel={sidePanel}
          planId={plan.id}
          board={plans.board}
          code={plans.code}
          transcript={plans.transcript}
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
            <NewPlanForm newPlan={plans.newPlan} />
          </div>
        </>
      );
  }
}
