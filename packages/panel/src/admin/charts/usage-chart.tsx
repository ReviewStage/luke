import type { AdminDailyUsage, AdminTrend } from "@repo/features/admin-answer-wire";
import type { ChartConfig } from "@repo/ui/chart";
import { DailyBars } from "@repo/ui/daily-bars";
import { seriesHasNoData } from "@repo/ui/daily-series";
import { barTopRadius } from "./bar-radius.js";
import { ChartEmpty, ChartFrame, ChartFrameSkeleton, ChartTrend } from "./chart-frame.js";

export const USAGE_CHART = {
  calls: { label: "Hosted calls", color: "var(--ui-color-chart-1)" },
} satisfies ChartConfig;

const USAGE_PLOT_HEIGHT = "12rem";

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

export function UsageChartSkeleton({ label }: { label: string }): React.JSX.Element {
  return <ChartFrameSkeleton title={label} aside plot={USAGE_PLOT_HEIGHT} />;
}
