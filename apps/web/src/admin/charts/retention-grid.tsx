import { Fragment } from "react";
import type { AdminMetrics, AdminRetentionCell } from "../../../server/admin/admin-metrics";
import { formatDayTick, formatNumber } from "../format";

/**
 * The floor under a cell's fill, so a small nonzero share still reads as a
 * mark against the card instead of vanishing into it.
 */
const RETENTION_FILL_FLOOR_PERCENT = 8;

/**
 * The share past which a cell's fill is strong enough that the page's light
 * foreground stops clearing it, so the text flips to the dark background tone.
 */
const RETENTION_TEXT_FLIP_SHARE = 0.75;

function retentionCellStyle(share: number): React.CSSProperties {
  const fill = Math.max(RETENTION_FILL_FLOOR_PERCENT, Math.round(share * 100));
  return {
    backgroundColor: `color-mix(in oklab, var(--chart-1) ${fill}%, transparent)`,
    color: share >= RETENTION_TEXT_FLIP_SHARE ? "var(--background)" : "var(--foreground)",
  };
}

function RetentionCell({ cell }: { cell: AdminRetentionCell }): React.JSX.Element {
  const provisional = cell.inProgress ? "border border-dashed border-muted-foreground/60" : "";
  if (cell.share === null) {
    return (
      <div
        className={`flex min-h-9 items-center justify-center rounded-sm text-muted-foreground ${provisional}`}
        title="No accounts in this cohort"
      >
        —
      </div>
    );
  }
  const percent = `${Math.round(cell.share * 100)}%`;
  const title = `${formatNumber(cell.activeAccounts)} ${
    cell.activeAccounts === 1 ? "account" : "accounts"
  } active${cell.inProgress ? " so far this week" : ""}`;
  if (cell.share === 0) {
    return (
      <div
        className={`flex min-h-9 items-center justify-center rounded-sm text-muted-foreground ${provisional}`}
        title={title}
      >
        {percent}
      </div>
    );
  }
  return (
    <div
      className={`flex min-h-9 items-center justify-center rounded-sm ${provisional}`}
      style={retentionCellStyle(cell.share)}
      title={title}
    >
      {percent}
    </div>
  );
}

/**
 * Weekly signup cohorts against the weeks after them, as a plain CSS grid
 * rather than a chart: each row is the accounts created in one UTC week, each
 * cell the share of them that used the hosted tier that many weeks after
 * signing up. The grid is triangular because the builder emits no cell for a
 * week the calendar has not reached, and the current week's cells wear a
 * dashed border because their week is still accruing.
 */
export function RetentionGrid({
  retention,
}: {
  retention: AdminMetrics["retention"];
}): React.JSX.Element {
  const totalAccounts = retention.cohorts.reduce((total, cohort) => total + cohort.size, 0);
  if (totalAccounts === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No accounts created in the last {retention.weeks} weeks yet.
      </div>
    );
  }

  const offsets = Array.from({ length: retention.weeks }, (_, offset) => offset);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[640px] gap-1 p-5 text-xs tabular-nums"
          style={{
            gridTemplateColumns: `minmax(84px, auto) minmax(72px, auto) repeat(${retention.weeks}, minmax(52px, 1fr))`,
          }}
        >
          <div className="flex items-center font-mono text-muted-foreground uppercase">Cohort</div>
          <div className="flex items-center justify-end font-mono text-muted-foreground uppercase">
            Accounts
          </div>
          {offsets.map((offset) => (
            <div
              key={offset}
              className="flex items-center justify-center font-mono text-muted-foreground uppercase"
            >
              Wk {offset}
            </div>
          ))}
          {retention.cohorts.map((cohort) => (
            <Fragment key={cohort.weekStart}>
              <div className="flex items-center">{formatDayTick(cohort.weekStart)}</div>
              <div className="flex items-center justify-end pr-1 text-muted-foreground">
                {formatNumber(cohort.size)}
              </div>
              {offsets.map((offset) => {
                const cell = cohort.cells[offset];
                return cell ? (
                  <RetentionCell key={offset} cell={cell} />
                ) : (
                  <div key={offset} aria-hidden="true" />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
