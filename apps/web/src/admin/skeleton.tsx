import { Skeleton as LineBone, TEXT_ELEMENT, TEXT_VARIANT, Text } from "@luke/ui";
import { ChartFrameSkeleton } from "./charts/chart-frame";
import {
  METRIC_STATUS,
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
function Skeleton({
  className,
  circle = false,
}: {
  className: string;
  circle?: boolean;
}): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`${circle ? "rounded-full" : "rounded-md"} animate-pulse bg-muted motion-reduce:animate-none ${className}`}
    />
  );
}

/** A bone boxed to the height of the text line it stands for, so the swap to words moves nothing. */
function SkeletonLine({ box, bone }: { box: string; bone: string }): React.JSX.Element {
  return (
    <div className={`flex items-center ${box}`}>
      <Skeleton className={bone} />
    </div>
  );
}

/** Each plot height is its chart's own fixed height, so the bars land where the bone stood. */
export const SKELETON_PLOT = {
  USAGE: "h-48",
  SIGNUPS: "h-40",
  SIGN_IN_METHODS: "h-[120px]",
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

/** A bone standing in for one line of text: the box it holds, and the bone in it. */
interface SkeletonTextLine {
  box: string;
  bone: string;
}

/** One region of a loading page, in the order the page stacks them. */
export type SkeletonShape =
  | { kind: typeof SKELETON_SHAPE.HEADING; label: string }
  | { kind: typeof SKELETON_SHAPE.STAT_GROUP }
  | { kind: typeof SKELETON_SHAPE.STAT_CARDS; count: 1 | 2 | 4; columns: 1 | 2 | 4 }
  /** One chart card, or the pair a page sets side by side. */
  | { kind: typeof SKELETON_SHAPE.CHART; plots: readonly SkeletonPlot[] }
  | { kind: typeof SKELETON_SHAPE.CALENDAR }
  | { kind: typeof SKELETON_SHAPE.RETENTION }
  | {
      kind: typeof SKELETON_SHAPE.TABLE;
      rows: number;
      numericColumns: number;
    }
  | { kind: typeof SKELETON_SHAPE.LINES; bones: readonly string[] }
  | { kind: typeof SKELETON_SHAPE.HEALTH }
  | {
      kind: typeof SKELETON_SHAPE.MASTHEAD;
      avatar?: boolean;
      title?: string;
      lines: readonly SkeletonTextLine[];
    }
  /** Words the page knows without reading anything, drawn as themselves. */
  | { kind: typeof SKELETON_SHAPE.STATIC; node: React.ReactNode };

function bones(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}

const STAT_CARDS_GRID = {
  1: "grid gap-3",
  2: "grid grid-cols-2 gap-3",
} as const;

/** Only the sign-in methods chart has no trend across from its heading. */
function SkeletonChartCard({ plot }: { plot: SkeletonPlot }): React.JSX.Element {
  return (
    <ChartFrameSkeleton aside={plot !== SKELETON_PLOT.SIGN_IN_METHODS} legend={false} plot={plot} />
  );
}

/**
 * The bone block approximates the calendar grid's height: a month-label row
 * and seven day rows with the grid's own gaps.
 */
function SkeletonCalendarCard(): React.JSX.Element {
  return <ChartFrameSkeleton aside={false} legend plot="h-[156px]" />;
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
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-6 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <SkeletonLine box="h-[18px]" bone="h-3 w-16" />
        </div>
        {columns.map((column) => (
          <div key={column} className="flex w-14 shrink-0 justify-end">
            <SkeletonLine box="h-[18px]" bone="h-3 w-10" />
          </div>
        ))}
      </div>
      {bones(rows).map((row) => (
        <div
          key={row}
          className="flex items-center gap-6 border-b border-border px-5 py-3 last:border-0"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Skeleton circle className="size-8 shrink-0" />
            <div className="min-w-0">
              <SkeletonLine box="h-[18px]" bone="h-3.5 w-36" />
              <SkeletonLine box="h-4" bone="h-3 w-44" />
            </div>
          </div>
          {columns.map((column) => (
            <div key={column} className="flex w-14 shrink-0 justify-end">
              <SkeletonLine box="h-5" bone="h-3.5 w-10" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonShapeBody({ shape }: { shape: SkeletonShape }): React.JSX.Element {
  switch (shape.kind) {
    case SKELETON_SHAPE.HEADING:
      return <SectionHeading>{shape.label}</SectionHeading>;
    case SKELETON_SHAPE.STAT_GROUP:
      return (
        <StatGroup>
          {bones(STAT_GROUP_COLUMNS).map((card) => (
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
              ? "grid gap-3 min-[720px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
              : undefined
          }
        >
          {shape.plots.map((plot) => (
            <SkeletonChartCard key={plot} plot={plot} />
          ))}
        </div>
      );
    case SKELETON_SHAPE.CALENDAR:
      return <SkeletonCalendarCard />;
    case SKELETON_SHAPE.RETENTION:
      return (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="grid gap-1">
            <SkeletonLine box="h-4" bone="h-3 w-full" />
            {bones(8).map((row) => (
              <Skeleton key={row} className="h-9 w-full" />
            ))}
          </div>
        </div>
      );
    case SKELETON_SHAPE.TABLE:
      return <SkeletonAccountsTable rows={shape.rows} numericColumns={shape.numericColumns} />;
    case SKELETON_SHAPE.LINES:
      return (
        <>
          {shape.bones.map((bone, index) => (
            <SkeletonLine key={index} box="h-5" bone={`h-3.5 ${bone}`} />
          ))}
        </>
      );
    case SKELETON_SHAPE.HEALTH:
      return (
        <div className="grid gap-3 min-[720px]:grid-cols-[1fr_1.4fr]">
          <MetricCardSkeleton>
            <div className={METRIC_STATUS}>
              <LineBone width="128px" />
            </div>
          </MetricCardSkeleton>
          <MetricCardSkeleton hint={false}>
            <div>
              {bones(5).map((row) => (
                <div key={row} className="border-b border-border py-3 last:border-0">
                  {/* Note that the tracks start at zero, so the bones give way in a
                  narrow card rather than holding it wider than its column. */}
                  <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)] items-center gap-4">
                    <Text as={TEXT_ELEMENT.DIV}>
                      <LineBone width="192px" />
                    </Text>
                    <div className="flex justify-end">
                      <Text as={TEXT_ELEMENT.DIV}>
                        <LineBone width="96px" />
                      </Text>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </MetricCardSkeleton>
        </div>
      );
    case SKELETON_SHAPE.MASTHEAD:
      return (
        <div className={shape.avatar ? "flex flex-wrap items-center gap-4" : undefined}>
          {shape.avatar ? <Skeleton circle className="size-14 shrink-0" /> : null}
          <div>
            {shape.title === undefined ? null : (
              <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TITLE}>
                {shape.title}
              </Text>
            )}
            {shape.lines.map((line, index) => (
              <div
                key={line.bone}
                className={shape.title !== undefined || index > 0 ? "mt-1" : undefined}
              >
                <SkeletonLine box={line.box} bone={line.bone} />
              </div>
            ))}
          </div>
        </div>
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
