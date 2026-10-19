import { browserClient } from "@luke/features/contract/browser-client";
import type { AdminDayAccount, AdminDayDetail } from "@luke/service/admin/admin-day";
import type { AdminDayQuery } from "@luke/service/admin/http";
import {
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
} from "@luke/ui";
import { formatDayHeading, formatNumber } from "@luke/ui/admin-format";
import { partialDayKey } from "@luke/ui/daily-series";
import { AccountCell } from "../accounts-table/accounts-table";
import { SectionHeading, STAT_CELL, STAT_ROW, StatCard } from "../charts/stat-card";
import { BackLink } from "../chrome/back-link";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, Refreshing } from "../chrome/controls";
import { DayNote } from "../chrome/notes";
import { AdminPage, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { dayReadQuery } from "../routing";
import { SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { type AdminReader, adminQuestion, adminReadFailure, useAdminRead } from "../use-admin-read";

const DAY_ERROR = "The day endpoint did not answer.";

/** One day's accounts, as the admin day procedure answers them. */
const readDayDetail =
  (query: AdminDayQuery): AdminReader<AdminDayDetail> =>
  async (signal) =>
    // SAFETY: the admin day procedure answers an AdminDayDetail (`@luke/service/admin/admin-day`), which the contract cannot name.
    (await browserClient.admin.day(query, { signal })) as AdminDayDetail;

/** What the day's page says it is, under the heading the address already names. */
const DAY_DESCRIPTION = "One UTC day of hosted-tier calls";

/** One day's own sections. */
const DAY_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.HEADING, label: "Hosted tier · this day" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 2, columns: 2 },
  { kind: SKELETON_SHAPE.HEADING, label: "Accounts active this day" },
  { kind: SKELETON_SHAPE.TABLE, rows: 5, numericColumns: 1 },
];

/** The day's two columns: who called, and how many times. */
function dayAccountColumns(
  onOpen: (id: string) => void,
): readonly DataTableColumn<AdminDayAccount>[] {
  return [
    {
      key: "account",
      label: "Account",
      cell: (row) => <AccountCell account={row} onOpen={onOpen} />,
    },
    {
      key: "calls",
      label: "Calls",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      cell: (row) => formatNumber(row.calls),
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
  const query = dayReadQuery(day, hideAdmins);
  const { state, refreshing, reload, withdraw } = useAdminRead(
    adminQuestion("day", query),
    readDayDetail(query),
    DAY_ERROR,
    { keeps: (shown) => shown.day === day },
  );
  const signOut = () => void withdraw(onSignOut);

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title={formatDayHeading(day)}
          description={DAY_DESCRIPTION}
          account={account}
          onSignOut={signOut}
          controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
          back={{ tab: "dashboard", label: "Overview", onBack }}
          shapes={DAY_SHAPES}
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
          detail={adminReadFailure(state, DAY_ERROR)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case "ready": {
      const detail = state.value;
      const stillFilling = partialDayKey([{ day: detail.day }], detail.generatedAt) !== undefined;
      const soFar = stillFilling ? "so far today" : undefined;

      return frame(
        <AdminPage
          title={formatDayHeading(detail.day)}
          description={`${DAY_DESCRIPTION}${stillFilling ? " — still filling" : ""}`}
          account={account}
          onSignOut={signOut}
          controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
        >
          <Refreshing failure={state.refreshFailure} refreshing={refreshing} onRetry={reload}>
            <BackLink tab="dashboard" label="Overview" onBack={onBack} />

            <SectionHeading>Hosted tier · this day</SectionHeading>
            {/* Note that each card shares the row from nothing up but never
            shrinks below its own figure, so the pair stacks once a figure
            needs the room rather than overflowing its card. */}
            <div className={STAT_ROW}>
              <div className={STAT_CELL}>
                <StatCard
                  label="Active accounts"
                  value={formatNumber(detail.totals.accounts)}
                  hint={soFar}
                />
              </div>
              <div className={STAT_CELL}>
                <StatCard
                  label="Hosted calls"
                  value={formatNumber(detail.totals.calls)}
                  hint={soFar}
                />
              </div>
            </div>

            <SectionHeading>Accounts active this day</SectionHeading>
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
          </Refreshing>
        </AdminPage>,
      );
    }
  }
}
