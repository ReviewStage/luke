import { formatDayTick } from "@repo/features/time-format";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { formatTooltipDay, PARTIAL_DAY_OPACITY } from "../admin-format.js";
import { partialDayKey } from "../daily-series.js";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "./chart.js";

export interface DailySeries {
  readonly key: string;
  readonly fill: string;
}

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
  data: readonly Day[];
  series: readonly DailySeries[];
  stack?: string | undefined;
  axis: DailyAxis;
  height: string;
  radius: [number, number, number, number];
  generatedAt: number;
  onOpenDay?: ((day: string) => void) | undefined;
}): React.JSX.Element {
  const partialDay = partialDayKey(data, generatedAt);
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
      className="ui-daily-bars"
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
