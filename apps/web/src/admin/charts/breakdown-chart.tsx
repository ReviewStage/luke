/**
 * breakdown-chart.tsx -- counts of failures by their fixed class, as
 * horizontal bars, one stacked part per series where a class counts more
 * than one way.
 */

import { formatNumber } from "@luke/ui/admin-format";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@luke/ui/chart";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartFrame, SeriesLegend } from "./chart-frame";

/** The room each class's bar takes, the sign-in methods chart's own. */
const BREAKDOWN_ROW_HEIGHT = 36;

/** One series of the breakdown: its key in each row's counts, its name, and its ink. */
export interface BreakdownSeries {
  key: string;
  label: string;
  color: string;
}

/** One class: its label, and its count under each series key. */
export interface BreakdownRow {
  label: string;
  counts: Readonly<Record<string, number>>;
}

/**
 * The classes as bars, most first as the service orders them, with each
 * row's total at its end. A breakdown with nothing to count says so.
 */
export function BreakdownChart({
  title,
  series: parts,
  rows,
  empty,
}: {
  title: string;
  /** One entry per series, stacked in its order; more than one wears a legend. */
  series: readonly BreakdownSeries[];
  rows: readonly BreakdownRow[];
  empty: string;
}): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <ChartFrame title={title}>
        <ChartEmpty>{empty}</ChartEmpty>
      </ChartFrame>
    );
  }

  const series = parts.map((part) => part.key);
  const config: ChartConfig = Object.fromEntries(
    parts.map((part) => [part.key, { label: part.label, color: part.color }]),
  );
  const data = rows.map((row) => ({
    label: row.label,
    ...row.counts,
    total: formatNumber(series.reduce((total, key) => total + (row.counts[key] ?? 0), 0)),
    // Note that the total rides the row's last part with a count, since a
    // part of nothing draws no bar for a label to stand beside.
    labelAt: series.findLast((key) => (row.counts[key] ?? 0) > 0),
  }));
  return (
    <ChartFrame
      title={title}
      legend={parts.length > 1 ? <SeriesLegend series={parts} /> : undefined}
    >
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: rows.length * BREAKDOWN_ROW_HEIGHT }}
      >
        <BarChart data={data} layout="vertical" margin={{ right: 48 }}>
          <XAxis type="number" hide />
          <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={168} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.map((key) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="classes"
              fill={`var(--color-${key})`}
              barSize={16}
            >
              <LabelList
                dataKey={(row: (typeof data)[number]) => (row.labelAt === key ? row.total : "")}
                position="right"
                offset={8}
                className="fill-(--luke-color-text-muted)"
              />
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
