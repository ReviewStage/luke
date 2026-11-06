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
} from "@repo/ui";
import { Fragment } from "react";

const METRIC_CARD_GROUPED =
  "shadow-[1px_0_0_var(--ui-color-border),0_1px_0_var(--ui-color-border)] px-(--ui-card-inset) py-(--ui-card-inset-compact) @min-[720px]/admin-section:flex-1 @min-[720px]/admin-section:basis-36";

const METRIC_FIGURE = "whitespace-nowrap tabular-nums";

const SKELETON_LABEL_WIDTH = "60%";

const SKELETON_VALUE_WIDTH = "45%";

const SKELETON_HINT_WIDTH = "80%";

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

function MetricFigure({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={METRIC_FIGURE}>
      <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.TITLE}>
        {children}
      </Text>
    </div>
  );
}

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

export const CARD_GAP = "gap-(--ui-space-8)";

const STAT_ROW = `flex flex-wrap ${CARD_GAP}`;

const STAT_CELL = "flex-1";

const STAT_PAIR = `flex flex-1 basis-88 flex-wrap ${CARD_GAP}`;

function StatGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Card padding={CARD_PADDING.FLUSH}>
      <div className="flex flex-col gap-px @min-[720px]/admin-section:flex-row @min-[720px]/admin-section:flex-wrap">
        {children}
      </div>
    </Card>
  );
}

export interface StatSpec<T> {
  key: string;
  label: (data: T) => string;
  value: (data: T) => string;
  hint?: ((data: T) => React.ReactNode) | undefined;
  title?: ((data: T) => string) | undefined;
}

export const STAT_LAYOUT = {
  GROUP: "group",
  ROW: "row",
  PAIRS: "pairs",
} as const;

type StatLayout = (typeof STAT_LAYOUT)[keyof typeof STAT_LAYOUT];

function inPairs<T>(items: readonly T[]): T[][] {
  const pairs: T[][] = [];
  for (let at = 0; at < items.length; at += 2) pairs.push(items.slice(at, at + 2));
  return pairs;
}

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
