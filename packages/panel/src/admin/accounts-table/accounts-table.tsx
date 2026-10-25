import { formatCount } from "@luke/features/number-format";
import { formatDayTick } from "@luke/features/time-format";
import {
  Badge,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  IconButton,
  Inline,
  SKELETON_SHAPE,
  Skeleton,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  TextLink,
  Tooltip,
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
import { StarIcon } from "@luke/ui/icons";
import { useState } from "react";
import { useAdminDoorsIfAny } from "../admin-doors.js";
import { AccountAvatar } from "../chrome/page-header.js";
import { DataTableSkeleton } from "../chrome/table-skeleton.js";
import { ACCOUNTS_SORT } from "../prefs.js";
import { plainLeftClick } from "../routing.js";

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

/** An account cell's avatar bone, a card avatar's size (`AVATAR_SIZE.CARD`). */
const SKELETON_AVATAR_WIDTH = "32px";

const SKELETON_NAME_WIDTH = "144px";

const SKELETON_EMAIL_WIDTH = "176px";

/** The star's column, which sorts nothing and so stands outside the sort keys. */
const FAVORITE_COLUMN = "favorite";

type AccountsColumnKey = AccountsSortKey | typeof FAVORITE_COLUMN;

/** What a row's star shows, and what its press asks. */
interface AccountsFavorite<Row> {
  starred: (row: Row) => boolean;
  onToggle: (id: string, favorite: boolean) => void;
}

/** The leading star column, whose press asks to star or unstar a row's account. */
function favoriteColumn<Row extends AccountsTableRow>(
  favorite: AccountsFavorite<Row>,
): DataTableColumn<Row, AccountsColumnKey> {
  return {
    key: FAVORITE_COLUMN,
    label: "Favorite",
    kind: DATA_TABLE_COLUMN_KIND.MARK,
    cell: (row) => {
      const label = `${favorite.starred(row) ? "Unfavorite" : "Favorite"} ${row.name || row.email}`;
      return (
        <Tooltip label={label}>
          <IconButton
            icon={<StarIcon fill={favorite.starred(row) ? "currentColor" : "none"} />}
            label={label}
            pressed={favorite.starred(row)}
            onClick={() => favorite.onToggle(row.id, !favorite.starred(row))}
          />
        </Tooltip>
      );
    },
  };
}

/** An account cell's frame: `avatar` beside `name` over `email`, where it has one. */
function AccountCellFrame({
  avatar,
  name,
  email,
}: {
  avatar: React.ReactNode;
  name: React.ReactNode;
  email: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-(--luke-space-12)">
      <span className="flex shrink-0">{avatar}</span>
      {/* Note that the lines stand in a flex column, so a line's bone keeps its own line's room rather than sharing a collapsed margin with the next. */}
      <div className="flex min-w-0 flex-col">
        {name}
        {email}
      </div>
    </div>
  );
}

/** An account's cell while its row is read: bones for its avatar, its name, and its email. */
export function AccountCellSkeleton(): React.JSX.Element {
  return (
    <AccountCellFrame
      avatar={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_AVATAR_WIDTH} />}
      name={
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL}>
          <Skeleton width={SKELETON_NAME_WIDTH} />
        </Text>
      }
      email={
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
          <Skeleton width={SKELETON_EMAIL_WIDTH} />
        </Text>
      }
    />
  );
}

/**
 * An account's cell, the same wherever an admin table lists accounts: its
 * avatar, its name with an admin's badge, and its email under a name that is
 * not the email itself. Where the mount keeps addresses, the name is a real
 * anchor, so a keyboard reaches the account and a modified click still gets
 * the browser's own gesture; where it keeps none, it is a button.
 */
export function AccountCell({
  account,
  onOpen,
}: {
  account: Pick<AccountsTableRow, "id" | "name" | "email" | "image" | "admin">;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const href = useAdminDoorsIfAny()?.address.accountHref(account.id);
  const content = (
    <AccountCellFrame
      avatar={
        <AccountAvatar
          account={{ name: account.name, email: account.email, image: account.image ?? undefined }}
        />
      }
      name={
        <Inline>
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
            {accountLabel(account)}
          </Text>
          {account.admin ? <Badge tone={STATUS_TONE.NEUTRAL}>Admin</Badge> : null}
        </Inline>
      }
      email={
        accountLabel(account) === account.email ? null : (
          <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {account.email}
          </Text>
        )
      }
    />
  );
  // Where the mount keeps no address, the account opens on a press alone,
  // so nothing poses as a link a modified click could open elsewhere.
  if (href === undefined) {
    return <TextButton onClick={() => onOpen(account.id)}>{content}</TextButton>;
  }
  return (
    <TextLink
      href={href}
      onClick={(event) => {
        if (!plainLeftClick(event)) return;
        event.preventDefault();
        onOpen(account.id);
      }}
    >
      {content}
    </TextLink>
  );
}

/** What one account table draws besides its rows, which its skeleton draws too. */
interface AccountsTableShape<Row extends AccountsTableRow> {
  windowDays: number;
  minWidth: AccountsTableMinWidth;
  onOpen: (id: string) => void;
  detailColumns?: readonly AccountsDetailColumn<Row>[] | undefined;
  /** Columns after Active days and, where drawn, the hosted-tier pair. */
  trailingColumns?: readonly AccountsDetailColumn<Row>[] | undefined;
  /** Draws Last active and Calls, the hosted-tier columns the roster's rows carry. */
  hostedColumns?: boolean | undefined;
  /** Sorts by any header's press, remembering the order chosen. */
  sortable?: boolean | undefined;
  /** Draws the leading star column. */
  favorite?: AccountsFavorite<Row> | undefined;
}

/** A table's columns, in the order every account table draws them. */
function accountsColumns<Row extends AccountsTableRow>({
  windowDays,
  onOpen,
  detailColumns = [],
  trailingColumns = [],
  hostedColumns = true,
  sortable = false,
  favorite,
}: AccountsTableShape<Row>): DataTableColumn<Row, AccountsColumnKey>[] {
  const numericColumn = (column: AccountsDetailColumn<Row>) => ({
    key: column.key,
    label: column.label,
    kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
    sortable,
    cell: column.cell,
  });
  const hosted: DataTableColumn<Row, AccountsColumnKey>[] = [
    {
      key: ACCOUNTS_SORT_KEY.LAST_ACTIVE,
      label: "Last active",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      sortable,
      cell: (row) => (row.lastActiveDay == null ? "—" : formatDayTick(row.lastActiveDay)),
    },
    {
      key: ACCOUNTS_SORT_KEY.CALLS,
      label: "Calls",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      sortable,
      cell: (row) => (row.calls === undefined ? "—" : formatCount(row.calls)),
    },
  ];
  return [
    ...(favorite ? [favoriteColumn(favorite)] : []),
    {
      key: ACCOUNTS_SORT_KEY.ACCOUNT,
      label: "Account",
      sortable,
      cell: (row) => <AccountCell account={row} onOpen={onOpen} />,
    },
    ...detailColumns.map(numericColumn),
    {
      key: ACCOUNTS_SORT_KEY.ACTIVE_DAYS,
      label: "Active days",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      sortable,
      cell: (row) => (
        <>
          {formatCount(row.activeDays)}
          <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
            {" "}
            of {formatCount(windowDays)}
          </Text>
        </>
      ),
    },
    ...(hostedColumns ? hosted : []),
    ...trailingColumns.map(numericColumn),
  ];
}

/** The table's label, for a reader moving between tables. */
const ACCOUNTS_TABLE_LABEL = "Accounts";

/**
 * One table for every account list the admin surface draws: the overview's
 * most-active accounts and the Users roster both render through it, so the
 * shared columns cannot drift apart. Every row opens the account's own page:
 * the row for the pointer, and the anchor on its name for a keyboard. What
 * belongs to one surface is opted into — the roster's star column, sortable
 * headers, and detail columns before the shared ones; the overview's
 * trailing columns after Active days, in place of the hosted-tier pair it
 * leaves out.
 */
export function AccountsTable<Row extends AccountsTableRow>({
  rows,
  emptyText,
  ...shape
}: AccountsTableShape<Row> & {
  rows: readonly Row[];
  emptyText: string;
}): React.JSX.Element {
  const { sortable = false, favorite, detailColumns = [], trailingColumns = [] } = shape;
  const [sort, setSort] = useState<AccountsSort | undefined>(
    sortable ? ACCOUNTS_SORT.read : undefined,
  );
  const toggleSort = (key: AccountsColumnKey) => {
    if (key === FAVORITE_COLUMN) return;
    const next = nextSort(sort, key);
    ACCOUNTS_SORT.write(next);
    setSort(next);
  };
  return (
    <DataTable
      label={ACCOUNTS_TABLE_LABEL}
      columns={accountsColumns(shape)}
      rows={sortAccountsRows(rows, sort, [...detailColumns, ...trailingColumns], favorite?.starred)}
      rowKey={(row) => row.id}
      empty={emptyText}
      minWidth={shape.minWidth}
      sort={sort}
      onSort={sortable ? toggleSort : undefined}
      onRowPress={(row) => shape.onOpen(row.id)}
    />
  );
}

/**
 * The table while its `rows` rows are read: the same columns the table
 * draws for `shape`, its headings as themselves and each account's cell its
 * avatar's and two lines' bones, so every row stands as tall as an account's.
 */
export function AccountsTableSkeleton<Row extends AccountsTableRow>({
  rows,
  ...shape
}: AccountsTableShape<Row> & { rows: number }): React.JSX.Element {
  return (
    <DataTableSkeleton
      label={ACCOUNTS_TABLE_LABEL}
      columns={accountsColumns(shape)}
      rows={rows}
      minWidth={shape.minWidth}
      cells={{ [ACCOUNTS_SORT_KEY.ACCOUNT]: <AccountCellSkeleton /> }}
    />
  );
}
