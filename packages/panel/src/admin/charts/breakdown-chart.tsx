import { formatCount } from "@repo/features/number-format";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/ui/chart";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartFrame, ChartFrameSkeleton, SeriesLegend } from "./chart-frame.js";

const BREAKDOWN_ROW_HEIGHT = 36;

const BREAKDOWN_SKELETON_ROWS = 4;

function breakdownLegend(parts: readonly BreakdownSeries[]): React.ReactNode {
  return parts.length > 1 ? <SeriesLegend series={parts} /> : undefined;
}

export interface BreakdownSeries {
  key: string;
  label: string;
  color: string;
}

export interface BreakdownRow {
  label: string;
  counts: Readonly<Record<string, number>>;
}

export function BreakdownChart({
  title,
  series: parts,
  rows,
  empty,
}: {
  title: string;
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
    total: formatCount(series.reduce((total, key) => total + (row.counts[key] ?? 0), 0)),
    labelAt: series.findLast((key) => (row.counts[key] ?? 0) > 0),
  }));
  return (
    <ChartFrame title={title} legend={breakdownLegend(parts)}>
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
                className="fill-(--ui-color-text-muted)"
              />
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}

export function BreakdownChartSkeleton({
  title,
  series,
}: {
  title: string;
  series: readonly BreakdownSeries[];
}): React.JSX.Element {
  return (
    <ChartFrameSkeleton
      title={title}
      legend={breakdownLegend(series)}
      plot={`${BREAKDOWN_SKELETON_ROWS * BREAKDOWN_ROW_HEIGHT}px`}
    />
  );
}
