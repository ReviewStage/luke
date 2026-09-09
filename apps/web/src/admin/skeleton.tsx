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
export function Skeleton({
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
export function SkeletonLine({ box, bone }: { box: string; bone: string }): React.JSX.Element {
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

export type SkeletonPlot = (typeof SKELETON_PLOT)[keyof typeof SKELETON_PLOT];

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
  SEARCH: "search",
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
  | { kind: typeof SKELETON_SHAPE.STAT_GROUP; columns: 2 | 3 }
  | { kind: typeof SKELETON_SHAPE.STAT_CARDS; count: 1 | 2 | 3 | 4; columns: 1 | 2 | 3 | 4 }
  /** One chart card, or the pair a page sets side by side. */
  | { kind: typeof SKELETON_SHAPE.CHART; plots: readonly SkeletonPlot[] }
  | { kind: typeof SKELETON_SHAPE.CALENDAR }
  | { kind: typeof SKELETON_SHAPE.RETENTION }
  | {
      kind: typeof SKELETON_SHAPE.TABLE;
      rows: number;
      numericColumns: number;
      starGutter?: boolean;
    }
  | { kind: typeof SKELETON_SHAPE.LINES; bones: readonly string[] }
  | { kind: typeof SKELETON_SHAPE.HEALTH }
  | { kind: typeof SKELETON_SHAPE.SEARCH }
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
  3: "grid grid-cols-2 gap-3 min-[720px]:grid-cols-3",
  4: "grid grid-cols-2 gap-3 min-[720px]:grid-cols-4",
} as const;

function SkeletonStatCard({ grouped }: { grouped: boolean }): React.JSX.Element {
  return (
    <div
      className={
        grouped ? "min-w-0 bg-card px-5 py-4" : "rounded-lg border border-border bg-card px-5 py-4"
      }
    >
      <SkeletonLine box="h-4" bone="h-3 w-24" />
      <div className="mt-2">
        <SkeletonLine box="h-9" bone="h-7 w-20" />
      </div>
      <div className="mt-1">
        <SkeletonLine box="h-5" bone="h-3.5 w-32" />
      </div>
    </div>
  );
}

function SkeletonChartCard({ plot }: { plot: SkeletonPlot }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <SkeletonLine box="h-4" bone="h-3 w-36" />
        <SkeletonLine box="h-4" bone="h-3 w-56" />
      </div>
      <Skeleton className={`w-full ${plot}`} />
    </div>
  );
}

/**
 * The bone block approximates the calendar grid's height: a month-label row
 * and seven day rows with the grid's own gaps.
 */
function SkeletonCalendarCard(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <SkeletonLine box="h-4" bone="h-3 w-52" />
      </div>
      <Skeleton className="h-[156px] w-full" />
      <div className="mt-4">
        <SkeletonLine box="h-4" bone="h-3 w-96 max-w-full" />
      </div>
    </div>
  );
}

function SkeletonAccountsTable({
  rows,
  numericColumns,
  starGutter,
}: {
  rows: number;
  numericColumns: number;
  starGutter: boolean;
}): React.JSX.Element {
  const columns = bones(numericColumns);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-6 border-b border-border px-5 py-3">
        {starGutter ? <div className="w-4 shrink-0" /> : null}
        <div className="min-w-0 flex-1">
          <SkeletonLine box="h-4" bone="h-3 w-16" />
        </div>
        {columns.map((column) => (
          <div key={column} className="flex w-14 shrink-0 justify-end">
            <SkeletonLine box="h-4" bone="h-3 w-10" />
          </div>
        ))}
      </div>
      {bones(rows).map((row) => (
        <div
          key={row}
          className="flex items-center gap-6 border-b border-border px-5 py-3 last:border-0"
        >
          {starGutter ? <div className="w-4 shrink-0" /> : null}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Skeleton circle className="size-8 shrink-0" />
            <div className="min-w-0">
              <SkeletonLine box="h-5" bone="h-3.5 w-36" />
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
      return <h2 className="mt-12 mb-4 text-lg font-semibold tracking-[-0.01em]">{shape.label}</h2>;
    case SKELETON_SHAPE.STAT_GROUP:
      return (
        <div
          className={`grid divide-border overflow-hidden rounded-lg border border-border bg-card ${
            shape.columns === 3
              ? "divide-y min-[720px]:grid-cols-3 min-[720px]:divide-x min-[720px]:divide-y-0"
              : "divide-y min-[520px]:grid-cols-2 min-[520px]:divide-x min-[520px]:divide-y-0"
          }`}
        >
          {bones(shape.columns).map((card) => (
            <SkeletonStatCard key={card} grouped />
          ))}
        </div>
      );
    case SKELETON_SHAPE.STAT_CARDS:
      return (
        <div className={STAT_CARDS_GRID[shape.columns]}>
          {bones(shape.count).map((card) => (
            <SkeletonStatCard key={card} grouped={false} />
          ))}
        </div>
      );
    case SKELETON_SHAPE.CHART:
      return (
        <div
          className={
            shape.plots.length > 1 ? "grid gap-3 min-[720px]:grid-cols-[1.6fr_1fr]" : undefined
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
      return (
        <SkeletonAccountsTable
          rows={shape.rows}
          numericColumns={shape.numericColumns}
          starGutter={shape.starGutter === true}
        />
      );
    case SKELETON_SHAPE.LINES:
      return (
        <>
          {shape.bones.map((bone, index) => (
            <SkeletonLine
              // biome-ignore lint/suspicious/noArrayIndexKey: a paragraph's bones are its line widths in order, and two lines may share one.
              key={index}
              box="h-5"
              bone={`h-3.5 ${bone}`}
            />
          ))}
        </>
      );
    case SKELETON_SHAPE.HEALTH:
      return (
        <div className="grid gap-3 min-[720px]:grid-cols-[1fr_1.4fr]">
          <div className="rounded-lg border border-border bg-card px-5 py-4">
            <SkeletonLine box="h-4" bone="h-3 w-20" />
            <div className="mt-2">
              <SkeletonLine box="h-7" bone="h-5 w-32" />
            </div>
            <div className="mt-1">
              <SkeletonLine box="h-5" bone="h-3.5 w-40" />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card px-5 py-4">
            <div className="mb-1">
              <SkeletonLine box="h-4" bone="h-3 w-24" />
            </div>
            {bones(5).map((row) => (
              <div
                key={row}
                className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
              >
                <SkeletonLine box="h-5" bone="h-3.5 w-48" />
                <SkeletonLine box="h-4" bone="h-3 w-24" />
              </div>
            ))}
          </div>
        </div>
      );
    case SKELETON_SHAPE.SEARCH:
      return (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Skeleton className="h-[34px] w-full max-w-[320px]" />
          <SkeletonLine box="h-4" bone="h-3 w-28" />
        </div>
      );
    case SKELETON_SHAPE.MASTHEAD:
      return (
        <div className={shape.avatar ? "flex flex-wrap items-center gap-4" : undefined}>
          {shape.avatar ? <Skeleton circle className="size-14 shrink-0" /> : null}
          <div>
            {shape.title === undefined ? null : (
              <h1 className="text-2xl font-semibold tracking-[-0.01em]">{shape.title}</h1>
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
 * so the region under it needs none; a masthead and the search row keep the
 * clearance the real pages give them; and words that draw themselves bring
 * whatever spacing they were written with.
 */
function shapeSpacing(
  shape: SkeletonShape,
  previous: SkeletonShape | undefined,
): string | undefined {
  switch (shape.kind) {
    case SKELETON_SHAPE.HEADING:
    case SKELETON_SHAPE.STATIC:
      return undefined;
    case SKELETON_SHAPE.SEARCH:
      return "mt-8";
    case SKELETON_SHAPE.MASTHEAD:
      return "mt-6";
    default:
      if (previous?.kind === SKELETON_SHAPE.HEADING) return undefined;
      // The roster's table keeps the clearance its search row is drawn with.
      return previous?.kind === SKELETON_SHAPE.SEARCH ? "mt-4" : "mt-3";
  }
}

/** One loading page's regions, stacked in the order the page states them. */
export function SkeletonBody({ shapes }: { shapes: readonly SkeletonShape[] }): React.JSX.Element {
  return (
    <>
      {shapes.map((shape, index) => {
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a region's identity is its place in the page's own order.
          <div key={index} className={shapeSpacing(shape, shapes[index - 1])}>
            <SkeletonShapeBody shape={shape} />
          </div>
        );
      })}
    </>
  );
}
