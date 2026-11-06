import { SORT_DIRECTION, type SortDirection } from "./sort-direction.js";

export interface AccountsTableRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  admin: boolean;
  activeDays: number;
}

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
