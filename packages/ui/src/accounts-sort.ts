import { SORT_DIRECTION, type SortDirection } from "./sort-direction.js";

/**
 * The account fields both admin tables' rows carry — the shared columns'
 * whole vocabulary, so a row from either endpoint draws through the one
 * `AccountsTable`. Active days count meaningful actions on both.
 */
export interface AccountsTableRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  activeDays: number;
}

/** The sortable columns, one per header the roster draws. */
export const ACCOUNTS_SORT_KEY = {
  ACCOUNT: "account",
  JOINED: "joined",
  LAST_SEEN: "lastSeen",
  ACTIVE_DAYS: "activeDays",
  LAST_ACTIVE: "lastActive",
  TASKS: "tasks",
  AGENTS: "agents",
  PRS_MERGED: "prsMerged",
} as const;

export type AccountsSortKey = (typeof ACCOUNTS_SORT_KEY)[keyof typeof ACCOUNTS_SORT_KEY];

/** A column's first press: names read forward, counts and dates largest first. */
export const ACCOUNTS_SORT_FIRST_DIRECTION = {
  [ACCOUNTS_SORT_KEY.ACCOUNT]: SORT_DIRECTION.ASCENDING,
  [ACCOUNTS_SORT_KEY.JOINED]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.LAST_SEEN]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.ACTIVE_DAYS]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.LAST_ACTIVE]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.TASKS]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.AGENTS]: SORT_DIRECTION.DESCENDING,
  [ACCOUNTS_SORT_KEY.PRS_MERGED]: SORT_DIRECTION.DESCENDING,
} satisfies Record<AccountsSortKey, SortDirection>;

/**
 * A column one surface adds beside the shared ones — the roster's Joined,
 * Last seen, and Last active, the overview's per-feature counts. It carries its own cell and ordering because
 * its fields exist only on that surface's rows; the shared columns are fixed
 * in the table itself.
 */
export interface AccountsDetailColumn<Row> {
  key: AccountsSortKey;
  label: string;
  cell: (row: Row) => React.ReactNode;
  /** What the column orders by; an account with none sits below the rest in either direction. */
  sortValue: (row: Row) => string | number | null;
}

export interface AccountsSort {
  key: AccountsSortKey;
  direction: SortDirection;
}
