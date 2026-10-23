import type { AdminDailyUsage, AdminTrend } from "@luke/features/admin-answer-wire";
import { type ChartConfig } from "@luke/ui/chart";
import { DailyBars } from "@luke/ui/daily-bars";
import { seriesHasNoData } from "@luke/ui/daily-series";
import { barTopRadius } from "./bar-radius.js";
import { ChartEmpty, ChartFrame, ChartFrameSkeleton, ChartTrend } from "./chart-frame.js";

export const USAGE_CHART = {
  calls: { label: "Hosted calls", color: "var(--luke-color-chart-1)" },
} satisfies ChartConfig;

/** The plot's height, which the chart and its skeleton both stand. */
const USAGE_PLOT_HEIGHT = "12rem";

/**
 * A trailing-window bar chart on shadcn/ui's chart primitives. One series, so
 * the heading names it and no legend box restates the heading; the tooltip
 * carries each day's exact count. A window with no calls at all says so
 * instead of drawing the server's zero-fill as a flat measurement, and
 * today's bar wears the partial-day fade. Where a day has a roster to open, a
 * click anywhere in a day's column opens it — read from the chart's own axis
 * datum, so the bar and the hover band around it land on the same day — and
 * the pointer says so; one account's chart passes no opener, because its day
 * needs no roster.
 */
export function UsageChart({
  daily,
  trend,
  label,
  generatedAt,
  onOpenDay,
}: {
  daily: readonly AdminDailyUsage[];
  trend: AdminTrend;
  label: string;
  generatedAt: number;
  onOpenDay?: (day: string) => void;
}): React.JSX.Element {
  if (seriesHasNoData(daily.map((point) => point.calls))) {
    return (
      <ChartFrame title={label} aside={<ChartTrend trend={trend} />}>
        <ChartEmpty>No hosted-tier calls recorded in this window yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame title={label} aside={<ChartTrend trend={trend} />}>
      <DailyBars
        config={USAGE_CHART}
        data={daily}
        series={[{ key: "calls", fill: "var(--color-calls)" }]}
        axis={{ width: 36, allowDecimals: false }}
        height={USAGE_PLOT_HEIGHT}
        radius={barTopRadius()}
        generatedAt={generatedAt}
        onOpenDay={onOpenDay}
      />
    </ChartFrame>
  );
}

/** The chart while its days are read: `label`, its heading, over its plot's block, and a bone for the trend it reads. */
export function UsageChartSkeleton({ label }: { label: string }): React.JSX.Element {
  return <ChartFrameSkeleton title={label} aside plot={USAGE_PLOT_HEIGHT} />;
}
