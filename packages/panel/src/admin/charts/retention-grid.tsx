import type { AdminMetrics, AdminRetentionCell } from "@repo/features/admin-answer-wire";
import { formatCount, formatPercent } from "@repo/features/number-format";
import { formatDayTick } from "@repo/features/time-format";
import {
  SCROLL_AXIS,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
  ScrollArea,
  SKELETON_SHAPE,
  Skeleton,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { Fragment } from "react";
import { ChartEmpty, ChartFrame, PlotBox } from "./chart-frame.js";

const RETENTION_FILL_FLOOR_PERCENT = 8;

const RETENTION_FILL_CEILING_PERCENT = 60;

const RETENTION_ROW_HEIGHT = "2.25rem";

const RETENTION_GAP = "var(--ui-space-4)";

const RETENTION_SKELETON_WEEKS = 8;

const RETENTION_CELL_BOX: React.CSSProperties = { minHeight: RETENTION_ROW_HEIGHT };

function retentionCellStyle(share: number): React.CSSProperties {
  const fill = Math.max(
    RETENTION_FILL_FLOOR_PERCENT,
    Math.round(share * RETENTION_FILL_CEILING_PERCENT),
  );
  return {
    ...RETENTION_CELL_BOX,
    backgroundColor: `color-mix(in oklab, var(--ui-color-chart-1) ${fill}%, transparent)`,
    color: "var(--ui-color-text)",
  };
}

function RetentionCell({ cell }: { cell: AdminRetentionCell }): React.JSX.Element {
  const provisional = cell.inProgress
    ? "border border-dashed border-(--ui-color-text-muted)/60"
    : "";
  if (cell.share === null) {
    return (
      <div
        className={`flex items-center justify-center rounded-sm text-(--ui-color-text-muted) ${provisional}`}
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
        className={`flex items-center justify-center rounded-sm text-(--ui-color-text-muted) ${provisional}`}
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

function HeaderWords({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP}>
      {children}
    </Text>
  );
}

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
      <div className="-mx-(--ui-card-inset)">
        <ScrollArea
          axis={SCROLL_AXIS.HORIZONTAL}
          size={SCROLL_SIZE.CONTENT}
          overscroll={SCROLL_OVERSCROLL.CHAIN}
        >
          <div className="w-fit min-w-full px-(--ui-card-inset)">
            <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
              <div
                className="grid min-w-160 tabular-nums"
                style={{
                  gap: RETENTION_GAP,
                  gridTemplateColumns: `minmax(84px, auto) minmax(72px, auto) repeat(${retention.weeks}, minmax(52px, 1fr))`,
                }}
              >
                <div className="flex items-center">
                  <HeaderWords>Cohort</HeaderWords>
                </div>
                <div className="flex items-center justify-end">
                  <HeaderWords>Accounts</HeaderWords>
                </div>
                {offsets.map((offset) => (
                  <div key={offset} className="flex items-center justify-center">
                    <HeaderWords>Wk {offset}</HeaderWords>
                  </div>
                ))}
                {retention.cohorts.map((cohort) => (
                  <Fragment key={cohort.weekStart}>
                    <div className="flex items-center">{formatDayTick(cohort.weekStart)}</div>
                    <div className="flex items-center justify-end pr-(--ui-space-4) text-(--ui-color-text-muted)">
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

export function RetentionGridSkeleton(): React.JSX.Element {
  return (
    <ChartFrame>
      <PlotBox
        height={`calc(var(--ui-type-caption-leading) + ${RETENTION_SKELETON_WEEKS} * (${RETENTION_ROW_HEIGHT} + ${RETENTION_GAP}))`}
      >
        <Skeleton shape={SKELETON_SHAPE.BLOCK} />
      </PlotBox>
    </ChartFrame>
  );
}
