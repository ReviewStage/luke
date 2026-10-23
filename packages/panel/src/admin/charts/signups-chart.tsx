import type {
  AdminDailySignups,
  AdminSignInMethods,
  AdminTrend,
} from "@luke/features/admin-answer-wire";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@luke/ui/chart";
import { DailyBars } from "@luke/ui/daily-bars";
import { seriesHasNoData } from "@luke/ui/daily-series";
import { formatCount } from "@luke/ui/time-format";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import { barRadius, barTopRadius } from "./bar-radius.js";
import { ChartEmpty, ChartFrame, ChartFrameSkeleton, ChartTrend } from "./chart-frame.js";

const SIGNUPS_CHART = {
  count: { label: "New accounts", color: "var(--luke-color-chart-1)" },
} satisfies ChartConfig;

const SIGNUPS_TITLE = "New accounts per day";

/** The plot's height, which the chart and its skeleton both stand. */
const SIGNUPS_PLOT_HEIGHT = "10rem";

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
      <ChartFrame title={SIGNUPS_TITLE} aside={<ChartTrend trend={trend} />}>
        <ChartEmpty>No accounts created in this window yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame title={SIGNUPS_TITLE} aside={<ChartTrend trend={trend} />}>
      <DailyBars
        config={SIGNUPS_CHART}
        data={daily}
        series={[{ key: "count", fill: "var(--color-count)" }]}
        axis={{ width: 36, allowDecimals: false }}
        height={SIGNUPS_PLOT_HEIGHT}
        radius={barTopRadius()}
        generatedAt={generatedAt}
      />
    </ChartFrame>
  );
}

/** The chart while the window is read: its heading over its plot's block, and a bone for the trend it reads. */
export function SignupsChartSkeleton(): React.JSX.Element {
  return <ChartFrameSkeleton title={SIGNUPS_TITLE} aside plot={SIGNUPS_PLOT_HEIGHT} />;
}

const SIGN_IN_METHODS_TITLE = "Linked sign-in methods";

/** The methods a bar stands for, in the order they stand, each read from the answer's counts. */
const SIGN_IN_METHODS: readonly {
  method: string;
  accounts: (methods: AdminSignInMethods) => number;
}[] = [
  { method: "GitHub", accounts: (methods) => methods.github },
  { method: "Google", accounts: (methods) => methods.google },
  { method: "Other", accounts: (methods) => methods.other },
];

/** The room each method's bar takes. */
const SIGN_IN_ROW_HEIGHT = 40;

const SIGN_IN_METHODS_CHART = {
  accounts: { label: "Accounts", color: "var(--luke-color-chart-1)" },
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
  methods: AdminSignInMethods;
  totalAccounts: number;
}): React.JSX.Element {
  const rows = SIGN_IN_METHODS.map((entry) => ({
    method: entry.method,
    accounts: entry.accounts(methods),
  }))
    .filter((row) => row.accounts > 0)
    .map((row) => ({
      ...row,
      label: `${formatCount(row.accounts)} · ${Math.round(
        (row.accounts / totalAccounts) * 100,
      )}% of accounts`,
    }));

  if (rows.length === 0) {
    return (
      <ChartFrame title={SIGN_IN_METHODS_TITLE}>
        <ChartEmpty>No linked sign-in methods recorded yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame title={SIGN_IN_METHODS_TITLE}>
      <ChartContainer
        config={SIGN_IN_METHODS_CHART}
        className="aspect-auto w-full"
        style={{ height: rows.length * SIGN_IN_ROW_HEIGHT }}
      >
        <BarChart data={rows} layout="vertical" margin={{ right: 160 }}>
          <XAxis type="number" hide />
          <YAxis dataKey="method" type="category" tickLine={false} axisLine={false} width={56} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="accounts" fill="var(--color-accounts)" radius={barRadius()} barSize={18}>
            <LabelList
              dataKey="label"
              position="right"
              offset={8}
              className="fill-(--luke-color-text-muted)"
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}

/**
 * The chart while the roster is read: its heading over a block of a bar for
 * every method, as an answer where each was linked stands.
 */
export function SignInMethodsChartSkeleton(): React.JSX.Element {
  return (
    <ChartFrameSkeleton
      title={SIGN_IN_METHODS_TITLE}
      plot={`${SIGN_IN_METHODS.length * SIGN_IN_ROW_HEIGHT}px`}
    />
  );
}
