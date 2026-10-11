import type { PlanDocument } from "@sidecar/hosted/plan-wire";
import { MarkdownMessage } from "../markdown-message";
import {
  ConfirmDialog,
  DIALOG_TONE,
  type DialogQuestion,
  useConfirmDialog,
} from "../settings/confirm-dialog";
import {
  VERSION_CHANGE,
  VERSION_COMPARE,
  type VersionCompare,
  type VersionDiff,
  versionDiff,
  versionHeading,
  versionMoment,
} from "./plan-history-model";
import { momentText, useMinute } from "./plan-time";
import { NO_ASSUMPTIONS_LINE } from "./planning-model";
import { HISTORY_READ, type PlanHistoryControl, type ViewedVersion } from "./use-plan-history";

/**
 * version-view.tsx -- a version of the open plan drawn in the document's place, its changes marked, with its restore and the way back.
 *
 * Choosing a row of the History tab turns the document area into a
 * read-only view of that version, the way Google Docs shows a version in
 * the page rather than in its narrow list. A bar above it says whose version
 * it is and from when, and offers the comparison, Restore this version, and
 * Back to current; Escape goes back too, as the window's nearest layer
 * (`use-plans-tab.ts`). The version is drawn whole against the version
 * before it, which shows what that revision changed, or against the plan as
 * it stands, which shows what restoring it would change: words written in
 * wear the accent and words struck out are struck, so neither reads by its
 * colour alone (`plan-history-model.ts`). Restoring asks first, in the
 * window's dialog with the accent rather than red, since a restore is
 * itself a version the history keeps and can be undone by restoring the
 * one before it. Everything drawn is the plan's words, so the root is left
 * out of the screen recording (`ph-no-capture`) as a second line behind the
 * recording's text masking.
 */

/** The comparison's two choices, as its segmented control names them. */
const COMPARE_LABEL = {
  [VERSION_COMPARE.PREVIOUS]: "Changes in this version",
  [VERSION_COMPARE.CURRENT]: "Compared with current",
} as const satisfies Record<VersionCompare, string>;

/** What the view says over a version that differs in nothing from what it is compared with. */
const NO_CHANGE_LINE = {
  [VERSION_COMPARE.PREVIOUS]: "This version changed nothing from the one before it.",
  [VERSION_COMPARE.CURRENT]: "This version is the same as the plan as it stands.",
} as const satisfies Record<VersionCompare, string>;

/** The question Restore this version asks, naming the version. */
function restoreQuestion(at: number): DialogQuestion {
  return {
    title: "Restore this version?",
    body: `The plan will go back to the version from ${versionMoment(at)}. The plan as it stands now stays in the history, so you can restore it again.`,
    verb: "Restore",
    running: "Restoring…",
    tone: DIALOG_TONE.PRIMARY,
  };
}

/** The class a unit or an assumption wears by how it stands. */
const CHANGE_CLASS = {
  [VERSION_CHANGE.SAME]: "",
  [VERSION_CHANGE.ADDED]: " version-added",
  [VERSION_CHANGE.REMOVED]: " version-removed",
  [VERSION_CHANGE.CHANGED]: " version-changed",
} as const;

/** The version's body and its assumptions, each unit and assumption drawn as it stands against what it is compared with. */
function VersionBody({ diff }: { diff: VersionDiff }): React.JSX.Element {
  return (
    <>
      <div className="plan-body">
        {diff.units.map((unit, at) => (
          <MarkdownMessage
            // A unit's heading may stand twice, struck and written again, so its place keys it.
            // oxlint-disable-next-line react/no-array-index-key -- the units are drawn once per diff, in order.
            key={at}
            words={unit.words}
            className={`plan-unit${CHANGE_CLASS[unit.change]}`}
            edit={unit.marks.length === 0 ? undefined : { marks: unit.marks }}
          />
        ))}
      </div>
      <section className="plan-assumptions" aria-label="Assumptions">
        <h2 className="plan-assumptions-heading">Assumptions</h2>
        {diff.assumptions.length === 0 ? (
          <p className="plan-assumptions-none">{NO_ASSUMPTIONS_LINE}</p>
        ) : (
          <ul>
            {diff.assumptions.map((assumption, at) => (
              // oxlint-disable-next-line react/no-array-index-key -- an assumption has no id of its own.
              <li key={at} className={`plan-assumption${CHANGE_CLASS[assumption.change]}`}>
                {assumption.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** The version's content, compared as asked, or the state standing in its place. */
function VersionContent({
  viewing,
  compare,
  current,
}: {
  viewing: ViewedVersion;
  compare: VersionCompare;
  current: PlanDocument;
}): React.JSX.Element {
  const { read } = viewing;
  if (read.kind === HISTORY_READ.READING) {
    return <p className="version-note">Reading the version…</p>;
  }
  if (read.kind === HISTORY_READ.FAILED) {
    return (
      <p className="version-note" role="alert">
        The version could not be read.
      </p>
    );
  }
  const base = compare === VERSION_COMPARE.PREVIOUS ? read.previous : current;
  const diff = versionDiff(base, read.document);
  const note =
    base === null
      ? "The first version: there is nothing before it to compare."
      : diff.changed
        ? undefined
        : NO_CHANGE_LINE[compare];
  return (
    <>
      {note === undefined ? null : <p className="version-note">{note}</p>}
      <VersionBody diff={diff} />
    </>
  );
}

/**
 * The version chosen in the History tab, drawn in the document's place:
 * the bar with its comparison, its restore, and the way back, over the
 * version itself. `current` is the plan as it stands, which the version is
 * compared with on asking; `shown` whether the window shows it, which the
 * restore's question stands on.
 */
export function VersionView({
  history,
  viewing,
  current,
  shown,
}: {
  history: PlanHistoryControl;
  viewing: ViewedVersion;
  current: PlanDocument;
  shown: boolean;
}): React.JSX.Element {
  const now = useMinute();
  const restore = useConfirmDialog({ subject: true, surfaceOpen: shown }, history.onRestore);
  const { line } = viewing;
  return (
    <div className="version-view ph-no-capture">
      <section className="version-bar" aria-label="Version">
        <p className="version-bar-title" title={momentText(line.lastEdit.at)}>
          {versionHeading(line, now)}
          {/* The newest version is the plan as it stands, so it has nothing to restore. */}
          {viewing.current ? " · Current version" : null}
        </p>
        <div className="version-bar-actions">
          <button
            type="button"
            className="primary-button"
            disabled={viewing.current}
            onClick={restore.ask}
          >
            Restore this version
          </button>
          <button type="button" className="toolbar-button" onClick={history.onBack}>
            Back to current
          </button>
        </div>
        <fieldset className="settings-segments version-compare" aria-label="Compare">
          {Object.values(VERSION_COMPARE).map((choice) => (
            <button
              key={choice}
              type="button"
              className="settings-segment"
              aria-pressed={history.compare === choice}
              onClick={() => history.onCompare(choice)}
            >
              {COMPARE_LABEL[choice]}
            </button>
          ))}
        </fieldset>
      </section>
      <div className="plan-document-scroll version-document">
        <VersionContent viewing={viewing} compare={history.compare} current={current} />
      </div>
      <ConfirmDialog confirm={restore} question={restoreQuestion(line.lastEdit.at)} />
    </div>
  );
}
