import type { MouseEvent, ReactNode } from "react";
import { SORT_DIRECTION, type SortDirection } from "../../sort-direction.js";
import { CARD_PADDING, Card } from "../card/card.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * data-table.tsx -- rows of records under headings that line up their columns, sortable where the caller sorts, in a flush Card that scrolls sideways on its own.
 *
 * A table is for records a reader compares across: counts, dates, the same
 * fields on every row. A collection read one thing at a time is a `List`.
 * The table draws its rows in the order handed to it; sorting is the
 * caller's, which owns the order and hears a sortable heading's press. That
 * heading is a real button inside its cell, so a keyboard reaches it, and its
 * cell carries `aria-sort`, so a reader hears the order the pointer sees
 * drawn as the arrow.
 *
 * Every cell keeps to one line, and the frame scrolls sideways rather than
 * crushing a column: a narrow table would otherwise split a count or an email
 * mid-word. A row may open something: the pointer presses it anywhere but on
 * a control of its own cells (a link, a button), which answer for
 * themselves, so a press on a row's link is never also a press on the row.
 * A keyboard opens a row through such a link in its cells, since a table row
 * is no control. The table owns every length in it and takes no class or
 * style.
 */

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

/** The order a table's rows are drawn in: by one column, one way. */
export interface DataTableSort<Key extends string> {
  key: Key;
  direction: SortDirection;
}

/** One column: its heading, what it holds, and the cell it draws for a row. */
export interface DataTableColumn<Row, Key extends string = string> {
  key: Key;
  /** The heading's words; a mark column's are read and not drawn. */
  label: string;
  kind?: DataTableColumnKind;
  /** Whether the heading sorts, where the table hears `onSort`. */
  sortable?: boolean;
  cell: (row: Row) => ReactNode;
}

/** The elements a press inside a row answers for itself. */
const OWN_CONTROL = "a, button, input, select, textarea, label, [role='button']";

/** Whether `event` landed on a control inside the row rather than on the row itself. */
function onOwnControl(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const control = target.closest(OWN_CONTROL);
  return control !== null && event.currentTarget.contains(control);
}

/** A column's heading: a button where it sorts, its cell saying the order chosen. */
function DataTableHeading<Row, Key extends string>({
  column,
  sort,
  onSort,
}: {
  column: DataTableColumn<Row, Key>;
  sort: DataTableSort<Key> | undefined;
  onSort: ((key: Key) => void) | undefined;
}): React.JSX.Element {
  const kind = column.kind ?? DATA_TABLE_COLUMN_KIND.TEXT;
  if (kind === DATA_TABLE_COLUMN_KIND.MARK) {
    return (
      <th className="luke-data-table-cell" data-kind={kind}>
        <span className="luke-visually-hidden">{column.label}</span>
      </th>
    );
  }
  const direction = sort?.key === column.key ? sort.direction : undefined;
  if (!onSort || column.sortable !== true) {
    return (
      <th className="luke-data-table-cell" data-kind={kind} aria-sort={direction}>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
          {column.label}
        </Text>
      </th>
    );
  }
  return (
    <th className="luke-data-table-cell" data-kind={kind} aria-sort={direction}>
      <button type="button" className="luke-data-table-sort" onClick={() => onSort(column.key)}>
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.LABEL}
          tone={direction === undefined ? TEXT_TONE.MUTED : TEXT_TONE.DEFAULT}
        >
          {column.label}
          {direction ? (
            <span aria-hidden="true">{direction === SORT_DIRECTION.ASCENDING ? " ▲" : " ▼"}</span>
          ) : null}
        </Text>
      </button>
    </th>
  );
}

/**
 * `rows` under `columns`' headings, named by `label`, in the order given;
 * `empty` in the frame in place of the table where there are no rows.
 */
export function DataTable<Row, Key extends string = string>({
  label,
  columns,
  rows,
  rowKey,
  empty,
  minWidth = DATA_TABLE_MIN_WIDTH.CONTENT,
  sort,
  onSort,
  onRowPress,
  rowPressable,
}: {
  /** What the table holds, for a reader moving between tables. */
  label: string;
  columns: readonly DataTableColumn<Row, Key>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** The line the frame shows when there are no rows. */
  empty: ReactNode;
  minWidth?: DataTableMinWidth;
  /** The order `rows` are in, announced on its column's heading. */
  sort?: DataTableSort<Key> | undefined;
  /** A sortable heading's press; without one no heading sorts. */
  onSort?: ((key: Key) => void) | undefined;
  /** A press on a row outside its cells' own controls. */
  onRowPress?: ((row: Row) => void) | undefined;
  /** Whether a row takes `onRowPress`, where some rows have nothing to open; every row does where left out. */
  rowPressable?: ((row: Row) => boolean) | undefined;
}): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <Card>
        <div className="luke-data-table-empty">
          <Text tone={TEXT_TONE.MUTED}>{empty}</Text>
        </div>
      </Card>
    );
  }
  return (
    <Card padding={CARD_PADDING.FLUSH}>
      <div className="luke-data-table-scroller">
        <table className="luke-data-table-table" aria-label={label} data-min-width={minWidth}>
          <thead>
            <tr>
              {columns.map((column) => (
                <DataTableHeading key={column.key} column={column} sort={sort} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const press = onRowPress && (rowPressable?.(row) ?? true) ? onRowPress : undefined;
              return (
                <tr
                  key={rowKey(row)}
                  className="luke-data-table-row"
                  data-pressable={press ? "true" : undefined}
                  onClick={
                    press
                      ? (event) => {
                          if (!onOwnControl(event)) press(row);
                        }
                      : undefined
                  }
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className="luke-data-table-cell"
                      data-kind={column.kind ?? DATA_TABLE_COLUMN_KIND.TEXT}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
