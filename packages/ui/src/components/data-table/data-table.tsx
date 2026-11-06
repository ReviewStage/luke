import {
  createSortedRowModel,
  createTableHook,
  FlexRender,
  functionalUpdate,
  type Header,
  metaHelper,
  type ReactTable,
  type RowData,
  rowSortingFeature,
  type SortingState,
  sortFn_basic,
  sortFn_text,
  type TableOptions,
  type Row as TableRowModel,
  tableFeatures,
  type Updater,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type MouseEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PRESS_PULSE, pulseOnPress, pulsePress } from "../../press-pulse.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../shadcn/table.js";
import { SORT_DIRECTION } from "../../sort-direction.js";
import { CARD_PADDING, Card } from "../card/card.js";
import { Inline, JUSTIFY } from "../layout/layout.js";
import { usePageScroller } from "../page-frame/page-scroller.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * data-table.tsx -- rows of records under headings that line up their columns, sorted by TanStack Table, in a flush Card that scrolls sideways on its own.
 *
 * A table is for records a reader compares across: counts, dates, the same
 * fields on every row. A collection read one thing at a time is a `List`.
 * The table is TanStack Table's (`useAppTable`, bound below by
 * `createTableHook` to the one feature set every data table shares): its
 * caller writes the columns through `createDataTableColumnHelper`, and the
 * table builds its headings and rows from them and owns their order in
 * TanStack's sort state. A column with an accessor sorts by its heading, its
 * first press going the way `sortDescFirst` says and each later press
 * flipping it; the heading is a real button inside its cell, so a keyboard
 * reaches it, and its cell carries `aria-sort`, so a reader hears the order
 * the pointer sees drawn as the arrow.
 *
 * Every cell keeps to one line, and the frame scrolls sideways rather than
 * crushing a column: a narrow table would otherwise split a count or an email
 * mid-word. A row may open something: the pointer presses it anywhere but on
 * a control of its own cells (a link, a button), which answer for
 * themselves, so a press on a row's link is never also a press on the row.
 * A keyboard opens a row through such a link in its cells, since a table row
 * is no control. The table owns every length in it and takes no class or
 * style.
 *
 * The body draws only the rows near the view, virtualized by TanStack
 * Virtual as its docs' table example does: table rows cannot be placed
 * absolutely, so the rows drawn stand in the table's own flow between a
 * spacer row above them and one below, each as tall as the rows it stands
 * for, and the columns keep the widths their words give them. The scroller
 * is the page's (`usePageScroller`), the body counted from where it stands
 * in it (`scrollMargin`), and each row drawn is measured, so a row taller
 * than the rest is placed by what it measured. Since the rows left undrawn
 * are not there to be counted, the table tells a reader how many rows it
 * holds and each row where it stands among them (`aria-rowcount`,
 * `aria-rowindex`).
 *
 * The table is shadcn/ui's (`../../shadcn/table.tsx`), drawn in Tailwind
 * utilities over the theme.
 */

export type { RowData, SortingState } from "@tanstack/react-table";

/** What a column holds: words, figures aligned on their end, or a row's leading mark (a star, a check). */
export const DATA_TABLE_COLUMN_KIND = {
  TEXT: "text",
  NUMERIC: "numeric",
  MARK: "mark",
} as const;

export type DataTableColumnKind =
  (typeof DATA_TABLE_COLUMN_KIND)[keyof typeof DATA_TABLE_COLUMN_KIND];

/** The narrowest a table draws before its frame scrolls: its words' own width, or wider for more columns. */
export const DATA_TABLE_MIN_WIDTH = {
  CONTENT: "content",
  NARROW: "narrow",
  MEDIUM: "medium",
  WIDE: "wide",
} as const;

export type DataTableMinWidth = (typeof DATA_TABLE_MIN_WIDTH)[keyof typeof DATA_TABLE_MIN_WIDTH];

/** What a column tells the table beside TanStack's own definition: what it holds, which sets its cells' alignment. */
export interface DataTableColumnMeta {
  kind?: DataTableColumnKind;
}

/**
 * The features every data table registers: sorting, its sorted row model,
 * the comparators a column names (`text` for words, `basic` for figures and
 * ISO dates, whose text order is their order in time), and the column meta
 * above.
 */
const DATA_TABLE_FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof DATA_TABLE_FEATURES;

/**
 * The hook and column helper every data table is built with. Note that a
 * heading sorts its column alone and never clears it: a press flips the order
 * rather than dropping it, as a reader comparing records expects.
 */
const { createAppColumnHelper, useAppTable } = createTableHook({
  features: DATA_TABLE_FEATURES,
  enableMultiSort: false,
  enableSortingRemoval: false,
});

/** A data table's column helper for rows of `Row`, typed to the features the table registers. */
export const createDataTableColumnHelper = createAppColumnHelper;

/** The columns a data table of `Row` draws, as its column helper's `columns` builds them. */
export type DataTableColumns<Row extends RowData> = TableOptions<DataTableFeatures, Row>["columns"];

/** A cell's utilities by what its column holds: a figure's end-aligned in figures of one width, and a mark's as narrow as its mark, standing against the next column's words. */
const CELL_KIND =
  "data-[kind=numeric]:text-end data-[kind=numeric]:tabular-nums data-[kind=mark]:w-0 data-[kind=mark]:pe-0";

/** The widths past which more columns crush instead of shrinking. */
const TABLE_MIN_WIDTH =
  "data-[min-width=narrow]:min-w-data-table-narrow data-[min-width=medium]:min-w-data-table-medium data-[min-width=wide]:min-w-data-table-wide";

/** A row's fill eases in and out under the pointer. */
const ROW = "transition-[background-color] duration-(--ui-duration-hover) ease-plain";

/** A row that opens something: lit under the pointer, and pressed with the web's pointing hand but a Mac list's arrow on the desktop. */
const PRESSABLE_ROW = "cursor-press hover:bg-muted";

/** A sortable heading's press: its words alone, in the heading's own type and ink, its ring a little off them. */
const SORT_BUTTON =
  "m-0 inline-flex items-baseline border-0 bg-transparent p-0 text-inherit [font:inherit] cursor-press outline-offset-2";

/** The elements a press inside a row answers for itself. */
const OWN_CONTROL = "a, button, input, select, textarea, label, [role='button']";

/** A text cell's bone, about a short name's width. */
const SKELETON_TEXT_WIDTH = "96px";

/** A figure's bone, about a count's or a date's width. */
const SKELETON_FIGURE_WIDTH = "40px";

/** The height a body row is taken to have before it is measured, in pixels: one line of words in its cell's padding. */
const ROW_ESTIMATE_PX = 41;

/** How many rows past each edge of the view are drawn, as the docs' table example draws them. */
const ROW_OVERSCAN = 20;

/** The header's row, which comes before the body's in a reader's count. */
const HEADER_ROWS = 1;

/** A skeleton's table, which has no rows yet. */
const NO_ROWS: readonly never[] = [];

/** No sort: the rows keep the order handed in. */
const NO_SORTING: SortingState = [];

/** Whether `event` landed on a control inside the row rather than on the row itself. */
function onOwnControl(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const control = target.closest(OWN_CONTROL);
  return control !== null && event.currentTarget.contains(control);
}

/** What a column holds, plain words where its definition says nothing. */
function columnKind<Row extends RowData>(
  column: Header<DataTableFeatures, Row, unknown>["column"],
): DataTableColumnKind {
  return column.columnDef.meta?.kind ?? DATA_TABLE_COLUMN_KIND.TEXT;
}

/** A column's heading: a button where its column sorts, its cell saying the order chosen. */
function DataTableHeading<Row extends RowData>({
  header,
}: {
  header: Header<DataTableFeatures, Row, unknown>;
}): React.JSX.Element {
  const kind = columnKind(header.column);
  if (kind === DATA_TABLE_COLUMN_KIND.MARK) {
    return (
      <TableHead className={CELL_KIND} data-kind={kind}>
        <span className="ui-visually-hidden">
          <FlexRender header={header} />
        </span>
      </TableHead>
    );
  }
  const sorted = header.column.getIsSorted();
  const direction =
    sorted === false
      ? undefined
      : sorted === "asc"
        ? SORT_DIRECTION.ASCENDING
        : SORT_DIRECTION.DESCENDING;
  if (!header.column.getCanSort()) {
    return (
      <TableHead className={CELL_KIND} data-kind={kind} aria-sort={direction}>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
          <FlexRender header={header} />
        </Text>
      </TableHead>
    );
  }
  return (
    <TableHead className={CELL_KIND} data-kind={kind} aria-sort={direction}>
      <button
        type="button"
        className={SORT_BUTTON}
        onClick={pulseOnPress(header.column.getToggleSortingHandler())}
      >
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.LABEL}
          tone={direction === undefined ? TEXT_TONE.MUTED : TEXT_TONE.DEFAULT}
        >
          <FlexRender header={header} />
          {direction ? (
            <span aria-hidden="true">{direction === SORT_DIRECTION.ASCENDING ? " ▲" : " ▼"}</span>
          ) : null}
        </Text>
      </button>
    </TableHead>
  );
}

/**
 * The frame both a table and its skeleton draw in: the flush card, the
 * table named by `label`, its headings from `table`'s header groups, and
 * `children` as its body.
 */
function DataTableFrame<Row extends RowData>({
  table,
  label,
  minWidth,
  rowCount,
  children,
}: {
  table: ReactTable<DataTableFeatures, Row>;
  label: string;
  minWidth: DataTableMinWidth;
  /** How many rows the table holds, its headings' among them, where it draws only some. */
  rowCount?: number | undefined;
  /** The table's body. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card padding={CARD_PADDING.FLUSH}>
      <Table
        className={TABLE_MIN_WIDTH}
        aria-label={label}
        aria-rowcount={rowCount}
        data-min-width={minWidth}
      >
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow
              key={group.id}
              aria-rowindex={rowCount === undefined ? undefined : HEADER_ROWS}
            >
              {group.headers.map((header) => (
                <DataTableHeading key={header.id} header={header} />
              ))}
            </TableRow>
          ))}
        </TableHeader>
        {children}
      </Table>
    </Card>
  );
}

/** A body cell's utilities and kind, the same for a loaded cell and its bone. */
function DataTableCell({
  kind,
  children,
}: {
  kind: DataTableColumnKind;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <TableCell className={CELL_KIND} data-kind={kind}>
      {children}
    </TableCell>
  );
}

/**
 * `rows` under `columns`' headings, named by `label`, in the order the
 * table's sort state puts them; `empty` in the frame in place of the table
 * where there are no rows.
 *
 * The table starts in `initialSorting` and owns its sort from there, telling
 * `onSortingChange` each order a heading's press chooses. `leadingSorting`
 * orders the rows before that choice and no heading changes it: a roster's
 * starred accounts standing above the rest, each tier in the order chosen.
 * Keep `columns`, `rows`, and `leadingSorting` stable between renders, as
 * TanStack Table asks, so the rows are sorted only when one of them changes.
 */
export function DataTable<Row extends RowData>({
  label,
  columns,
  rows,
  getRowId,
  empty,
  minWidth = DATA_TABLE_MIN_WIDTH.CONTENT,
  initialSorting = NO_SORTING,
  leadingSorting = NO_SORTING,
  onSortingChange,
  onRowPress,
  rowPressable,
}: {
  /** What the table holds, for a reader moving between tables. */
  label: string;
  columns: DataTableColumns<Row>;
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** The line the frame shows when there are no rows. */
  empty: ReactNode;
  minWidth?: DataTableMinWidth;
  /** The order the rows are first drawn in. */
  initialSorting?: SortingState | undefined;
  /** The order that stands before the one chosen, which no heading's press changes. */
  leadingSorting?: SortingState | undefined;
  /** Hears each order a heading's press chooses, `leadingSorting` left out. */
  onSortingChange?: ((sorting: SortingState) => void) | undefined;
  /** A press on a row outside its cells' own controls. */
  onRowPress?: ((row: Row) => void) | undefined;
  /** Whether a row takes `onRowPress`, where some rows have nothing to open; every row does where left out. */
  rowPressable?: ((row: Row) => boolean) | undefined;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<SortingState>(initialSorting);
  const sorting = useMemo(() => [...leadingSorting, ...chosen], [leadingSorting, chosen]);
  const table = useAppTable({
    columns,
    data: rows,
    getRowId,
    state: { sorting },
    onSortingChange: (updater: Updater<SortingState>) => {
      // Note that a press replaces the whole state, so the leading order is
      // taken back out and stays the caller's alone.
      const next = functionalUpdate(updater, sorting).filter(
        (sort) => !leadingSorting.some((leading) => leading.id === sort.id),
      );
      setChosen(next);
      onSortingChange?.(next);
    },
  });
  if (rows.length === 0) {
    return (
      <Card>
        <div className="py-data-table-cell-block text-center">
          <Text tone={TEXT_TONE.MUTED}>{empty}</Text>
        </div>
      </Card>
    );
  }
  const { rows: drawn } = table.getRowModel();
  return (
    <DataTableFrame
      table={table}
      label={label}
      minWidth={minWidth}
      rowCount={HEADER_ROWS + drawn.length}
    >
      <DataTableBody
        table={table}
        rows={drawn}
        onRowPress={onRowPress}
        rowPressable={rowPressable}
      />
    </DataTableFrame>
  );
}

/** A spacer row standing for the rows left undrawn above or below the view, as tall as they would stand. */
function DataTableSpacer({ height, columns }: { height: number; columns: number }): ReactNode {
  if (height <= 0) return null;
  return (
    <tr>
      <td colSpan={columns} className="p-0" style={{ height }} />
    </tr>
  );
}

/**
 * The body of `rows`, drawing those near the view between two spacer rows,
 * as TanStack Virtual's table example does. Note that the virtualizer lives
 * here rather than in `DataTable`, because each scroll draws again only the
 * component holding it, as TanStack Table's virtualized rows example asks.
 */
function DataTableBody<Row extends RowData>({
  table,
  rows,
  onRowPress,
  rowPressable,
}: {
  table: ReactTable<DataTableFeatures, Row>;
  rows: readonly TableRowModel<DataTableFeatures, Row>[];
  onRowPress: ((row: Row) => void) | undefined;
  rowPressable: ((row: Row) => boolean) | undefined;
}): React.JSX.Element {
  const scroller = usePageScroller();
  const body = useRef<HTMLTableSectionElement>(null);
  const [margin, setMargin] = useState(0);
  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: scroller,
    estimateSize: () => ROW_ESTIMATE_PX,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: ROW_OVERSCAN,
    scrollMargin: margin,
    // Note that the view is taken to be the window's before the scroller is measured, which no view of it outgrows, so a table outside any page, as the catalog draws one, still draws a window's rows.
    initialRect: { width: window.innerWidth, height: window.innerHeight },
  });
  // The body stands below whatever the page draws above it in the scroller, read again as the scroller or what it holds is sized anew.
  useLayoutEffect(() => {
    const box = scroller();
    const element = body.current;
    if (box === null || element === null) return;
    const read = () => {
      const at = Math.round(
        element.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop,
      );
      setMargin((was) => (was === at ? was : at));
    };
    read();
    const heard = new ResizeObserver(read);
    heard.observe(box);
    for (const child of box.children) heard.observe(child);
    return () => heard.disconnect();
  }, [scroller]);
  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items.at(-1);
  const columns = table.getAllLeafColumns().length;
  const above = first === undefined ? 0 : first.start - margin;
  const below = last === undefined ? 0 : virtualizer.getTotalSize() - (last.end - margin);
  return (
    <TableBody ref={body} className="[overflow-anchor:none]">
      <DataTableSpacer height={above} columns={columns} />
      {items.map((item) => {
        const row = rows[item.index];
        if (row === undefined) return null;
        const press = onRowPress && (rowPressable?.(row.original) ?? true) ? onRowPress : undefined;
        return (
          <TableRow
            key={row.id}
            ref={virtualizer.measureElement}
            data-index={item.index}
            aria-rowindex={HEADER_ROWS + item.index + 1}
            className={press ? `${ROW} ${PRESSABLE_ROW}` : ROW}
            data-pressable={press ? "true" : undefined}
            onClick={
              press
                ? (event) => {
                    if (onOwnControl(event)) return;
                    // Note that a row runs the card's width, so its press leaves its fill and rule standing.
                    pulsePress(event.currentTarget, PRESS_PULSE.FLUSH);
                    press(row.original);
                  }
                : undefined
            }
          >
            {row.getAllCells().map((cell) => (
              <DataTableCell key={cell.id} kind={columnKind(cell.column)}>
                <table.FlexRender cell={cell} />
              </DataTableCell>
            ))}
          </TableRow>
        );
      })}
      <DataTableSpacer height={below} columns={columns} />
    </TableBody>
  );
}

/** A cell's bone by its column's kind: a line of words, a figure at the cell's end, or a mark. */
function DataTableCellSkeleton({ kind }: { kind: DataTableColumnKind }): React.JSX.Element {
  switch (kind) {
    case DATA_TABLE_COLUMN_KIND.NUMERIC:
      return (
        <Inline justify={JUSTIFY.END}>
          <Skeleton width={SKELETON_FIGURE_WIDTH} />
        </Inline>
      );
    case DATA_TABLE_COLUMN_KIND.MARK:
      return <Skeleton shape={SKELETON_SHAPE.CIRCLE} />;
    default:
      return <Skeleton width={SKELETON_TEXT_WIDTH} />;
  }
}

/**
 * `rows` rows of the table the loaded page draws, built by TanStack Table
 * from the same `columns` with no data and no sort: its headings as
 * themselves, and each cell a bone in its column's kind, or the skeleton
 * `cells` gives the column of that id whose cell is a shape of its own (an
 * account's avatar and two lines), so every row stands as tall as the row
 * that replaces it.
 */
export function DataTableSkeleton<Row extends RowData>({
  label,
  columns,
  rows,
  minWidth,
  cells = {},
}: {
  label: string;
  columns: DataTableColumns<Row>;
  rows: number;
  minWidth: DataTableMinWidth;
  cells?: Readonly<Record<string, ReactNode>>;
}): React.JSX.Element {
  const table = useAppTable({ columns, data: NO_ROWS, enableSorting: false });
  return (
    <DataTableFrame table={table} label={label} minWidth={minWidth}>
      <TableBody>
        {Array.from({ length: rows }, (_, row) => (
          <TableRow key={row} className={ROW}>
            {table.getAllLeafColumns().map((column) => (
              <DataTableCell key={column.id} kind={columnKind(column)}>
                {cells[column.id] ?? <DataTableCellSkeleton kind={columnKind(column)} />}
              </DataTableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </DataTableFrame>
  );
}
