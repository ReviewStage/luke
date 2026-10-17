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

/**
 * Note that a card keeps its content's width, with no `min-w-0`, because its
 * figure never breaks: a row or a track sized by its content widens for the
 * figure, and the label wraps, rather than the card squeezing the number
 * apart. A track that starts at zero holds the card to it, and the figure
 * then overflows the card whole.
 */
const METRIC_CARD = "rounded-lg border border-border bg-card px-5 py-4";

/**
 * A card inside a StatGroup leaves its edge to the group's, and once the
 * group sets its cards side by side, shares the row with them, never
 * narrower than its own figure.
 */
const METRIC_CARD_GROUPED = "bg-card px-5 py-4 min-[720px]:flex-1 min-[720px]:basis-36";

/**
 * A figure stands on one line, never broken inside a number, against the
 * shared Stack's `overflow-wrap: anywhere` it stands in.
 */
const METRIC_FIGURE = "whitespace-nowrap [overflow-wrap:normal]";

const METRIC_VALUE = `${METRIC_FIGURE} text-3xl font-semibold tabular-nums`;

/** A figure that is a state's word rather than a count, a step smaller. */
export const METRIC_STATUS = `${METRIC_FIGURE} text-xl font-semibold`;

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

/** The cards a StatGroup sets side by side once the page is wide enough for them. */
export const STAT_GROUP_COLUMNS = 3;

/**
 * Related headline metrics share one surface, leaving charts as the dominant
 * objects: stacked on a narrow page, side by side on a wide one. Note that
 * the rules between the cards are the group's own border ink showing
 * through a one-pixel gap, because a row that wraps when a figure needs the
 * room would leave a fixed divider on the wrong side of a card.
 */
export function StatGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border min-[720px]:flex-row min-[720px]:flex-wrap">
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
