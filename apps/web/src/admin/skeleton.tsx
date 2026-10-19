import {
  SKELETON_SHAPE as BONE_SHAPE,
  Skeleton as Bone,
  CARD_PADDING,
  Card,
  GAP,
  Inline,
  List,
  ListRow,
  Stack,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  type TextVariant,
} from "@luke/ui";
import { ChartFrameSkeleton } from "./charts/chart-frame";
import {
  MetricCardSkeleton,
  SectionHeading,
  STAT_CELL,
  STAT_GROUP_COLUMNS,
  STAT_PAIR,
  STAT_ROW,
  StatGroup,
} from "./charts/stat-card";

/**
 * The first load's stand-in: the page's own layout with bones where the data
 * will land, so the answer replaces the skeleton without moving what the
 * reader is already looking at. Every fixed dimension below mirrors a real
 * component and must move with it — a stat card's line boxes, each chart's
 * fixed plot height, the retention grid's eight `min-h-9` cohort rows and the
 * tables' ten (`ADMIN_RETENTION_WEEKS` and `ADMIN_TOP_USERS_LIMIT`, not
 * imported because the modules exporting them carry query code the client
 * bundle must not), and a table row's `py-3` around a `size-8` avatar. Static
 * words — the headings, the notes under the sections — render as themselves;
 * only unknown data gets bones, each hidden from readers while `aria-busy` on
 * the region and one visually hidden line say what the page is doing.
 *
 * Each page names its own shapes rather than restating its layout a second
 * time, so a section added to a page is a line here, not a page-shaped copy
 * that drifts from the page the moment either moves.
 */

/** A bone set in the type of the line it stands for, so the swap to words moves nothing. */
function SkeletonLine({ variant, width }: SkeletonTextLine): React.JSX.Element {
  return (
    <Text as={TEXT_ELEMENT.DIV} variant={variant}>
      <Bone width={width} />
    </Text>
  );
}

/** The small avatar's bone, the size of a table row's avatar. */
const AVATAR_BONE = { small: "32px", large: "56px" } as const;

/** Each plot height is its chart's own fixed height, so the bars land where the bone stood. */
export const SKELETON_PLOT = {
  USAGE: "h-48",
  SIGNUPS: "h-40",
  SIGN_IN_METHODS: "h-30",
  FAILURE_RATES: "h-56",
  BREAKDOWN: "h-40",
} as const;

type SkeletonPlot = (typeof SKELETON_PLOT)[keyof typeof SKELETON_PLOT];

export const SKELETON_SHAPE = {
  HEADING: "heading",
  STAT_GROUP: "stat-group",
  STAT_CARDS: "stat-cards",
  CHART: "chart",
  CALENDAR: "calendar",
  RETENTION: "retention",
  TABLE: "table",
  LINES: "lines",
  HEALTH: "health",
  MASTHEAD: "masthead",
  STATIC: "static",
} as const;

/** A bone standing in for one line of text: the type it is set in, and how wide it stands. */
interface SkeletonTextLine {
  variant: TextVariant;
  width: string;
}

/** One region of a loading page, in the order the page stacks them. */
export type SkeletonShape =
  | { kind: typeof SKELETON_SHAPE.HEADING; label: string }
  /** A stat group of `cards`, or the overview's three where none is given. */
  | { kind: typeof SKELETON_SHAPE.STAT_GROUP; cards?: number }
  | { kind: typeof SKELETON_SHAPE.STAT_CARDS; count: 1 | 2 | 4; columns: 1 | 2 | 4 }
  /** One chart card, or the pair a page sets side by side, wide and narrow unless `even`. */
  | { kind: typeof SKELETON_SHAPE.CHART; plots: readonly SkeletonPlot[]; even?: boolean }
  | { kind: typeof SKELETON_SHAPE.CALENDAR }
  | { kind: typeof SKELETON_SHAPE.RETENTION }
  | {
      kind: typeof SKELETON_SHAPE.TABLE;
      rows: number;
      numericColumns: number;
    }
  /** Lines of body text, each as wide as the share of the line given. */
  | { kind: typeof SKELETON_SHAPE.LINES; bones: readonly string[] }
  /** The health pair, its list of `rows` providers. */
  | { kind: typeof SKELETON_SHAPE.HEALTH; rows: number }
  | {
      kind: typeof SKELETON_SHAPE.MASTHEAD;
      avatar?: boolean;
      lines: readonly SkeletonTextLine[];
    }
  /** Words the page knows without reading anything, drawn as themselves. */
  | { kind: typeof SKELETON_SHAPE.STATIC; node: React.ReactNode };

function bones(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/** Two chart cards of equal width side by side, as the Reliability breakdowns stand. */
export const CHART_PAIR_EVEN = "grid gap-3 min-[720px]:grid-cols-2";

const STAT_CARDS_GRID = {
  1: "grid gap-3",
  2: "grid grid-cols-2 gap-3",
} as const;

/** The bar charts carry a trend across from their heading; the failure rates carry a legend under the plot instead. */
function SkeletonChartCard({ plot }: { plot: SkeletonPlot }): React.JSX.Element {
  const trended = plot === SKELETON_PLOT.USAGE || plot === SKELETON_PLOT.SIGNUPS;
  return (
    <ChartFrameSkeleton aside={trended} legend={plot === SKELETON_PLOT.FAILURE_RATES} plot={plot} />
  );
}

/**
 * The bone block approximates the calendar grid's height: a month-label row
 * and seven day rows with the grid's own gaps.
 */
function SkeletonCalendarCard(): React.JSX.Element {
  return <ChartFrameSkeleton aside={false} legend plot="h-39" />;
}

function SkeletonAccountsTable({
  rows,
  numericColumns,
}: {
  rows: number;
  numericColumns: number;
}): React.JSX.Element {
  const columns = bones(numericColumns);
  return (
    <Card padding={CARD_PADDING.FLUSH}>
      <div className="flex items-center gap-6 border-b border-(--luke-color-border) px-5 py-3">
        <div className="min-w-0 flex-1">
          <SkeletonLine variant={TEXT_VARIANT.LABEL} width="64px" />
        </div>
        {columns.map((column) => (
          <div key={column} className="flex w-14 shrink-0 justify-end">
            <SkeletonLine variant={TEXT_VARIANT.LABEL} width="40px" />
          </div>
        ))}
      </div>
      {bones(rows).map((row) => (
        <div
          key={row}
          className="flex items-center gap-6 border-b border-(--luke-color-border) px-5 py-3 last:border-0"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex shrink-0">
              <Bone shape={BONE_SHAPE.CIRCLE} width={AVATAR_BONE.small} />
            </span>
            <div className="min-w-0">
              <SkeletonLine variant={TEXT_VARIANT.LABEL} width="144px" />
              <SkeletonLine variant={TEXT_VARIANT.CAPTION} width="176px" />
            </div>
          </div>
          {columns.map((column) => (
            <div key={column} className="flex w-14 shrink-0 justify-end">
              <SkeletonLine variant={TEXT_VARIANT.BODY} width="40px" />
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}

function SkeletonShapeBody({ shape }: { shape: SkeletonShape }): React.JSX.Element {
  switch (shape.kind) {
    case SKELETON_SHAPE.HEADING:
      return <SectionHeading>{shape.label}</SectionHeading>;
    case SKELETON_SHAPE.STAT_GROUP:
      return (
        <StatGroup>
          {bones(shape.cards ?? STAT_GROUP_COLUMNS).map((card) => (
            <MetricCardSkeleton key={card} grouped />
          ))}
        </StatGroup>
      );
    case SKELETON_SHAPE.STAT_CARDS:
      // Note that four cards stand in the loaded page's two wrapping pairs,
      // so the bones break where the figures will rather than at a breakpoint
      // of their own.
      if (shape.columns === 4) {
        return (
          <div className={STAT_ROW}>
            {bones(2).map((pair) => (
              <div key={pair} className={STAT_PAIR}>
                {bones(2).map((card) => (
                  <div key={card} className={STAT_CELL}>
                    <MetricCardSkeleton />
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      }
      return (
        <div className={STAT_CARDS_GRID[shape.columns]}>
          {bones(shape.count).map((card) => (
            <MetricCardSkeleton key={card} />
          ))}
        </div>
      );
    case SKELETON_SHAPE.CHART:
      return (
        <div
          className={
            shape.plots.length > 1
              ? shape.even
                ? CHART_PAIR_EVEN
                : "grid gap-3 min-[720px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
              : undefined
          }
        >
          {shape.plots.map((plot, index) => (
            <SkeletonChartCard key={index} plot={plot} />
          ))}
        </div>
      );
    case SKELETON_SHAPE.CALENDAR:
      return <SkeletonCalendarCard />;
    case SKELETON_SHAPE.RETENTION:
      return (
        <Card>
          <div className="grid gap-1">
            <SkeletonLine variant={TEXT_VARIANT.CAPTION} width="100%" />
            {bones(8).map((row) => (
              <div key={row} className="h-9">
                <Bone shape={BONE_SHAPE.BLOCK} />
              </div>
            ))}
          </div>
        </Card>
      );
    case SKELETON_SHAPE.TABLE:
      return <SkeletonAccountsTable rows={shape.rows} numericColumns={shape.numericColumns} />;
    case SKELETON_SHAPE.LINES:
      return (
        <>
          {shape.bones.map((width, index) => (
            <SkeletonLine key={index} variant={TEXT_VARIANT.BODY} width={width} />
          ))}
        </>
      );
    case SKELETON_SHAPE.HEALTH:
      return (
        <div className="grid gap-3 min-[720px]:grid-cols-[1fr_1.4fr]">
          <MetricCardSkeleton>
            <Text as={TEXT_ELEMENT.DIV}>
              <Bone width="96px" />
            </Text>
          </MetricCardSkeleton>
          <MetricCardSkeleton hint={false}>
            <List label="Integrations">
              {bones(shape.rows).map((row) => (
                <ListRow key={row} title={<Bone width="192px" />} meta={<Bone width="96px" />} />
              ))}
            </List>
          </MetricCardSkeleton>
        </div>
      );
    case SKELETON_SHAPE.MASTHEAD:
      return (
        <Inline gap={GAP.FIELD}>
          {shape.avatar ? (
            <span className="flex shrink-0">
              <Bone shape={BONE_SHAPE.CIRCLE} width={AVATAR_BONE.large} />
            </span>
          ) : null}
          <Stack gap={GAP.TIGHT}>
            {shape.lines.map((line) => (
              <SkeletonLine key={line.width} variant={line.variant} width={line.width} />
            ))}
          </Stack>
        </Inline>
      );
    case SKELETON_SHAPE.STATIC:
      return <>{shape.node}</>;
  }
}

/**
 * What separates one region from the next. A heading carries its own margins,
 * so the region under it needs none; a masthead keeps the clearance the real
 * pages give it; and words that draw themselves bring whatever spacing they
 * were written with.
 */
function shapeSpacing(
  shape: SkeletonShape,
  previous: SkeletonShape | undefined,
): string | undefined {
  switch (shape.kind) {
    case SKELETON_SHAPE.HEADING:
    case SKELETON_SHAPE.STATIC:
      return undefined;
    case SKELETON_SHAPE.MASTHEAD:
      return "mt-6";
    default:
      return previous?.kind === SKELETON_SHAPE.HEADING ? undefined : "mt-3";
  }
}

/** One loading page's regions, stacked in the order the page states them. */
export function SkeletonBody({ shapes }: { shapes: readonly SkeletonShape[] }): React.JSX.Element {
  return (
    <>
      {shapes.map((shape, index) => {
        return (
          <div key={index} className={shapeSpacing(shape, shapes[index - 1])}>
            <SkeletonShapeBody shape={shape} />
          </div>
        );
      })}
    </>
  );
}
