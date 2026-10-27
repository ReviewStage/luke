import type { AdminMetrics, AdminRetentionCell } from "@luke/features/admin-answer-wire";
import { formatCount, formatPercent } from "@luke/features/number-format";
import { formatDayTick } from "@luke/features/time-format";
import {
  SCROLL_AXIS,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
  ScrollArea,
  SKELETON_SHAPE,
  Skeleton,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { Fragment } from "react";
import { ChartEmpty, ChartFrame, PlotBox } from "./chart-frame.js";

/**
 * The floor under a cell's fill, so a small nonzero share still reads as a
 * mark against the card instead of vanishing into it.
 */
const RETENTION_FILL_FLOOR_PERCENT = 8;

/**
 * The ceiling over a cell's fill. Note that a full share stops here rather
 * than at the series' own ink, because the page's text must read at AA on
 * every cell in both themes (`admin-retention-grid.test.ts`), and no single
 * ink, dark or white, clears the chart blue across the whole ramp.
 */
const RETENTION_FILL_CEILING_PERCENT = 60;

/** A cohort row's height at least, every cell's, which the grid's skeleton stands too. */
const RETENTION_ROW_HEIGHT = "2.25rem";

/** The room between the grid's rows and columns. */
const RETENTION_GAP = "var(--luke-space-4)";

/**
 * How many weekly cohorts the grid stands, the service's
 * `ADMIN_RETENTION_WEEKS`, not imported because the module exporting it
 * carries query code the client bundle must not.
 */
const RETENTION_SKELETON_WEEKS = 8;

/** Every cell's box: at least a row tall, so an empty cell holds its row as a filled one does. */
const RETENTION_CELL_BOX: React.CSSProperties = { minHeight: RETENTION_ROW_HEIGHT };

function retentionCellStyle(share: number): React.CSSProperties {
  const fill = Math.max(
    RETENTION_FILL_FLOOR_PERCENT,
    Math.round(share * RETENTION_FILL_CEILING_PERCENT),
  );
  return {
    ...RETENTION_CELL_BOX,
    backgroundColor: `color-mix(in oklab, var(--luke-color-chart-1) ${fill}%, transparent)`,
    color: "var(--luke-color-text)",
  };
}

function RetentionCell({ cell }: { cell: AdminRetentionCell }): React.JSX.Element {
  const provisional = cell.inProgress
    ? "border border-dashed border-(--luke-color-text-muted)/60"
    : "";
  if (cell.share === null) {
    return (
      <div
        className={`flex items-center justify-center rounded-sm text-(--luke-color-text-muted) ${provisional}`}
        style={RETENTION_CELL_BOX}
        title="No accounts in this cohort"
      >
        —
      </div>
    );
  }
  const percent = formatPercent(cell.share);
  const title = `${formatCount(cell.activeAccounts)} ${
    cell.activeAccounts === 1 ? "account" : "accounts"
  } active${cell.inProgress ? " so far this week" : ""}`;
  if (cell.share === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-sm text-(--luke-color-text-muted) ${provisional}`}
        style={RETENTION_CELL_BOX}
        title={title}
      >
        {percent}
      </div>
    );
  }
  return (
    <div
      className={`flex items-center justify-center rounded-sm ${provisional}`}
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
      <div className="-mx-(--luke-card-inset)">
        <ScrollArea
          axis={SCROLL_AXIS.HORIZONTAL}
          size={SCROLL_SIZE.CONTENT}
          overscroll={SCROLL_OVERSCROLL.CHAIN}
        >
          <div className="w-fit min-w-full px-(--luke-card-inset)">
            <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
              <div
                className="grid min-w-160 tabular-nums"
                style={{
                  gap: RETENTION_GAP,
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
                    <div className="flex items-center justify-end pr-(--luke-space-4) text-(--luke-color-text-muted)">
                      {formatCount(cohort.size)}
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

/**
 * The grid while its cohorts are read: its card over a block as tall as the
 * grid it stands for, its header row in the caption's line and a row a
 * cohort, each the cells' own height and the grid's gap apart.
 */
export function RetentionGridSkeleton(): React.JSX.Element {
  return (
    <ChartFrame>
      <PlotBox
        height={`calc(var(--luke-type-caption-leading) + ${RETENTION_SKELETON_WEEKS} * (${RETENTION_ROW_HEIGHT} + ${RETENTION_GAP}))`}
      >
        <Skeleton shape={SKELETON_SHAPE.BLOCK} />
      </PlotBox>
    </ChartFrame>
  );
}
