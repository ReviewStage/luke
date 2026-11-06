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

export const ACCOUNTS_TABLE_MIN_WIDTH = {
  OVERVIEW: DATA_TABLE_MIN_WIDTH.MEDIUM,
  ROSTER: DATA_TABLE_MIN_WIDTH.WIDE,
} as const;

type AccountsTableMinWidth =
  (typeof ACCOUNTS_TABLE_MIN_WIDTH)[keyof typeof ACCOUNTS_TABLE_MIN_WIDTH];

const SKELETON_AVATAR_WIDTH = "32px";

const SKELETON_NAME_WIDTH = "144px";

const SKELETON_EMAIL_WIDTH = "176px";

const FAVORITE_COLUMN = "favorite";

const STARRED_FIRST: SortingState = [{ id: FAVORITE_COLUMN, desc: true }];

interface AccountsFavorite<Row> {
  starred: (row: Row) => boolean;
  onToggle: (id: string, favorite: boolean) => void;
}

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
      <div className="flex min-w-0 flex-col">
        {name}
        {email}
      </div>
    </div>
  );
}

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

interface AccountsTableShape<Row extends AccountsTableRow> {
  windowDays: number;
  minWidth: AccountsTableMinWidth;
  onOpen: (id: string) => void;
  detailColumns?: readonly AccountsDetailColumn<Row>[] | undefined;
  trailingColumns?: readonly AccountsDetailColumn<Row>[] | undefined;
  sortable?: boolean | undefined;
  favorite?: AccountsFavorite<Row> | undefined;
}

function sortSettings(key: AccountsSortKey, sortable: boolean) {
  return {
    enableSorting: sortable,
    sortDescFirst: ACCOUNTS_SORT_FIRST_DIRECTION[key] === SORT_DIRECTION.DESCENDING,
    sortUndefined: "last",
  } as const;
}

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

function rememberedSorting<Row extends AccountsTableRow>(
  columns: DataTableColumns<Row>,
  sortable: boolean,
): SortingState {
  const sort = sortable ? ACCOUNTS_SORT.read() : undefined;
  if (sort === undefined || !columns.some((column) => column.id === sort.key)) return [];
  return [{ id: sort.key, desc: sort.direction === SORT_DIRECTION.DESCENDING }];
}

function rememberSorting([sort]: SortingState): void {
  const key = Object.values(ACCOUNTS_SORT_KEY).find((candidate) => candidate === sort?.id);
  if (sort === undefined || key === undefined) return;
  ACCOUNTS_SORT.write({
    key,
    direction: sort.desc ? SORT_DIRECTION.DESCENDING : SORT_DIRECTION.ASCENDING,
  });
}

const ACCOUNTS_TABLE_LABEL = "Accounts";

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
