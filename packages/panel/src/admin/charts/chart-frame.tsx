/**
 * chart-frame.tsx -- the card every admin chart stands in: its heading over
 * the plot, and the legend under it where one is needed.
 *
 * The heading names what is drawn on the left and, where the chart has one,
 * a caption on the right, which wraps under the name in a column too narrow
 * for both. The heading, the plot, and the legend are a field's gap apart,
 * and the type is the shared roles, so every chart on a page reads as one
 * set. The plot itself stays the chart's own.
 */

import type { AdminTrend } from "@luke/features/admin-answer-wire";
import { formatCount } from "@luke/features/number-format";
import {
  ALIGN,
  Card,
  GAP,
  Inline,
  JUSTIFY,
  SKELETON_SHAPE,
  Skeleton,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { formatTrendMove, TREND_DIRECTION, trendDirection } from "@luke/ui/admin-format";
import { CARD_GAP } from "./stat-card.js";

/** The ink a trend's move is drawn in: a rise complete, a fall attention, no move muted. */
const TREND_TONE = {
  [TREND_DIRECTION.UP]: "text-complete",
  [TREND_DIRECTION.DOWN]: "text-attention",
  [TREND_DIRECTION.FLAT]: "text-muted-foreground",
} as const;

/** The room an empty window's line stands in, about a short plot's height. */
const CHART_EMPTY = "py-(--luke-space-24) text-center";

/** A legend's entries, wrapping a field's gap apart, and close under each other where they wrap. */
export const LEGEND = "flex flex-wrap gap-x-(--luke-field-gap) gap-y-(--luke-space-4)";

/** A legend entry's swatch a short step from its name, closer than a glyph to its words, since the swatch is smaller. */
export const LEGEND_ENTRY = "inline-flex items-center gap-(--luke-space-6)";

/** A heading bone's width, about the words it stands for. */
const SKELETON_TITLE_WIDTH = "144px";

const SKELETON_ASIDE_WIDTH = "224px";

/** Two chart cards of equal width side by side, as the Reliability breakdowns stand. */
export const CHART_PAIR_EVEN = `grid ${CARD_GAP} min-[720px]:grid-cols-2`;

/** A wide chart card beside a narrow one, as the Overview's funnel and reach stand. */
export const CHART_PAIR_WIDE = `grid ${CARD_GAP} min-[720px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]`;

/** A trend's move alone, in the ink of its direction: a rise complete, a fall attention. */
export function TrendMove({ trend }: { trend: AdminTrend }): React.JSX.Element {
  return (
    <span className={`font-medium tabular-nums ${TREND_TONE[trendDirection(trend)]}`}>
      {formatTrendMove(trend)}
    </span>
  );
}

/**
 * How a chart's trailing run moved against the run before it, set as the
 * heading's caption. The comparison sits with the bars rather than on a card
 * of its own, because it is read as a caption on the shape under it.
 */
export function ChartTrend({ trend }: { trend: AdminTrend }): React.JSX.Element {
  return (
    <>
      <TrendMove trend={trend} /> {formatCount(trend.recent)} in the last {trend.days} days, against{" "}
      {formatCount(trend.prior)} before
    </>
  );
}

/**
 * A swatch and a name for each series of a chart drawing more than one, set
 * as the frame's legend under the plot, in the config's own order.
 */
export function SeriesLegend({
  series,
}: {
  series: readonly { key: string; label: string; color: string }[];
}): React.JSX.Element {
  return (
    <span className={LEGEND}>
      {series.map((entry) => (
        <span key={entry.key} className={LEGEND_ENTRY}>
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          {entry.label}
        </span>
      ))}
    </span>
  );
}

/**
 * What a chart draws in place of its plot when its window holds nothing to
 * measure: one muted line, centered in the room the bars would take, rather
 * than the server's zero-fill drawn as a flat measurement.
 */
export function ChartEmpty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={CHART_EMPTY}>
      <Text tone={TEXT_TONE.MUTED}>{children}</Text>
    </div>
  );
}

/**
 * A chart's card: `title` over `children`, with `aside` across from the
 * title and `legend` under the plot where they are given. A chart the
 * page's section heading already names, the retention grid, takes no
 * title, and its card holds the plot alone. The card is
 * positioned, so `overlay`, a chart's own tooltip, stands on it outside the
 * column the rest is set in, which would otherwise squeeze it; `ref` is the
 * card, which such a tooltip measures against.
 */
export function ChartFrame({
  title,
  aside,
  legend,
  overlay,
  ref,
  children,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  legend?: React.ReactNode;
  overlay?: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card ref={ref}>
      <Stack gap={GAP.FIELD}>
        {title === undefined ? null : (
          <Inline justify={JUSTIFY.BETWEEN} align={ALIGN.BASELINE}>
            <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
              {title}
            </Text>
            {aside === undefined ? null : (
              <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {aside}
              </Text>
            )}
          </Inline>
        )}
        {children}
        {legend === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {legend}
          </Text>
        )}
      </Stack>
      {overlay}
    </Card>
  );
}

/**
 * The box a chart's plot stands in, `height` tall: the chart's own plot
 * height, a CSS length the chart and its skeleton both read, so the bars land
 * where the block stood.
 */
export function PlotBox({
  height,
  children,
}: {
  height: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return <div style={{ height }}>{children}</div>;
}

/**
 * A caption's bone across from a heading. Note that it stands in a row of
 * its own, whose baseline is the bone's foot, because the heading sets its
 * caption on its words' baseline and a bone's block alone would sit its
 * whole line's room above it, standing the heading taller than its words do.
 */
export function AsideSkeleton(): React.JSX.Element {
  return (
    <Inline>
      <Skeleton width={SKELETON_ASIDE_WIDTH} />
    </Inline>
  );
}

/**
 * A chart's card while its data is still being read, drawn through the
 * chart's own frame: its heading, the words where the chart knows them and a
 * bone where they are read, a bone for a caption read with the data, the
 * legend as itself, since a chart's series are known before its data, and a
 * block of `plot`, the chart's own plot height, so the words and the plot
 * land where the bones stood. A chart the page's heading names (`untitled`)
 * stands no heading.
 */
export function ChartFrameSkeleton({
  title,
  untitled = false,
  aside = false,
  legend,
  plot,
}: {
  /** The heading's words where the chart knows them before its data; a bone where left out. */
  title?: string | undefined;
  untitled?: boolean;
  /** Whether a caption read with the data stands across from the heading. */
  aside?: boolean;
  legend?: React.ReactNode;
  /** The plot's height, the chart's own. */
  plot: string;
}): React.JSX.Element {
  return (
    <ChartFrame
      title={untitled ? undefined : (title ?? <Skeleton width={SKELETON_TITLE_WIDTH} />)}
      aside={aside ? <AsideSkeleton /> : undefined}
      legend={legend}
    >
      <PlotBox height={plot}>
        <Skeleton shape={SKELETON_SHAPE.BLOCK} />
      </PlotBox>
    </ChartFrame>
  );
}
