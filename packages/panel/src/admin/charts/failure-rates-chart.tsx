/**
 * failure-rates-chart.tsx -- the Reliability screen's daily failure rates,
 * one line per kind of work, each the share of that day's ended work that
 * failed.
 */

import type { AdminReliabilityDay } from "@luke/features/admin-answer-wire";
import { formatPercent } from "@luke/features/number-format";
import { formatDayTick } from "@luke/features/time-format";
import { formatTooltipDay, RATE_PLACES } from "@luke/ui/admin-format";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@luke/ui/chart";
import { partialDayKey } from "@luke/ui/daily-series";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartFrame, ChartFrameSkeleton, SeriesLegend } from "./chart-frame.js";

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

const FAILURE_RATES_TITLE = "Failure rate per day";

/** The plot's height, which the chart and its skeleton both stand. */
const FAILURE_RATES_PLOT_HEIGHT = "14rem";

/** The four kinds of work by their line's ink, in the config's order. */
function FailureRatesLegend(): React.JSX.Element {
  return (
    <SeriesLegend
      series={SERIES.map((series) => ({
        key: series,
        label: FAILURE_RATES_CHART[series].label,
        color: FAILURE_RATES_CHART[series].color,
      }))}
    />
  );
}

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
  const title = FAILURE_RATES_TITLE;
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
    <ChartFrame title={title} legend={<FailureRatesLegend />}>
      <ChartContainer
        config={FAILURE_RATES_CHART}
        className="aspect-auto w-full"
        style={{ height: FAILURE_RATES_PLOT_HEIGHT }}
      >
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
            tickFormatter={(value: number) => formatPercent(value, RATE_PLACES)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatTooltipDay(String(value), partialDay)}
                valueFormatter={(value: number) => formatPercent(value, RATE_PLACES)}
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

/** The chart while the window is read: its heading and legend, which it knows, over its plot's block. */
export function FailureRatesChartSkeleton(): React.JSX.Element {
  return (
    <ChartFrameSkeleton
      title={FAILURE_RATES_TITLE}
      legend={<FailureRatesLegend />}
      plot={FAILURE_RATES_PLOT_HEIGHT}
    />
  );
}
