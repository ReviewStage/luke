import type { AdminReliabilityDay } from "@repo/features/admin-answer-wire";
import { formatPercent } from "@repo/features/number-format";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { formatDayTick } from "@repo/features/time-format";
import { formatTooltipDay, RATE_PLACES } from "@repo/ui/admin-format";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/ui/chart";
import { partialDayKey } from "@repo/ui/daily-series";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { retiredTitle } from "../chrome/notes.js";
import { ChartEmpty, ChartFrame, ChartFrameSkeleton, SeriesLegend } from "./chart-frame.js";

const FAILURE_RATES_CHART = {
  agentRuns: { label: "Agent runs", color: "var(--ui-color-chart-2)" },
  automationRuns: { label: "Automation runs", color: "var(--ui-color-chart-3)" },
  appTurns: { label: retiredTitle(`${PRODUCT_NAME} turns`), color: "var(--ui-color-chart-1)" },
} satisfies ChartConfig;

type FailureSeries = keyof typeof FAILURE_RATES_CHART;

const SERIES = Object.keys(FAILURE_RATES_CHART) as FailureSeries[];

const FAILURE_RATES_TITLE = "Failure rate per day";

const FAILURE_RATES_PLOT_HEIGHT = "14rem";

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

export function FailureRatesChartSkeleton(): React.JSX.Element {
  return (
    <ChartFrameSkeleton
      title={FAILURE_RATES_TITLE}
      legend={<FailureRatesLegend />}
      plot={FAILURE_RATES_PLOT_HEIGHT}
    />
  );
}
