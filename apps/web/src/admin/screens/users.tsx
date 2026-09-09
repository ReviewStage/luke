import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminUserList, AdminUserListRow } from "../../../server/admin/admin-users";
import {
  ADMIN_USER_ID_PARAM,
  ADMIN_USERS_SEARCH_MAX_LENGTH,
  type AdminMetricsWindow,
} from "../../../server/admin/http";
import { ACCOUNTS_TABLE_MIN_WIDTH, AccountsTable } from "../accounts-table/accounts-table";
import { ACCOUNTS_SORT_KEY, type AccountsDetailColumn } from "../accounts-table/sort";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, RefreshFailureNotice, WindowSwitcher } from "../chrome/controls";
import { RosterNote } from "../chrome/notes";
import { PageHeader, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { formatDate, formatNumber } from "../format";
import {
  FAVORITE_PATH,
  SEARCH_DEBOUNCE_MS,
  searchFromLocation,
  searchHref,
  searchTerm,
  USERS_PATH,
  windowedReadPath,
} from "../routing";
import { SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { type AdminReader, adminReadFailure, useAdminRead } from "../use-admin-read";

const USERS_ERROR = "The users endpoint did not answer. Try again shortly.";

// SAFETY: a 200 from the admin users endpoint is an AdminUserList body by its contract.
const readUserList: AdminReader<AdminUserList> = async (response) =>
  (await response.json()) as AdminUserList;

/** The roster's own sections. */
const USERS_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.SEARCH },
  { kind: SKELETON_SHAPE.TABLE, rows: 10, numericColumns: 5, starGutter: true },
  { kind: SKELETON_SHAPE.STATIC, node: <RosterNote /> },
];

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
  // carries the newest intent to the service: presses faster than the network
  // coalesce into the chain's next request instead of racing it out of order.
  // A landed write redraws its own outcome, so a roster refresh that crossed
  // it mid-flight cannot leave a stale star, and a failed one puts the star
  // back only when no newer press has spoken since.
  const favoriteIntents = useRef(new Map<string, boolean>());
  const favoriteWriting = useRef(new Set<string>());
  const toggleFavorite = useCallback(
    (id: string, favorite: boolean) => {
      const draw = (value: boolean) =>
        revise((list) => ({
          ...list,
          rows: list.rows.map((row) => (row.id === id ? { ...row, favorite: value } : row)),
        }));
      draw(favorite);
      favoriteIntents.current.set(id, favorite);
      if (favoriteWriting.current.has(id)) return;
      favoriteWriting.current.add(id);
      void (async () => {
        try {
          for (;;) {
            const want = favoriteIntents.current.get(id);
            if (want === undefined) return;
            favoriteIntents.current.delete(id);
            let landed = false;
            try {
              const response = await fetch(
                `${FAVORITE_PATH}?${ADMIN_USER_ID_PARAM}=${encodeURIComponent(id)}`,
                { method: want ? "PUT" : "DELETE", headers: { accept: "application/json" } },
              );
              landed = response.ok;
            } catch {
              landed = false;
            }
            if (landed) draw(want);
            else if (!favoriteIntents.current.has(id)) draw(!want);
          }
        } finally {
          favoriteWriting.current.delete(id);
        }
      })();
    },
    [revise],
  );

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title="Users"
          account={account}
          onSignOut={signOut}
          loading="Reading the service's own tables."
          controls={
            <>
              <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
              <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
            </>
          }
          shapes={USERS_SHAPES}
        />,
      );
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

      return frame(
        <main className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10">
          <PageHeader
            title="Users"
            account={account}
            onSignOut={signOut}
            controls={
              <>
                <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
                <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
              </>
            }
          />

          <RefreshFailureNotice
            failure={state.refreshFailure}
            refreshing={refreshing}
            onRetry={reload}
          />

          <div
            className="transition-opacity duration-150 data-[busy=true]:opacity-50"
            data-busy={refreshing}
            aria-busy={refreshing}
          >
            <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <input
                type="search"
                value={query}
                maxLength={ADMIN_USERS_SEARCH_MAX_LENGTH}
                placeholder="Search by name or email…"
                aria-label="Search accounts by name or email"
                className="min-h-11 w-full max-w-[320px] rounded-md border border-border bg-card px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
                onChange={(event) => changeQuery(event.target.value)}
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatNumber(rows.length)} of {formatNumber(list.total)} accounts
                {list.search === undefined ? "" : " matching"}
              </span>
            </div>
            <div className="mt-4">
              <AccountsTable
                rows={rows}
                windowDays={list.windowDays}
                emptyText="No account matches."
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
          </div>
        </main>,
      );
    }
  }
}
