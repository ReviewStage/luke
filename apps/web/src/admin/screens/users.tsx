import { browserClient } from "@luke/features/contract/browser-client";
import type { AdminUserList, AdminUserListRow } from "@luke/service/admin/admin-users";
import {
  ADMIN_USER_ID_PARAM,
  ADMIN_USERS_SEARCH_MAX_LENGTH,
  type AdminMetricsWindow,
  type AdminUsersQuery,
} from "@luke/service/admin/http";
import {
  COLLECTION_STATE,
  EmptyState,
  SearchField,
  SearchIcon,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { ACCOUNTS_SORT_KEY, type AccountsDetailColumn } from "@luke/ui/accounts-sort";
import { formatDate, formatNumber } from "@luke/ui/admin-format";
import { useEffect, useState } from "react";
import { ACCOUNTS_TABLE_MIN_WIDTH, AccountsTable } from "../accounts-table/accounts-table";
import { SignInMethodsChart } from "../charts/signups-chart";
import { SectionHeading } from "../charts/stat-card";
import { AdminErrorState, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, Refreshing, WindowSwitcher } from "../chrome/controls";
import { RosterNote } from "../chrome/notes";
import { AdminCollectionPage, type ViewerAccount } from "../chrome/page-header";
import {
  SEARCH_DEBOUNCE_MS,
  searchFromLocation,
  searchHref,
  searchTerm,
  usersReadQuery,
} from "../routing";
import {
  ADMIN_READ,
  type AdminReader,
  type AdminWriter,
  adminReadFailure,
  useAdminRead,
  useAdminWrite,
} from "../use-admin-read";

const USERS_ERROR = "The users endpoint did not answer.";

/** What the roster says when no account answers the search. */
const USERS_EMPTY = "No account matches.";

/** The roster, as the admin users procedure answers it. */
const readUserList =
  (query: AdminUsersQuery): AdminReader<AdminUserList> =>
  async (signal) =>
    // SAFETY: the admin users procedure answers an AdminUserList (`@luke/service/admin/admin-users`), which the contract cannot name.
    (await browserClient.admin.users(query, { signal })) as AdminUserList;

/** One favorite intent as the star's PUT or DELETE; a refusal did not land. */
const writeFavorite: AdminWriter = async (id, favorite, signal) => {
  const input = { query: { [ADMIN_USER_ID_PARAM]: id } };
  const write = favorite ? browserClient.admin.favorite : browserClient.admin.unfavorite;
  return write(input, { signal }).then(
    () => true,
    () => false,
  );
};

/**
 * The roster's own columns beside the shared ones: when the account joined
 * and when it last touched the service, fields the most-active rows do not
 * carry.
 */
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
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  // What the box holds and what the service was asked to search for, apart:
  // the query redraws on every keystroke and filters the loaded rows at once,
  // while the read's own debounce commits it into the address the roster is
  // refetched under, so the whole account table is not scanned per keystroke.
  // Typing rides the address bar in place, so a searched roster is shareable
  // without the back button walking keystrokes.
  const [query, setQuery] = useState(searchFromLocation);
  // Note that the query is held to the service's own bound, as a field's
  // `maxLength` would, so a pasted run past it never reaches the read.
  const changeQuery = (typed: string) => {
    const next = typed.slice(0, ADMIN_USERS_SEARCH_MAX_LENGTH);
    setQuery(next);
    window.history.replaceState(null, "", searchHref(next.trim()));
  };
  useEffect(() => {
    const onPopState = () => setQuery(searchFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const asked = usersReadQuery(hideAdmins, windowDays, searchTerm(query));
  const { state, refreshing, reload, withdraw, revise } = useAdminRead(
    { procedure: ADMIN_READ.USERS, query: asked },
    readUserList(asked),
    USERS_ERROR,
    { debounceMs: SEARCH_DEBOUNCE_MS },
  );
  const signOut = () => void withdraw(onSignOut);

  // The star answers the press at once, while one write chain per account
  // carries the newest intent to the service and redraws its outcome.
  const toggleFavorite = useAdminWrite(writeFavorite, (id, favorite) =>
    revise((list) => ({
      ...list,
      rows: list.rows.map((row) => (row.id === id ? { ...row, favorite } : row)),
    })),
  );

  // The title, its controls, and the search stand the same on the loading
  // page and the loaded one, so the box takes typing before the first answer.
  const page = (
    content: Pick<
      React.ComponentProps<typeof AdminCollectionPage>,
      "filters" | "state" | "empty" | "error" | "children"
    >,
  ) =>
    frame(
      <AdminCollectionPage
        title="Users"
        controls={
          <>
            <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
            <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
          </>
        }
        loadingLabel="Loading…"
        {...content}
      />,
    );
  const search = (
    <SearchField
      label="Search accounts by name or email"
      placeholder="Search by name or email…"
      value={query}
      onChange={changeQuery}
      onClear={() => changeQuery("")}
    />
  );

  switch (state.status) {
    case "loading": {
      return page({ filters: search, state: COLLECTION_STATE.LOADING });
    }
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={signOut} />;
    case "missing":
    case "error":
      return page({
        filters: search,
        state: COLLECTION_STATE.ERROR,
        error: (
          <AdminErrorState
            detail={adminReadFailure(state, USERS_ERROR)}
            refreshing={refreshing}
            onRetry={reload}
          />
        ),
      });
    case "ready": {
      const list = state.value;
      // The service searches the whole roster once the debounce settles; until
      // that answer lands, the same needle filters the rows already loaded, so
      // the box stays instant between refetches.
      const needle = query.trim().toLowerCase();
      const rows = needle
        ? list.rows.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle))
        : list.rows;
      // Note that a miss may lie past a truncated roster's rows, so its note stays.
      const truncatedTo = list.total > list.rows.length ? list.rows.length : undefined;
      const refreshed = (content: React.ReactNode) => (
        <Refreshing failure={state.refreshFailure} refreshing={refreshing} onRetry={reload}>
          {content}
        </Refreshing>
      );

      // Note that the methods describe every account the scope keeps, so a
      // search that narrows the rows, or finds none, leaves the chart standing.
      const signInMethods = (
        <>
          <SectionHeading>Sign-in methods</SectionHeading>
          <SignInMethodsChart methods={list.signIn.methods} totalAccounts={list.signIn.accounts} />
        </>
      );

      return page({
        // Note that the count stands beside the field rather than in it, so a
        // narrow page wraps it under the field instead of crowding the query.
        filters: (
          <>
            {search}
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {formatNumber(rows.length)} of {formatNumber(list.total)} accounts
              {list.search === undefined ? "" : " matching"}
            </Text>
          </>
        ),
        state: rows.length === 0 ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY,
        empty: refreshed(
          <>
            <EmptyState icon={<SearchIcon />}>{USERS_EMPTY}</EmptyState>
            {truncatedTo === undefined ? null : (
              <RosterNote truncatedTo={truncatedTo} searched={list.search !== undefined} />
            )}
            {signInMethods}
          </>,
        ),
        children: refreshed(
          <>
            <AccountsTable
              rows={rows}
              windowDays={list.windowDays}
              emptyText={USERS_EMPTY}
              minWidth={ACCOUNTS_TABLE_MIN_WIDTH.ROSTER}
              onOpen={onOpenAccount}
              detailColumns={ROSTER_DETAIL_COLUMNS}
              sortable
              favorite={{ starred: (row) => row.favorite, onToggle: toggleFavorite }}
            />
            <RosterNote truncatedTo={truncatedTo} searched={list.search !== undefined} />
            {signInMethods}
          </>,
        ),
      });
    }
  }
}
