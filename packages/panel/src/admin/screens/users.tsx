import type { AdminUserListRow } from "@luke/features/admin-answer-wire";
import {
  ADMIN_READ,
  ADMIN_USERS_SEARCH_MAX_LENGTH,
  type AdminMetricsWindow,
} from "@luke/features/admin-wire";
import {
  COLLECTION_STATE,
  SearchField,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { ACCOUNTS_SORT_KEY, type AccountsDetailColumn } from "@luke/ui/accounts-sort";
import { formatCount, formatDate } from "@luke/ui/time-format";
import { useEffect, useState } from "react";
import { ACCOUNTS_TABLE_MIN_WIDTH, AccountsTable } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { SignInMethodsChart } from "../charts/signups-chart.js";
import { AdminSection } from "../charts/stat-card.js";
import { AdminErrorState } from "../chrome/cards.js";
import { AdminViewOptions, Refreshing, windowWords } from "../chrome/controls.js";
import { RosterNote } from "../chrome/notes.js";
import { AdminCollectionPage, type ViewerAccount } from "../chrome/page-header.js";
import { SEARCH_DEBOUNCE_MS, searchTerm, usersReadQuery } from "../routing.js";
import { adminReadFailure, useAdminRead, useAdminWrite } from "../use-admin-read.js";

const USERS_ERROR = "The users endpoint did not answer.";

/** What the roster says when no account answers the search. */
const USERS_EMPTY = "No account matches.";

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
  // Typing is kept where the mount keeps an address, in place, so on the web
  // page a searched roster is shareable without the back button walking
  // keystrokes.
  const { reads, gate, address } = useAdminDoors();
  const [query, setQuery] = useState(address.search);
  // Note that the query is held to the service's own bound, as a field's
  // `maxLength` would, so a pasted run past it never reaches the read.
  const changeQuery = (typed: string) => {
    const next = typed.slice(0, ADMIN_USERS_SEARCH_MAX_LENGTH);
    setQuery(next);
    address.keepSearch(next.trim());
  };
  useEffect(() => address.onSearchMoved(() => setQuery(address.search())), [address]);

  const asked = usersReadQuery(hideAdmins, windowDays, searchTerm(query));
  const { state, refreshing, reload, withdraw, revise } = useAdminRead(
    { procedure: ADMIN_READ.USERS, query: asked },
    (signal) => reads.users(asked, signal),
    USERS_ERROR,
    { debounceMs: SEARCH_DEBOUNCE_MS },
  );
  const signOut = () => void withdraw(onSignOut);

  // The star answers the press at once, while one write chain per account
  // carries the newest intent to the service and redraws its outcome.
  const toggleFavorite = useAdminWrite(
    (id, favorite, signal) => reads.favorite(id, favorite, signal),
    (id, favorite) =>
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
        note={windowWords(windowDays)}
        controls={
          <>
            <AdminViewOptions
              windowDays={windowDays}
              onWindowDaysChange={onWindowDaysChange}
              hideAdmins={hideAdmins}
              onHideAdminsChange={onHideAdminsChange}
            />
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
      return gate.signedOut();
    case "forbidden":
      return gate.forbidden({ email: account?.email, onSignOut: signOut });
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
        <AdminSection title="Sign-in methods">
          <SignInMethodsChart methods={list.signIn.methods} totalAccounts={list.signIn.accounts} />
        </AdminSection>
      );

      return page({
        // Note that the count stands beside the field rather than in it, so a
        // narrow page wraps it under the field instead of crowding the query.
        filters: (
          <>
            {search}
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {formatCount(rows.length)} of {formatCount(list.total)} accounts
              {list.search === undefined ? "" : " matching"}
            </Text>
          </>
        ),
        // An empty answer stands where the table stands, in the table's own
        // frame under the filters, rather than centred in the page apart
        // from them, so the page keeps its line whatever the search finds.
        state: COLLECTION_STATE.READY,
        children: refreshed(
          <>
            <AdminSection>
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
            </AdminSection>
            {signInMethods}
          </>,
        ),
      });
    }
  }
}
