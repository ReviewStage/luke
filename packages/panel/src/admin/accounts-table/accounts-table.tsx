import { formatCount } from "@repo/features/number-format";
import {
  Badge,
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
} from "@repo/ui";
import { accountLabel } from "@repo/ui/account-initials";
import {
  ACCOUNTS_SORT_FIRST_DIRECTION,
  ACCOUNTS_SORT_KEY,
  type AccountsDetailColumn,
  type AccountsSortKey,
  type AccountsTableRow,
} from "@repo/ui/accounts-sort";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumns,
  DataTableSkeleton,
  type SortingState,
} from "@repo/ui/data-table";
import { StarIcon } from "@repo/ui/icons";
import { SORT_DIRECTION } from "@repo/ui/sort-direction";
import { useMemo, useState } from "react";
import { useAdminDoorsIfAny } from "../admin-doors.js";
import { AccountAvatar } from "../chrome/page-header.js";
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

/** The star's column, which no heading sorts and so stands outside the sort keys. */
const FAVORITE_COLUMN = "favorite";

/** Starred rows above the rest: the order before any a heading chooses. */
const STARRED_FIRST: SortingState = [{ id: FAVORITE_COLUMN, desc: true }];

/** What a row's star shows, and what its press asks. */
interface AccountsFavorite<Row> {
  starred: (row: Row) => boolean;
  onToggle: (id: string, favorite: boolean) => void;
}

/**
 * The leading star column, whose press asks to star or unstar a row's
 * account. Its value is whether the row is starred, which `STARRED_FIRST`
 * sorts by before the order a heading chooses; its heading is a mark's, so
 * no press sorts it.
 */
function favoriteColumn<Row extends AccountsTableRow>(favorite: AccountsFavorite<Row>) {
  const column = createDataTableColumnHelper<Row>();
  return column.accessor((row) => favorite.starred(row), {
    id: FAVORITE_COLUMN,
    header: "Favorite",
    meta: { kind: DATA_TABLE_COLUMN_KIND.MARK },
    sortFn: "basic",
    cell: ({ row }) => {
      const account = row.original;
      const label = `${favorite.starred(account) ? "Unfavorite" : "Favorite"} ${account.name || account.email}`;
      return (
        <Tooltip label={label}>
          <IconButton
            icon={<StarIcon fill={favorite.starred(account) ? "currentColor" : "none"} />}
            label={label}
            pressed={favorite.starred(account)}
            onClick={() => favorite.onToggle(account.id, !favorite.starred(account))}
          />
        </Tooltip>
      );
    },
  });
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
    <div className="flex items-center gap-(--ui-space-12)">
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
  /** Columns after Active days. */
  trailingColumns?: readonly AccountsDetailColumn<Row>[] | undefined;
  /** Sorts by any header's press, remembering the order chosen. */
  sortable?: boolean | undefined;
  /** Draws the leading star column. */
  favorite?: AccountsFavorite<Row> | undefined;
}

/**
 * How a column sorts by its heading, where its table sorts at all: its first
 * press the way `ACCOUNTS_SORT_FIRST_DIRECTION` says, and an account with no
 * value yet below the rest in either direction, since it has no place in a
 * chronology and flipping one should not bury the answer under the blanks.
 */
function sortSettings(key: AccountsSortKey, sortable: boolean) {
  return {
    enableSorting: sortable,
    sortDescFirst: ACCOUNTS_SORT_FIRST_DIRECTION[key] === SORT_DIRECTION.DESCENDING,
    sortUndefined: "last",
  } as const;
}

/** A table's columns, in the order every account table draws them. */
function accountsColumns<Row extends AccountsTableRow>({
  windowDays,
  onOpen,
  detailColumns = [],
  trailingColumns = [],
  sortable = false,
  favorite,
}: Omit<AccountsTableShape<Row>, "minWidth">): DataTableColumns<Row> {
  const column = createDataTableColumnHelper<Row>();
  const numericColumn = (detail: AccountsDetailColumn<Row>) =>
    column.accessor((row) => detail.sortValue(row) ?? undefined, {
      id: detail.key,
      header: detail.label,
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      sortFn: "basic",
      ...sortSettings(detail.key, sortable),
      cell: ({ row }) => detail.cell(row.original),
    });
  return column.columns([
    ...(favorite ? [favoriteColumn(favorite)] : []),
    // Note that an account sorts by the name its row shows, falling back to the email exactly as the cell does.
    column.accessor((row) => accountLabel(row), {
      id: ACCOUNTS_SORT_KEY.ACCOUNT,
      header: "Account",
      sortFn: "text",
      ...sortSettings(ACCOUNTS_SORT_KEY.ACCOUNT, sortable),
      cell: ({ row }) => <AccountCell account={row.original} onOpen={onOpen} />,
    }),
    ...detailColumns.map(numericColumn),
    column.accessor((row) => row.activeDays, {
      id: ACCOUNTS_SORT_KEY.ACTIVE_DAYS,
      header: "Active days",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      sortFn: "basic",
      ...sortSettings(ACCOUNTS_SORT_KEY.ACTIVE_DAYS, sortable),
      cell: ({ getValue }) => (
        <>
          {formatCount(getValue())}
          <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
            {" "}
            of {formatCount(windowDays)}
          </Text>
        </>
      ),
    }),
    ...trailingColumns.map(numericColumn),
  ]);
}

/** The columns of `shape`, built again only when one of its parts changes, as TanStack Table asks. */
function useAccountsColumns<Row extends AccountsTableRow>({
  windowDays,
  onOpen,
  detailColumns,
  trailingColumns,
  sortable,
  favorite,
}: AccountsTableShape<Row>): DataTableColumns<Row> {
  return useMemo(
    () =>
      accountsColumns({ windowDays, onOpen, detailColumns, trailingColumns, sortable, favorite }),
    [windowDays, onOpen, detailColumns, trailingColumns, sortable, favorite],
  );
}

/**
 * The remembered roster sort as the table's first order: none where the
 * table does not sort, or where the stored key names a column it does not
 * draw.
 */
function rememberedSorting<Row extends AccountsTableRow>(
  columns: DataTableColumns<Row>,
  sortable: boolean,
): SortingState {
  const sort = sortable ? ACCOUNTS_SORT.read() : undefined;
  if (sort === undefined || !columns.some((column) => column.id === sort.key)) return [];
  return [{ id: sort.key, desc: sort.direction === SORT_DIRECTION.DESCENDING }];
}

/** Remembers the order a heading's press chose, for the next visit. */
function rememberSorting([sort]: SortingState): void {
  const key = Object.values(ACCOUNTS_SORT_KEY).find((candidate) => candidate === sort?.id);
  if (sort === undefined || key === undefined) return;
  ACCOUNTS_SORT.write({
    key,
    direction: sort.desc ? SORT_DIRECTION.DESCENDING : SORT_DIRECTION.ASCENDING,
  });
}

/** The table's label, for a reader moving between tables. */
const ACCOUNTS_TABLE_LABEL = "Accounts";

/**
 * One table for every account list the admin surface draws: the overview's
 * most-active accounts and the Users roster both render through it, so the
 * shared columns cannot drift apart. Every row opens the account's own page:
 * the row for the pointer, and the anchor on its name for a keyboard. What
 * belongs to one surface is opted into — the roster's star column, sortable
 * headers, and detail columns before the shared ones; each surface's
 * trailing columns after Active days.
 */
export function AccountsTable<Row extends AccountsTableRow>({
  rows,
  emptyText,
  ...shape
}: AccountsTableShape<Row> & {
  rows: readonly Row[];
  emptyText: string;
}): React.JSX.Element {
  const { sortable = false, favorite } = shape;
  const columns = useAccountsColumns(shape);
  const [initialSorting] = useState(() => rememberedSorting(columns, sortable));
  return (
    <DataTable
      label={ACCOUNTS_TABLE_LABEL}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      empty={emptyText}
      minWidth={shape.minWidth}
      initialSorting={initialSorting}
      leadingSorting={favorite ? STARRED_FIRST : undefined}
      onSortingChange={rememberSorting}
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
      columns={useAccountsColumns(shape)}
      rows={rows}
      minWidth={shape.minWidth}
      cells={{ [ACCOUNTS_SORT_KEY.ACCOUNT]: <AccountCellSkeleton /> }}
    />
  );
}
