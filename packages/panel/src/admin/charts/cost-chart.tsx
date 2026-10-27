/**
 * cost-chart.tsx -- the Cost screen's daily list-price equivalent, one bar a day stacked by source.
 */

import { type AdminCostDay, COST_SOURCE, type CostSource } from "@luke/features/admin-cost-wire";
import { formatCompact } from "@luke/features/number-format";
import type { ChartConfig } from "@luke/ui/chart";
import { DailyBars } from "@luke/ui/daily-bars";
import { seriesHasNoData } from "@luke/ui/daily-series";
import { barTopRadius } from "./bar-radius.js";
import { ChartEmpty, ChartFrame, ChartFrameSkeleton, LEGEND, LEGEND_ENTRY } from "./chart-frame.js";

/** Each source's name and its series colour, in the order the bars stack them from the axis up. */
const COST_CHART = {
  [COST_SOURCE.CODING_AGENTS]: { label: "Coding agents", color: "var(--luke-color-chart-1)" },
  [COST_SOURCE.LUKE]: { label: "Luke's own turns", color: "var(--luke-color-chart-2)" },
  [COST_SOURCE.VOICE]: { label: "Voice", color: "var(--luke-color-chart-3)" },
  [COST_SOURCE.DICTATION]: { label: "Dictation", color: "var(--luke-color-chart-4)" },
  [COST_SOURCE.AVATAR]: { label: "Video avatar", color: "var(--luke-color-chart-5)" },
} as const satisfies ChartConfig;

const SOURCES: readonly CostSource[] = Object.values(COST_SOURCE);

const COST_TITLE = "Daily list-price equivalent by source, USD";

/** The plot's height, which the chart and its skeleton both stand. */
const COST_PLOT_HEIGHT = "12rem";

/** The swatch beside a legend's name, in the series' own colour. */
const SWATCH = {
  [COST_SOURCE.CODING_AGENTS]: "bg-(--luke-color-chart-1)",
  [COST_SOURCE.LUKE]: "bg-(--luke-color-chart-2)",
  [COST_SOURCE.VOICE]: "bg-(--luke-color-chart-3)",
  [COST_SOURCE.DICTATION]: "bg-(--luke-color-chart-4)",
  [COST_SOURCE.AVATAR]: "bg-(--luke-color-chart-5)",
} as const;

function CostLegend(): React.JSX.Element {
  return (
    <span className={LEGEND}>
      {SOURCES.map((source) => (
        <span key={source} className={LEGEND_ENTRY}>
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
 * day's height is its whole list-price equivalent and its bands say where it
 * came from.
 * Unpriced tokens are in no band, which the screen says beside the totals.
 * Today's bar wears the partial-day fade, and a window with nothing priced says
 * so rather than drawing the zero-fill as a flat measurement.
 */
export function CostChart({
  daily,
  generatedAt,
}: {
  daily: readonly AdminCostDay[];
  generatedAt: number;
}): React.JSX.Element {
  const totals = daily.map((day) => SOURCES.reduce((total, source) => total + day[source], 0));
  if (seriesHasNoData(totals)) {
    return (
      <ChartFrame title={COST_TITLE}>
        <ChartEmpty>No priced usage recorded in this window yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  const data = daily.map((day) => ({
    day: day.day,
    ...Object.fromEntries(SOURCES.map((source) => [source, day[source]])),
  }));
  return (
    <ChartFrame title={COST_TITLE} legend={<CostLegend />}>
      <DailyBars
        config={COST_CHART}
        data={data}
        series={SOURCES.map((source) => ({ key: source, fill: COST_CHART[source].color }))}
        stack="spend"
        axis={{ width: 56, tickFormatter: (value: number) => `$${formatCompact(value)}` }}
        height={COST_PLOT_HEIGHT}
        radius={barTopRadius()}
        generatedAt={generatedAt}
      />
    </ChartFrame>
  );
}

/** The chart while the window is read: its heading and legend, which it knows, over its plot's block. */
export function CostChartSkeleton(): React.JSX.Element {
  return <ChartFrameSkeleton title={COST_TITLE} legend={<CostLegend />} plot={COST_PLOT_HEIGHT} />;
}
