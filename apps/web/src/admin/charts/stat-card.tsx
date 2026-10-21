/**
 * stat-card.tsx -- the admin's metric cards and the sections they stand in.
 *
 * A metric card names what it counts in the shared label role, the figure
 * large under it in the page title's role, the largest the shared roles
 * hold, and a hint in the body role beneath. Words a card holds
 * are the shared roles, so a card, a chart's heading, and a section read as
 * one set.
 *
 * A section is the app's own (`SettingsSection`), without its card: its
 * heading in the section role a step quieter than what it heads, a hair in
 * from the cards' edge, and what it holds a short step under it and one
 * from the next, each card drawing its own frame. A headed section is a
 * region named by its heading. The room between one section and the next
 * is the page's (`Refreshing`).
 */

import {
  CARD_PADDING,
  Card,
  GAP,
  SETTINGS_SECTION_FRAME,
  SettingsSection,
  Skeleton,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";

/**
 * A card inside a StatGroup leaves its edge to the group's, and once the
 * group sets its cards side by side, shares the row with them, never
 * narrower than its own figure.
 */
const METRIC_CARD_GROUPED =
  "bg-(--luke-color-surface) px-(--luke-card-inset) py-(--luke-card-inset-compact) min-[720px]:flex-1 min-[720px]:basis-36";

/**
 * A figure stands on one line, never broken inside a number: a line that
 * may not wrap leaves the shared Text's `overflow-wrap: anywhere` no break to
 * take.
 */
const METRIC_FIGURE = "whitespace-nowrap tabular-nums";

/** A label bone's width, about the words it stands for. */
const SKELETON_LABEL_WIDTH = "96px";

const SKELETON_VALUE_WIDTH = "80px";

const SKELETON_HINT_WIDTH = "128px";

/**
 * A metric's frame: a card of its own, or a cell of a StatGroup's. Note that
 * a card keeps its content's width, with no `min-w-0`, because its figure
 * never breaks: a row or a track sized by its content widens for the figure,
 * and the label wraps, rather than the card squeezing the number apart. A
 * track that starts at zero holds the card to it, and the figure then
 * overflows the card whole.
 */
function MetricFrame({
  grouped,
  title,
  children,
}: {
  grouped: boolean;
  title?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return grouped ? (
    <div className={METRIC_CARD_GROUPED} title={title}>
      {children}
    </div>
  ) : (
    <Card padding={CARD_PADDING.COMPACT} title={title}>
      {children}
    </Card>
  );
}

/** A card's figure, or the bone standing for it, on one line in the title role. */
function MetricFigure({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={METRIC_FIGURE}>
      <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.TITLE}>
        {children}
      </Text>
    </div>
  );
}

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
    <MetricFrame grouped={grouped} title={title}>
      <Stack gap={GAP.CONTROL}>
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
          {label}
        </Text>
        <Stack gap={GAP.TIGHT}>
          {children}
          {hint === undefined ? null : <Text tone={TEXT_TONE.MUTED}>{hint}</Text>}
        </Stack>
      </Stack>
    </MetricFrame>
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
  hint?: React.ReactNode;
  title?: string | undefined;
  grouped?: boolean;
}): React.JSX.Element {
  return (
    <MetricCard label={label} hint={hint} title={title} grouped={grouped}>
      <MetricFigure>{value}</MetricFigure>
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
    <MetricFrame grouped={grouped}>
      <Stack gap={GAP.CONTROL}>
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL}>
          <Skeleton width={SKELETON_LABEL_WIDTH} />
        </Text>
        <Stack gap={GAP.TIGHT}>
          {children ?? (
            <MetricFigure>
              <Skeleton width={SKELETON_VALUE_WIDTH} />
            </MetricFigure>
          )}
          {hint ? (
            <Text as={TEXT_ELEMENT.DIV}>
              <Skeleton width={SKELETON_HINT_WIDTH} />
            </Text>
          ) : null}
        </Stack>
      </Stack>
    </MetricFrame>
  );
}

/**
 * The room between two cards of one section, across a row or down a column:
 * the step a section stands what it holds under its heading at
 * (`settings-section.css`), so a section's cards read as one group and the
 * section's gap parts it from the next.
 */
export const CARD_GAP = "gap-(--luke-space-8)";

/**
 * A row of stat cards that wraps rather than holding fixed columns. Note that
 * a card's cell grows from nothing but never shrinks below its own figure,
 * so the row wraps once a figure needs the room rather than the figure
 * overflowing its card.
 */
export const STAT_ROW = `flex flex-wrap ${CARD_GAP}`;

export const STAT_CELL = "flex-1";

/**
 * Two cards of a row of four, kept together so the four read in order: one
 * row of four on a wide page, two rows of two on a narrower one, and one
 * column once a pair's figures need the room.
 */
export const STAT_PAIR = `flex flex-1 basis-88 flex-wrap ${CARD_GAP}`;

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
    <Card padding={CARD_PADDING.FLUSH}>
      <div className="flex flex-col gap-px bg-(--luke-color-border) min-[720px]:flex-row min-[720px]:flex-wrap">
        {children}
      </div>
    </Card>
  );
}

/**
 * `children`, its cards and the notes under them, under `title`, a region it
 * names; or, with no title, what leads a page's first section (a page's note,
 * its headline, an account's masthead), at the same step.
 */
export function AdminSection({
  title,
  children,
}: {
  title?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <SettingsSection title={title} frame={SETTINGS_SECTION_FRAME.NONE}>
      {children}
    </SettingsSection>
  );
}
