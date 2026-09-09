import type { AdminTrend } from "../../../server/admin/admin-metrics";
import { formatNumber, formatTrendMove, trendTone } from "../format";

/**
 * A chart's own heading: what it draws on the left, and how its trailing run
 * moved against the run before it on the right. The comparison sits with the
 * bars rather than on a card of its own, because it is read as a caption on
 * the shape above it.
 */
export function ChartHeading({
  label,
  trend,
}: {
  label: string;
  trend: AdminTrend;
}): React.JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-baseline gap-1.5">
        <span className={`font-medium tabular-nums ${trendTone(trend)}`}>
          {formatTrendMove(trend)}
        </span>
        <span className="text-muted-foreground">
          {formatNumber(trend.recent)} in the last {trend.days} days, against{" "}
          {formatNumber(trend.prior)} before
        </span>
      </span>
    </div>
  );
}
