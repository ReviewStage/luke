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
  AdminSection,
  CARD_GAP,
  MetricCardSkeleton,
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
 * tables' ten (`ADMIN_RETENTION_WEEKS` and `ADMIN_OVERVIEW_ACCOUNTS_LIMIT`, not
 * imported because the modules exporting them carry query code the client
 * bundle must not), and a table cell's padding (`data-table.css`) around a
 * `size-8` avatar. A heading opens a section that holds every shape after it
 * up to the next, as the loaded page's sections hold theirs. Static
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

/** The retention basis picker's bone, about its two segments' width. */
const RETENTION_PICKER_WIDTH = "260px";

/** The small avatar's bone, the size of a table row's avatar. */
const AVATAR_BONE = { small: "32px", large: "56px" } as const;

/** Each plot height is its chart's own fixed height, so the bars land where the bone stood. */
export const SKELETON_PLOT = {
  USAGE: "h-48",
  ACTIVITY: "h-60",
  /** The funnel's and reach's seven rows of share bars. */
  SHARE_BARS: "h-50",
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
export const CHART_PAIR_EVEN = `grid ${CARD_GAP} min-[720px]:grid-cols-2`;

/** A wide chart card beside a narrow one, as the Overview's funnel and reach stand. */
export const CHART_PAIR_WIDE = `grid ${CARD_GAP} min-[720px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]`;

const STAT_CARDS_GRID = {
  1: `grid ${CARD_GAP}`,
  2: `grid grid-cols-2 ${CARD_GAP}`,
} as const;

/** A table's row of bones, ruled and padded as a `DataTable` cell is (`data-table.css`). */
const TABLE_ROW_BONES =
  "flex items-center gap-(--luke-space-24) border-b border-(--luke-color-border) px-(--luke-space-20) py-(--luke-space-12)";

/**
 * The bar charts and the share bars carry a caption across from their
 * heading; the failure rates and the activity chart carry a legend under the plot.
 */
function SkeletonChartCard({ plot }: { plot: SkeletonPlot }): React.JSX.Element {
  const captioned =
    plot === SKELETON_PLOT.USAGE ||
    plot === SKELETON_PLOT.SIGNUPS ||
    plot === SKELETON_PLOT.ACTIVITY ||
    plot === SKELETON_PLOT.SHARE_BARS;
  return (
    <ChartFrameSkeleton
      aside={captioned}
      legend={plot === SKELETON_PLOT.FAILURE_RATES || plot === SKELETON_PLOT.ACTIVITY}
      plot={plot}
    />
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
      <div className={TABLE_ROW_BONES}>
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
        <div key={row} className={`${TABLE_ROW_BONES} last:border-0`}>
          <div className="flex min-w-0 flex-1 items-center gap-(--luke-space-12)">
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

/** A shape that stands in a section, every one but the heading that opens it. */
type SkeletonPart = Exclude<SkeletonShape, { kind: typeof SKELETON_SHAPE.HEADING }>;

function SkeletonShapeBody({ shape }: { shape: SkeletonPart }): React.JSX.Element {
  switch (shape.kind) {
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
            shape.plots.length > 1 ? (shape.even ? CHART_PAIR_EVEN : CHART_PAIR_WIDE) : undefined
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
      // Note that the grid's basis picker stands over it, so its bone does too.
      return (
        <>
          <div>
            <Bone shape={BONE_SHAPE.CONTROL} width={RETENTION_PICKER_WIDTH} />
          </div>
          <Card>
            <div className="grid gap-(--luke-space-4)">
              <SkeletonLine variant={TEXT_VARIANT.CAPTION} width="100%" />
              {bones(8).map((row) => (
                <div key={row} className="h-9">
                  <Bone shape={BONE_SHAPE.BLOCK} />
                </div>
              ))}
            </div>
          </Card>
        </>
      );
    case SKELETON_SHAPE.TABLE:
      return <SkeletonAccountsTable rows={shape.rows} numericColumns={shape.numericColumns} />;
    case SKELETON_SHAPE.LINES:
      return (
        <div>
          {shape.bones.map((width, index) => (
            <SkeletonLine key={index} variant={TEXT_VARIANT.BODY} width={width} />
          ))}
        </div>
      );
    case SKELETON_SHAPE.HEALTH:
      return (
        <div className={`grid ${CARD_GAP} min-[720px]:grid-cols-[1fr_1.4fr]`}>
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

/** One section of a loading page: its heading, where it has one, and the shapes under it. */
interface SkeletonSection {
  heading: string | undefined;
  shapes: SkeletonPart[];
}

/**
 * The shapes, each heading opening a section that holds what follows it up
 * to the next; what stands before the first heading leads the page as a
 * section of no heading, as an account's masthead or a page's note does.
 */
function skeletonSections(shapes: readonly SkeletonShape[]): SkeletonSection[] {
  const sections: SkeletonSection[] = [];
  for (const shape of shapes) {
    if (shape.kind === SKELETON_SHAPE.HEADING) {
      sections.push({ heading: shape.label, shapes: [] });
      continue;
    }
    const last = sections.at(-1);
    if (last === undefined) sections.push({ heading: undefined, shapes: [shape] });
    else last.shapes.push(shape);
  }
  return sections;
}

/**
 * One loading page's sections, stacked in the order the page states them, a
 * section's gap apart as the loaded page's are (`Refreshing`), so the first
 * opens where the page's content does, under the toolbar.
 */
export function SkeletonBody({ shapes }: { shapes: readonly SkeletonShape[] }): React.JSX.Element {
  return (
    <Stack gap={GAP.SECTION}>
      {skeletonSections(shapes).map((section, index) => (
        <AdminSection key={index} title={section.heading}>
          {section.shapes.map((shape, at) => (
            <SkeletonShapeBody key={at} shape={shape} />
          ))}
        </AdminSection>
      ))}
    </Stack>
  );
}
