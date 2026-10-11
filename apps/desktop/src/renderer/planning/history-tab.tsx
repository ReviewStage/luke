import type { PlanRevisionLine } from "@sidecar/hosted/plan-wire";
import { useState } from "react";
import { revisionAuthor, revisionSummary } from "./plan-history-model";
import { momentText, sinceText, useMinute } from "./plan-time";
import { HISTORY_READ, type PlanHistoryControl } from "./use-plan-history";

/**
 * history-tab.tsx -- the History tab: every version of the open plan, newest first, each opening in the document area against the one before it.
 *
 * Each row is one revision as the history keeps it: who wrote it (Luke, You,
 * or a coding agent by its title), whether on a call, what it did, and how
 * long ago, in the sidebar's few letters with the moment itself on hover. The
 * newest is the plan as it stands, and says so. Choosing a row draws that
 * version in the document area, where it is compared and restored
 * (`version-view.tsx`); the row stays lit while it is drawn. Older versions
 * are read a page at a time from the foot of the list. Every row names what
 * the plan held, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 */

/** What the tab says above the rows. */
const HISTORY_HINT = "Choose a version to see what changed.";

/** What the tab says while the plan has no revision yet. */
const NO_HISTORY_LINE = "Versions appear here as the plan is written.";

/** One revision's row: who, whether on a call, what it did, and when; lit while its version is drawn. */
function RevisionRow({
  line,
  current,
  selected,
  now,
  onSelect,
}: {
  line: PlanRevisionLine;
  current: boolean;
  selected: boolean;
  now: number;
  onSelect: () => void;
}): React.JSX.Element {
  const { lastEdit } = line;
  return (
    <li>
      <button
        type="button"
        className="history-row"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <span className="history-row-head">
          <span className="history-row-author">{revisionAuthor(lastEdit)}</span>
          {lastEdit.duringCall ? <span className="history-row-tag">During a call</span> : null}
          {current ? <span className="history-row-tag">Current</span> : null}
          <time
            className="history-row-time"
            dateTime={new Date(lastEdit.at).toISOString()}
            title={momentText(lastEdit.at)}
          >
            {sinceText(lastEdit.at, now)}
          </time>
        </span>
        <span className="history-row-summary">{revisionSummary(line)}</span>
      </button>
    </li>
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
    <button type="button" className="history-earlier" disabled={reading} onClick={read}>
      {reading
        ? "Reading…"
        : failed
          ? "Could not read older versions. Try again"
          : "Show older versions"}
    </button>
  );
}

/** The History tab: the plan's versions as read, or the state standing in their place. */
export function HistoryTab({ history }: { history: PlanHistoryControl }): React.JSX.Element {
  const now = useMinute();
  const { list } = history;
  if (list.kind === HISTORY_READ.READING) {
    return <p className="side-panel-empty">Reading the history…</p>;
  }
  if (list.kind === HISTORY_READ.FAILED) {
    return (
      <div className="side-panel-empty" role="alert">
        <p>The history could not be read.</p>
        <button type="button" className="toolbar-button" onClick={history.onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (list.revisions.length === 0) return <p className="side-panel-empty">{NO_HISTORY_LINE}</p>;
  const newest = list.revisions[0]?.seq;
  return (
    <section className="history-tab ph-no-capture" aria-label="History">
      <p className="history-hint">{HISTORY_HINT}</p>
      <ol className="history-list">
        {list.revisions.map((line) => (
          <RevisionRow
            key={line.seq}
            line={line}
            current={line.seq === newest}
            selected={line.seq === history.selected}
            now={now}
            onSelect={() => history.onSelect(line.seq)}
          />
        ))}
      </ol>
      {list.earlier === undefined ? null : <EarlierRow onRead={history.onLoadEarlier} />}
    </section>
  );
}
