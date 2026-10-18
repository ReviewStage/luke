import { dayAndTimeText, momentText } from "@luke/panel/tasks/task-time";
import { TaskTitle } from "@luke/panel/tasks/task-title";
import { useOpenLink } from "@luke/panel/tasks/use-open-link";
import { TOAST_HOLD, TOAST_TONE, type ToastNotice, UNDO_LABEL } from "@luke/panel/toast";
import { Tooltip } from "@luke/panel/tooltip";
import {
  BUTTON_VARIANT,
  Button,
  ConfirmDialog,
  DIALOG_TONE,
  type DialogConfirm,
  type DialogQuestion,
  ErrorState,
  Skeleton,
  SkeletonRegion,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { MarkdownMessage } from "../markdown-message";
import { DocumentScroll } from "./document-frame";
import { VERSION_CHANGE, type VersionDiff, versionDiff } from "./plan-history-model";
import { PlanPictures, usePlanPictureDrawer } from "./plan-pictures";
import { type MentionedTask, useMentionLink } from "./task-mentions";
import { HISTORY_READ, type PlanHistoryControl, type ViewedVersion } from "./use-plan-history";

/**
 * version-view.tsx -- one version of a plan, drawn read-only with what it changed marked, under a bar with its restore.
 *
 * The page beside a plan's version history (`desktop-version-history.tsx`),
 * the way Google Docs shows a version in the page rather than in its narrow
 * list. Its bar names when the version was saved and offers Restore this
 * version, which the newest version, the plan as it stands, holds unavailable
 * with a hint saying why: unavailable but still focusable, since a
 * disabled button takes no pointer and no focus, so its hint could never
 * show. The version is drawn whole against the version before it, which
 * shows what that revision changed: words written in wear the accent and
 * words struck out are struck, so neither reads by its colour alone
 * (`plan-history-model.ts`). A Mermaid fence draws as its diagram, and one
 * whose code the revision changed as its code with the changes marked,
 * since two diagrams side by side would hide what changed (`../plan-diagram.tsx`).
 * A version is drawn under the plan's name, as
 * the plan's own tab draws it. The first version has nothing before it, so
 * it is drawn with nothing marked. A section opened from its revision's
 * list is drawn alone, without the task's name over it, marked as the whole
 * version marks it, and a version still being read stands as
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

/** What the toast says once a version is restored, and why its Undo did nothing. */
const VERSION_RESTORED_NOTE = "Version restored";
const RESTORE_UNDO_REFUSED_NOTE = "The restore could not be undone. Try again.";

/** Why Restore this version is unavailable over the newest version. */
const CURRENT_HINT = "This version is already current";

/** The question Restore this version asks, naming the version and what it is of. */
function restoreQuestion(at: number, noun: string): DialogQuestion {
  return {
    title: "Restore this version?",
    body: `The ${noun} will go back to the version from ${dayAndTimeText(at)}. The ${noun} as it stands now stays in the history.`,
    verb: "Restore",
    running: "Restoring",
    tone: DIALOG_TONE.PRIMARY,
  };
}

/** The class a unit wears by how it stands. */
const CHANGE_CLASS = {
  [VERSION_CHANGE.SAME]: "",
  [VERSION_CHANGE.ADDED]: " version-added",
  [VERSION_CHANGE.REMOVED]: " version-removed",
  [VERSION_CHANGE.CHANGED]: " version-changed",
} as const;

/** The version's text under the task's name, each unit drawn as it stands against what it is compared with. */
function VersionBody({
  diff,
  title,
  section,
  task,
}: {
  diff: VersionDiff;
  title: string | undefined;
  section: number | undefined;
  task: MentionedTask | undefined;
}): React.JSX.Element {
  const units = section === undefined ? diff.units : diff.units.slice(section, section + 1);
  const link = useMentionLink(task);
  const openLink = useOpenLink();
  const picture = usePlanPictureDrawer();
  return (
    <div className="plan-body">
      {title === undefined || section !== undefined ? null : <TaskTitle name={title} />}
      {units.map((unit, at) => (
        <MarkdownMessage
          // A unit's heading may stand twice, struck and written again, so its place keys it.
          // oxlint-disable-next-line react/no-array-index-key -- the units are drawn once per diff, in order.
          key={at}
          words={unit.words}
          className={`plan-unit${CHANGE_CLASS[unit.change]}`}
          edit={unit.marks.length === 0 ? undefined : { marks: unit.marks }}
          link={link}
          openLink={openLink}
          diagrams
          picture={picture}
        />
      ))}
    </div>
  );
}

/** The version's page as quiet blocks while it is read: headings over their lines, in the body's own type. */
export function VersionSkeleton(): React.JSX.Element {
  return (
    <div className="plan-body">
      <SkeletonRegion label="Reading the version…">
        {PAGE_SKELETON.map((section) => (
          <div key={section.heading} className="version-skeleton-section">
            <div className="version-skeleton-heading">
              <Skeleton width={section.heading} />
            </div>
            {section.lines.map((width, at) => (
              // oxlint-disable-next-line react/no-array-index-key -- a placeholder's lines have nothing but their place.
              <Skeleton key={at} width={width} />
            ))}
          </div>
        ))}
      </SkeletonRegion>
    </div>
  );
}

/** The version's content against the one before it, or the state standing in its place. */
function VersionContent({
  viewing,
  title,
  section,
  task,
}: {
  viewing: ViewedVersion;
  title: string | undefined;
  section: number | undefined;
  task: MentionedTask | undefined;
}): React.JSX.Element {
  const { read } = viewing;
  if (read.kind === HISTORY_READ.READING) return <VersionSkeleton />;
  if (read.kind === HISTORY_READ.FAILED) {
    return (
      <div className="version-note">
        <ErrorState>The version could not be read.</ErrorState>
      </div>
    );
  }
  const diff = versionDiff(read.previous, read.document);
  // Note that the first version is compared with nothing, so it is never said to have changed nothing.
  const unchanged = read.previous !== null && !diff.changed;
  return (
    <>
      {unchanged ? <p className="version-note">{NO_CHANGE_LINE}</p> : null}
      {task === undefined ? (
        <VersionBody diff={diff} title={title} section={section} task={task} />
      ) : (
        // A version struck a picture as well as wrote one in, so both texts name the pictures it draws.
        <PlanPictures
          taskId={task.taskId}
          text={`${read.document.body}\n${read.previous?.body ?? ""}`}
        >
          <VersionBody diff={diff} title={title} section={section} task={task} />
        </PlanPictures>
      )}
    </>
  );
}

/**
 * The restore of the version chosen, asked in the window's dialog: held by
 * the history around the page rather than the page itself, so a version
 * row's menu can choose its version and ask in one press. `shown` is
 * whether the window shows the history, which the question stands on, and
 * `onRestored` what follows a restore that landed. Note that the answer
 * restores whichever version is chosen when it is given, which is the one
 * the question names, since choosing another takes focus off the dialog.
 */
export function useVersionRestore(
  history: PlanHistoryControl,
  shown: boolean,
  restorable: boolean,
  onRestored: () => void,
): DialogConfirm {
  // An archive landing while the question stands takes the question down with the button.
  return useConfirmDialog({ subject: restorable, surfaceOpen: shown }, async () => {
    const result = await history.onRestore();
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) onRestored();
    return result;
  });
}

/**
 * Says in the window's toast that a restore landed, with its Undo where the
 * history names the version that stood before it: a restore of that
 * version, itself a restore, which says so where it is refused.
 */
export function sayRestored(
  toast: (notice: ToastNotice) => void,
  undo: (() => Promise<boolean>) | undefined,
): void {
  if (undo === undefined) {
    toast({ words: VERSION_RESTORED_NOTE, tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
    return;
  }
  toast({
    words: VERSION_RESTORED_NOTE,
    tone: TOAST_TONE.DONE,
    action: {
      label: UNDO_LABEL,
      onPress: () => {
        undo().then((undone) => {
          if (undone) return;
          toast({
            words: RESTORE_UNDO_REFUSED_NOTE,
            tone: TOAST_TONE.FAILED,
            hold: TOAST_HOLD.FAILED,
          });
        });
      },
    },
  });
}

/**
 * The version chosen in the version history, the page beside its list: the
 * bar with when it was saved and its restore, over the version itself. An
 * archived plan's versions are read but not restored, so its bar offers no
 * restore.
 */
export function VersionView({
  viewing,
  restore,
  restorable = true,
  title,
  noun = "plan",
  section,
  task,
}: {
  viewing: ViewedVersion;
  /** The restore's question, held by the history around the page (`useVersionRestore`). */
  restore: DialogConfirm;
  /** Whether the version may be restored: not while the task is archived. */
  restorable?: boolean;
  /** The task's name, which every version is drawn under. */
  title?: string | undefined;
  /** What the versions are of, as the restore's question names it. */
  noun?: string;
  /** The one unit of the version to draw, alone and without the task's title, as a section opened from its revision's list; the whole version without one. */
  section?: number | undefined;
  /** The task the versions are of, which their mentions are read against; none for the account's template. */
  task?: MentionedTask | undefined;
}): React.JSX.Element {
  const { line } = viewing;
  return (
    <>
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">
            <Tooltip label={momentText(line.lastEdit.at)}>
              <time dateTime={new Date(line.lastEdit.at).toISOString()}>
                {dayAndTimeText(line.lastEdit.at)}
              </time>
            </Tooltip>
          </h1>
        </div>
        {restorable ? (
          <div className="desktop-toolbar-actions">
            <Tooltip label={viewing.current ? CURRENT_HINT : undefined}>
              <Button
                variant={BUTTON_VARIANT.PRIMARY}
                disabled={viewing.current}
                focusableWhenDisabled
                onClick={restore.ask}
              >
                Restore this version
              </Button>
            </Tooltip>
          </div>
        ) : null}
      </header>
      <div className="desktop-document">
        <DocumentScroll>
          <VersionContent viewing={viewing} title={title} section={section} task={task} />
        </DocumentScroll>
      </div>
      <ConfirmDialog confirm={restore} question={restoreQuestion(line.lastEdit.at, noun)} />
    </>
  );
}
