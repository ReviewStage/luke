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
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
import { usePageScroll } from "../page-frame/page-scroll.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { sizeWhileShown } from "../virtual-rows/virtual-rows.js";

export type { RowData, SortingState } from "@tanstack/react-table";

export const DATA_TABLE_COLUMN_KIND = {
  TEXT: "text",
  NUMERIC: "numeric",
  MARK: "mark",
} as const;

export type DataTableColumnKind =
  (typeof DATA_TABLE_COLUMN_KIND)[keyof typeof DATA_TABLE_COLUMN_KIND];

export const DATA_TABLE_MIN_WIDTH = {
  CONTENT: "content",
  NARROW: "narrow",
  MEDIUM: "medium",
  WIDE: "wide",
} as const;

export type DataTableMinWidth = (typeof DATA_TABLE_MIN_WIDTH)[keyof typeof DATA_TABLE_MIN_WIDTH];

export interface DataTableColumnMeta {
  kind?: DataTableColumnKind;
}

const DATA_TABLE_FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
  columnMeta: metaHelper<DataTableColumnMeta>(),
});

export type DataTableFeatures = typeof DATA_TABLE_FEATURES;

const { createAppColumnHelper, useAppTable } = createTableHook({
  features: DATA_TABLE_FEATURES,
  enableMultiSort: false,
  enableSortingRemoval: false,
});

export const createDataTableColumnHelper = createAppColumnHelper;

export type DataTableColumns<Row extends RowData> = TableOptions<DataTableFeatures, Row>["columns"];

const CELL_KIND =
  "data-[kind=numeric]:text-end data-[kind=numeric]:tabular-nums data-[kind=mark]:w-0 data-[kind=mark]:pe-0";

const TABLE_MIN_WIDTH =
  "data-[min-width=narrow]:min-w-data-table-narrow data-[min-width=medium]:min-w-data-table-medium data-[min-width=wide]:min-w-data-table-wide";

const ROW = "transition-[background-color] duration-(--ui-duration-hover) ease-plain";

const PRESSABLE_ROW = "cursor-press hover:bg-muted";

const SORT_BUTTON =
  "m-0 inline-flex items-baseline border-0 bg-transparent p-0 text-inherit [font:inherit] cursor-press outline-offset-2";

const OWN_CONTROL = "a, button, input, select, textarea, label, [role='button']";

const SKELETON_TEXT_WIDTH = "96px";

const SKELETON_FIGURE_WIDTH = "40px";

const ROW_ESTIMATE_PX = 41;

const ROW_OVERSCAN = 20;

const HEADER_ROWS = 1;

const NO_ROWS: readonly never[] = [];

const NO_SORTING: SortingState = [];

function onOwnControl(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const control = target.closest(OWN_CONTROL);
  return control !== null && event.currentTarget.contains(control);
}

function columnKind<Row extends RowData>(
  column: Header<DataTableFeatures, Row, unknown>["column"],
): DataTableColumnKind {
  return column.columnDef.meta?.kind ?? DATA_TABLE_COLUMN_KIND.TEXT;
}

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
  rowCount?: number | undefined;
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
  label: string;
  columns: DataTableColumns<Row>;
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  empty: ReactNode;
  minWidth?: DataTableMinWidth;
  initialSorting?: SortingState | undefined;
  leadingSorting?: SortingState | undefined;
  onSortingChange?: ((sorting: SortingState) => void) | undefined;
  onRowPress?: ((row: Row) => void) | undefined;
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

function DataTableSpacer({ height, columns }: { height: number; columns: number }): ReactNode {
  if (height <= 0) return null;
  return (
    <tr>
      <td colSpan={columns} className="p-0" style={{ height }} />
    </tr>
  );
}

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
  const { scroller, shiftedBy } = usePageScroll();
  const body = useRef<HTMLTableSectionElement>(null);
  const [margin, setMargin] = useState(0);
  const [, setFound] = useState(0);
  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: ROW_OVERSCAN,
    scrollMargin: margin,
    initialRect: { width: window.innerWidth, height: window.innerHeight },
    observeElementRect: sizeWhileShown,
  });
  useEffect(() => {
    const element = body.current;
    const found = scroller.current;
    if (element === null || found === null) return;
    const read = () => {
      const box = scroller.current;
      if (box === null) return;
      const at = Math.round(
        element.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop,
      );
      setMargin((was) => (was === at ? was : at));
    };
    read();
    setFound((count) => count + 1);
    if (typeof ResizeObserver === "undefined") return;
    const heard = new ResizeObserver(read);
    heard.observe(found);
    if (shiftedBy.current !== null) heard.observe(shiftedBy.current);
    return () => heard.disconnect();
  }, [scroller, shiftedBy]);
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
