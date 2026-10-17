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

import type { AdminTrend } from "@luke/service/admin/admin-metrics";
import {
  ALIGN,
  GAP,
  Inline,
  JUSTIFY,
  Skeleton,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { formatNumber, formatTrendMove, trendTone } from "@luke/ui/admin-format";

const CHART_CARD = "relative rounded-lg border border-border bg-card p-5";

/** The room an empty window's line stands in, about a short plot's height. */
const CHART_EMPTY = "py-6 text-center";

/** A heading bone's width, about the words it stands for. */
const SKELETON_TITLE_WIDTH = "144px";

const SKELETON_ASIDE_WIDTH = "224px";

/** The legend bone stops short of the line, as a sentence does. */
const SKELETON_LEGEND_WIDTH = "60%";

/**
 * How a chart's trailing run moved against the run before it, set as the
 * heading's caption. The comparison sits with the bars rather than on a card
 * of its own, because it is read as a caption on the shape under it.
 */
export function ChartTrend({ trend }: { trend: AdminTrend }): React.JSX.Element {
  return (
    <>
      <span className={`font-medium tabular-nums ${trendTone(trend)}`}>
        {formatTrendMove(trend)}
      </span>{" "}
      {formatNumber(trend.recent)} in the last {trend.days} days, against{" "}
      {formatNumber(trend.prior)} before
    </>
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
 * title and `legend` under the plot where they are given. The card is
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
  title: string;
  aside?: React.ReactNode;
  legend?: React.ReactNode;
  overlay?: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div ref={ref} className={CHART_CARD}>
      <Stack gap={GAP.FIELD}>
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
        {children}
        {legend === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {legend}
          </Text>
        )}
      </Stack>
      {overlay}
    </div>
  );
}

/**
 * A chart's card while its data is still being read: bones where the
 * heading, its caption, and the legend will be, each in the type it stands
 * for, so the words land where the bones stood.
 */
export function ChartFrameSkeleton({
  aside,
  legend,
  children,
}: {
  aside: boolean;
  legend: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={CHART_CARD}>
      <Stack gap={GAP.FIELD}>
        <Inline justify={JUSTIFY.BETWEEN}>
          <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL}>
            <Skeleton width={SKELETON_TITLE_WIDTH} />
          </Text>
          {aside ? (
            <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
              <Skeleton width={SKELETON_ASIDE_WIDTH} />
            </Text>
          ) : null}
        </Inline>
        {children}
        {legend ? (
          <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
            <Skeleton width={SKELETON_LEGEND_WIDTH} />
          </Text>
        ) : null}
      </Stack>
    </div>
  );
}
