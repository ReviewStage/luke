import type { ChartConfig } from "@luke/ui/chart";
import { DailyBars } from "@luke/ui/daily-bars";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * daily-bars.tsx -- a fortnight of days as one series, the last day still
 * counting and faded, and as a stack of three whose columns open the day
 * they stand for.
 */

/** The fortnight drawn, oldest first, its last day the one still counting. */
const DAYS = Array.from(
  { length: 14 },
  (_, index) => `2026-10-${String(10 + index).padStart(2, "0")}`,
);

/** Midday on the last day, so it reads as partial. */
const GENERATED_AT = Date.parse("2026-10-23T12:00:00Z");

/** The corners a column's top is rounded at. */
const RADIUS: [number, number, number, number] = [6, 6, 0, 0];

const CALLS_CHART = {
  calls: { label: "Calls", color: "var(--luke-color-chart-1)" },
} satisfies ChartConfig;

const CALLS = DAYS.map((day, index) => ({
  day,
  calls: [4, 7, 5, 9, 12, 3, 2, 8, 11, 10, 14, 6, 9, 5][index] ?? 0,
}));

const STACKED_CHART = {
  agents: { label: "Agents started", color: "var(--luke-color-chart-1)" },
  plans: { label: "Plan revisions", color: "var(--luke-color-chart-2)" },
  calls: { label: "Calls held", color: "var(--luke-color-chart-3)" },
} satisfies ChartConfig;

const STACKED = DAYS.map((day, index) => ({
  day,
  agents: (index * 3) % 7,
  plans: (index * 5) % 9,
  calls: (index * 2) % 5,
}));

const STACK_SERIES = Object.entries(STACKED_CHART).map(([key, entry]) => ({
  key,
  fill: entry.color,
}));

function DailyBarsExample(): React.JSX.Element {
  const [opened, setOpened] = useState<string | undefined>(undefined);
  return (
    <>
      <CatalogSection id="daily-bars-one" title="One series, today faded">
        <div className="catalog-column">
          <DailyBars
            config={CALLS_CHART}
            data={CALLS}
            series={[{ key: "calls", fill: "var(--color-calls)" }]}
            axis={{ width: 36, allowDecimals: false }}
            height="12rem"
            radius={RADIUS}
            generatedAt={GENERATED_AT}
          />
        </div>
      </CatalogSection>
      <CatalogSection id="daily-bars-stacked" title="Stacked, each column opening its day">
        <div className="catalog-column">
          <DailyBars
            config={STACKED_CHART}
            data={STACKED}
            series={STACK_SERIES}
            stack="activity"
            axis={{ width: 36, allowDecimals: false }}
            height="15rem"
            radius={RADIUS}
            generatedAt={GENERATED_AT}
            onOpenDay={setOpened}
          />
          <p>{opened === undefined ? "No day opened" : `Opened ${opened}`}</p>
        </div>
      </CatalogSection>
    </>
  );
}

export const DAILY_BARS_EXAMPLE: Example = {
  id: "daily-bars",
  title: "Daily bars",
  Render: DailyBarsExample,
};
