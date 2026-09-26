import type { PlanAssumption, PlanSummary } from "@sidecar/hosted/plan-wire";
import { CheckIcon, CopyIcon, MicrophoneIcon, PlusIcon } from "@sidecar/panel";
import { MarkdownMessage } from "../markdown-message";
import { ThinkingDots } from "../thinking-dots";
import { Waveform, type WaveformVoice } from "../waveform";
import {
  COPY_FAILED_NOTE,
  COPY_SHOWN,
  type CopyShown,
  DOCUMENT_REGION,
  type DocumentRegion,
  EMPTY_PLAN_LINE,
  repositoryLine,
  type VoiceBarLine,
} from "./planning-model";

/**
 * planning-parts.tsx -- the planning window's regions as pure layouts: the plan list, the document, and the voice bar.
 *
 * Each part draws what it is handed and decides nothing, so what a region
 * shows is `planning-model.ts`'s answer and a press is a callback the surface
 * hands down. The document is read-only throughout: nothing drawn here edits
 * a plan, confirms an assumption, or reaches the model as conversation.
 */

/** The sidebar: every plan the account owns, most recently opened first, and New plan at its foot. */
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
      <h2 className="plan-list-heading">Plans</h2>
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
      <button type="button" className="plan-list-new" onClick={onNewPlan}>
        <PlusIcon />
        New plan
      </button>
    </nav>
  );
}

/**
 * One assumption: a checkbox that cannot be clicked, the text, and the plain
 * status. The flag is the model's reading of the developer's agreement,
 * shown as stored; nothing here can change it.
 */
function AssumptionRow({ assumption }: { assumption: PlanAssumption }): React.JSX.Element {
  return (
    <li className="plan-assumption" data-confirmed={String(assumption.confirmed)}>
      <input type="checkbox" checked={assumption.confirmed} disabled readOnly tabIndex={-1} />
      <span className="plan-assumption-text">{assumption.text}</span>
      <span className="plan-assumption-status">
        {assumption.confirmed ? "Confirmed" : "Not confirmed"}
      </span>
    </li>
  );
}

/**
 * Copy, the one action on the document: always enabled, whatever the flags
 * say and whether or not a handoff prompt is written yet. The check mark
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

/** The document region: the saved body and its assumptions, or the state that stands in their place. */
export function PlanDocumentView({
  region,
  onRetry,
  copy,
}: {
  region: DocumentRegion;
  onRetry: () => void;
  /** What Copy shows for the drawn document, and its press. */
  copy: { shown: CopyShown; onPress: () => void };
}): React.JSX.Element {
  switch (region.kind) {
    case DOCUMENT_REGION.NONE:
      return (
        <section className="plan-document plan-document-state">
          <p>Choose a plan, or start a new one.</p>
        </section>
      );
    case DOCUMENT_REGION.READING:
      return (
        <section className="plan-document plan-document-state" aria-busy="true">
          <p>Reading the plan…</p>
        </section>
      );
    case DOCUMENT_REGION.FAILED:
      return (
        <section className="plan-document plan-document-state">
          <p role="alert">The plan could not be read.</p>
          <button type="button" className="plan-button" onClick={onRetry}>
            Try again
          </button>
        </section>
      );
    case DOCUMENT_REGION.MISSING:
      return (
        <section className="plan-document plan-document-state">
          <p role="alert">This plan no longer exists.</p>
        </section>
      );
    case DOCUMENT_REGION.READY: {
      const { plan } = region;
      const { body, assumptions } = plan.document;
      return (
        <section className="plan-document" aria-label={plan.name}>
          <header className="plan-header">
            <h1 className="plan-title">{plan.name}</h1>
            <p className="plan-repository">{repositoryLine(plan.repository)}</p>
            <CopyControl shown={copy.shown} onPress={copy.onPress} />
          </header>
          <div className="plan-document-scroll">
            {body.trim().length === 0 ? (
              <p className="plan-empty">{EMPTY_PLAN_LINE}</p>
            ) : (
              <MarkdownMessage words={body} className="plan-body" />
            )}
            {assumptions.length > 0 ? (
              <section className="plan-assumptions" aria-label="Assumptions">
                <h2 className="plan-assumptions-heading">Assumptions</h2>
                <ul>
                  {assumptions.map((assumption, index) => (
                    // An assumption has no id of its own: the list is replaced whole on every save.
                    // oxlint-disable-next-line react/no-array-index-key -- the saved list's order is its identity.
                    <AssumptionRow key={index} assumption={assumption} />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </section>
      );
    }
  }
}

/**
 * The voice bar: the microphone button, the status word or the voice error
 * standing in its place, the waveform, and the words being said now.
 */
export function VoiceBar({
  line,
  level,
  voice,
  voiceActive,
  thinking,
  microphone,
}: {
  line: VoiceBarLine;
  /** How loud whoever is talking is, in the unit interval. */
  level: number;
  /** Whose turn the waveform draws, absent while nobody is heard. */
  voice: WaveformVoice | undefined;
  /** Whether that voice is audibly talking, on the relayed levels' own hangover. */
  voiceActive: boolean;
  /** The planning model is working on a delegated question and Luke has nothing to say yet. */
  thinking: boolean;
  microphone: { label: string; enabled: boolean; onPress: () => void };
}): React.JSX.Element {
  return (
    <footer className="plan-voice-bar">
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
      <span
        className="plan-voice-status"
        data-tone={line.status?.tone}
        role={line.status?.tone === "error" ? "alert" : undefined}
      >
        {line.status?.text ?? ""}
      </span>
      <Waveform level={level} voice={voice} voiceActive={voiceActive} />
      {thinking ? <ThinkingDots /> : null}
      <p className="plan-caption" aria-live="polite">
        {line.caption ?? ""}
      </p>
    </footer>
  );
}
