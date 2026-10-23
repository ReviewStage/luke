/**
 * table-skeleton.tsx -- a table while its rows are read, drawn through the loaded table's own columns.
 */

import {
  DATA_TABLE_COLUMN_KIND,
  DataTable,
  type DataTableColumn,
  type DataTableMinWidth,
  Inline,
  JUSTIFY,
  SKELETON_SHAPE,
  Skeleton,
} from "@luke/ui";

/** A text cell's bone, about a short name's width. */
const SKELETON_TEXT_WIDTH = "96px";

/** A figure's bone, about a count's or a date's width. */
const SKELETON_FIGURE_WIDTH = "40px";

/** A cell's bone by its column's kind: a line of words, a figure at the cell's end, or a mark. */
function CellSkeleton({ kind }: { kind: DataTableColumn<unknown>["kind"] }): React.JSX.Element {
  switch (kind ?? DATA_TABLE_COLUMN_KIND.TEXT) {
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
 * `rows` rows of the table the loaded page draws, through the same
 * `DataTable` and the same `columns`: its headings as themselves and each
 * cell a bone in its column's kind, or the skeleton `cells` gives a column
 * whose cell is a shape of its own (an account's avatar and two lines), so
 * every row stands as tall as the row that replaces it.
 */
export function DataTableSkeleton<Row, Key extends string>({
  label,
  columns,
  rows,
  minWidth,
  cells = {},
}: {
  label: string;
  columns: readonly DataTableColumn<Row, Key>[];
  rows: number;
  minWidth: DataTableMinWidth;
  cells?: Partial<Record<Key, React.ReactNode>>;
}): React.JSX.Element {
  const boned = columns.map(
    (column): DataTableColumn<number, Key> => ({
      ...column,
      cell: () => cells[column.key] ?? <CellSkeleton kind={column.kind} />,
    }),
  );
  return (
    <DataTable
      label={label}
      columns={boned}
      rows={Array.from({ length: rows }, (_, row) => row)}
      rowKey={String}
      empty=""
      minWidth={minWidth}
    />
  );
}
