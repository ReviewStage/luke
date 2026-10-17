import type { AdminUserList, AdminUserListRow } from "@luke/service/admin/admin-users";
import {
  ADMIN_USER_ID_PARAM,
  ADMIN_USERS_SEARCH_MAX_LENGTH,
  type AdminMetricsWindow,
} from "@luke/service/admin/http";
import {
  COLLECTION_STATE,
  TEXT_ELEMENT,
  TEXT_FIELD_TYPE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
} from "@luke/ui";
import { ACCOUNTS_SORT_KEY, type AccountsDetailColumn } from "@luke/ui/accounts-sort";
import { formatDate, formatNumber } from "@luke/ui/admin-format";
import { useEffect, useState } from "react";
import { ACCOUNTS_TABLE_MIN_WIDTH, AccountsTable } from "../accounts-table/accounts-table";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, RefreshFailureNotice, WindowSwitcher } from "../chrome/controls";
import { RosterNote } from "../chrome/notes";
import { AdminCollectionPage, type ViewerAccount } from "../chrome/page-header";
import {
  FAVORITE_PATH,
  SEARCH_DEBOUNCE_MS,
  searchFromLocation,
  searchHref,
  searchTerm,
  USERS_PATH,
  windowedReadPath,
} from "../routing";
import {
  type AdminReader,
  type AdminWriter,
  adminReadFailure,
  useAdminRead,
  useAdminWrite,
} from "../use-admin-read";

const USERS_ERROR = "The users endpoint did not answer.";

/** What the roster says when no account answers the search. */
const USERS_EMPTY = "No account matches.";

// SAFETY: a 200 from the admin users endpoint is an AdminUserList body by its contract.
const readUserList: AdminReader<AdminUserList> = async (response) =>
  (await response.json()) as AdminUserList;

/** One favorite intent as the endpoint's PUT or DELETE; a response that is not ok did not land. */
const writeFavorite: AdminWriter = async (id, favorite, signal) => {
  const response = await fetch(
    `${FAVORITE_PATH}?${ADMIN_USER_ID_PARAM}=${encodeURIComponent(id)}`,
    {
      method: favorite ? "PUT" : "DELETE",
      headers: { accept: "application/json" },
      signal,
    },
  );
  return response.ok;
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

/** What a refresh in flight dims, said busy to a reader until the answer lands. */
function Refreshing({
  refreshing,
  children,
}: {
  refreshing: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="transition-opacity duration-150 data-[busy=true]:opacity-50"
      data-busy={refreshing}
      aria-busy={refreshing}
    >
      {children}
    </div>
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
  const changeQuery = (next: string) => {
    setQuery(next);
    window.history.replaceState(null, "", searchHref(next.trim()));
  };
  useEffect(() => {
    const onPopState = () => setQuery(searchFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const { state, refreshing, reload, withdraw, revise } = useAdminRead(
    windowedReadPath(USERS_PATH, hideAdmins, windowDays, searchTerm(query)),
    readUserList,
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
      "filters" | "state" | "empty" | "children"
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
        account={account}
        onSignOut={signOut}
        loadingLabel="Loading…"
        {...content}
      />,
    );
  const search = (
    <TextField
      type={TEXT_FIELD_TYPE.SEARCH}
      label="Search accounts by name or email"
      placeholder="Search by name or email…"
      maxLength={ADMIN_USERS_SEARCH_MAX_LENGTH}
      value={query}
      onChange={changeQuery}
    />
  );

  switch (state.status) {
    case "loading":
      return page({ filters: search, state: COLLECTION_STATE.LOADING });
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={signOut} />;
    case "missing":
    case "error":
      return frame(
        <AdminErrorCard
          detail={adminReadFailure(state, USERS_ERROR)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case "ready": {
      const list = state.value;
      // The service searches the whole roster once the debounce settles; until
      // that answer lands, the same needle filters the rows already loaded, so
      // the box stays instant between refetches.
      const needle = query.trim().toLowerCase();
      const rows = needle
        ? list.rows.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle))
        : list.rows;
      const failure = state.refreshFailure;
      const notice = (
        <RefreshFailureNotice failure={failure} refreshing={refreshing} onRetry={reload} />
      );

      return page({
        filters: (
          <>
            {search}
            <span className="ms-auto tabular-nums">
              <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {formatNumber(rows.length)} of {formatNumber(list.total)} accounts
                {list.search === undefined ? "" : " matching"}
              </Text>
            </span>
          </>
        ),
        state: rows.length === 0 ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY,
        empty: (
          <Refreshing refreshing={refreshing}>
            {notice}
            <Text tone={TEXT_TONE.MUTED}>{USERS_EMPTY}</Text>
          </Refreshing>
        ),
        children: (
          <Refreshing refreshing={refreshing}>
            {notice}
            <div className={failure === undefined ? undefined : "mt-4"}>
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
            </div>
            <RosterNote
              truncatedTo={list.total > list.rows.length ? list.rows.length : undefined}
              searched={list.search !== undefined}
            />
          </Refreshing>
        ),
      });
    }
  }
}
