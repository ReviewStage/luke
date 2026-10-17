import type {
  AdminDailySignups,
  AdminMetrics,
  AdminTrend,
} from "@luke/service/admin/admin-metrics";
import {
  formatDayTick,
  formatNumber,
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
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartFrame, ChartTrend } from "./chart-frame";

const SIGNUPS_CHART = {
  count: { label: "New accounts", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * One series, so the heading names it and no legend box restates the heading.
 * A window with no signups says so instead of drawing the server's zero-fill
 * as a flat measurement, and today's bar wears the partial-day fade.
 */
export function SignupsChart({
  daily,
  trend,
  generatedAt,
}: {
  daily: readonly AdminDailySignups[];
  trend: AdminTrend;
  generatedAt: number;
}): React.JSX.Element {
  if (seriesHasNoData(daily.map((point) => point.count))) {
    return (
      <ChartFrame title="New accounts per day" aside={<ChartTrend trend={trend} />}>
        <ChartEmpty>No accounts created in this window yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  const partialDay = partialDayKey(daily, generatedAt);
  return (
    <ChartFrame title="New accounts per day" aside={<ChartTrend trend={trend} />}>
      <ChartContainer config={SIGNUPS_CHART} className="aspect-auto h-40 w-full">
        <BarChart data={[...daily]}>
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
          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]}>
            {daily.map((point) => (
              <Cell
                key={point.day}
                fillOpacity={point.day === partialDay ? PARTIAL_DAY_OPACITY : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}

const SIGN_IN_METHODS_CHART = {
  accounts: { label: "Accounts", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * How the accounts sign in, as horizontal bars. One measure across nominal
 * categories, so every bar wears the first slot's hue and the end labels
 * carry the exact count and its share of all accounts — shares that can sum
 * past 100%, since an account may link more than one method, which is why
 * each label says "of accounts" instead of posing as a slice of the bars. A
 * method nobody has linked draws no bar at all: a zero-length bar parks its
 * end label at the plot origin, where two empty methods would stack their
 * labels over the category axis.
 */
export function SignInMethodsChart({
  methods,
  totalAccounts,
}: {
  methods: AdminMetrics["users"]["signInMethods"];
  totalAccounts: number;
}): React.JSX.Element {
  const rows = [
    { method: "GitHub", accounts: methods.github },
    { method: "Google", accounts: methods.google },
    { method: "Other", accounts: methods.other },
  ]
    .filter((row) => row.accounts > 0)
    .map((row) => ({
      ...row,
      label: `${formatNumber(row.accounts)} · ${Math.round(
        (row.accounts / totalAccounts) * 100,
      )}% of accounts`,
    }));

  if (rows.length === 0) {
    return (
      <ChartFrame title="Linked sign-in methods">
        <ChartEmpty>No linked sign-in methods recorded yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame title="Linked sign-in methods">
      <ChartContainer
        config={SIGN_IN_METHODS_CHART}
        className="aspect-auto w-full"
        style={{ height: rows.length * 40 }}
      >
        <BarChart data={rows} layout="vertical" margin={{ right: 160 }}>
          <XAxis type="number" hide />
          <YAxis dataKey="method" type="category" tickLine={false} axisLine={false} width={56} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="accounts" fill="var(--color-accounts)" radius={4} barSize={18}>
            <LabelList
              dataKey="label"
              position="right"
              offset={8}
              className="fill-muted-foreground"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
