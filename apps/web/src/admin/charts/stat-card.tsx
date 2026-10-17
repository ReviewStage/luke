/**
 * stat-card.tsx -- the admin's metric cards and the headings its sections
 * stand under.
 *
 * A metric card names what it counts in the shared label role, the figure
 * large under it, and a hint in the body role beneath; the figure keeps its
 * own size, because no type role is a headline number. Words a card holds
 * are the shared roles, so a card, a chart's heading, and a section read as
 * one set.
 */

import { GAP, Skeleton, Stack, TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";

const METRIC_CARD = "min-w-0 rounded-lg border border-border bg-card px-5 py-4";

/** A card inside a StatGroup leaves its edge to the group's. */
const METRIC_CARD_GROUPED = "min-w-0 bg-card px-5 py-4";

const METRIC_VALUE = "text-3xl font-semibold tabular-nums";

/** A figure that is a state's word rather than a count, a step smaller. */
export const METRIC_STATUS = "text-xl font-semibold";

/** A label bone's width, about the words it stands for. */
const SKELETON_LABEL_WIDTH = "96px";

const SKELETON_VALUE_WIDTH = "80px";

const SKELETON_HINT_WIDTH = "128px";

/** The room above a section's heading, which parts one section from the last, and under it. */
const SECTION_HEADING = "mt-12 mb-4";

/**
 * A metric card's frame: `label` over `children`, the figure, with `hint`
 * under it. The label is a control's gap from the figure and the hint sits
 * close under it, as a caption does.
 */
export function MetricCard({
  label,
  hint,
  title,
  grouped = false,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  title?: string | undefined;
  grouped?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={grouped ? METRIC_CARD_GROUPED : METRIC_CARD} title={title}>
      <Stack gap={GAP.CONTROL}>
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
          {label}
        </Text>
        <Stack gap={GAP.TIGHT}>
          {children}
          {hint === undefined ? null : <Text tone={TEXT_TONE.MUTED}>{hint}</Text>}
        </Stack>
      </Stack>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  title,
  grouped = false,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  title?: string | undefined;
  grouped?: boolean;
}): React.JSX.Element {
  return (
    <MetricCard label={label} hint={hint} title={title} grouped={grouped}>
      <div className={METRIC_VALUE}>{value}</div>
    </MetricCard>
  );
}

/**
 * A metric card while its data is still being read: bones where the label,
 * the figure, and the hint will be, each in the type it stands for, so the
 * words land where the bones stood. `children` is the figure's bone, a stat
 * card's own where none is given.
 */
export function MetricCardSkeleton({
  grouped = false,
  hint = true,
  children,
}: {
  grouped?: boolean;
  hint?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={grouped ? METRIC_CARD_GROUPED : METRIC_CARD}>
      <Stack gap={GAP.CONTROL}>
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL}>
          <Skeleton width={SKELETON_LABEL_WIDTH} />
        </Text>
        <Stack gap={GAP.TIGHT}>
          {children ?? (
            <div className={METRIC_VALUE}>
              <Skeleton width={SKELETON_VALUE_WIDTH} />
            </div>
          )}
          {hint ? (
            <Text as={TEXT_ELEMENT.DIV}>
              <Skeleton width={SKELETON_HINT_WIDTH} />
            </Text>
          ) : null}
        </Stack>
      </Stack>
    </div>
  );
}

/**
 * A row of stat cards that wraps rather than holding fixed columns. Note that
 * a card's cell grows from nothing but never shrinks below its own figure,
 * so the row wraps once a figure needs the room rather than the figure
 * overflowing its card.
 */
export const STAT_ROW = "flex flex-wrap gap-3";

export const STAT_CELL = "flex-1";

/**
 * Two cards of a row of four, kept together so the four read in order: one
 * row of four on a wide page, two rows of two on a narrower one, and one
 * column once a pair's figures need the room.
 */
export const STAT_PAIR = "flex flex-1 basis-88 flex-wrap gap-3";

/** The cards a StatGroup sets side by side once the page is wide enough for them. */
export const STAT_GROUP_COLUMNS = 3;

/** Related headline metrics share one surface, leaving charts as the dominant objects. */
export function StatGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid divide-y divide-border overflow-hidden rounded-lg border border-border bg-card min-[720px]:grid-cols-3 min-[720px]:divide-x min-[720px]:divide-y-0">
      {children}
    </div>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={SECTION_HEADING}>
      <Text as={TEXT_ELEMENT.H2} variant={TEXT_VARIANT.SECTION}>
        {children}
      </Text>
    </div>
  );
}
