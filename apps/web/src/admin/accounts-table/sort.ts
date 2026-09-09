import { accountLabel } from "../../account-initials";

/**
 * The account fields both admin tables' rows carry — the shared columns'
 * whole vocabulary, so a row from either endpoint draws through the one
 * `AccountsTable`.
 */
export interface AccountsTableRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  activeDays: number;
  lastActiveDay: string | null;
  calls: number;
}

/** The sortable columns, one per header the roster draws. */
export const ACCOUNTS_SORT_KEY = {
  ACCOUNT: "account",
  JOINED: "joined",
  LAST_SEEN: "lastSeen",
  ACTIVE_DAYS: "activeDays",
  LAST_ACTIVE: "lastActive",
  CALLS: "calls",
} as const;

export type AccountsSortKey = (typeof ACCOUNTS_SORT_KEY)[keyof typeof ACCOUNTS_SORT_KEY];

/** The values `aria-sort` takes, so the state is the announcement. */
export const SORT_DIRECTION = {
  ASCENDING: "ascending",
  DESCENDING: "descending",
} as const;

export type SortDirection = (typeof SORT_DIRECTION)[keyof typeof SORT_DIRECTION];

/** A column's first press: names read forward, counts and dates largest first. */
export const ACCOUNTS_SORT_FIRST_DIRECTION = {
  [ACCOUNTS_SORT_KEY.ACCOUNT]: SORT_DIRECTION.ASCENDING,
  [ACCOUNTS_SORT_KEY.JOINED]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.LAST_SEEN]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.ACTIVE_DAYS]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.LAST_ACTIVE]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.CALLS]: SORT_DIRECTION.DESCENDING,
} satisfies Record<AccountsSortKey, SortDirection>;

/**
 * What each shared column orders by. An account sorts by the name its row
 * shows — falling back to the email exactly as the cell does — and a
 * last-active day is an ISO date, so its lexicographic order is its
 * chronological one. A detail column's ordering rides the column itself,
 * because its fields exist only on the rows of the surface that draws it.
 */
const SHARED_SORT_VALUE = new Map<
  AccountsSortKey,
  (row: AccountsTableRow) => string | number | null
>([
  [ACCOUNTS_SORT_KEY.ACCOUNT, (row) => accountLabel(row).toLowerCase()],
  [ACCOUNTS_SORT_KEY.ACTIVE_DAYS, (row) => row.activeDays],
  [ACCOUNTS_SORT_KEY.LAST_ACTIVE, (row) => row.lastActiveDay],
  [ACCOUNTS_SORT_KEY.CALLS, (row) => row.calls],
]);

/**
 * A column one surface adds between Account and the usage counts — the
 * roster's Joined and Last seen. It carries its own cell and ordering because
 * its fields exist only on that surface's rows; the shared columns are fixed
 * in the table itself.
 */
export interface AccountsDetailColumn<Row> {
  key: AccountsSortKey;
  label: string;
  cell: (row: Row) => React.ReactNode;
  sortValue: (row: Row) => string | number | null;
}

export interface AccountsSort {
  key: AccountsSortKey;
  direction: SortDirection;
}

/** Where a header's press takes the order: its own first direction, then the flip. */
export function nextSort(current: AccountsSort | undefined, key: AccountsSortKey): AccountsSort {
  if (current?.key !== key) return { key, direction: ACCOUNTS_SORT_FIRST_DIRECTION[key] };
  return {
    key,
    direction:
      current.direction === SORT_DIRECTION.ASCENDING
        ? SORT_DIRECTION.DESCENDING
        : SORT_DIRECTION.ASCENDING,
  };
}

/**
 * Orders the rows for one sort. Starred rows stand above everything first —
 * the star marks the accounts the admin actually watches, so no column order
 * may bury them — and the sort chosen orders each tier on its own. No sort
 * keeps the server's order — most recently active first — and ties keep it
 * too, since the sort is stable. An account with no active day yet sits below
 * the dated rows of its tier in either direction: it has no place in a
 * chronology, and flipping one should not bury the answer under the blanks.
 * A stored key naming a column this table does not draw reads as no sort at
 * all.
 */
export function sortAccountsRows<Row extends AccountsTableRow>(
  rows: readonly Row[],
  sort: AccountsSort | undefined,
  detailColumns: readonly AccountsDetailColumn<Row>[],
  starred: ((row: Row) => boolean) | undefined,
): readonly Row[] {
  const detail = sort ? detailColumns.find((column) => column.key === sort.key) : undefined;
  const value = sort ? (detail?.sortValue ?? SHARED_SORT_VALUE.get(sort.key)) : undefined;
  if (value === undefined && starred === undefined) return rows;
  const flip = sort?.direction === SORT_DIRECTION.DESCENDING ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (starred && starred(a) !== starred(b)) return starred(a) ? -1 : 1;
    if (value === undefined) return 0;
    const left = value(a);
    const right = value(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    if (left < right) return -flip;
    if (left > right) return flip;
    return 0;
  });
}
