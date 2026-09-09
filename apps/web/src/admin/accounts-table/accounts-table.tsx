import { useState } from "react";
import { accountLabel } from "../../account-initials";
import { AccountAvatar } from "../chrome/page-header";
import { formatDayTick, formatNumber } from "../format";
import { ACCOUNTS_SORT } from "../prefs";
import { accountHref, plainLeftClick } from "../routing";
import {
  ACCOUNTS_SORT_KEY,
  type AccountsDetailColumn,
  type AccountsSort,
  type AccountsSortKey,
  type AccountsTableRow,
  nextSort,
  SORT_DIRECTION,
  sortAccountsRows,
} from "./sort";

/**
 * The narrowest each surface's table may draw before its scroll wrapper takes
 * over — past this the columns crush instead of shrinking. The roster stands
 * wider because its detail and star columns join the shared set.
 */
export const ACCOUNTS_TABLE_MIN_WIDTH = {
  OVERVIEW: "min-w-[640px]",
  ROSTER: "min-w-[760px]",
} as const;

export type AccountsTableMinWidth =
  (typeof ACCOUNTS_TABLE_MIN_WIDTH)[keyof typeof ACCOUNTS_TABLE_MIN_WIDTH];

/**
 * A column heading, sortable where the surface sorts: a real button inside
 * the cell so a keyboard reaches it, `aria-sort` on the cell so a reader
 * hears the order the pointer sees drawn as the arrow. Without a sorter the
 * heading is the plain cell the overview draws.
 */
function AccountsHeader({
  label,
  sortKey,
  sort,
  onSort,
  numeric,
}: {
  label: string;
  sortKey: AccountsSortKey;
  sort: AccountsSort | undefined;
  onSort: ((key: AccountsSortKey) => void) | undefined;
  numeric?: boolean;
}): React.JSX.Element {
  const cell = `px-5 py-3 font-medium ${numeric ? "text-right" : ""}`;
  if (!onSort) return <th className={cell}>{label}</th>;
  const direction = sort?.key === sortKey ? sort.direction : undefined;
  return (
    <th className={cell} aria-sort={direction}>
      <button
        type="button"
        className="inline-flex cursor-pointer items-baseline gap-1 font-medium uppercase transition-colors duration-150 outline-offset-2 hover:text-foreground data-[sorted=true]:text-foreground"
        data-sorted={direction !== undefined}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {direction ? (
          <span aria-hidden="true">{direction === SORT_DIRECTION.ASCENDING ? "▲" : "▼"}</span>
        ) : null}
      </button>
    </th>
  );
}

function StarIcon({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.9l1.87 3.79 4.18.61-3.02 2.95.71 4.16L8 11.44l-3.74 1.97.71-4.16-3.02-2.95 4.18-.61L8 1.9z" />
    </svg>
  );
}

/**
 * One table for every account list the admin surface draws: the overview's
 * most-active accounts and the Users roster both render through it, so the
 * shared columns cannot drift apart. Every row opens the account's own page:
 * the row for the pointer, and a real anchor on the name so a keyboard
 * reaches it and a modified click still gets the browser's own gesture. What
 * belongs to one surface is opted into — the roster's star column, sortable
 * headers, and detail columns.
 */
export function AccountsTable<Row extends AccountsTableRow>({
  rows,
  windowDays,
  emptyText,
  minWidth,
  onOpen,
  detailColumns = [],
  sortable = false,
  favorite,
}: {
  rows: readonly Row[];
  windowDays: number;
  emptyText: string;
  minWidth: AccountsTableMinWidth;
  onOpen: (id: string) => void;
  detailColumns?: readonly AccountsDetailColumn<Row>[];
  /** Sorts by any header's press, remembering the order chosen. */
  sortable?: boolean;
  /** Draws the leading star column: what a row's star shows, and what its press asks. */
  favorite?: { starred: (row: Row) => boolean; onToggle: (id: string, favorite: boolean) => void };
}): React.JSX.Element {
  const [sort, setSort] = useState<AccountsSort | undefined>(
    sortable ? ACCOUNTS_SORT.read : undefined,
  );
  const toggleSort = (key: AccountsSortKey) => {
    const next = nextSort(sort, key);
    ACCOUNTS_SORT.write(next);
    setSort(next);
  };
  const onSort = sortable ? toggleSort : undefined;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }
  const sorted = sortAccountsRows(rows, sort, detailColumns, favorite?.starred);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className={`w-full ${minWidth} text-sm`}>
          <thead>
            <tr className="border-b border-border text-left font-mono text-xs text-muted-foreground uppercase">
              {favorite ? (
                <th className="w-0 py-3 pr-0 pl-5">
                  <span className="sr-only">Favorite</span>
                </th>
              ) : null}
              <AccountsHeader
                label="Account"
                sortKey={ACCOUNTS_SORT_KEY.ACCOUNT}
                sort={sort}
                onSort={onSort}
              />
              {detailColumns.map((column) => (
                <AccountsHeader
                  key={column.key}
                  label={column.label}
                  sortKey={column.key}
                  sort={sort}
                  onSort={onSort}
                  numeric
                />
              ))}
              <AccountsHeader
                label="Active days"
                sortKey={ACCOUNTS_SORT_KEY.ACTIVE_DAYS}
                sort={sort}
                onSort={onSort}
                numeric
              />
              <AccountsHeader
                label="Last active"
                sortKey={ACCOUNTS_SORT_KEY.LAST_ACTIVE}
                sort={sort}
                onSort={onSort}
                numeric
              />
              <AccountsHeader
                label="Calls"
                sortKey={ACCOUNTS_SORT_KEY.CALLS}
                sort={sort}
                onSort={onSort}
                numeric
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                className="group cursor-pointer border-b border-border transition-colors duration-150 last:border-0 hover:bg-muted"
                onClick={() => onOpen(row.id)}
              >
                {favorite ? (
                  <td className="w-0 py-3 pr-0 pl-5">
                    <button
                      type="button"
                      className="-my-2 -ml-3 flex size-11 cursor-pointer items-center justify-center text-muted-foreground opacity-60 transition-opacity duration-150 outline-offset-2 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 data-[favorite=true]:text-attention data-[favorite=true]:opacity-100"
                      data-favorite={favorite.starred(row)}
                      aria-pressed={favorite.starred(row)}
                      aria-label={`${favorite.starred(row) ? "Unfavorite" : "Favorite"} ${row.name || row.email}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        favorite.onToggle(row.id, !favorite.starred(row));
                      }}
                    >
                      <StarIcon filled={favorite.starred(row)} />
                    </button>
                  </td>
                ) : null}
                <td className="px-5 py-3">
                  <a
                    href={accountHref(row.id)}
                    className="flex items-center gap-3 outline-offset-2"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!plainLeftClick(event)) return;
                      event.preventDefault();
                      onOpen(row.id);
                    }}
                  >
                    <AccountAvatar
                      account={{ name: row.name, email: row.email, image: row.image ?? undefined }}
                    />
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {accountLabel(row)}
                        {row.admin ? (
                          <span className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] tracking-[0.2px] text-muted-foreground uppercase">
                            Admin
                          </span>
                        ) : null}
                      </div>
                      {accountLabel(row) === row.email ? null : (
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      )}
                    </div>
                  </a>
                </td>
                {detailColumns.map((column) => (
                  <td key={column.key} className="px-5 py-3 text-right tabular-nums">
                    {column.cell(row)}
                  </td>
                ))}
                <td className="px-5 py-3 text-right tabular-nums">
                  {formatNumber(row.activeDays)}
                  <span className="text-muted-foreground"> of {formatNumber(windowDays)}</span>
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {row.lastActiveDay === null ? "—" : formatDayTick(row.lastActiveDay)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatNumber(row.calls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
