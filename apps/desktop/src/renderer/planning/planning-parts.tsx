import type { PlanAssumption, PlanSummary } from "@sidecar/hosted/plan-wire";
import { BackIcon, CheckIcon, CopyIcon, MicrophoneIcon, PlusIcon } from "@sidecar/panel";
import { MarkdownMessage } from "../markdown-message";
import {
  COPY_FAILED_NOTE,
  COPY_SHOWN,
  type CopyShown,
  DOCUMENT_REGION,
  type DocumentRegion,
  NO_ASSUMPTIONS_LINE,
  repositoryLine,
} from "./planning-model";

/**
 * planning-parts.tsx -- the Plans tab's pages as pure layouts: the plan list, and the open plan's document over its microphone row.
 *
 * Each part draws what it is handed and decides nothing, so what a region
 * shows is `planning-model.ts`'s answer and a press is a callback the tab
 * hands down. The document is read-only throughout: nothing drawn here edits
 * a plan or reaches the model as conversation. The
 * waveform and the captions are the panel's own, drawn on the shape for a
 * planning call exactly as for any other.
 */

/** The list page: every plan the account owns, most recently opened first, under New plan. */
export function PlanList({
  plans,
  activePlanId,
  failed,
  onSelect,
  onRetry,
  onNewPlan,
}: {
  plans: readonly PlanSummary[];
  activePlanId: string | undefined;
  /** The last list read failed; the plans drawn are the ones it read before. */
  failed: boolean;
  onSelect: (planId: string) => void;
  onRetry: () => void;
  onNewPlan: () => void;
}): React.JSX.Element {
  return (
    <nav className="plan-list" aria-label="Plans">
      <button type="button" className="plan-button plan-list-new" onClick={onNewPlan}>
        <PlusIcon />
        New plan
      </button>
      {failed ? (
        <p className="plan-list-note" role="alert">
          Your plans could not be read.{" "}
          <button type="button" className="link-button" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}
      {plans.length === 0 && !failed ? <p className="plan-list-note">No plans yet.</p> : null}
      <ul className="plan-list-rows">
        {plans.map((plan) => (
          <li key={plan.id}>
            <button
              type="button"
              className="plan-list-row"
              aria-current={plan.id === activePlanId ? "true" : undefined}
              onClick={() => onSelect(plan.id)}
            >
              <span className="plan-list-name">{plan.name}</span>
              <span className="plan-list-repository">
                {plan.repository.owner}/{plan.repository.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One assumption, its text as stored. */
function AssumptionRow({ assumption }: { assumption: PlanAssumption }): React.JSX.Element {
  return <li className="plan-assumption">{assumption.text}</li>;
}

/**
 * Copy, the one action on the document: always enabled, whether or not a handoff prompt is written yet. The check mark
 * stands while the clipboard holds the document drawn, and a refused copy
 * says so beside the button.
 */
function CopyControl({
  shown,
  onPress,
}: {
  shown: CopyShown;
  onPress: () => void;
}): React.JSX.Element {
  const copied = shown === COPY_SHOWN.COPIED;
  return (
    <div className="plan-copy">
      {shown === COPY_SHOWN.FAILED ? (
        <p className="plan-copy-failed" role="alert">
          {COPY_FAILED_NOTE}
        </p>
      ) : null}
      <button
        type="button"
        className="plan-button plan-copy-button"
        data-copied={copied ? "true" : undefined}
        onClick={onPress}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** The document page's header: the way back to the list, the plan's name and repository line, and Copy. */
function PlanHeader({
  title,
  repository,
  copy,
  onBack,
}: {
  title: string;
  repository?: string | undefined;
  copy?: { shown: CopyShown; onPress: () => void } | undefined;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <header className="plan-header">
      <button
        type="button"
        className="icon-button plan-back"
        aria-label="Back to plans"
        title="Back"
        onClick={onBack}
      >
        <BackIcon />
      </button>
      <div className="plan-heading">
        <h1 className="plan-title">{title}</h1>
        {repository !== undefined ? <p className="plan-repository">{repository}</p> : null}
      </div>
      {copy !== undefined ? <CopyControl shown={copy.shown} onPress={copy.onPress} /> : null}
    </header>
  );
}

/**
 * The document page's region: the saved body and its assumptions under the
 * header, the assumptions' section standing even while the list is empty as
 * the fixed template's last section, which scroll between the header and the microphone row, or the
 * state that stands in their place. Back leaves the plan, which ends its call.
 */
export function PlanDocumentView({
  region,
  onRetry,
  onBack,
  copy,
}: {
  region: DocumentRegion;
  onRetry: () => void;
  onBack: () => void;
  /** What Copy shows for the drawn document, and its press. */
  copy: { shown: CopyShown; onPress: () => void };
}): React.JSX.Element {
  switch (region.kind) {
    case DOCUMENT_REGION.NONE:
      return (
        <section className="plan-document plan-document-state">
          <PlanHeader title="Plans" onBack={onBack} />
          <p>Choose a plan, or start a new one.</p>
        </section>
      );
    case DOCUMENT_REGION.READING:
      return (
        <section className="plan-document plan-document-state" aria-busy="true">
          <PlanHeader title="Plans" onBack={onBack} />
          <p>Reading the plan…</p>
        </section>
      );
    case DOCUMENT_REGION.FAILED:
      return (
        <section className="plan-document plan-document-state">
          <PlanHeader title="Plans" onBack={onBack} />
          <p role="alert">The plan could not be read.</p>
          <button type="button" className="plan-button" onClick={onRetry}>
            Try again
          </button>
        </section>
      );
    case DOCUMENT_REGION.MISSING:
      return (
        <section className="plan-document plan-document-state">
          <PlanHeader title="Plans" onBack={onBack} />
          <p role="alert">This plan no longer exists.</p>
        </section>
      );
    case DOCUMENT_REGION.READY: {
      const { plan } = region;
      const { body, assumptions } = plan.document;
      return (
        <section className="plan-document" aria-label={plan.name}>
          <PlanHeader
            title={plan.name}
            repository={repositoryLine(plan.repository)}
            copy={copy}
            onBack={onBack}
          />
          <div className="plan-document-scroll">
            <MarkdownMessage words={body} className="plan-body" />
            <section className="plan-assumptions" aria-label="Assumptions">
              <h2 className="plan-assumptions-heading">Assumptions</h2>
              {assumptions.length === 0 ? (
                <p className="plan-assumptions-none">{NO_ASSUMPTIONS_LINE}</p>
              ) : (
                <ul>
                  {assumptions.map((assumption, index) => (
                    // An assumption has no id of its own: the list is replaced whole on every save.
                    // oxlint-disable-next-line react/no-array-index-key -- the saved list's order is its identity.
                    <AssumptionRow key={index} assumption={assumption} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </section>
      );
    }
  }
}

/**
 * The microphone row under the document: the button, and the open plan's
 * call status beside it. Only the button and the word are the tab's own;
 * whoever is heard, and what is said, the panel draws on its shape.
 */
export function MicrophoneRow({
  status,
  microphone,
}: {
  /** The call's status word, absent while no call about this plan stands. */
  status: string | undefined;
  microphone: { label: string; enabled: boolean; onPress: () => void };
}): React.JSX.Element {
  return (
    <footer className="plan-microphone-row">
      <button
        type="button"
        className="plan-microphone"
        aria-label={microphone.label}
        title={microphone.label}
        disabled={!microphone.enabled}
        onClick={microphone.onPress}
      >
        <MicrophoneIcon />
      </button>
      <span className="plan-voice-status">{status ?? microphone.label}</span>
    </footer>
  );
}
