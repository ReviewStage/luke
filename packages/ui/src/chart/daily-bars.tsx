import { formatDayTick } from "@luke/features/time-format";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { formatTooltipDay, PARTIAL_DAY_OPACITY } from "../admin-format.js";
import { partialDayKey } from "../daily-series.js";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "./chart.js";

/**
 * daily-bars.tsx -- a window's days as columns of bars, one series or a stack of several, today's faded as a day still counting.
 *
 * The plot owns its axes (each day's tick along the bottom, the measure up
 * the side), the grid under it, a tooltip naming the day, and today's fade;
 * a series is a key of each day's row and the colour it is drawn in, the
 * last stacked one rounded at its top by `radius`. A day with a page of its
 * own opens it on a click anywhere in its column, read from the chart's own
 * axis datum, so the bar and the hover band around it land on the same day.
 * The frame around the plot (its heading, its trend, its legend, and what
 * stands in for a window with nothing in it) is the caller's.
 */

/** One series: the key each day's row holds it under, and the colour its bars are drawn in. */
export interface DailySeries {
  readonly key: string;
  readonly fill: string;
}

/** How the measure's axis is drawn: its room, whether it ticks between whole numbers, and its words. */
export interface DailyAxis {
  readonly width: number;
  readonly allowDecimals?: boolean;
  readonly tickFormatter?: (value: number) => string;
}

export function DailyBars<Day extends { readonly day: string }>({
  config,
  data,
  series,
  stack,
  axis,
  height,
  radius,
  generatedAt,
  onOpenDay,
}: {
  config: ChartConfig;
  /** The window's days, oldest first, each holding every series' value under its key. */
  data: readonly Day[];
  series: readonly DailySeries[];
  /** The stack several series stand in, one column a day; none for a lone series. */
  stack?: string | undefined;
  axis: DailyAxis;
  /** The plot's height, as a CSS length, which the chart's skeleton stands too. */
  height: string;
  /** The corners the top bar of each column is rounded at, in pixels. */
  radius: [number, number, number, number];
  /** When the answer was read, which names the day still counting. */
  generatedAt: number;
  onOpenDay?: ((day: string) => void) | undefined;
}): React.JSX.Element {
  const partialDay = partialDayKey(data, generatedAt);
  // The clicked label is resolved against the drawn series itself, so only a
  // day these bars actually state can open; an unset opener leaves recharts'
  // own `onClick` prop absent rather than assigned `undefined`.
  const barChartProps: Pick<React.ComponentProps<typeof BarChart>, "onClick"> = {};
  if (onOpenDay) {
    barChartProps.onClick = ({ activeLabel }) => {
      const clicked = data.find((point) => point.day === activeLabel);
      if (clicked) onOpenDay(clicked.day);
    };
  }
  return (
    <ChartContainer
      config={config}
      className="luke-daily-bars"
      data-opens={onOpenDay === undefined ? undefined : ""}
      style={{ height }}
    >
      <BarChart data={[...data]} {...barChartProps}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatDayTick}
        />
        <YAxis tickLine={false} axisLine={false} {...axis} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatTooltipDay(String(value), partialDay)}
            />
          }
        />
        {series.map((each, index) => (
          <Bar
            key={each.key}
            dataKey={each.key}
            {...(stack === undefined ? {} : { stackId: stack })}
            fill={each.fill}
            radius={index === series.length - 1 ? radius : 0}
          >
            {data.map((point) => (
              <Cell
                key={point.day}
                fillOpacity={point.day === partialDay ? PARTIAL_DAY_OPACITY : 1}
              />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
}
