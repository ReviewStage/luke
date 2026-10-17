import type { AdminDailyUsage, AdminTrend } from "@luke/service/admin/admin-metrics";
import { formatDayTick, formatTooltipDay, PARTIAL_DAY_OPACITY } from "@luke/ui/admin-format";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@luke/ui/chart";
import { partialDayKey, seriesHasNoData } from "@luke/ui/daily-series";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ChartFrame, ChartTrend } from "./chart-frame";

export const USAGE_CHART = {
  calls: { label: "Hosted calls", color: "var(--chart-1)" },
} satisfies ChartConfig;

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
        <p className="m-0 py-6 text-center text-sm text-muted-foreground">
          No hosted-tier calls recorded in this window yet.
        </p>
      </ChartFrame>
    );
  }

  const partialDay = partialDayKey(daily, generatedAt);
  // The clicked label is resolved against the drawn series itself, so only a
  // day these bars actually state can open; an unset opener leaves recharts'
  // own `onClick` prop absent rather than assigned `undefined`.
  const barChartProps: Pick<React.ComponentProps<typeof BarChart>, "onClick"> = {};
  if (onOpenDay) {
    barChartProps.onClick = ({ activeLabel }) => {
      const clicked = daily.find((point) => point.day === activeLabel);
      if (clicked) onOpenDay(clicked.day);
    };
  }
  return (
    <ChartFrame title={label} aside={<ChartTrend trend={trend} />}>
      <ChartContainer
        config={USAGE_CHART}
        className={`aspect-auto h-48 w-full ${onOpenDay ? "cursor-pointer" : ""}`}
      >
        <BarChart data={[...daily]} {...barChartProps}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDayTick}
          />
          <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatTooltipDay(String(value), partialDay)}
              />
            }
          />
          <Bar dataKey="calls" fill="var(--color-calls)" radius={[4, 4, 0, 0]}>
            {daily.map((point) => (
              <Cell
                key={point.day}
                fillOpacity={point.day === partialDay ? PARTIAL_DAY_OPACITY : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
