import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import type { Plan, PlanRevisionLine } from "@sidecar/hosted/plan-wire";
import { BackIcon, ChevronRightIcon, TerminalIcon, WingFace } from "@sidecar/panel";
import { HistoryIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import type { NavigationHistory } from "../navigation-history";
import { PersonAvatar } from "../person-avatar";
import { centreWithin } from "../planning/code-pane";
import {
  authorName,
  type ChangedSection,
  changedSections,
  type HistoryReader,
  opensSections,
  REVISION_AUTHOR,
  type RevisionAuthor,
  revisionAuthorOf,
  revisionSummary,
  sectionName,
  VERSION_CHANGE,
  versionDiff,
  versionMoment,
} from "../planning/plan-history-model";
import { momentText, sinceText, useMinute } from "../planning/plan-time";
import { documentTitleOf } from "../planning/plan-title";
import { DOCUMENT_REGION } from "../planning/planning-model";
import { HISTORY_READ, type ViewedVersion } from "../planning/use-plan-history";
import type { PlansControl } from "../planning/use-plans-tab";
import { VersionSkeleton, VersionView } from "../planning/version-view";
import { HarnessMark } from "../provider-marks";
import { RetryButton, RetryRowLabel } from "../retry-button";
import { Skeleton, SkeletonRegion } from "../skeleton";
import { BusyLabel } from "../spinner";
import { commandKeyshortcuts, ShortcutGlyphs, Tooltip } from "../tooltip";
import { HistoryButtons, SidebarResizeEdge, useSidebarEdge } from "./desktop-sidebar";
import type { SidebarCollapse } from "./sidebar-collapse";

/**
 * desktop-version-history.tsx -- a plan's version history, taking the whole window the way Settings does: every version listed where the sidebar stands, the one chosen beside them.
 *
 * The left column is as wide as the plans' sidebar and resizes it from its
 * own edge, never folding, as Settings' page list does. At its head stand
 * back and forward and the Back row, which Escape presses too, then the
 * plan's name under the view's own, then the versions, newest first: who
 * wrote each, drawn as the rest of the window draws them (Luke's face as
 * the Transcript wears it, the reader's account picture as You, a coding
 * agent's harness and title), what it did, and how long ago, in the
 * sidebar's few letters with the moment itself on hover. The newest is the plan as it stands and the one
 * drawn when the view opens, wearing no tag of its own: its Restore says it
 * is already current. Opened from a section's "Edited by", the view draws
 * the version that made the section's last change instead, its row brought
 * into the list's view. Choosing a row, or stepping with the up and down
 * arrows, draws that version beside the list (`version-view.tsx`), and older
 * versions are read a page at a time from the list's foot. A version of
 * several changes carries a chevron at its row's end, and it or the right
 * arrow slides the column one level over, as a nested page of System
 * Settings does: All versions at its head, who wrote the version and when on
 * one line, then a row for each section it changed, a section added or
 * removed saying so. The first is drawn alone beside them, the arrows step
 * through the rest, and the left arrow, Escape, or All versions slide back
 * with the version still chosen. A version keeps only the text its writer's
 * saves left, so a section is the finest step it is read in. While the
 * versions are read, the list and the page stand as quiet blocks in their
 * own shapes (`skeleton.tsx`).
 *
 * The view is one place in the window's history however many versions are
 * chosen in it, so Back returns to wherever it was opened from, the plan as
 * it was left, side panel and all; a restore that lands leaves for the plan
 * it restored, where the window's toast offers its Undo. Every row and the version beside them name what
 * the plan held, so both are left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 */

/** What the page says while the plan has no revision yet. */
const NO_HISTORY_LINE = "Versions appear here as the plan is written.";

/** What the chevron that opens a revision's sections says. */
const SECTIONS_HINT = "Show the sections it changed";

/** The word a changed section wears beside its name: none for an edit, which most are. */
const SECTION_CHANGE_WORDS = {
  [VERSION_CHANGE.ADDED]: "Added",
  [VERSION_CHANGE.REMOVED]: "Removed",
  [VERSION_CHANGE.CHANGED]: undefined,
} as const satisfies Record<ChangedSection["change"], string | undefined>;

/** The placeholder rows' shape while the versions are read: each row's author and summary as wide as their share of it. */
const LOG_SKELETON = [
  { author: "34%", summary: "78%" },
  { author: "48%", summary: "62%" },
  { author: "28%", summary: "84%" },
  { author: "40%", summary: "56%" },
] as const;

/** Who wrote a revision, as the rest of the window draws them: Luke's face as the Transcript draws it, a person's picture, an agent's harness, or the history glyph. */
function RevisionMark({ author }: { author: RevisionAuthor }): React.JSX.Element {
  switch (author.kind) {
    case REVISION_AUTHOR.LUKE:
      return (
        <span className="version-row-mark version-row-luke" aria-hidden="true">
          <WingFace />
        </span>
      );
    case REVISION_AUTHOR.PERSON:
      return (
        <span className="version-row-mark" aria-hidden="true">
          <PersonAvatar name={author.name ?? authorName(author)} pictureUrl={author.pictureUrl} />
        </span>
      );
    case REVISION_AUTHOR.AGENT:
      return (
        <span className="version-row-mark" aria-hidden="true">
          {author.provider === undefined ? (
            <TerminalIcon />
          ) : (
            <HarnessMark provider={author.provider} />
          )}
        </span>
      );
    case REVISION_AUTHOR.EARLIER:
      return (
        <span className="version-row-mark version-row-earlier" aria-hidden="true">
          <HistoryIcon />
        </span>
      );
  }
}

/**
 * One revision's row: who wrote it, what it did, and when; lit while its
 * version is drawn. A revision of several changes carries a chevron at its
 * end that opens the sections it changed, a button beside the row rather
 * than inside it, since a button holds no other.
 */
function RevisionRow({
  line,
  author,
  selected,
  now,
  rowRef,
  onSelect,
  onOpenSections,
}: {
  line: PlanRevisionLine;
  author: RevisionAuthor;
  selected: boolean;
  now: number;
  rowRef: (row: HTMLButtonElement | null) => void;
  onSelect: () => void;
  /** Opens the sections the revision changed; none for a revision that opens none. */
  onOpenSections: (() => void) | undefined;
}): React.JSX.Element {
  const { lastEdit } = line;
  return (
    <li className="version-item">
      <button
        ref={rowRef}
        type="button"
        className="version-row"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <RevisionMark author={author} />
        <span className="version-row-text">
          <span className="version-row-head">
            <span className="version-row-author" data-author={author.kind}>
              {authorName(author)}
            </span>
            <time
              className="version-row-time"
              dateTime={new Date(lastEdit.at).toISOString()}
              title={momentText(lastEdit.at)}
            >
              {sinceText(lastEdit.at, now)}
            </time>
          </span>
          <span className="version-row-summary">{revisionSummary(line)}</span>
        </span>
      </button>
      {onOpenSections === undefined ? null : (
        <Tooltip label={SECTIONS_HINT}>
          <button
            type="button"
            className="version-row-sections"
            aria-label={SECTIONS_HINT}
            tabIndex={-1}
            onClick={onOpenSections}
          >
            <ChevronRightIcon />
          </button>
        </Tooltip>
      )}
    </li>
  );
}

/** The head of a revision's sections: the way back to every version, and who wrote it and when, on one line. */
function SectionsHead({
  line,
  author,
  onBack,
}: {
  line: PlanRevisionLine;
  author: RevisionAuthor;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <>
      <button type="button" className="sidebar-item version-sections-back" onClick={onBack}>
        <BackIcon />
        All versions
      </button>
      <p className="version-sections-head">
        <RevisionMark author={author} />
        <span className="version-row-author" data-author={author.kind}>
          {authorName(author)}
        </span>
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(line.lastEdit.at).toISOString()}>
          {versionMoment(line.lastEdit.at)}
        </time>
      </p>
    </>
  );
}

/** One section a revision changed: its name, and a quiet word where it was added or removed rather than edited; lit while it is drawn. */
function SectionRow({
  section,
  selected,
  rowRef,
  onSelect,
}: {
  section: ChangedSection;
  selected: boolean;
  rowRef: (row: HTMLButtonElement | null) => void;
  onSelect: () => void;
}): React.JSX.Element {
  const word = SECTION_CHANGE_WORDS[section.change];
  return (
    <li>
      <button
        ref={rowRef}
        type="button"
        className="version-section-row"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <span className="version-section-name">{sectionName(section.heading)}</span>
        {word === undefined ? null : <span className="version-section-change">{word}</span>}
      </button>
    </li>
  );
}

/** The reader as their account names them, or nobody while no account is signed in. */
function readerOf(account: AccountSnapshot): HistoryReader {
  return account.status === ACCOUNT_STATUS.SIGNED_IN
    ? { name: account.name ?? account.email, pictureUrl: account.pictureUrl }
    : { name: undefined, pictureUrl: undefined };
}

/** The versions as quiet rows while they are read, in a row's own type. */
function LogSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading the versions…">
      {LOG_SKELETON.map((row) => (
        <div key={row.author} className="version-skeleton-row">
          <Skeleton width={row.author} className="version-skeleton-author" />
          <Skeleton width={row.summary} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** The foot of the list while an older page stands: read on its press, and offered again after a read that failed. */
function EarlierRow({ onRead }: { onRead: () => Promise<boolean> }): React.JSX.Element {
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const read = () => {
    setReading(true);
    onRead().then(
      (landed) => {
        setReading(false);
        setFailed(!landed);
      },
      () => {
        setReading(false);
        setFailed(true);
      },
    );
  };
  return (
    <button type="button" className="version-earlier" disabled={reading} onClick={read}>
      <BusyLabel busy={reading} label="Loading older versions">
        {failed ? (
          <RetryRowLabel failure="Could not read older versions." />
        ) : (
          "Show older versions"
        )}
      </BusyLabel>
    </button>
  );
}

/** Whether a key press belongs to something that takes keys of its own: a field, or a dialog over the window. */
function keysTaken(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, dialog") !== null;
}

/** What a list does with the arrow keys: up and down step through it, and right and left go into a row and back out, where the list offers them. */
interface ArrowKeys {
  /** Steps one row down or up; answers whether there was a row to step to. */
  readonly step: (by: 1 | -1) => boolean;
  /** Goes into the chosen row; answers whether it opens anything. */
  readonly open?: () => boolean;
  readonly back?: () => void;
}

/**
 * The arrows, anywhere in the view but a field or a dialog, as the list on
 * show takes them: the versions, or the sections of the one opened. Note
 * that the handler reads the keys through a ref, so a list re-rendered on
 * every step does not take the listener down and up again with it.
 */
function useArrowKeys(keys: ArrowKeys): void {
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || keysTaken(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const held = latest.current;
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : undefined;
      let handled = false;
      if (step !== undefined) handled = held.step(step);
      else if (event.key === "ArrowRight") handled = held.open?.() ?? false;
      else if (event.key === "ArrowLeft" && held.back !== undefined) {
        held.back();
        handled = true;
      }
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
}

/** The row `step` away from the one whose key is `at` among `keys`, chosen and focused, which brings it into its list's view; false where there is none. */
function stepThrough<K>(
  keys: readonly K[],
  at: K | undefined,
  step: 1 | -1,
  choose: (key: K) => void,
  rows: Map<K, HTMLButtonElement>,
): boolean {
  const index = at === undefined ? -1 : keys.indexOf(at);
  const next = keys[index + step];
  if (index === -1 || next === undefined) return false;
  choose(next);
  rows.get(next)?.focus();
  return true;
}

/**
 * The row of the version the view opened on, brought into the list's view
 * once it is chosen, so a version opened deep in the list is seen lit. Only
 * the list scrolls, since the window around it must not.
 */
function useOpenedRowShown(
  selected: number | undefined,
  rows: Map<number, HTMLButtonElement>,
  log: React.RefObject<HTMLDivElement | null>,
): void {
  const shown = useRef(false);
  useEffect(() => {
    const row = selected === undefined ? undefined : rows.get(selected);
    if (shown.current || row === undefined || log.current === null) return;
    shown.current = true;
    const box = log.current.getBoundingClientRect();
    const line = row.getBoundingClientRect();
    if (line.top < box.top || line.bottom > box.bottom) centreWithin(log.current, row);
  }, [selected, rows, log]);
}

/** The revision whose sections are open, and the one of them drawn, the first until another is chosen. */
interface OpenedSections {
  readonly seq: number;
  readonly unit: number | undefined;
}

/** The sections the open revision changed, once its version is read; nothing while it is read, or while no revision is open. */
function openedSections(
  viewing: ViewedVersion | undefined,
  opened: OpenedSections | undefined,
  plan: Plan | undefined,
): readonly ChangedSection[] | undefined {
  if (opened === undefined || viewing?.line.seq !== opened.seq) return undefined;
  const { read } = viewing;
  if (read.kind !== HISTORY_READ.READY) return undefined;
  const title = plan === undefined ? undefined : documentTitleOf(plan);
  return changedSections(versionDiff(read.previous, read.document, title), read.previous === null);
}

/**
 * The version history's page beside the list: the version chosen, or the
 * state standing in its place. A restore that lands leaves for the plan it
 * restored, which is not always the one Back returns to; an archived plan's
 * versions are read and not restored.
 */
function VersionPage({
  plans,
  section,
}: {
  plans: PlansControl;
  /** The one unit of the version drawn alone, while a section of its revision is open. */
  section: number | undefined;
}): React.JSX.Element {
  const { history, region } = plans;
  if (history.viewing !== undefined) {
    const plan = region.kind === DOCUMENT_REGION.READY ? region.plan : undefined;
    return (
      <VersionView
        history={history}
        viewing={history.viewing}
        shown={plans.shown}
        onRestored={history.onClose}
        restorable={plan?.archivedAt === undefined}
        title={plan === undefined ? undefined : documentTitleOf(plan)}
        section={section}
      />
    );
  }
  const { list } = history;
  // A list read that holds versions is still finding the one the view opened on.
  const finding = list.kind === HISTORY_READ.READY && list.revisions.length > 0;
  if (list.kind === HISTORY_READ.READING || finding) {
    return (
      <>
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading version-skeleton-title">
            <Skeleton width="160px" />
          </div>
        </header>
        <div className="desktop-document">
          <div className="plan-document-scroll">
            <VersionSkeleton />
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="desktop-drag-strip" />
      <div className="desktop-empty">
        {list.kind === HISTORY_READ.FAILED ? (
          <>
            <p role="alert">The history could not be read.</p>
            <RetryButton onRetry={history.onRetry} />
          </>
        ) : (
          <p>{NO_HISTORY_LINE}</p>
        )}
      </div>
    </>
  );
}

/**
 * The open plan's version history over the whole window: the versions where
 * the sidebar stands, with the way back at their head, and the version
 * chosen beside them. `onExit` leaves for wherever it was opened from.
 */
export function DesktopVersionHistory({
  sidebar,
  history,
  plans,
  account,
  onExit,
}: {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  plans: PlansControl;
  /** Who is reading, whose revisions are drawn as theirs. */
  account: AccountSnapshot;
  onExit: () => void;
}): React.JSX.Element {
  const now = useMinute();
  const versions = plans.history;
  const { list } = versions;
  const revisions = list.kind === HISTORY_READ.READY ? list.revisions : [];
  const rows = useRef(new Map<number, HTMLButtonElement>()).current;
  const sectionRows = useRef(new Map<number, HTMLButtonElement>()).current;
  const log = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<OpenedSections | undefined>(undefined);
  const edge = useSidebarEdge(sidebar);
  const reader = readerOf(account);
  const agents = plans.agents.agents ?? [];
  // The plan is named as its document is drawn, or as the list names it while its read is on its way.
  const { region } = plans;
  const plan = region.kind === DOCUMENT_REGION.READY ? region.plan : undefined;
  const name =
    plan?.name ??
    [...plans.plans, ...plans.archived].find((each) => each.id === plans.boundFor)?.name;
  const sections = openedSections(versions.viewing, opened, plan);
  const openedLine = revisions.find((line) => line.seq === opened?.seq);
  const unit = opened?.unit ?? sections?.[0]?.unit;
  const openSections = (seq: number) => {
    versions.onSelect(seq);
    setOpened({ seq, unit: undefined });
  };
  const closeSections = () => {
    if (opened === undefined) return;
    setOpened(undefined);
    rows.get(opened.seq)?.focus();
  };
  useAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY, opened === undefined ? onExit : closeSections);
  const chooseUnit = (at: number) => setOpened((held) => held && { ...held, unit: at });
  const units = sections?.map((section) => section.unit) ?? [];
  const seqs = revisions.map((line) => line.seq);
  useArrowKeys(
    opened === undefined
      ? {
          step: (by) => stepThrough(seqs, versions.selected, by, versions.onSelect, rows),
          open: () => {
            const line = revisions.find((each) => each.seq === versions.selected);
            if (line === undefined || !opensSections(line)) return false;
            openSections(line.seq);
            return true;
          },
        }
      : {
          step: (by) => stepThrough(units, unit, by, chooseUnit, sectionRows),
          back: closeSections,
        },
  );
  useOpenedRowShown(versions.selected, rows, log);

  return (
    <div className="desktop-version-history">
      <nav className="version-log ph-no-capture" aria-label="Versions">
        <div className="desktop-drag-strip" />
        <HistoryButtons history={history} />
        <button
          type="button"
          className="sidebar-item version-log-back"
          aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.EXIT_VERSION_HISTORY)}
          onClick={onExit}
        >
          <BackIcon />
          Back
          <ShortcutGlyphs command={APP_COMMAND.EXIT_VERSION_HISTORY} className="row-shortcut" />
        </button>
        <h1 className="version-log-title">Version history</h1>
        {name === undefined ? null : <p className="version-log-plan">{name}</p>}
        <div className="version-log-track" data-opened={String(opened !== undefined)}>
          <div ref={log} className="sidebar-section version-log-pane" inert={opened !== undefined}>
            {list.kind === HISTORY_READ.READING ? <LogSkeleton /> : null}
            <ol className="version-list">
              {revisions.map((line) => (
                <RevisionRow
                  key={line.seq}
                  line={line}
                  author={revisionAuthorOf(line, reader, agents)}
                  selected={line.seq === versions.selected}
                  now={now}
                  rowRef={(row) => {
                    if (row === null) rows.delete(line.seq);
                    else rows.set(line.seq, row);
                  }}
                  onSelect={() => versions.onSelect(line.seq)}
                  onOpenSections={opensSections(line) ? () => openSections(line.seq) : undefined}
                />
              ))}
            </ol>
            {list.kind === HISTORY_READ.READY && list.earlier !== undefined ? (
              <EarlierRow onRead={versions.onLoadEarlier} />
            ) : null}
          </div>
          <section
            className="sidebar-section version-log-pane"
            aria-label="Sections changed"
            inert={opened === undefined}
          >
            {openedLine === undefined ? null : (
              <>
                <SectionsHead
                  line={openedLine}
                  author={revisionAuthorOf(openedLine, reader, agents)}
                  onBack={closeSections}
                />
                {sections === undefined ? <LogSkeleton /> : null}
                <ol className="version-list">
                  {sections?.map((section) => (
                    <SectionRow
                      key={section.unit}
                      section={section}
                      selected={section.unit === unit}
                      rowRef={(row) => {
                        if (row === null) sectionRows.delete(section.unit);
                        else sectionRows.set(section.unit, row);
                      }}
                      onSelect={() => chooseUnit(section.unit)}
                    />
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
        {/* Last, so the drag strip above the way back does not take the edge's top from it. */}
        <SidebarResizeEdge edge={edge} />
      </nav>
      <section className="version-page ph-no-capture" aria-label="Version">
        <VersionPage plans={plans} section={opened === undefined ? undefined : unit} />
      </section>
    </div>
  );
}
