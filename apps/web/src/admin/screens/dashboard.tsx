import { browserClient } from "@luke/features/contract/browser-client";
import type { AdminMetrics, AdminTrend } from "@luke/service/admin/admin-metrics";
import type { AdminOverview, AdminOverviewAccount } from "@luke/service/admin/admin-overview";
import {
  RETENTION_BASIS,
  type RetentionBasis,
} from "@luke/service/admin/admin-overview-vocabulary";
import type { AdminMetricsWindow, AdminWindowedQuery } from "@luke/service/admin/http";
import { CHOICE_BAR_LOOK, ChoiceBar } from "@luke/ui";
import { ACCOUNTS_SORT_KEY, type AccountsDetailColumn } from "@luke/ui/accounts-sort";
import { formatDate, formatNumber } from "@luke/ui/admin-format";
import { useState } from "react";
import { ACCOUNTS_TABLE_MIN_WIDTH, AccountsTable } from "../accounts-table/accounts-table";
import { ActivityChart } from "../charts/activity-chart";
import { TrendMove } from "../charts/chart-frame";
import { RetentionGrid } from "../charts/retention-grid";
import { FunnelChart, ReachChart } from "../charts/share-bars";
import { SignupsChart } from "../charts/signups-chart";
import { SectionHeading, StatCard, StatGroup } from "../charts/stat-card";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, Refreshing, WindowSwitcher } from "../chrome/controls";
import { ActivityNote, RetentionNote, TopAccountsNote } from "../chrome/notes";
import { AdminPage, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { windowedReadQuery } from "../routing";
import { SKELETON_PLOT, SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import {
  ADMIN_READ,
  type AdminReader,
  type AdminReadHandle,
  adminReadFailure,
  useAdminRead,
} from "../use-admin-read";

const METRICS_ERROR = "The metrics endpoint did not answer.";

/** The dashboard's numbers, as the admin metrics procedure answers them. */
const readMetrics =
  (query: AdminWindowedQuery): AdminReader<AdminMetrics> =>
  async (signal) =>
    // SAFETY: the admin metrics procedure answers an AdminMetrics (`@luke/service/admin/admin-metrics`), which the contract cannot name.
    (await browserClient.admin.metrics(query, { signal })) as AdminMetrics;

/** What the page is called, in the sidebar and over the page alike. */
const OVERVIEW_TITLE = "Overview";

/** The retention grid's two bases, the meaningful one first and chosen until another is. */
const RETENTION_OPTIONS = [
  { value: RETENTION_BASIS.MEANINGFUL, label: "Meaningful action" },
  { value: RETENTION_BASIS.HOSTED_CALL, label: "Any hosted call" },
] as const;

/** The dashboard's own sections, in the order the loaded page states them. */
const DASHBOARD_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.HEADING, label: "This week" },
  { kind: SKELETON_SHAPE.STAT_GROUP, cards: 4 },
  { kind: SKELETON_SHAPE.HEADING, label: "Activity by feature" },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.ACTIVITY] },
  { kind: SKELETON_SHAPE.STATIC, node: <ActivityNote /> },
  { kind: SKELETON_SHAPE.HEADING, label: "Activation and reach" },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.SHARE_BARS, SKELETON_PLOT.SHARE_BARS] },
  { kind: SKELETON_SHAPE.HEADING, label: "Retention · weekly cohorts" },
  { kind: SKELETON_SHAPE.RETENTION },
  { kind: SKELETON_SHAPE.STATIC, node: <RetentionNote basis={RETENTION_BASIS.MEANINGFUL} /> },
  { kind: SKELETON_SHAPE.HEADING, label: "Most active accounts" },
  { kind: SKELETON_SHAPE.TABLE, rows: 10, numericColumns: 6 },
  { kind: SKELETON_SHAPE.STATIC, node: <TopAccountsNote /> },
  { kind: SKELETON_SHAPE.HEADING, label: "Signups" },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.SIGNUPS] },
];

/**
 * The most active accounts' own columns after Active days: what each did in
 * the window, and when it last signed in. The table is ranked by the server
 * and draws no sort, so no ordering rides these but the column's own.
 */
const OVERVIEW_ACCOUNT_COLUMNS: readonly AccountsDetailColumn<AdminOverviewAccount>[] = [
  {
    key: ACCOUNTS_SORT_KEY.TASKS,
    label: "Tasks",
    cell: (row) => formatNumber(row.tasks),
    sortValue: (row) => row.tasks,
  },
  {
    key: ACCOUNTS_SORT_KEY.AGENTS,
    label: "Agents",
    cell: (row) => formatNumber(row.agents),
    sortValue: (row) => row.agents,
  },
  {
    key: ACCOUNTS_SORT_KEY.PRS_MERGED,
    label: "PRs merged",
    cell: (row) => formatNumber(row.prsMerged),
    sortValue: (row) => row.prsMerged,
  },
  {
    key: ACCOUNTS_SORT_KEY.CALL_MINUTES,
    label: "Call min",
    cell: (row) => formatNumber(row.callMinutes),
    sortValue: (row) => row.callMinutes,
  },
  {
    key: ACCOUNTS_SORT_KEY.LAST_SEEN,
    label: "Last seen",
    cell: (row) => (row.lastSeenAt === null ? "—" : formatDate(row.lastSeenAt)),
    sortValue: (row) => row.lastSeenAt,
  },
];

function percentOf(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** A tile's figure for the recent run, its move against the run before, and what else it says. */
function TrendTile({
  label,
  trend,
  detail,
}: {
  label: string;
  trend: AdminTrend;
  detail?: string | undefined;
}): React.JSX.Element {
  return (
    <StatCard
      label={label}
      value={formatNumber(trend.recent)}
      hint={
        <>
          <TrendMove trend={trend} /> vs the {trend.days} days before
          {detail === undefined ? null : ` · ${detail}`}
        </>
      }
      title={`against ${formatNumber(trend.prior)} in the ${trend.days} days before`}
      grouped
    />
  );
}

/**
 * The four headline tiles, each over the last seven UTC days against the
 * seven before: who is active, and the tasks, agents, and pull requests the
 * product exists to move.
 */
function HeadlineTiles({ headline }: { headline: AdminOverview["headline"] }): React.JSX.Element {
  const { activeDevelopers, tasksCreated, agentsStarted, prsMerged, prsOpened } = headline;
  const days = activeDevelopers.days;
  return (
    <StatGroup>
      <TrendTile label="Weekly active developers" trend={activeDevelopers} />
      <TrendTile
        label={`Tasks created · ${days} days`}
        trend={tasksCreated}
        detail={
          activeDevelopers.recent === 0
            ? undefined
            : `${(tasksCreated.recent / activeDevelopers.recent).toFixed(1)} per active developer`
        }
      />
      <TrendTile
        label={`Agents started · ${days} days`}
        trend={agentsStarted}
        detail={
          agentsStarted.recent === 0
            ? undefined
            : `${percentOf(headline.agentsFromAutomations, agentsStarted.recent)} from automations`
        }
      />
      <TrendTile
        label={`PRs merged · ${days} days`}
        trend={prsMerged}
        detail={
          prsOpened.opened === 0
            ? undefined
            : `${percentOf(prsOpened.merged, prsOpened.opened)} of this week's agents' ${formatNumber(prsOpened.opened)} PRs merged`
        }
      />
    </StatGroup>
  );
}

/**
 * The overview's own read. It is held by the shell rather than by the screen
 * below, because the animations view — which reads nothing itself — honors the
 * refusals this read already landed, and a read mounted with the screen would
 * take them away with it.
 */
export function useMetricsRead(
  hideAdmins: boolean,
  windowDays: AdminMetricsWindow,
  enabled: boolean,
): AdminReadHandle<AdminMetrics> {
  const query = windowedReadQuery(hideAdmins, windowDays);
  return useAdminRead(
    { procedure: ADMIN_READ.METRICS, query: query },
    readMetrics(query),
    METRICS_ERROR,
    {
      enabled,
    },
  );
}

export function DashboardScreen({
  read,
  hideAdmins,
  onHideAdminsChange,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
  onOpenAccount,
  onOpenDay,
  frame,
}: {
  read: AdminReadHandle<AdminMetrics>;
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onOpenAccount: (id: string) => void;
  onOpenDay: (day: string) => void;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { state, refreshing, reload, withdraw } = read;
  const signOut = () => void withdraw(onSignOut);
  // The basis is the page's own choice, kept across refreshes and windows:
  // both grids ride every answer, so flipping it reads nothing.
  const [basis, setBasis] = useState<RetentionBasis>(RETENTION_BASIS.MEANINGFUL);

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title={OVERVIEW_TITLE}
          controls={
            <>
              <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
              <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
            </>
          }
          shapes={DASHBOARD_SHAPES}
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
          detail={adminReadFailure(state, METRICS_ERROR)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case "ready": {
      const metrics = state.value;
      const overview = metrics.overview;

      return frame(
        <AdminPage
          title={OVERVIEW_TITLE}
          controls={
            <>
              <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
              <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
            </>
          }
        >
          {/* A refetch dims the answer already on screen rather than replacing it:
          the numbers below stay the last ones actually read, and the dimming
          says so while the next read is in flight. */}
          <Refreshing failure={state.refreshFailure} refreshing={refreshing} onRetry={reload}>
            <SectionHeading>This week</SectionHeading>
            <HeadlineTiles headline={overview.headline} />

            <SectionHeading>Activity by feature</SectionHeading>
            <ActivityChart
              activity={overview.activity}
              generatedAt={metrics.generatedAt}
              onOpenDay={onOpenDay}
            />
            <ActivityNote />

            <SectionHeading>Activation and reach</SectionHeading>
            <div className="grid gap-3 min-[720px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <FunnelChart funnel={overview.funnel} windowDays={metrics.windowDays} />
              <ReachChart reach={overview.reach} />
            </div>

            <SectionHeading>Retention · weekly cohorts</SectionHeading>
            <div className="mb-3">
              <ChoiceBar
                label="Retained by"
                items={RETENTION_OPTIONS}
                value={basis}
                look={CHOICE_BAR_LOOK.SEGMENTED}
                onChange={setBasis}
              />
            </div>
            <RetentionGrid
              retention={
                basis === RETENTION_BASIS.MEANINGFUL ? overview.retention : metrics.retention
              }
            />
            <RetentionNote basis={basis} />

            <SectionHeading>Most active accounts</SectionHeading>
            <AccountsTable
              rows={overview.topAccounts}
              windowDays={metrics.windowDays}
              emptyText="No meaningful actions recorded in this window yet."
              minWidth={ACCOUNTS_TABLE_MIN_WIDTH.ROSTER}
              onOpen={onOpenAccount}
              hostedColumns={false}
              trailingColumns={OVERVIEW_ACCOUNT_COLUMNS}
            />
            <TopAccountsNote />

            <SectionHeading>Signups</SectionHeading>
            <SignupsChart
              daily={metrics.users.dailySignups}
              trend={metrics.users.signupTrend}
              generatedAt={metrics.generatedAt}
            />
          </Refreshing>
        </AdminPage>,
      );
    }
  }
}
