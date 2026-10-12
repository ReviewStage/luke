import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { MarkdownMessage } from "../markdown-message";
import {
  ConfirmDialog,
  DIALOG_TONE,
  type DialogQuestion,
  useConfirmDialog,
} from "../settings/confirm-dialog";
import { Skeleton, SkeletonRegion } from "../skeleton";
import { Tooltip } from "../tooltip";
import { VERSION_CHANGE, type VersionDiff, versionDiff, versionMoment } from "./plan-history-model";
import { momentText } from "./plan-time";
import { PlanTitle } from "./plan-title";
import { NO_ASSUMPTIONS_LINE } from "./planning-model";
import { HISTORY_READ, type PlanHistoryControl, type ViewedVersion } from "./use-plan-history";

/**
 * version-view.tsx -- one version of a plan, drawn read-only with what it changed marked, under a bar with its restore.
 *
 * The page beside a plan's version history (`desktop-version-history.tsx`),
 * the way Google Docs shows a version in the page rather than in its narrow
 * list. Its bar names when the version was saved and offers Restore this
 * version, which the newest version, the plan as it stands, holds unavailable
 * with a hint saying why: `aria-disabled` rather than `disabled`, since a
 * disabled button takes no pointer and no focus, so its hint could never
 * show. The version is drawn whole against the version before it, which
 * shows what that revision changed: words written in wear the accent and
 * words struck out are struck, so neither reads by its colour alone
 * (`plan-history-model.ts`). A version of a plan that is one document is
 * drawn under the plan's name, as the plan's own tab draws it, with no
 * assumptions' section after it, since its assumptions are a section of
 * its text. The first version has nothing before it, so it is drawn with
 * nothing marked. A section opened from its revision's list is drawn alone,
 * without the plan's name over it, marked as the whole version marks it,
 * and a version still being read stands as
 * quiet blocks in the page's shape (`skeleton.tsx`). Restoring asks first,
 * in the window's dialog with the accent rather than red, since a restore is
 * itself a version the history keeps and can be undone by restoring the
 * one before it. Everything drawn is the plan's words, so the root is left
 * out of the screen recording (`ph-no-capture`) as a second line behind the
 * recording's text masking.
 */

/** What the view says over a version that changed nothing from the one before it. */
const NO_CHANGE_LINE = "This version changed nothing from the one before it.";

/**
 * The placeholder page's shape while a version is read: a heading over its
 * lines, twice, each line as wide as its share of the column.
 */
const PAGE_SKELETON = [
  { heading: "42%", lines: ["100%", "96%", "88%", "54%"] },
  { heading: "30%", lines: ["100%", "91%", "72%"] },
] as const;

/** Why Restore this version is unavailable over the newest version. */
const CURRENT_HINT = "This version is already current";

/** The question Restore this version asks, naming the version. */
function restoreQuestion(at: number): DialogQuestion {
  return {
    title: "Restore this version?",
    body: `The plan will go back to the version from ${versionMoment(at)}. The plan as it stands now stays in the history, so you can restore it again.`,
    verb: "Restore",
    running: "Restoring",
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

/** The assumptions of a version of a plan of the template's fields, each drawn as it stands against what it is compared with. */
function VersionAssumptions({ diff }: { diff: VersionDiff }): React.JSX.Element {
  return (
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
  );
}

/**
 * The version's body, each unit drawn as it stands against what it is
 * compared with: under `title` for a plan that is one document, and
 * followed by its assumptions for a plan of the template's fields.
 */
function VersionBody({
  diff,
  title,
  section,
}: {
  diff: VersionDiff;
  title: string | undefined;
  section: number | undefined;
}): React.JSX.Element {
  const units = section === undefined ? diff.units : diff.units.slice(section, section + 1);
  return (
    <>
      <div className="plan-body">
        {title === undefined || section !== undefined ? null : <PlanTitle name={title} />}
        {units.map((unit, at) => (
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
      {title === undefined && section === undefined ? <VersionAssumptions diff={diff} /> : null}
    </>
  );
}

/** The version's page as quiet blocks while it is read: headings over their lines, in the body's own type. */
export function VersionSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading the version…" className="plan-body">
      {PAGE_SKELETON.map((section) => (
        <div key={section.heading} className="version-skeleton-section">
          <Skeleton width={section.heading} className="version-skeleton-heading" />
          {section.lines.map((width, at) => (
            // oxlint-disable-next-line react/no-array-index-key -- a placeholder's lines have nothing but their place.
            <Skeleton key={at} width={width} />
          ))}
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** The version's content against the one before it, or the state standing in its place. */
function VersionContent({
  viewing,
  title,
  section,
}: {
  viewing: ViewedVersion;
  title: string | undefined;
  section: number | undefined;
}): React.JSX.Element {
  const { read } = viewing;
  if (read.kind === HISTORY_READ.READING) return <VersionSkeleton />;
  if (read.kind === HISTORY_READ.FAILED) {
    return (
      <p className="version-note" role="alert">
        The version could not be read.
      </p>
    );
  }
  const diff = versionDiff(read.previous, read.document, title);
  // Note that the first version is compared with nothing, so it is never said to have changed nothing.
  const unchanged = read.previous !== null && !diff.changed;
  return (
    <>
      {unchanged ? <p className="version-note">{NO_CHANGE_LINE}</p> : null}
      <VersionBody diff={diff} title={title} section={section} />
    </>
  );
}

/**
 * The version chosen in the version history, the page beside its list: the
 * bar with when it was saved and its restore, over the version itself.
 * `shown` is whether the window shows it, which the restore's question
 * stands on, and `onRestored` what follows a restore that landed. An
 * archived plan's versions are read but not restored, so its bar offers no
 * restore.
 */
export function VersionView({
  history,
  viewing,
  shown,
  onRestored,
  restorable = true,
  title,
  section,
}: {
  history: PlanHistoryControl;
  viewing: ViewedVersion;
  shown: boolean;
  onRestored: () => void;
  /** Whether the version may be restored: not while the plan is archived. */
  restorable?: boolean;
  /** The name of a plan that is one document, which every version is drawn under (`documentTitleOf`). */
  title?: string | undefined;
  /** The one unit of the version to draw, alone and without the plan's title, as a section opened from its revision's list; the whole version without one. */
  section?: number | undefined;
}): React.JSX.Element {
  // An archive landing while the question stands takes the question down with the button.
  const restore = useConfirmDialog({ subject: restorable, surfaceOpen: shown }, async () => {
    const result = await history.onRestore();
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) onRestored();
    return result;
  });
  const { line } = viewing;
  return (
    <>
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title" title={momentText(line.lastEdit.at)}>
            {versionMoment(line.lastEdit.at)}
          </h1>
        </div>
        {restorable ? (
          <div className="desktop-toolbar-actions">
            <Tooltip label={viewing.current ? CURRENT_HINT : undefined}>
              <button
                type="button"
                className="primary-button"
                aria-disabled={viewing.current ? "true" : undefined}
                onClick={viewing.current ? undefined : restore.ask}
              >
                Restore this version
              </button>
            </Tooltip>
          </div>
        ) : null}
      </header>
      <div className="desktop-document">
        <div className="plan-document-scroll">
          <VersionContent viewing={viewing} title={title} section={section} />
        </div>
      </div>
      <ConfirmDialog confirm={restore} question={restoreQuestion(line.lastEdit.at)} />
    </>
  );
}
