import type { AdminDayAccount, AdminDayDetail } from "@luke/features/admin-answer-wire";
import { ADMIN_READ } from "@luke/features/admin-wire";
import { formatCount } from "@luke/features/number-format";
import { formatDayHeading } from "@luke/features/time-format";
import {
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
} from "@luke/ui";
import { partialDayKey } from "@luke/ui/daily-series";
import { AccountCell, AccountCellSkeleton } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminReadView } from "../admin-read-view.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { AdminViewOptions } from "../chrome/controls.js";
import { DayNote } from "../chrome/notes.js";
import { AdminPage, type AdminWayBack, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { DataTableSkeleton } from "../chrome/table-skeleton.js";
import { ADMIN_TAB, dayReadQuery } from "../routing.js";
import { useAdminRead } from "../use-admin-read.js";

const DAY_ERROR = "The day endpoint did not answer.";

/** How many accounts the table's skeleton stands a row for, about a quiet day's. */
const ACCOUNT_SKELETON_ROWS = 5;

/** The day's account column, the one whose cell is an account's. */
const ACCOUNT_COLUMN = "account";

/**
 * The day's two cards, each saying under its figure that the day is still
 * filling where it is today, and nothing where it is past.
 */
function dayStats(stillFilling: boolean): readonly StatSpec<AdminDayDetail>[] {
  const soFar = stillFilling ? () => "so far today" : undefined;
  return [
    {
      key: "accounts",
      label: () => "Active accounts",
      value: (detail) => formatCount(detail.totals.accounts),
      hint: soFar,
    },
    {
      key: "calls",
      label: () => "Hosted calls",
      value: (detail) => formatCount(detail.totals.calls),
      hint: soFar,
    },
  ];
}

/** The day's two columns: who called, and how many times. */
function dayAccountColumns(
  onOpen: (id: string) => void,
): readonly DataTableColumn<AdminDayAccount>[] {
  return [
    {
      key: ACCOUNT_COLUMN,
      label: "Account",
      cell: (row) => <AccountCell account={row} onOpen={onOpen} />,
    },
    {
      key: "calls",
      label: "Calls",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      cell: (row) => formatCount(row.calls),
    },
  ];
}

/**
 * The day's accounts, busiest first as the endpoint orders them. The shared
 * `AccountsTable` draws windowed columns a single day does not have, so the
 * day page keeps a table of its own over the same account cell: the row for
 * the pointer, the anchor on the name for a keyboard.
 */
function DayAccountsTable({
  accounts,
  onOpen,
}: {
  accounts: readonly AdminDayAccount[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <DataTable
      label="Accounts active this day"
      columns={dayAccountColumns(onOpen)}
      rows={accounts}
      rowKey={(row) => row.id}
      empty="No hosted-tier calls recorded on this day."
      minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
      onRowPress={(row) => onOpen(row.id)}
    />
  );
}

/**
 * The day's sections under its toolbar, drawn from `detail` once it is read
 * and as their skeletons until then. Whether the day is still filling is
 * known from `day` before the answer, by the clock, and from the answer's
 * own instant once it lands.
 */
function DaySections({
  day,
  detail,
  onOpenAccount,
}: {
  day: string;
  detail: AdminDayDetail | undefined;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  const stillFilling = partialDayKey([{ day }], detail?.generatedAt ?? Date.now()) !== undefined;
  return (
    <>
      <AdminSection title="Hosted tier · this day">
        <StatCards layout={STAT_LAYOUT.ROW} stats={dayStats(stillFilling)} data={detail} />
      </AdminSection>

      <AdminSection title="Accounts active this day">
        {detail === undefined ? (
          <DataTableSkeleton
            label="Accounts active this day"
            columns={dayAccountColumns(onOpenAccount)}
            rows={ACCOUNT_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
            cells={{ [ACCOUNT_COLUMN]: <AccountCellSkeleton /> }}
          />
        ) : (
          <>
            <DayAccountsTable accounts={detail.accounts} onOpen={onOpenAccount} />
            {detail.accounts.length > 0 ? (
              <DayNote
                truncatedTo={
                  detail.totals.accounts > detail.accounts.length
                    ? detail.accounts.length
                    : undefined
                }
                totalAccounts={detail.totals.accounts}
              />
            ) : null}
          </>
        )}
      </AdminSection>
    </>
  );
}

export function DayScreen({
  day,
  hideAdmins,
  onHideAdminsChange,
  account,
  onSignOut,
  onBack,
  onOpenAccount,
  frame,
}: {
  day: string;
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onBack: () => void;
  onOpenAccount: (id: string) => void;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate } = useAdminDoors();
  const query = dayReadQuery(day, hideAdmins);
  const { state, refreshing, reload, withdraw } = useAdminRead(
    { procedure: ADMIN_READ.DAY, query: query },
    (signal) => reads.day(query, signal),
    DAY_ERROR,
    { keeps: (shown) => shown.day === day },
  );
  const signOut = () => void withdraw(onSignOut);
  const back: AdminWayBack = { tab: ADMIN_TAB.DASHBOARD, onBack };
  const controls = (
    <AdminViewOptions hideAdmins={hideAdmins} onHideAdminsChange={onHideAdminsChange} />
  );

  return adminReadView({
    read: { state, refreshing, reload },
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: DAY_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title={formatDayHeading(day)} back={back} controls={controls}>
          <DaySections day={day} detail={undefined} onOpenAccount={onOpenAccount} />
        </PageSkeleton>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title={formatDayHeading(day)} back={back} controls={controls}>
          {error}
        </AdminPage>,
      ),
    ready: (detail, refreshed) =>
      frame(
        <AdminPage title={formatDayHeading(detail.day)} back={back} controls={controls}>
          {refreshed(
            <DaySections day={detail.day} detail={detail} onOpenAccount={onOpenAccount} />,
          )}
        </AdminPage>,
      ),
  });
}
