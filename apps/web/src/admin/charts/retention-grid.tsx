import type { AdminMetrics, AdminRetentionCell } from "@luke/service/admin/admin-metrics";
import {
  SCROLL_AXIS,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
  ScrollArea,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { formatDayTick, formatNumber } from "@luke/ui/admin-format";
import { Fragment } from "react";
import { ChartEmpty, ChartFrame } from "./chart-frame";

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
    backgroundColor: `color-mix(in oklab, var(--luke-color-chart-1) ${fill}%, transparent)`,
    color:
      share >= RETENTION_TEXT_FLIP_SHARE ? "var(--luke-color-ground)" : "var(--luke-color-text)",
  };
}

function RetentionCell({ cell }: { cell: AdminRetentionCell }): React.JSX.Element {
  const provisional = cell.inProgress
    ? "border border-dashed border-(--luke-color-text-muted)/60"
    : "";
  if (cell.share === null) {
    return (
      <div
        className={`flex min-h-9 items-center justify-center rounded-sm text-(--luke-color-text-muted) ${provisional}`}
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
        className={`flex min-h-9 items-center justify-center rounded-sm text-(--luke-color-text-muted) ${provisional}`}
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

/** A column's heading in the mono face the grid keeps for its labels. */
function HeaderWords({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.CAPTION}
      tone={TEXT_TONE.MUTED}
      font={TEXT_FONT.MONO}
    >
      {children}
    </Text>
  );
}

/**
 * Weekly signup cohorts against the weeks after them, as a plain CSS grid
 * rather than a chart: each row is the accounts created in one UTC week, each
 * cell the share of them that used the hosted tier that many weeks after
 * signing up. The grid is triangular because the builder emits no cell for a
 * week the calendar has not reached, and the current week's cells wear a
 * dashed border because their week is still accruing. The page's section
 * heading names it, so its card carries no title, and the grid scrolls inside
 * the card rather than squeezing its cells in a narrow column.
 */
export function RetentionGrid({
  retention,
}: {
  retention: AdminMetrics["retention"];
}): React.JSX.Element {
  const totalAccounts = retention.cohorts.reduce((total, cohort) => total + cohort.size, 0);
  if (totalAccounts === 0) {
    return (
      <ChartFrame>
        <ChartEmpty>No accounts created in the last {retention.weeks} weeks yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  const offsets = Array.from({ length: retention.weeks }, (_, offset) => offset);
  return (
    <ChartFrame>
      {/* Note that the scroller bleeds across the card's inset, because cells
      scrolled out of a narrow card should pass under its edge, not stop short of it.
      The inset comes back on the grid's own box, which stands as wide as the grid,
      so it pads both ends of the scroll; a swipe up or down over it moves the page. */}
      <div className="-mx-5">
        <ScrollArea
          axis={SCROLL_AXIS.HORIZONTAL}
          size={SCROLL_SIZE.CONTENT}
          overscroll={SCROLL_OVERSCROLL.CHAIN}
        >
          <div className="w-fit min-w-full px-5">
            <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
              <div
                className="grid min-w-160 gap-1 tabular-nums"
                style={{
                  gridTemplateColumns: `minmax(84px, auto) minmax(72px, auto) repeat(${retention.weeks}, minmax(52px, 1fr))`,
                }}
              >
                <div className="flex items-center uppercase">
                  <HeaderWords>Cohort</HeaderWords>
                </div>
                <div className="flex items-center justify-end uppercase">
                  <HeaderWords>Accounts</HeaderWords>
                </div>
                {offsets.map((offset) => (
                  <div key={offset} className="flex items-center justify-center uppercase">
                    <HeaderWords>Wk {offset}</HeaderWords>
                  </div>
                ))}
                {retention.cohorts.map((cohort) => (
                  <Fragment key={cohort.weekStart}>
                    <div className="flex items-center">{formatDayTick(cohort.weekStart)}</div>
                    <div className="flex items-center justify-end pr-1 text-(--luke-color-text-muted)">
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
            </Text>
          </div>
        </ScrollArea>
      </div>
    </ChartFrame>
  );
}
