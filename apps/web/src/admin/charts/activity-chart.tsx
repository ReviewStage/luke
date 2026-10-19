/**
 * activity-chart.tsx -- the Overview's daily activity, stacked by feature.
 *
 * One bar a UTC day, each feature's count a segment of it from the base up in
 * the vocabulary's order, so the stack's height is the day's whole activity
 * and each band's thickness one feature's share of it. The legend under the
 * plot names every band in its slot's hue, since five series cannot be told
 * apart by the heading alone, and the tooltip carries each day's exact counts.
 */

import type { AdminOverview } from "@luke/service/admin/admin-overview";
import {
  ACTIVITY_FEATURE,
  type ActivityFeature,
} from "@luke/service/admin/admin-overview-vocabulary";
import { formatDayTick, formatTooltipDay, PARTIAL_DAY_OPACITY } from "@luke/ui/admin-format";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@luke/ui/chart";
import { partialDayKey, seriesHasNoData } from "@luke/ui/daily-series";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartFrame, ChartTrend } from "./chart-frame";

const ACTIVITY_TITLE = "Activity by feature per day";

/** Each feature's name and its slot's hue, keyed by the series it draws. */
const ACTIVITY_CHART = {
  [ACTIVITY_FEATURE.AGENTS_STARTED]: {
    label: "Agents started",
    color: "var(--luke-color-chart-1)",
  },
  [ACTIVITY_FEATURE.PLAN_REVISIONS]: {
    label: "Plan revisions",
    color: "var(--luke-color-chart-2)",
  },
  [ACTIVITY_FEATURE.CALLS_HELD]: { label: "Calls held", color: "var(--luke-color-chart-3)" },
  [ACTIVITY_FEATURE.INBOX_ANSWERED]: {
    label: "Inbox items answered",
    color: "var(--luke-color-chart-4)",
  },
  [ACTIVITY_FEATURE.AUTOMATION_RUNS]: {
    label: "Automation runs",
    color: "var(--luke-color-chart-5)",
  },
} satisfies ChartConfig & Record<ActivityFeature, { label: string; color: string }>;

const FEATURES = Object.values(ACTIVITY_FEATURE);

/** The top band rounds its corners, as a single series' bar does; the rest stand square. */
const TOP_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/** One band's swatch and name, in the legend under the plot. */
function LegendEntry({ feature }: { feature: ActivityFeature }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block size-2.5 rounded-sm"
        style={{ backgroundColor: ACTIVITY_CHART[feature].color }}
      />
      {ACTIVITY_CHART[feature].label}
    </span>
  );
}

function ActivityLegend(): React.JSX.Element {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {FEATURES.map((feature) => (
        <LegendEntry key={feature} feature={feature} />
      ))}
    </span>
  );
}

/**
 * The stacked chart. A window with no activity at all says so instead of
 * drawing the zero-fill as a flat measurement, and today's bar wears the
 * partial-day fade on every band. Where a day has a roster to open, a click
 * anywhere in its column opens it, read from the chart's own axis datum.
 */
export function ActivityChart({
  activity,
  generatedAt,
  onOpenDay,
}: {
  activity: AdminOverview["activity"];
  generatedAt: number;
  onOpenDay?: (day: string) => void;
}): React.JSX.Element {
  const { daily, trend } = activity;
  const totals = daily.map((point) => FEATURES.reduce((total, key) => total + point[key], 0));
  if (seriesHasNoData(totals)) {
    return (
      <ChartFrame title={ACTIVITY_TITLE} aside={<ChartTrend trend={trend} />}>
        <ChartEmpty>No activity recorded in this window yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  const partialDay = partialDayKey(daily, generatedAt);
  const barChartProps: Pick<React.ComponentProps<typeof BarChart>, "onClick"> = {};
  if (onOpenDay) {
    barChartProps.onClick = ({ activeLabel }) => {
      const clicked = daily.find((point) => point.day === activeLabel);
      if (clicked) onOpenDay(clicked.day);
    };
  }
  return (
    <ChartFrame
      title={ACTIVITY_TITLE}
      aside={<ChartTrend trend={trend} />}
      legend={<ActivityLegend />}
    >
      <ChartContainer
        config={ACTIVITY_CHART}
        className={`aspect-auto h-60 w-full ${onOpenDay ? "cursor-pointer" : ""}`}
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
          {FEATURES.map((feature, index) => (
            <Bar
              key={feature}
              dataKey={feature}
              stackId="activity"
              fill={ACTIVITY_CHART[feature].color}
              radius={index === FEATURES.length - 1 ? TOP_RADIUS : 0}
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
