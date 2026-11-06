import type { AdminUserList, AdminUserListRow } from "@repo/features/admin-answer-wire";
import { ADMIN_USERS_SEARCH_MAX_LENGTH, type AdminMetricsWindow } from "@repo/features/admin-wire";
import { formatCount } from "@repo/features/number-format";
import { formatDate, formatDayTick } from "@repo/features/time-format";
import {
  type Noun,
  noMatchWords,
  noneYetWords,
  readFailedWords,
  readingWords,
} from "@repo/features/words";
import {
  COLLECTION_STATE,
  SearchField,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ACCOUNTS_SORT_KEY, type AccountsDetailColumn } from "@repo/ui/accounts-sort";
import { matchesTokens, searchTokens } from "@repo/ui/search-tokens";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ACCOUNTS_TABLE_MIN_WIDTH,
  AccountsTable,
  AccountsTableSkeleton,
} from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminUsersQuery, useAdminSignOut, useFavoriteMutation } from "../admin-queries.js";
import { adminReadView } from "../admin-read-view.js";
import { SignInMethodsChart, SignInMethodsChartSkeleton } from "../charts/signups-chart.js";
import { AdminSection } from "../charts/stat-card.js";
import { AdminViewOptions, PageSections, windowWords } from "../chrome/controls.js";
import { RosterNote } from "../chrome/notes.js";
import {
  AdminCollectionPage,
  CollectionCountSkeleton,
  type ViewerAccount,
} from "../chrome/page-header.js";
import { searchTerm, usersReadQuery } from "../routing.js";
import { useSettledSearch } from "../settled-search.js";

const USERS_ERROR = readFailedWords("users");

const ACCOUNT: Noun = { one: "account", many: "accounts" };

function usersEmpty(searched: boolean): string {
  return searched ? noMatchWords(ACCOUNT) : noneYetWords(ACCOUNT);
}

const ROSTER_DETAIL_COLUMNS: readonly AccountsDetailColumn<AdminUserListRow>[] = [
  {
    key: ACCOUNTS_SORT_KEY.JOINED,
    label: "Joined",
    cell: (row) => formatDate(row.createdAt),
    sortValue: (row) => row.createdAt,
  },
  {
    key: ACCOUNTS_SORT_KEY.LAST_SEEN,
    label: "Last seen",
    cell: (row) => (row.lastSeenAt === null ? "—" : formatDate(row.lastSeenAt)),
    sortValue: (row) => row.lastSeenAt,
  },
];

const ROSTER_TRAILING_COLUMNS: readonly AccountsDetailColumn<AdminUserListRow>[] = [
  {
    key: ACCOUNTS_SORT_KEY.LAST_ACTIVE,
    label: "Last active",
    cell: (row) => (row.lastActiveDay === null ? "—" : formatDayTick(row.lastActiveDay)),
    sortValue: (row) => row.lastActiveDay,
  },
];

const ROSTER_SKELETON_ROWS = 10;

function UsersSections({
  list,
  rows,
  searched,
  windowDays,
  onOpenAccount,
  onToggleFavorite,
}: {
  list: AdminUserList | undefined;
  rows: readonly AdminUserListRow[];
  searched: boolean;
  windowDays: number;
  onOpenAccount: (id: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
}): React.JSX.Element {
  const favorite = useMemo(
    () => ({ starred: (row: AdminUserListRow) => row.favorite, onToggle: onToggleFavorite }),
    [onToggleFavorite],
  );
  const roster = {
    windowDays: list?.windowDays ?? windowDays,
    minWidth: ACCOUNTS_TABLE_MIN_WIDTH.ROSTER,
    onOpen: onOpenAccount,
    detailColumns: ROSTER_DETAIL_COLUMNS,
    trailingColumns: ROSTER_TRAILING_COLUMNS,
    sortable: true,
    favorite,
  };
  const truncatedTo =
    list !== undefined && list.total > list.rows.length ? list.rows.length : undefined;
  return (
    <>
      <AdminSection>
        {list === undefined ? (
          <AccountsTableSkeleton rows={ROSTER_SKELETON_ROWS} {...roster} />
        ) : (
          <AccountsTable rows={rows} emptyText={usersEmpty(searched)} {...roster} />
        )}
        <RosterNote truncatedTo={truncatedTo} searched={list?.search !== undefined} />
      </AdminSection>
      <AdminSection title="Sign-in methods">
        {list === undefined ? (
          <SignInMethodsChartSkeleton />
        ) : (
          <SignInMethodsChart methods={list.signIn.methods} totalAccounts={list.signIn.accounts} />
        )}
      </AdminSection>
    </>
  );
}

export function UsersScreen({
  hideAdmins,
  onHideAdminsChange,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
  onOpenAccount,
  frame,
}: {
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onOpenAccount: (id: string) => void;
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate, address } = useAdminDoors();
  const [query, setQuery] = useState(address.search);
  const changeQuery = (typed: string) => {
    const next = typed.slice(0, ADMIN_USERS_SEARCH_MAX_LENGTH);
    setQuery(next);
    address.keepSearch(next.trim());
  };
  useEffect(() => address.onSearchMoved(() => setQuery(address.search())), [address]);

  const asked = usersReadQuery(hideAdmins, windowDays, useSettledSearch(searchTerm(query)));
  const read = useQuery({ ...adminUsersQuery(reads, asked), enabled: !gate.heldAtGate() });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();

  const favorite = useFavoriteMutation(reads);
  const toggleFavorite = (id: string, starred: boolean) =>
    favorite.mutate({ id, favorite: starred });

  const page = (
    content: Pick<
      React.ComponentProps<typeof AdminCollectionPage>,
      "filters" | "state" | "skeleton" | "empty" | "error" | "children"
    >,
  ) =>
    frame(
      <AdminCollectionPage
        title="Users"
        note={windowWords(windowDays)}
        controls={
          <AdminViewOptions
            windowDays={windowDays}
            onWindowDaysChange={onWindowDaysChange}
            hideAdmins={hideAdmins}
            onHideAdminsChange={onHideAdminsChange}
          />
        }
        loadingLabel={readingWords("users")}
        {...content}
      />,
    );
  const search = (
    <SearchField
      label="Search accounts by name or email"
      placeholder="Search by name or email"
      value={query}
      onChange={changeQuery}
      onClear={() => changeQuery("")}
    />
  );

  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: USERS_ERROR,
    loading: () =>
      page({
        filters: (
          <>
            {search}
            <CollectionCountSkeleton />
          </>
        ),
        state: COLLECTION_STATE.LOADING,
        skeleton: (
          <PageSections>
            <UsersSections
              list={undefined}
              rows={[]}
              searched={false}
              windowDays={windowDays}
              onOpenAccount={onOpenAccount}
              onToggleFavorite={toggleFavorite}
            />
          </PageSections>
        ),
      }),
    failed: (error) => page({ filters: search, state: COLLECTION_STATE.ERROR, error }),
    ready: (list, refreshed) => {
      const tokens = searchTokens(query);
      const rows =
        tokens.length > 0
          ? list.rows.filter((row) => matchesTokens([row.name, row.email], tokens))
          : list.rows;
      return page({
        filters: (
          <>
            {search}
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {formatCount(rows.length)} of {formatCount(list.total)} accounts
              {list.search === undefined ? "" : " matching"}
            </Text>
          </>
        ),
        state: COLLECTION_STATE.READY,
        children: refreshed(
          <UsersSections
            list={list}
            rows={rows}
            searched={tokens.length > 0 || list.search !== undefined}
            windowDays={windowDays}
            onOpenAccount={onOpenAccount}
            onToggleFavorite={toggleFavorite}
          />,
        ),
      });
    },
  });
}
