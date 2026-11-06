import type { AdminTrend } from "@repo/features/admin-answer-wire";
import { formatCount } from "@repo/features/number-format";
import {
  ALIGN,
  Card,
  GAP,
  Inline,
  JUSTIFY,
  SKELETON_SHAPE,
  Skeleton,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { formatTrendMove, TREND_DIRECTION, trendDirection } from "@repo/ui/admin-format";
import { CARD_GAP } from "./stat-card.js";

const TREND_TONE = {
  [TREND_DIRECTION.UP]: "text-complete",
  [TREND_DIRECTION.DOWN]: "text-attention",
  [TREND_DIRECTION.FLAT]: "text-muted-foreground",
} as const;

const CHART_EMPTY = "py-(--ui-space-24) text-center";

export const LEGEND = "flex flex-wrap gap-x-(--ui-field-gap) gap-y-(--ui-space-4)";

export const LEGEND_ENTRY = "inline-flex items-center gap-(--ui-space-6)";

const SKELETON_TITLE_WIDTH = "144px";

const SKELETON_ASIDE_WIDTH = "224px";

export const CHART_PAIR_EVEN = `grid ${CARD_GAP} @min-[720px]/admin-section:grid-cols-2`;

export const CHART_PAIR_WIDE = `grid ${CARD_GAP} @min-[720px]/admin-section:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]`;

export function TrendMove({ trend }: { trend: AdminTrend }): React.JSX.Element {
  return (
    <span className={`font-medium tabular-nums ${TREND_TONE[trendDirection(trend)]}`}>
      {formatTrendMove(trend)}
    </span>
  );
}

export function ChartTrend({ trend }: { trend: AdminTrend }): React.JSX.Element {
  return (
    <>
      <TrendMove trend={trend} /> {formatCount(trend.recent)} in the last {trend.days} days, against{" "}
      {formatCount(trend.prior)} before
    </>
  );
}

export function SeriesLegend({
  series,
}: {
  series: readonly { key: string; label: string; color: string }[];
}): React.JSX.Element {
  return (
    <span className={LEGEND}>
      {series.map((entry) => (
        <span key={entry.key} className={LEGEND_ENTRY}>
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          {entry.label}
        </span>
      ))}
    </span>
  );
}

export function ChartEmpty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={CHART_EMPTY}>
      <Text tone={TEXT_TONE.MUTED}>{children}</Text>
    </div>
  );
}

export function ChartFrame({
  title,
  aside,
  legend,
  overlay,
  ref,
  children,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  legend?: React.ReactNode;
  overlay?: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card ref={ref}>
      <Stack gap={GAP.FIELD}>
        {title === undefined ? null : (
          <Inline justify={JUSTIFY.BETWEEN} align={ALIGN.BASELINE}>
            <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
              {title}
            </Text>
            {aside === undefined ? null : (
              <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {aside}
              </Text>
            )}
          </Inline>
        )}
        {children}
        {legend === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {legend}
          </Text>
        )}
      </Stack>
      {overlay}
    </Card>
  );
}

export function PlotBox({
  height,
  children,
}: {
  height: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return <div style={{ height }}>{children}</div>;
}

export function AsideSkeleton(): React.JSX.Element {
  return (
    <Inline>
      <Skeleton width={SKELETON_ASIDE_WIDTH} />
    </Inline>
  );
}

export function ChartFrameSkeleton({
  title,
  untitled = false,
  aside = false,
  legend,
  plot,
}: {
  title?: string | undefined;
  untitled?: boolean;
  aside?: boolean;
  legend?: React.ReactNode;
  plot: string;
}): React.JSX.Element {
  return (
    <ChartFrame
      title={untitled ? undefined : (title ?? <Skeleton width={SKELETON_TITLE_WIDTH} />)}
      aside={aside ? <AsideSkeleton /> : undefined}
      legend={legend}
    >
      <PlotBox height={plot}>
        <Skeleton shape={SKELETON_SHAPE.BLOCK} />
      </PlotBox>
    </ChartFrame>
  );
}
