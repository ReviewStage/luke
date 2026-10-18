import type { AdminDayAccount, AdminDayDetail } from "@luke/service/admin/admin-day";
import {
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  GAP,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { formatDayHeading, formatNumber } from "@luke/ui/admin-format";
import { partialDayKey } from "@luke/ui/daily-series";
import { AccountCell } from "../accounts-table/accounts-table";
import { SectionHeading, StatCard } from "../charts/stat-card";
import { BackLink } from "../chrome/back-link";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, RefreshFailureNotice } from "../chrome/controls";
import { DayNote } from "../chrome/notes";
import { AdminPage, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { dayReadPath } from "../routing";
import { SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { type AdminReader, adminReadFailure, useAdminRead } from "../use-admin-read";

const DAY_ERROR = "The day endpoint did not answer.";

// SAFETY: a 200 from the admin day endpoint is an AdminDayDetail body by its contract.
const readDayDetail: AdminReader<AdminDayDetail> = async (response) =>
  (await response.json()) as AdminDayDetail;

/** One day's own sections, under the heading the address already names. */
function daySkeletonShapes(day: string): readonly SkeletonShape[] {
  return [
    {
      kind: SKELETON_SHAPE.MASTHEAD,
      title: formatDayHeading(day),
      lines: [{ box: "h-5", bone: "h-3.5 w-56" }],
    },
    { kind: SKELETON_SHAPE.HEADING, label: "Hosted tier · this day" },
    { kind: SKELETON_SHAPE.STAT_CARDS, count: 2, columns: 2 },
    { kind: SKELETON_SHAPE.HEADING, label: "Accounts active this day" },
    { kind: SKELETON_SHAPE.TABLE, rows: 5, numericColumns: 1 },
  ];
}

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
  const { state, refreshing, reload, withdraw } = useAdminRead(
    dayReadPath(day, hideAdmins),
    readDayDetail,
    DAY_ERROR,
    { keeps: (shown) => shown.day === day },
  );
  const signOut = () => void withdraw(onSignOut);

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title="Day"
          account={account}
          onSignOut={signOut}
          controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
          back={{ tab: "dashboard", label: "Dashboard", onBack }}
          shapes={daySkeletonShapes(day)}
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
          title="Day"
          account={account}
          onSignOut={signOut}
          controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
        >
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
            <BackLink tab="dashboard" label="Dashboard" onBack={onBack} />

            <div className="mt-6">
              <Stack gap={GAP.TIGHT}>
                <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TITLE}>
                  {formatDayHeading(detail.day)}
                </Text>
                <Text tone={TEXT_TONE.MUTED}>
                  One UTC day of hosted-tier calls{stillFilling ? " — still filling" : ""}
                </Text>
              </Stack>
            </div>

            <SectionHeading>Hosted tier · this day</SectionHeading>
            {/* Note that each card shares the row from nothing up but never
            shrinks below its own figure, so the pair stacks once a figure
            needs the room rather than overflowing its card. */}
            <div className="flex flex-wrap gap-3">
              <div className="flex-1">
                <StatCard
                  label="Active accounts"
                  value={formatNumber(detail.totals.accounts)}
                  hint={soFar}
                />
              </div>
              <div className="flex-1">
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
          </div>
        </AdminPage>,
      );
    }
  }
}
