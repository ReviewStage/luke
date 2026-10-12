import type { PlanRevisionLine } from "@sidecar/hosted/plan-wire";
import { BackIcon } from "@sidecar/panel";
import { useEffect, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import type { NavigationHistory } from "../navigation-history";
import { revisionAuthor, revisionSummary } from "../planning/plan-history-model";
import { momentText, sinceText, useMinute } from "../planning/plan-time";
import { DOCUMENT_REGION } from "../planning/planning-model";
import { HISTORY_READ } from "../planning/use-plan-history";
import type { PlansControl } from "../planning/use-plans-tab";
import { VersionSkeleton, VersionView } from "../planning/version-view";
import { Skeleton, SkeletonRegion } from "../skeleton";
import { BusyLabel } from "../spinner";
import { commandKeyshortcuts, ShortcutGlyphs } from "../tooltip";
import { HistoryButtons, SidebarResizeEdge, useSidebarEdge } from "./desktop-sidebar";
import type { SidebarCollapse } from "./sidebar-collapse";

/**
 * desktop-version-history.tsx -- a plan's version history, taking the whole window the way Settings does: every version listed where the sidebar stands, the one chosen beside them.
 *
 * The left column is as wide as the plans' sidebar and resizes it from its
 * own edge, never folding, as Settings' page list does. At its head stand
 * back and forward and the Back row, which Escape presses too, then the
 * plan's name under the view's own, then the versions, newest first: who
 * wrote each (Luke, You, or a coding agent by its title), whether on a call,
 * what it did, and how long ago, in the sidebar's few letters with the
 * moment itself on hover. The newest is the plan as it stands and the one
 * drawn when the view opens, wearing no tag of its own: its Restore says it
 * is already current. Choosing a row, or stepping with the up and down
 * arrows, draws that version beside the list (`version-view.tsx`), and older
 * versions are read a page at a time from the list's foot. While the
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

/** The placeholder rows' shape while the versions are read: each row's author and summary as wide as their share of it. */
const LOG_SKELETON = [
  { author: "34%", summary: "78%" },
  { author: "48%", summary: "62%" },
  { author: "28%", summary: "84%" },
  { author: "40%", summary: "56%" },
] as const;

/** One revision's row: who, whether on a call, what it did, and when; lit while its version is drawn. */
function RevisionRow({
  line,
  selected,
  now,
  rowRef,
  onSelect,
}: {
  line: PlanRevisionLine;
  selected: boolean;
  now: number;
  rowRef: (row: HTMLButtonElement | null) => void;
  onSelect: () => void;
}): React.JSX.Element {
  const { lastEdit } = line;
  return (
    <li>
      <button
        ref={rowRef}
        type="button"
        className="version-row"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <span className="version-row-head">
          <span className="version-row-author">{revisionAuthor(lastEdit)}</span>
          {lastEdit.duringCall ? <span className="version-tag">During a call</span> : null}
          <time
            className="version-row-time"
            dateTime={new Date(lastEdit.at).toISOString()}
            title={momentText(lastEdit.at)}
          >
            {sinceText(lastEdit.at, now)}
          </time>
        </span>
        <span className="version-row-summary">{revisionSummary(line)}</span>
      </button>
    </li>
  );
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
        {failed ? "Could not read older versions. Try again" : "Show older versions"}
      </BusyLabel>
    </button>
  );
}

/** Whether a key press belongs to something that takes keys of its own: a field, or a dialog over the window. */
function keysTaken(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, dialog") !== null;
}

/**
 * The up and down arrows, anywhere in the view but a field or a dialog,
 * choose the version above or below the one drawn, and focus its row, which
 * brings it into the list's view.
 */
function useVersionKeys(
  revisions: readonly PlanRevisionLine[],
  selected: number | undefined,
  onSelect: (seq: number) => void,
  rows: Map<number, HTMLButtonElement>,
): void {
  const latest = useRef({ revisions, selected, onSelect });
  latest.current = { revisions, selected, onSelect };
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step === 0 || event.defaultPrevented || keysTaken(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const held = latest.current;
      const at = held.revisions.findIndex((line) => line.seq === held.selected);
      const next = held.revisions[at + step];
      if (at === -1 || next === undefined) return;
      event.preventDefault();
      held.onSelect(next.seq);
      rows.get(next.seq)?.focus();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [rows]);
}

/**
 * The version history's page beside the list: the version chosen, or the
 * state standing in its place. A restore that lands leaves for the plan it
 * restored, which is not always the one Back returns to; an archived plan's
 * versions are read and not restored.
 */
function VersionPage({ plans }: { plans: PlansControl }): React.JSX.Element {
  const { history, region } = plans;
  if (history.viewing !== undefined) {
    const archived = region.kind === DOCUMENT_REGION.READY && region.plan.archivedAt !== undefined;
    return (
      <VersionView
        history={history}
        viewing={history.viewing}
        shown={plans.shown}
        onRestored={history.onClose}
        restorable={!archived}
      />
    );
  }
  const { list } = history;
  if (list.kind === HISTORY_READ.READING) {
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
            <button type="button" className="primary-button" onClick={history.onRetry}>
              Try again
            </button>
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
  onExit,
}: {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  plans: PlansControl;
  onExit: () => void;
}): React.JSX.Element {
  const now = useMinute();
  const versions = plans.history;
  const { list } = versions;
  const revisions = list.kind === HISTORY_READ.READY ? list.revisions : [];
  const rows = useRef(new Map<number, HTMLButtonElement>()).current;
  useAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY, onExit);
  useVersionKeys(revisions, versions.selected, versions.onSelect, rows);
  const edge = useSidebarEdge(sidebar);
  // The plan is named as its document is drawn, or as the list names it while its read is on its way.
  const { region } = plans;
  const name =
    region.kind === DOCUMENT_REGION.READY
      ? region.plan.name
      : [...plans.plans, ...plans.archived].find((plan) => plan.id === plans.boundFor)?.name;

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
        <div className="sidebar-section">
          {list.kind === HISTORY_READ.READING ? <LogSkeleton /> : null}
          <ol className="version-list">
            {revisions.map((line) => (
              <RevisionRow
                key={line.seq}
                line={line}
                selected={line.seq === versions.selected}
                now={now}
                rowRef={(row) => {
                  if (row === null) rows.delete(line.seq);
                  else rows.set(line.seq, row);
                }}
                onSelect={() => versions.onSelect(line.seq)}
              />
            ))}
          </ol>
          {list.kind === HISTORY_READ.READY && list.earlier !== undefined ? (
            <EarlierRow onRead={versions.onLoadEarlier} />
          ) : null}
        </div>
        {/* Last, so the drag strip above the way back does not take the edge's top from it. */}
        <SidebarResizeEdge edge={edge} />
      </nav>
      <section className="version-page ph-no-capture" aria-label="Version">
        <VersionPage plans={plans} />
      </section>
    </div>
  );
}
