import type {
  AdminMetrics,
  AdminOverview,
  AdminOverviewAccount,
  AdminTrend,
} from "@luke/features/admin-answer-wire";
import { RETENTION_BASIS, type RetentionBasis } from "@luke/features/admin-overview-vocabulary";
import { ADMIN_READ, type AdminMetricsWindow } from "@luke/features/admin-wire";
import { formatCount, formatPercent } from "@luke/features/number-format";
import { formatDate } from "@luke/features/time-format";
import { CHOICE_BAR_LOOK, ChoiceBar } from "@luke/ui";
import { ACCOUNTS_SORT_KEY, type AccountsDetailColumn } from "@luke/ui/accounts-sort";
import { useState } from "react";
import {
  ACCOUNTS_TABLE_MIN_WIDTH,
  AccountsTable,
  AccountsTableSkeleton,
} from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminReadView } from "../admin-read-view.js";
import { ActivityChart, ActivityChartSkeleton } from "../charts/activity-chart.js";
import { CHART_PAIR_WIDE, TrendMove } from "../charts/chart-frame.js";
import { RetentionGrid, RetentionGridSkeleton } from "../charts/retention-grid.js";
import {
  FunnelChart,
  FunnelChartSkeleton,
  ReachChart,
  ReachChartSkeleton,
} from "../charts/share-bars.js";
import { SignupsChart, SignupsChartSkeleton } from "../charts/signups-chart.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { AdminViewOptions, windowWords } from "../chrome/controls.js";
import { ActivityNote, RetentionNote, TopAccountsNote } from "../chrome/notes.js";
import { AdminPage, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { windowedReadQuery } from "../routing.js";
import { type AdminReadHandle, useAdminRead } from "../use-admin-read.js";

const METRICS_ERROR = "The metrics endpoint did not answer.";

/** What the page is called, in the sidebar and over the page alike. */
const OVERVIEW_TITLE = "Overview";

/** The retention grid's two bases, the meaningful one first and chosen until another is. */
const RETENTION_OPTIONS = [
  { value: RETENTION_BASIS.MEANINGFUL, label: "Meaningful action" },
  { value: RETENTION_BASIS.HOSTED_CALL, label: "Any hosted call" },
] as const;

/**
 * How many accounts the most-active table's skeleton stands a row for, the
 * service's `ADMIN_OVERVIEW_ACCOUNTS_LIMIT`, not imported because the module
 * exporting it carries query code the client bundle must not.
 */
const TOP_ACCOUNTS_SKELETON_ROWS = 10;

/**
 * The most active accounts' own columns after Active days: what each did in
 * the window, and when it last signed in. The table is ranked by the server
 * and draws no sort, so no ordering rides these but the column's own.
 */
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
    key: ACCOUNTS_SORT_KEY.CALL_MINUTES,
    label: "Call min",
    cell: (row) => formatCount(row.callMinutes),
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
  return formatPercent(part / whole);
}

/** A tile's move against the run before, and what else it says. */
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

/** A headline tile's figure, the recent run's, and its title, the run before it. */
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

/**
 * The four headline tiles, each over the last seven UTC days against the
 * seven before: who is active, and the tasks, agents, and pull requests the
 * product exists to move.
 */
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
    ({ agentsStarted, agentsFromAutomations }) =>
      agentsStarted.recent === 0
        ? undefined
        : `${percentOf(agentsFromAutomations, agentsStarted.recent)} from automations`,
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

/**
 * The page's sections under its toolbar, drawn from `metrics` once it is
 * read and as their skeletons until then. The retention basis is the page's
 * own choice, so its picker and its note stand live either way.
 */
function DashboardSections({
  metrics,
  windowDays,
  basis,
  onBasisChange,
  onOpenAccount,
  onOpenDay,
}: {
  metrics: AdminMetrics | undefined;
  windowDays: AdminMetricsWindow;
  basis: RetentionBasis;
  onBasisChange: (basis: RetentionBasis) => void;
  onOpenAccount: (id: string) => void;
  onOpenDay: (day: string) => void;
}): React.JSX.Element {
  const overview = metrics?.overview;
  const topAccounts = {
    windowDays: metrics?.windowDays ?? windowDays,
    minWidth: ACCOUNTS_TABLE_MIN_WIDTH.ROSTER,
    onOpen: onOpenAccount,
    hostedColumns: false,
    trailingColumns: OVERVIEW_ACCOUNT_COLUMNS,
  };
  return (
    <>
      <AdminSection title="This week">
        <StatCards layout={STAT_LAYOUT.GROUP} stats={HEADLINE_STATS} data={overview?.headline} />
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
        <div>
          <ChoiceBar
            label="Retained by"
            items={RETENTION_OPTIONS}
            value={basis}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            onChange={onBasisChange}
          />
        </div>
        {metrics === undefined ? (
          <RetentionGridSkeleton />
        ) : (
          <RetentionGrid
            retention={
              basis === RETENTION_BASIS.MEANINGFUL ? metrics.overview.retention : metrics.retention
            }
          />
        )}
        <RetentionNote basis={basis} />
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
    </>
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
  const { reads } = useAdminDoors();
  const query = windowedReadQuery(hideAdmins, windowDays);
  return useAdminRead(
    { procedure: ADMIN_READ.METRICS, query: query },
    (signal) => reads.metrics(query, signal),
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
  const { gate } = useAdminDoors();
  const { state, refreshing, reload, withdraw } = read;
  const signOut = () => void withdraw(onSignOut);
  // The basis is the page's own choice, kept across refreshes and windows:
  // both grids ride every answer, so flipping it reads nothing.
  const [basis, setBasis] = useState<RetentionBasis>(RETENTION_BASIS.MEANINGFUL);
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
    basis,
    onBasisChange: setBasis,
    onOpenAccount,
    onOpenDay,
  };

  return adminReadView({
    read: { state, refreshing, reload },
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
    // A refetch dims the answer already on screen rather than replacing it:
    // the numbers below stay the last ones actually read, and the dimming
    // says so while the next read is in flight.
    ready: (metrics, refreshed) =>
      frame(
        <AdminPage title={OVERVIEW_TITLE} note={windowWords(windowDays)} controls={controls}>
          {refreshed(<DashboardSections metrics={metrics} {...sections} />)}
        </AdminPage>,
      ),
  });
}
