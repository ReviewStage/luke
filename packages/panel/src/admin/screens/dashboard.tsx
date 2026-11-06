import type {
  AdminMetrics,
  AdminOverview,
  AdminOverviewAccount,
  AdminTrend,
} from "@repo/features/admin-answer-wire";
import { RETENTION_BASIS } from "@repo/features/admin-overview-vocabulary";
import type { AdminMetricsWindow } from "@repo/features/admin-wire";
import { formatCount, formatPercent } from "@repo/features/number-format";
import { formatDate } from "@repo/features/time-format";
import { readFailedWords } from "@repo/features/words";
import { ACCOUNTS_SORT_KEY, type AccountsDetailColumn } from "@repo/ui/accounts-sort";
import { useQuery } from "@tanstack/react-query";
import {
  ACCOUNTS_TABLE_MIN_WIDTH,
  AccountsTable,
  AccountsTableSkeleton,
} from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminMetricsQuery, useAdminSignOut } from "../admin-queries.js";
import { adminReadView } from "../admin-read-view.js";
import { ActivityChart, ActivityChartSkeleton } from "../charts/activity-chart.js";
import { CHART_PAIR_WIDE, TrendMove } from "../charts/chart-frame.js";
import { RetentionGrid, RetentionGridSkeleton } from "../charts/retention-grid.js";
import {
  AgentOriginsChart,
  AgentOriginsChartSkeleton,
  FunnelChart,
  FunnelChartSkeleton,
  ReachChart,
  ReachChartSkeleton,
} from "../charts/share-bars.js";
import { SignupsChart, SignupsChartSkeleton } from "../charts/signups-chart.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { AdminViewOptions, windowWords } from "../chrome/controls.js";
import {
  ActivityNote,
  AgentOriginsNote,
  RetentionNote,
  retiredTitle,
  TopAccountsNote,
} from "../chrome/notes.js";
import { AdminPage, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { windowedReadQuery } from "../routing.js";

const METRICS_ERROR = readFailedWords("the overview");

const OVERVIEW_TITLE = "Overview";

const TOP_ACCOUNTS_SKELETON_ROWS = 10;

const OVERVIEW_ACCOUNT_COLUMNS: readonly AccountsDetailColumn<AdminOverviewAccount>[] = [
  {
    key: ACCOUNTS_SORT_KEY.TASKS,
    label: "Tasks",
    cell: (row) => formatCount(row.tasks),
    sortValue: (row) => row.tasks,
  },
  {
    key: ACCOUNTS_SORT_KEY.AGENTS,
    label: "Agents",
    cell: (row) => formatCount(row.agents),
    sortValue: (row) => row.agents,
  },
  {
    key: ACCOUNTS_SORT_KEY.PRS_MERGED,
    label: "PRs merged",
    cell: (row) => formatCount(row.prsMerged),
    sortValue: (row) => row.prsMerged,
  },
  {
    key: ACCOUNTS_SORT_KEY.LAST_SEEN,
    label: "Last seen",
    cell: (row) => (row.lastSeenAt === null ? "—" : formatDate(row.lastSeenAt)),
    sortValue: (row) => row.lastSeenAt,
  },
];

function percentOf(part: number, whole: number): string {
  return formatPercent(part / whole);
}

function TrendHint({
  trend,
  detail,
}: {
  trend: AdminTrend;
  detail?: string | undefined;
}): React.JSX.Element {
  return (
    <>
      <TrendMove trend={trend} /> vs the {trend.days} days before
      {detail === undefined ? null : ` · ${detail}`}
    </>
  );
}

function trendTile(
  key: string,
  label: (headline: AdminOverview["headline"]) => string,
  trendOf: (headline: AdminOverview["headline"]) => AdminTrend,
  detail: (headline: AdminOverview["headline"]) => string | undefined = () => undefined,
): StatSpec<AdminOverview["headline"]> {
  return {
    key,
    label,
    value: (headline) => formatCount(trendOf(headline).recent),
    hint: (headline) => <TrendHint trend={trendOf(headline)} detail={detail(headline)} />,
    title: (headline) =>
      `against ${formatCount(trendOf(headline).prior)} in the ${trendOf(headline).days} days before`,
  };
}

const HEADLINE_STATS: readonly StatSpec<AdminOverview["headline"]>[] = [
  trendTile(
    "active-developers",
    () => "Weekly active developers",
    (headline) => headline.activeDevelopers,
  ),
  trendTile(
    "tasks-created",
    (headline) => `Tasks created · ${headline.activeDevelopers.days} days`,
    (headline) => headline.tasksCreated,
    ({ activeDevelopers, tasksCreated }) =>
      activeDevelopers.recent === 0
        ? undefined
        : `${(tasksCreated.recent / activeDevelopers.recent).toFixed(1)} per active developer`,
  ),
  trendTile(
    "agents-started",
    (headline) => `Agents started · ${headline.activeDevelopers.days} days`,
    (headline) => headline.agentsStarted,
  ),
  trendTile(
    "prs-merged",
    (headline) => `PRs merged · ${headline.activeDevelopers.days} days`,
    (headline) => headline.prsMerged,
    ({ prsOpened }) =>
      prsOpened.opened === 0
        ? undefined
        : `${percentOf(prsOpened.merged, prsOpened.opened)} of this week's agents' ${formatCount(prsOpened.opened)} PRs merged`,
  ),
];

function DashboardSections({
  metrics,
  windowDays,
  onOpenAccount,
  onOpenDay,
}: {
  metrics: AdminMetrics | undefined;
  windowDays: AdminMetricsWindow;
  onOpenAccount: (id: string) => void;
  onOpenDay: (day: string) => void;
}): React.JSX.Element {
  const overview = metrics?.overview;
  const topAccounts = {
    windowDays: metrics?.windowDays ?? windowDays,
    minWidth: ACCOUNTS_TABLE_MIN_WIDTH.ROSTER,
    onOpen: onOpenAccount,
    trailingColumns: OVERVIEW_ACCOUNT_COLUMNS,
  };
  return (
    <>
      <AdminSection title="This week">
        <StatCards layout={STAT_LAYOUT.GROUP} stats={HEADLINE_STATS} data={overview?.headline} />
        {overview === undefined ? (
          <AgentOriginsChartSkeleton />
        ) : (
          <AgentOriginsChart origins={overview.agentOrigins} />
        )}
        <AgentOriginsNote />
      </AdminSection>

      <AdminSection title="Activity by feature">
        {metrics === undefined ? (
          <ActivityChartSkeleton />
        ) : (
          <ActivityChart
            activity={metrics.overview.activity}
            generatedAt={metrics.generatedAt}
            onOpenDay={onOpenDay}
          />
        )}
        <ActivityNote />
      </AdminSection>

      <AdminSection title="Activation and reach">
        <div className={CHART_PAIR_WIDE}>
          {metrics === undefined ? (
            <FunnelChartSkeleton windowDays={windowDays} />
          ) : (
            <FunnelChart funnel={metrics.overview.funnel} windowDays={metrics.windowDays} />
          )}
          {overview === undefined ? <ReachChartSkeleton /> : <ReachChart reach={overview.reach} />}
        </div>
      </AdminSection>

      <AdminSection title="Retention · weekly cohorts">
        {metrics === undefined ? (
          <RetentionGridSkeleton />
        ) : (
          <RetentionGrid retention={metrics.overview.retention} />
        )}
        <RetentionNote basis={RETENTION_BASIS.MEANINGFUL} />
      </AdminSection>

      <AdminSection title="Most active accounts">
        {metrics === undefined ? (
          <AccountsTableSkeleton rows={TOP_ACCOUNTS_SKELETON_ROWS} {...topAccounts} />
        ) : (
          <AccountsTable
            rows={metrics.overview.topAccounts}
            emptyText="No meaningful actions recorded in this window yet."
            {...topAccounts}
          />
        )}
        <TopAccountsNote />
      </AdminSection>

      <AdminSection title="Signups">
        {metrics === undefined ? (
          <SignupsChartSkeleton />
        ) : (
          <SignupsChart
            daily={metrics.users.dailySignups}
            trend={metrics.users.signupTrend}
            generatedAt={metrics.generatedAt}
          />
        )}
      </AdminSection>

      <AdminSection title={retiredTitle("Retention by any hosted call")}>
        {metrics === undefined ? (
          <RetentionGridSkeleton />
        ) : (
          <RetentionGrid retention={metrics.retention} />
        )}
        <RetentionNote basis={RETENTION_BASIS.HOSTED_CALL} />
      </AdminSection>
    </>
  );
}

export function DashboardScreen({
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
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onOpenAccount: (id: string) => void;
  onOpenDay: (day: string) => void;
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate } = useAdminDoors();
  const read = useQuery({
    ...adminMetricsQuery(reads, windowedReadQuery(hideAdmins, windowDays)),
    enabled: !gate.heldAtGate(),
  });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();
  const controls = (
    <>
      <AdminViewOptions
        windowDays={windowDays}
        onWindowDaysChange={onWindowDaysChange}
        hideAdmins={hideAdmins}
        onHideAdminsChange={onHideAdminsChange}
      />
    </>
  );

  const sections = {
    windowDays,
    onOpenAccount,
    onOpenDay,
  };

  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: METRICS_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title={OVERVIEW_TITLE} note={windowWords(windowDays)} controls={controls}>
          <DashboardSections metrics={undefined} {...sections} />
        </PageSkeleton>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title={OVERVIEW_TITLE} note={windowWords(windowDays)} controls={controls}>
          {error}
        </AdminPage>,
      ),
    ready: (metrics, refreshed) =>
      frame(
        <AdminPage title={OVERVIEW_TITLE} note={windowWords(windowDays)} controls={controls}>
          {refreshed(<DashboardSections metrics={metrics} {...sections} />)}
        </AdminPage>,
      ),
  });
}
