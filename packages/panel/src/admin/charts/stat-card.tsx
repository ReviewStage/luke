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
import { Fragment } from "react";

/**
 * A card inside a StatGroup leaves its edge to the group's, and once the
 * group sets its cards side by side, shares the row with them, never
 * narrower than its own figure. Note that it has no ground of its own, because
 * the surface is translucent in the dark, and a cell laying it over the
 * group's own would read lighter than every other card; its right and bottom
 * hairlines fall in the one-pixel gap, or past the group's clipped edge.
 */
const METRIC_CARD_GROUPED =
  "shadow-[1px_0_0_var(--luke-color-border),0_1px_0_var(--luke-color-border)] px-(--luke-card-inset) py-(--luke-card-inset-compact) @min-[720px]/admin-section:flex-1 @min-[720px]/admin-section:basis-36";

/**
 * A figure stands on one line, never broken inside a number: a line that
 * may not wrap leaves the shared Text's `overflow-wrap: anywhere` no break to
 * take.
 */
const METRIC_FIGURE = "whitespace-nowrap tabular-nums";

/**
 * A label bone's width, about the words it stands for. Each is a share of
 * the card's line, so the bones ask no width of the card, as wrapping words
 * do not, and a row of cards wraps where the loaded one does.
 */
const SKELETON_LABEL_WIDTH = "60%";

const SKELETON_VALUE_WIDTH = "45%";

const SKELETON_HINT_WIDTH = "80%";

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

function StatCard({
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
const STAT_ROW = `flex flex-wrap ${CARD_GAP}`;

const STAT_CELL = "flex-1";

/**
 * Two cards of a row of four, kept together so the four read in order: one
 * row of four on a wide page, two rows of two on a narrower one, and one
 * column once a pair's figures need the room.
 */
const STAT_PAIR = `flex flex-1 basis-88 flex-wrap ${CARD_GAP}`;

/**
 * Related headline metrics share one surface, leaving charts as the dominant
 * objects: stacked on a narrow page, side by side on a wide one. Note that
 * the rules between the cards are each card's own right and bottom hairline
 * in a one-pixel gap, because a row that wraps when a figure needs the
 * room would leave a fixed divider on the wrong side of a card.
 */
function StatGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Card padding={CARD_PADDING.FLUSH}>
      <div className="flex flex-col gap-px @min-[720px]/admin-section:flex-row @min-[720px]/admin-section:flex-wrap">
        {children}
      </div>
    </Card>
  );
}

/**
 * One stat card as a page declares it, read from the answer `T`: its label,
 * its figure, and, where it has them, its hint and its title. Whether a card
 * has a hint is the declaration's, so its skeleton stands the hint's line
 * exactly where the loaded card will.
 */
export interface StatSpec<T> {
  key: string;
  label: (data: T) => string;
  value: (data: T) => string;
  hint?: ((data: T) => React.ReactNode) | undefined;
  title?: ((data: T) => string) | undefined;
}

/**
 * How a page sets its stat cards: on one shared surface (`StatGroup`), side
 * by side in a row that wraps, or in a row's two wrapping pairs, which keep
 * four cards reading in order.
 */
export const STAT_LAYOUT = {
  GROUP: "group",
  ROW: "row",
  PAIRS: "pairs",
} as const;

type StatLayout = (typeof STAT_LAYOUT)[keyof typeof STAT_LAYOUT];

/** The cards two by two, the last alone where they are odd. */
function inPairs<T>(items: readonly T[]): T[][] {
  const pairs: T[][] = [];
  for (let at = 0; at < items.length; at += 2) pairs.push(items.slice(at, at + 2));
  return pairs;
}

/**
 * A page's stat cards, one for each of `stats` in their order, set as
 * `layout` sets them: each card drawn from `data` once it is read, and its
 * skeleton until then, so the cards, their count, and their hints are the
 * declaration's alone, loading or loaded.
 */
export function StatCards<T>({
  layout,
  stats,
  data,
}: {
  layout: StatLayout;
  stats: readonly StatSpec<T>[];
  data: T | undefined;
}): React.JSX.Element {
  const grouped = layout === STAT_LAYOUT.GROUP;
  const card = (stat: StatSpec<T>) =>
    data === undefined ? (
      <MetricCardSkeleton grouped={grouped} hint={stat.hint !== undefined} />
    ) : (
      <StatCard
        label={stat.label(data)}
        value={stat.value(data)}
        hint={stat.hint?.(data)}
        title={stat.title?.(data)}
        grouped={grouped}
      />
    );
  const cell = (stat: StatSpec<T>) => (
    <div key={stat.key} className={STAT_CELL}>
      {card(stat)}
    </div>
  );
  switch (layout) {
    case STAT_LAYOUT.GROUP:
      return (
        <StatGroup>
          {stats.map((stat) => (
            <Fragment key={stat.key}>{card(stat)}</Fragment>
          ))}
        </StatGroup>
      );
    case STAT_LAYOUT.ROW:
      return <div className={STAT_ROW}>{stats.map(cell)}</div>;
    case STAT_LAYOUT.PAIRS:
      return (
        <div className={STAT_ROW}>
          {inPairs(stats).map((pair) => (
            <div key={pair[0]?.key} className={STAT_PAIR}>
              {pair.map(cell)}
            </div>
          ))}
        </div>
      );
  }
}

/**
 * `children`, its cards and the notes under them, under `title`, a region it
 * names; or, with no title, what leads a page's first section (a page's note,
 * its headline, an account's masthead), at the same step. Note that the
 * section is the container its cards and charts pair up by
 * (`@min-[720px]/admin-section:`), because it is the column they stand in:
 * the window is wider than that column by the sidebar and the page's insets.
 */
export function AdminSection({
  title,
  children,
}: {
  title?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="@container/admin-section">
      <SettingsSection title={title} frame={SETTINGS_SECTION_FRAME.NONE}>
        {children}
      </SettingsSection>
    </div>
  );
}
