/**
 * failure-rates-chart.tsx -- the Reliability screen's daily failure rates,
 * one line per kind of work, each the share of that day's ended work that
 * failed.
 */

import type { AdminReliabilityDay } from "@luke/service/admin/admin-reliability";
import { formatDayTick, formatShare, formatTooltipDay } from "@luke/ui/admin-format";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@luke/ui/chart";
import { partialDayKey } from "@luke/ui/daily-series";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartFrame, SeriesLegend } from "./chart-frame";

/** The four rates, in the order the legend names them. */
const FAILURE_RATES_CHART = {
  lukeTurns: { label: "Luke turns", color: "var(--luke-color-chart-1)" },
  agentRuns: { label: "Coding-agent runs", color: "var(--luke-color-chart-2)" },
  calls: { label: "Calls dropped", color: "var(--luke-color-chart-3)" },
  automationRuns: { label: "Automation runs", color: "var(--luke-color-chart-4)" },
} satisfies ChartConfig;

type FailureSeries = keyof typeof FAILURE_RATES_CHART;

// SAFETY: `Object.keys` widens the config's own keys to string.
const SERIES = Object.keys(FAILURE_RATES_CHART) as FailureSeries[];

/**
 * The window's daily failure rates. A day nothing of a kind ended on is a
 * gap in that kind's line rather than a zero, and a window where nothing
 * ended at all says so instead of drawing four empty lines.
 */
export function FailureRatesChart({
  daily,
  generatedAt,
}: {
  daily: readonly AdminReliabilityDay[];
  generatedAt: number;
}): React.JSX.Element {
  const title = "Failure rate per day";
  const anything = daily.some((day) => SERIES.some((series) => day[series] !== null));
  if (!anything) {
    return (
      <ChartFrame title={title}>
        <ChartEmpty>Nothing ended in this window yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  const partialDay = partialDayKey(daily, generatedAt);
  return (
    <ChartFrame
      title={title}
      legend={
        <SeriesLegend
          series={SERIES.map((series) => ({
            key: series,
            label: FAILURE_RATES_CHART[series].label,
            color: FAILURE_RATES_CHART[series].color,
          }))}
        />
      }
    >
      <ChartContainer config={FAILURE_RATES_CHART} className="aspect-auto h-56 w-full">
        <LineChart data={[...daily]}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDayTick}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatShare(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatTooltipDay(String(value), partialDay)}
                valueFormatter={formatShare}
              />
            }
          />
          {SERIES.map((series) => (
            <Line
              key={series}
              dataKey={series}
              type="monotone"
              stroke={`var(--color-${series})`}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </ChartFrame>
  );
}
