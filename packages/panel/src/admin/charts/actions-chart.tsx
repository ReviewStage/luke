/**
 * actions-chart.tsx -- one account's daily meaningful actions, stacked by kind.
 *
 * One bar a UTC day, each kind's count a segment of it from the base up in
 * the vocabulary's order, so the stack's height is the day's whole count and
 * each band one kind's share of it. A kind keeps the hue the Overview's
 * activity chart draws the same rows in, and the legend under the plot names
 * every band, since three series cannot be told apart by the heading alone.
 */

import type { AdminUserActions } from "@repo/features/admin-answer-wire";
import { MEANINGFUL_ACTION, type MeaningfulAction } from "@repo/features/admin-overview-vocabulary";
import type { ChartConfig } from "@repo/ui/chart";
import { DailyBars } from "@repo/ui/daily-bars";
import { seriesHasNoData } from "@repo/ui/daily-series";
import { barTopRadius } from "./bar-radius.js";
import {
  ChartEmpty,
  ChartFrame,
  ChartFrameSkeleton,
  ChartTrend,
  SeriesLegend,
} from "./chart-frame.js";

const ACTIONS_TITLE = "This account's actions per day";

/** The plot's height, which the chart and its skeleton both stand. */
const ACTIONS_PLOT_HEIGHT = "12rem";

/** Each kind's name and its slot's hue, keyed by the series it draws. */
const ACTIONS_CHART = {
  [MEANINGFUL_ACTION.TASKS_CREATED]: { label: "Tasks created", color: "var(--ui-color-chart-3)" },
  [MEANINGFUL_ACTION.DESCRIPTION_REVISIONS]: {
    label: "Description revisions",
    color: "var(--ui-color-chart-2)",
  },
  [MEANINGFUL_ACTION.AGENTS_STARTED]: {
    label: "Agents started",
    color: "var(--ui-color-chart-1)",
  },
} satisfies ChartConfig & Record<MeaningfulAction, { label: string; color: string }>;

const KINDS = Object.values(MEANINGFUL_ACTION);

const LEGEND_SERIES = KINDS.map((kind) => ({ key: kind, ...ACTIONS_CHART[kind] }));

/**
 * The stacked chart. A window with no action at all says so instead of
 * drawing the zero-fill as a flat measurement, and today's bar wears the
 * partial-day fade on every band. One account's day has no roster to open,
 * so no column opens anything.
 */
export function ActionsChart({
  actions,
  generatedAt,
}: {
  actions: AdminUserActions;
  generatedAt: number;
}): React.JSX.Element {
  const totals = actions.daily.map((point) =>
    KINDS.reduce((total, kind) => total + point[kind], 0),
  );
  if (seriesHasNoData(totals)) {
    return (
      <ChartFrame title={ACTIONS_TITLE} aside={<ChartTrend trend={actions.actionsTrend} />}>
        <ChartEmpty>No meaningful action in this window yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title={ACTIONS_TITLE}
      aside={<ChartTrend trend={actions.actionsTrend} />}
      legend={<SeriesLegend series={LEGEND_SERIES} />}
    >
      <DailyBars
        config={ACTIONS_CHART}
        data={actions.daily}
        series={KINDS.map((kind) => ({ key: kind, fill: ACTIONS_CHART[kind].color }))}
        stack="actions"
        axis={{ width: 36, allowDecimals: false }}
        height={ACTIONS_PLOT_HEIGHT}
        radius={barTopRadius()}
        generatedAt={generatedAt}
      />
    </ChartFrame>
  );
}

/** The chart while the account is read: its heading and legend, which it knows, over its plot's block, and a bone for the trend it reads. */
export function ActionsChartSkeleton(): React.JSX.Element {
  return (
    <ChartFrameSkeleton
      title={ACTIONS_TITLE}
      aside
      legend={<SeriesLegend series={LEGEND_SERIES} />}
      plot={ACTIONS_PLOT_HEIGHT}
    />
  );
}
