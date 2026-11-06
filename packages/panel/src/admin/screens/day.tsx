import type {
  AdminDayAccount,
  AdminDayActiveAccount,
  AdminDayDetail,
} from "@repo/features/admin-answer-wire";
import {
  ACTIVITY_FEATURE,
  DAY_ACCOUNT_COUNT,
  type DayAccountCount,
} from "@repo/features/admin-overview-vocabulary";
import { formatCount } from "@repo/features/number-format";
import { formatDayHeading } from "@repo/features/time-format";
import { readFailedWords } from "@repo/features/words";
import {
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
} from "@repo/ui";
import { partialDayKey } from "@repo/ui/daily-series";
import { useQuery } from "@tanstack/react-query";
import { AccountCell, AccountCellSkeleton } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminDayQuery, useAdminSignOut } from "../admin-queries.js";
import { adminReadView } from "../admin-read-view.js";
import { activityFeatureLabel } from "../charts/activity-chart.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { AdminViewOptions } from "../chrome/controls.js";
import { DayActivityNote, DayNote, retiredTitle } from "../chrome/notes.js";
import { AdminPage, type AdminWayBack, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { DataTableSkeleton } from "../chrome/table-skeleton.js";
import { ADMIN_TAB, dayReadQuery } from "../routing.js";

const DAY_ERROR = readFailedWords("this day");

/** How many accounts the table's skeleton stands a row for, about a quiet day's. */
const ACCOUNT_SKELETON_ROWS = 5;

/** The day's account column, the one whose cell is an account's. */
const ACCOUNT_COLUMN = "account";

/** Each per-account count's column heading, in the order the columns stand. */
const DAY_ACCOUNT_COUNT_LABEL = {
  [DAY_ACCOUNT_COUNT.TASKS_CREATED]: "Tasks",
  [DAY_ACCOUNT_COUNT.PLAN_REVISIONS]: "Plan revisions",
  [DAY_ACCOUNT_COUNT.AGENTS_STARTED]: "Agents",
  [DAY_ACCOUNT_COUNT.INBOX_ANSWERED]: "Inbox answered",
  [DAY_ACCOUNT_COUNT.AUTOMATION_RUNS]: "Automation runs",
} satisfies Record<DayAccountCount, string>;

/** What a card under the day says while the day is still filling, and nothing once it is past. */
function soFarToday(stillFilling: boolean): (() => string) | undefined {
  return stillFilling ? () => "so far today" : undefined;
}

/**
 * The day's live cards: its active developers, then one per feature the
 * Overview's chart stacks, each the segment of the bar that opened the page.
 */
function activityStats(stillFilling: boolean): readonly StatSpec<AdminDayDetail>[] {
  const hint = soFarToday(stillFilling);
  return [
    {
      key: "active-developers",
      label: () => "Active developers",
      value: (detail) => formatCount(detail.activity.activeDevelopers),
      hint,
    },
    ...Object.values(ACTIVITY_FEATURE).map(
      (feature): StatSpec<AdminDayDetail> => ({
        key: feature,
        label: () => activityFeatureLabel(feature),
        value: (detail) => formatCount(detail.activity.features[feature]),
        hint,
      }),
    ),
  ];
}

/** The live table's columns: who acted, then how many of each kind. */
function activeAccountColumns(
  onOpen: (id: string) => void,
): readonly DataTableColumn<AdminDayActiveAccount>[] {
  return [
    {
      key: ACCOUNT_COLUMN,
      label: "Account",
      cell: (row) => <AccountCell account={row} onOpen={onOpen} />,
    },
    ...Object.values(DAY_ACCOUNT_COUNT).map(
      (kind): DataTableColumn<AdminDayActiveAccount> => ({
        key: kind,
        label: DAY_ACCOUNT_COUNT_LABEL[kind],
        kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
        cell: (row) => formatCount(row.counts[kind]),
      }),
    ),
  ];
}

/**
 * The retired hosted tier's two cards, each saying under its figure that the
 * day is still filling where it is today.
 */
function hostedStats(stillFilling: boolean): readonly StatSpec<AdminDayDetail>[] {
  const soFar = soFarToday(stillFilling);
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
 * The day's active accounts, busiest first as the endpoint orders them. The
 * shared `AccountsTable` draws windowed columns a single day does not have,
 * so the day page keeps tables of its own over the same account cell: the
 * row for the pointer, the anchor on the name for a keyboard.
 */
function ActiveAccountsTable({
  accounts,
  onOpen,
}: {
  accounts: readonly AdminDayActiveAccount[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <DataTable
      label="Accounts active this day"
      columns={activeAccountColumns(onOpen)}
      rows={accounts}
      rowKey={(row) => row.id}
      empty="No tasks, plan revisions, or agents recorded on this day."
      minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
      onRowPress={(row) => onOpen(row.id)}
    />
  );
}

/** The day's hosted-tier accounts, busiest first, under the retired heading. */
function DayAccountsTable({
  accounts,
  onOpen,
}: {
  accounts: readonly AdminDayAccount[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <DataTable
      label="Hosted-tier accounts this day"
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
 * and as their skeletons until then: its live activity first, then the
 * retired hosted tier's two, headed retired. Whether the day is still
 * filling is known from `day` before the answer, by the clock, and from the
 * answer's own instant once it lands.
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
      <AdminSection title="This day">
        <StatCards layout={STAT_LAYOUT.GROUP} stats={activityStats(stillFilling)} data={detail} />
      </AdminSection>

      <AdminSection title="Accounts active this day">
        {detail === undefined ? (
          <DataTableSkeleton
            label="Accounts active this day"
            columns={activeAccountColumns(onOpenAccount)}
            rows={ACCOUNT_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            cells={{ [ACCOUNT_COLUMN]: <AccountCellSkeleton /> }}
          />
        ) : (
          <>
            <ActiveAccountsTable accounts={detail.activity.accounts} onOpen={onOpenAccount} />
            {detail.activity.accounts.length > 0 ? (
              <DayActivityNote
                truncatedTo={
                  detail.activity.activeDevelopers > detail.activity.accounts.length
                    ? detail.activity.accounts.length
                    : undefined
                }
                activeDevelopers={detail.activity.activeDevelopers}
              />
            ) : null}
          </>
        )}
      </AdminSection>

      <AdminSection title={retiredTitle("Hosted tier · this day")}>
        <StatCards layout={STAT_LAYOUT.ROW} stats={hostedStats(stillFilling)} data={detail} />
      </AdminSection>

      <AdminSection title={retiredTitle("Hosted-tier accounts this day")}>
        {detail === undefined ? (
          <DataTableSkeleton
            label="Hosted-tier accounts this day"
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
  const read = useQuery({ ...adminDayQuery(reads, query), enabled: !gate.heldAtGate() });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();
  const back: AdminWayBack = { tab: ADMIN_TAB.DASHBOARD, onBack };
  const controls = (
    <AdminViewOptions hideAdmins={hideAdmins} onHideAdminsChange={onHideAdminsChange} />
  );

  return adminReadView({
    read,
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
