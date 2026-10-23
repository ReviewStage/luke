/**
 * activity-chart.tsx -- the Overview's daily activity, stacked by feature.
 *
 * One bar a UTC day, each feature's count a segment of it from the base up in
 * the vocabulary's order, so the stack's height is the day's whole activity
 * and each band's thickness one feature's share of it. The legend under the
 * plot names every band in its slot's hue, since five series cannot be told
 * apart by the heading alone, and the tooltip carries each day's exact counts.
 */

import type { AdminOverview } from "@luke/features/admin-answer-wire";
import { ACTIVITY_FEATURE, type ActivityFeature } from "@luke/features/admin-overview-vocabulary";
import type { ChartConfig } from "@luke/ui/chart";
import { DailyBars } from "@luke/ui/daily-bars";
import { seriesHasNoData } from "@luke/ui/daily-series";
import { barTopRadius } from "./bar-radius.js";
import {
  ChartEmpty,
  ChartFrame,
  ChartFrameSkeleton,
  ChartTrend,
  LEGEND,
  LEGEND_ENTRY,
} from "./chart-frame.js";

const ACTIVITY_TITLE = "Activity by feature per day";

/** The plot's height, which the chart and its skeleton both stand. */
const ACTIVITY_PLOT_HEIGHT = "15rem";

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

/** One band's swatch and name, in the legend under the plot. */
function LegendEntry({ feature }: { feature: ActivityFeature }): React.JSX.Element {
  return (
    <span className={LEGEND_ENTRY}>
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
    <span className={LEGEND}>
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

  return (
    <ChartFrame
      title={ACTIVITY_TITLE}
      aside={<ChartTrend trend={trend} />}
      legend={<ActivityLegend />}
    >
      <DailyBars
        config={ACTIVITY_CHART}
        data={daily}
        series={FEATURES.map((feature) => ({ key: feature, fill: ACTIVITY_CHART[feature].color }))}
        stack="activity"
        axis={{ width: 36, allowDecimals: false }}
        height={ACTIVITY_PLOT_HEIGHT}
        radius={barTopRadius()}
        generatedAt={generatedAt}
        onOpenDay={onOpenDay}
      />
    </ChartFrame>
  );
}

/** The chart while the window is read: its heading and legend, which it knows, over its plot's block, and a bone for the trend it reads. */
export function ActivityChartSkeleton(): React.JSX.Element {
  return (
    <ChartFrameSkeleton
      title={ACTIVITY_TITLE}
      aside
      legend={<ActivityLegend />}
      plot={ACTIVITY_PLOT_HEIGHT}
    />
  );
}
