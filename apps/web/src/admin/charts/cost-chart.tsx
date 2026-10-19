/**
 * cost-chart.tsx -- the Cost screen's daily spend, one bar a day stacked by where the dollars went.
 */

import {
  type AdminCostDay,
  COST_SOURCE,
  type CostSource,
} from "@luke/service/admin/admin-cost-wire";
import {
  formatCompact,
  formatDayTick,
  formatTooltipDay,
  PARTIAL_DAY_OPACITY,
} from "@luke/ui/admin-format";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@luke/ui/chart";
import { partialDayKey, seriesHasNoData } from "@luke/ui/daily-series";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartFrame } from "./chart-frame";

/** Each source's name and its series colour, in the order the bars stack them from the axis up. */
const COST_CHART = {
  [COST_SOURCE.CODING_AGENTS]: { label: "Coding agents", color: "var(--luke-color-chart-1)" },
  [COST_SOURCE.LUKE]: { label: "Luke's own turns", color: "var(--luke-color-chart-2)" },
  [COST_SOURCE.VOICE]: { label: "Voice", color: "var(--luke-color-chart-3)" },
  [COST_SOURCE.DICTATION]: { label: "Dictation", color: "var(--luke-color-chart-4)" },
  [COST_SOURCE.AVATAR]: { label: "Video avatar", color: "var(--luke-color-chart-5)" },
} as const satisfies ChartConfig;

const SOURCES: readonly CostSource[] = Object.values(COST_SOURCE);

/** The swatch beside a legend's name, in the series' own colour. */
const SWATCH = {
  [COST_SOURCE.CODING_AGENTS]: "bg-(--luke-color-chart-1)",
  [COST_SOURCE.LUKE]: "bg-(--luke-color-chart-2)",
  [COST_SOURCE.VOICE]: "bg-(--luke-color-chart-3)",
  [COST_SOURCE.DICTATION]: "bg-(--luke-color-chart-4)",
  [COST_SOURCE.AVATAR]: "bg-(--luke-color-chart-5)",
} as const;

const CENTS = 100;

/** The tooltip reads a bar's own value, so a day's dollars ride rounded to the cent. */
function toCents(value: number): number {
  return Math.round(value * CENTS) / CENTS;
}

function CostLegend(): React.JSX.Element {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {SOURCES.map((source) => (
        <span key={source} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block size-2.5 rounded-sm ${SWATCH[source]}`}
            aria-hidden="true"
          />
          {COST_CHART[source].label}
        </span>
      ))}
    </span>
  );
}

/**
 * The window's days as stacked bars, each source a series of its own, so a
 * day's height is its whole priced spend and its bands say where it went.
 * Unpriced tokens are in no band, which the screen says beside the totals.
 * Today's bar wears the partial-day fade, and a window with no spend says
 * so rather than drawing the zero-fill as a flat measurement.
 */
export function CostChart({
  daily,
  generatedAt,
}: {
  daily: readonly AdminCostDay[];
  generatedAt: number;
}): React.JSX.Element {
  const title = "Daily spend by source, USD";
  const totals = daily.map((day) => SOURCES.reduce((total, source) => total + day[source], 0));
  if (seriesHasNoData(totals)) {
    return (
      <ChartFrame title={title}>
        <ChartEmpty>No priced spend recorded in this window yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  const partialDay = partialDayKey(daily, generatedAt);
  const data = daily.map((day) => ({
    day: day.day,
    ...Object.fromEntries(SOURCES.map((source) => [source, toCents(day[source])])),
  }));
  return (
    <ChartFrame title={title} legend={<CostLegend />}>
      <ChartContainer config={COST_CHART} className="aspect-auto h-48 w-full">
        <BarChart data={data}>
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
            width={56}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => `$${formatCompact(value)}`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatTooltipDay(String(value), partialDay)}
              />
            }
          />
          {SOURCES.map((source, index) => (
            <Bar
              key={source}
              dataKey={source}
              stackId="spend"
              fill={COST_CHART[source].color}
              radius={index === SOURCES.length - 1 ? [4, 4, 0, 0] : 0}
            >
              {daily.map((point) => (
                <Cell
                  key={point.day}
                  fillOpacity={point.day === partialDay ? PARTIAL_DAY_OPACITY : 1}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
