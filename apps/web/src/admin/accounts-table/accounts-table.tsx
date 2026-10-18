import {
  BADGE_TONE,
  Badge,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  IconButton,
  Inline,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { accountLabel } from "@luke/ui/account-initials";
import {
  ACCOUNTS_SORT_KEY,
  type AccountsDetailColumn,
  type AccountsSort,
  type AccountsSortKey,
  type AccountsTableRow,
  nextSort,
  sortAccountsRows,
} from "@luke/ui/accounts-sort";
import { formatDayTick, formatNumber } from "@luke/ui/admin-format";
import { useState } from "react";
import { AccountAvatar } from "../chrome/page-header";
import { ACCOUNTS_SORT } from "../prefs";
import { accountHref, plainLeftClick } from "../routing";

/**
 * The narrowest each surface's table may draw before its scroll wrapper takes
 * over — past this the columns crush instead of shrinking. The roster stands
 * wider because its detail and star columns join the shared set.
 */
export const ACCOUNTS_TABLE_MIN_WIDTH = {
  OVERVIEW: DATA_TABLE_MIN_WIDTH.MEDIUM,
  ROSTER: DATA_TABLE_MIN_WIDTH.WIDE,
} as const;

type AccountsTableMinWidth =
  (typeof ACCOUNTS_TABLE_MIN_WIDTH)[keyof typeof ACCOUNTS_TABLE_MIN_WIDTH];

/** The star's column, which sorts nothing and so stands outside the sort keys. */
const FAVORITE_COLUMN = "favorite";

type AccountsColumnKey = AccountsSortKey | typeof FAVORITE_COLUMN;

/** What a row's star shows, and what its press asks. */
interface AccountsFavorite<Row> {
  starred: (row: Row) => boolean;
  onToggle: (id: string, favorite: boolean) => void;
}

function StarIcon({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg
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

/** The leading star column, whose press asks to star or unstar a row's account. */
function favoriteColumn<Row extends AccountsTableRow>(
  favorite: AccountsFavorite<Row>,
): DataTableColumn<Row, AccountsColumnKey> {
  return {
    key: FAVORITE_COLUMN,
    label: "Favorite",
    kind: DATA_TABLE_COLUMN_KIND.MARK,
    cell: (row) => (
      <IconButton
        icon={<StarIcon filled={favorite.starred(row)} />}
        label={`${favorite.starred(row) ? "Unfavorite" : "Favorite"} ${row.name || row.email}`}
        pressed={favorite.starred(row)}
        onClick={() => favorite.onToggle(row.id, !favorite.starred(row))}
      />
    ),
  };
}

/**
 * An account's cell, the same wherever an admin table lists accounts: its
 * avatar, its name with an admin's badge, and its email under a name that is
 * not the email itself. The name is a real anchor, so a keyboard reaches the
 * account and a modified click still gets the browser's own gesture.
 */
export function AccountCell({
  account,
  onOpen,
}: {
  account: Pick<AccountsTableRow, "id" | "name" | "email" | "image" | "admin">;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <a
      href={accountHref(account.id)}
      className="flex items-center gap-3 outline-offset-2"
      onClick={(event) => {
        if (!plainLeftClick(event)) return;
        event.preventDefault();
        onOpen(account.id);
      }}
    >
      <span className="flex shrink-0">
        <AccountAvatar
          account={{ name: account.name, email: account.email, image: account.image ?? undefined }}
        />
      </span>
      <div className="min-w-0">
        <Inline>
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
            {accountLabel(account)}
          </Text>
          {account.admin ? <Badge tone={BADGE_TONE.NEUTRAL}>Admin</Badge> : null}
        </Inline>
        {accountLabel(account) === account.email ? null : (
          <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {account.email}
          </Text>
        )}
      </div>
    </a>
  );
}

/**
 * One table for every account list the admin surface draws: the overview's
 * most-active accounts and the Users roster both render through it, so the
 * shared columns cannot drift apart. Every row opens the account's own page:
 * the row for the pointer, and the anchor on its name for a keyboard. What
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
  /** Draws the leading star column. */
  favorite?: AccountsFavorite<Row>;
}): React.JSX.Element {
  const [sort, setSort] = useState<AccountsSort | undefined>(
    sortable ? ACCOUNTS_SORT.read : undefined,
  );
  const toggleSort = (key: AccountsColumnKey) => {
    if (key === FAVORITE_COLUMN) return;
    const next = nextSort(sort, key);
    ACCOUNTS_SORT.write(next);
    setSort(next);
  };

  const columns: DataTableColumn<Row, AccountsColumnKey>[] = [
    ...(favorite ? [favoriteColumn(favorite)] : []),
    {
      key: ACCOUNTS_SORT_KEY.ACCOUNT,
      label: "Account",
      sortable,
      cell: (row) => <AccountCell account={row} onOpen={onOpen} />,
    },
    ...detailColumns.map((column) => ({
      key: column.key,
      label: column.label,
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      sortable,
      cell: column.cell,
    })),
    {
      key: ACCOUNTS_SORT_KEY.ACTIVE_DAYS,
      label: "Active days",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      sortable,
      cell: (row) => (
        <>
          {formatNumber(row.activeDays)}
          <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
            {" "}
            of {formatNumber(windowDays)}
          </Text>
        </>
      ),
    },
    {
      key: ACCOUNTS_SORT_KEY.LAST_ACTIVE,
      label: "Last active",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      sortable,
      cell: (row) => (row.lastActiveDay === null ? "—" : formatDayTick(row.lastActiveDay)),
    },
    {
      key: ACCOUNTS_SORT_KEY.CALLS,
      label: "Calls",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      sortable,
      cell: (row) => formatNumber(row.calls),
    },
  ];
  return (
    <DataTable
      label="Accounts"
      columns={columns}
      rows={sortAccountsRows(rows, sort, detailColumns, favorite?.starred)}
      rowKey={(row) => row.id}
      empty={emptyText}
      minWidth={minWidth}
      sort={sort}
      onSort={sortable ? toggleSort : undefined}
      onRowPress={(row) => onOpen(row.id)}
    />
  );
}
