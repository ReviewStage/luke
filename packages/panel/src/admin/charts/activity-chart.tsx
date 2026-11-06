import type { AdminOverview } from "@repo/features/admin-answer-wire";
import { ACTIVITY_FEATURE, type ActivityFeature } from "@repo/features/admin-overview-vocabulary";
import type { ChartConfig } from "@repo/ui/chart";
import { DailyBars } from "@repo/ui/daily-bars";
import { seriesHasNoData } from "@repo/ui/daily-series";
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

const ACTIVITY_PLOT_HEIGHT = "15rem";

const ACTIVITY_CHART = {
  [ACTIVITY_FEATURE.AGENTS_STARTED]: {
    label: "Agents started",
    color: "var(--ui-color-chart-1)",
  },
  [ACTIVITY_FEATURE.DESCRIPTION_REVISIONS]: {
    label: "Description revisions",
    color: "var(--ui-color-chart-2)",
  },
  [ACTIVITY_FEATURE.INBOX_ANSWERED]: {
    label: "Inbox items answered",
    color: "var(--ui-color-chart-3)",
  },
  [ACTIVITY_FEATURE.AUTOMATION_RUNS]: {
    label: "Automation runs",
    color: "var(--ui-color-chart-4)",
  },
} satisfies ChartConfig & Record<ActivityFeature, { label: string; color: string }>;

const FEATURES = Object.values(ACTIVITY_FEATURE);

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

export function activityFeatureLabel(feature: ActivityFeature): string {
  return ACTIVITY_CHART[feature].label;
}

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
