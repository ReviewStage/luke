import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  BackIcon,
  CheckIcon,
  CopyIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PlusIcon,
  StopIcon,
} from "@sidecar/panel";
import { ThinkingDots } from "../thinking-dots";
import { PlanBody } from "./plan-body";
import {
  type CallStatus,
  COPY_FAILED_NOTE,
  COPY_SHOWN,
  type CopyShown,
  DOCUMENT_REGION,
  type DocumentRegion,
  folderLine,
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

/** What a reader is told while the backend works; the sighted read the dots and the line. */
const PLAN_WORKING_LABEL = "Luke is working on it";

/** The backend line's names for its two parts, and what the planning model says with no command pending. */
const PLANNER_NAME = "Planning model";
const PLANNER_THINKING = "Thinking";
const NOTETAKER_WRITING = "Notetaker · Writing notes";

/** The stop's name for a reader and its hover. */
const STOP_CALL_LABEL = "End the call";

/** The list page: every plan the account owns, newest started first, under New plan. */
export function PlanList({
  plans,
  folders,
  activePlanId,
  failed,
  onSelect,
  onRetry,
  onNewPlan,
}: {
  plans: readonly PlanSummary[];
  /** The folder of this Mac each plan reads, by plan id. */
  folders: Readonly<Record<string, string>>;
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
              <FolderLine folderPath={folders[plan.id]} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Copy, the one action on the document: always enabled, however much of the plan is written. The check mark
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

/** The folder line of a plan, or nothing where this Mac holds no folder for it. */
function folderOf(folders: Readonly<Record<string, string>>, planId: string): string | undefined {
  const folderPath = folders[planId];
  return folderPath === undefined ? undefined : folderLine(folderPath);
}

/** A plan's folder on this Mac, or nothing where this Mac holds none for it. */
function FolderLine({ folderPath }: { folderPath: string | undefined }): React.JSX.Element | null {
  if (folderPath === undefined) return null;
  return <span className="plan-list-repository">{folderLine(folderPath)}</span>;
}

/** The document page's header: the way back to the list, the plan's name and folder line, and Copy. */
function PlanHeader({
  title,
  repository,
  onChooseFolder,
  copy,
  onBack,
}: {
  title: string;
  repository?: string | undefined;
  /** Offered in place of the folder line where this Mac holds no folder for the plan. */
  onChooseFolder?: (() => void) | undefined;
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
        {repository === undefined && onChooseFolder !== undefined ? (
          <button type="button" className="link-button" onClick={onChooseFolder}>
            Choose folder…
          </button>
        ) : null}
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
  live,
  folders,
  onChooseFolder,
}: {
  region: DocumentRegion;
  onRetry: () => void;
  onBack: () => void;
  /** The folder of this Mac each plan reads, by plan id. */
  folders: Readonly<Record<string, string>>;
  onChooseFolder: () => void;
  /** What Copy shows for the drawn document, and its press. */
  copy: { shown: CopyShown; onPress: () => void };
  /** Whether the open plan's call is in progress, so the plan is still being written. */
  live: boolean;
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
      return (
        <section className="plan-document" aria-label={plan.name}>
          <PlanHeader
            key={plan.id}
            title={plan.name}
            repository={folderOf(folders, plan.id)}
            onChooseFolder={onChooseFolder}
            copy={copy}
            onBack={onBack}
          />
          <PlanBody plan={plan} live={live} />
        </section>
      );
    }
  }
}

/**
 * The microphone row under the document: the button, and beside it the open
 * plan's call in two lines. The button is struck through and pressed while
 * the call stands muted. While the call is in progress a stop ends it, apart
 * from the microphone, so muting never hangs up and hanging up is one press. The first is the voice's word. The second stands
 * only while the backend works: the planning model with its pending command
 * set in monospace, or Thinking where it has none, and the notetaker while it
 * writes, each named so neither reads as the voice. The dots are decorative,
 * so a reader is told by a status line of its own. Only the button and the
 * lines are the tab's own; whoever is heard, and what is said, the panel
 * draws on its shape.
 */
export function MicrophoneRow({
  status,
  microphone,
  stop,
}: {
  /** The call's status, absent while no call about this plan stands. */
  status: CallStatus | undefined;
  microphone: { label: string; enabled: boolean; muted: boolean; onPress: () => void };
  stop: { shown: boolean; onPress: () => void };
}): React.JSX.Element {
  const planner = status?.backend.planner;
  const notes = status?.backend.notes ?? false;
  return (
    <footer className="plan-microphone-row">
      <button
        type="button"
        className="plan-microphone"
        aria-label={microphone.label}
        title={microphone.label}
        aria-pressed={microphone.muted}
        data-muted={String(microphone.muted)}
        disabled={!microphone.enabled}
        onClick={microphone.onPress}
      >
        {microphone.muted ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
      </button>
      <span className="plan-voice-status">
        <span className="plan-voice-word">{status?.voiceWord ?? microphone.label}</span>
        {planner !== undefined || notes ? (
          <span className="plan-backend">
            <ThinkingDots />
            {planner === undefined ? null : (
              <span className="plan-backend-part">
                {PLANNER_NAME} ·{" "}
                {planner.action === undefined ? (
                  PLANNER_THINKING
                ) : (
                  <span className="plan-backend-action">{planner.action}</span>
                )}
              </span>
            )}
            {notes ? <span className="plan-backend-part">{NOTETAKER_WRITING}</span> : null}
            <span className="visually-hidden" role="status">
              {PLAN_WORKING_LABEL}
            </span>
          </span>
        ) : null}
      </span>
      {stop.shown ? (
        <button
          type="button"
          className="plan-stop"
          aria-label={STOP_CALL_LABEL}
          title={STOP_CALL_LABEL}
          onClick={stop.onPress}
        >
          <StopIcon />
        </button>
      ) : null}
    </footer>
  );
}
