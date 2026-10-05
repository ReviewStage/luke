import { CheckIcon, CloseIcon, CopyIcon, DocumentIcon, PlusIcon } from "@sidecar/panel";
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

/**
 * The work column while Plans is chosen: the open plan as a document with
 * its toolbar above and the call bar below, the new-plan form, or the empty
 * state that offers one. The plan list itself is the sidebar's.
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

/** Copy, the one action on a document, with its refusal said beside it. */
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

/** Nothing open: what this column is for, and the way to start. */
function EmptyPlans({ plans }: { plans: PlansControl }): React.JSX.Element {
  return (
    <section className="desktop-empty">
      <span className="desktop-empty-mark" aria-hidden="true">
        <DocumentIcon />
      </span>
      <h1>Plan a feature with Luke</h1>
      <p>
        {plans.signedIn
          ? "Talk it through and Luke writes the plan as you go. Pick a plan on the left, or start a new one."
          : "Sign in to Luke to plan a feature."}
      </p>
      {plans.signedIn ? (
        <button type="button" className="primary-button" onClick={plans.onNewPlan}>
          <PlusIcon />
          New plan
        </button>
      ) : null}
    </section>
  );
}

/** The open plan's region: its document, or the state standing in its place. */
function PlanDocument({ plans }: { plans: PlansControl }): React.JSX.Element {
  const { region } = plans;
  const closeButton = (
    <button
      type="button"
      className="toolbar-button toolbar-icon-button"
      aria-label="Close plan"
      title="Close plan"
      onClick={plans.onLeavePlan}
    >
      <CloseIcon />
    </button>
  );
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
        <Toolbar title="Plan">{closeButton}</Toolbar>
        <section className="desktop-empty" aria-busy={region.kind === DOCUMENT_REGION.READING}>
          <p role={region.kind === DOCUMENT_REGION.READING ? undefined : "alert"}>{line}</p>
          {region.kind === DOCUMENT_REGION.FAILED ? (
            <button type="button" className="primary-button" onClick={plans.onRetryDocument}>
              Try again
            </button>
          ) : null}
        </section>
      </>
    );
  }
  const { plan } = region;
  const folderPath = plans.folders[plan.id];
  return (
    <>
      <Toolbar
        title={plan.name}
        subtitle={folderPath === undefined ? undefined : folderLine(folderPath)}
      >
        {folderPath === undefined ? (
          <button type="button" className="toolbar-button" onClick={plans.onChooseFolder}>
            Choose folder…
          </button>
        ) : null}
        <CopyButton copy={plans.copy} />
        {closeButton}
      </Toolbar>
      <section className="desktop-document" aria-label={plan.name}>
        <PlanBody plan={plan} live={plans.live} />
      </section>
      <div className="desktop-call-bar" data-live={String(plans.status !== undefined)}>
        <MicrophoneRow status={plans.status} microphone={plans.microphone} />
      </div>
    </>
  );
}

export function DesktopPlans({ plans }: { plans: PlansControl }): React.JSX.Element {
  switch (plans.page) {
    case PLANS_PAGE.DOCUMENT:
      return <PlanDocument plans={plans} />;
    case PLANS_PAGE.NEW:
      return (
        <>
          <Toolbar title="New plan" />
          <div className="desktop-form">
            <NewPlanForm onStarted={plans.onCancelNew} onCancel={plans.onCancelNew} />
          </div>
        </>
      );
    case PLANS_PAGE.LIST:
      return (
        <>
          <Toolbar title="Plans" />
          <EmptyPlans plans={plans} />
        </>
      );
  }
}
