import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import type { AdminDailyUsage, AdminTrend } from "../../../server/admin/admin-metrics";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "../../components/ui/chart";
import { partialDayKey, seriesHasNoData } from "../../daily-series";
import { formatDayTick, formatTooltipDay, PARTIAL_DAY_OPACITY } from "../format";
import { ChartHeading } from "./chart-heading";

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
      <div className="rounded-lg border border-border bg-card p-5">
        <ChartHeading label={label} trend={trend} />
        <p className="m-0 py-6 text-center text-sm text-muted-foreground">
          No hosted-tier calls recorded in this window yet.
        </p>
      </div>
    );
  }

  const partialDay = partialDayKey(daily, generatedAt);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <ChartHeading label={label} trend={trend} />
      <ChartContainer
        config={USAGE_CHART}
        className={`aspect-auto h-48 w-full ${onOpenDay ? "cursor-pointer" : ""}`}
      >
        <BarChart
          data={[...daily]}
          // The clicked label is resolved against the drawn series itself, so
          // only a day these bars actually state can open.
          onClick={
            onOpenDay
              ? ({ activeLabel }) => {
                  const clicked = daily.find((point) => point.day === activeLabel);
                  if (clicked) onOpenDay(clicked.day);
                }
              : undefined
          }
        >
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
    </div>
  );
}
