import type { AdminIntegration, AdminMetrics } from "@luke/service/admin/admin-metrics";
import type { AdminMetricsWindow } from "@luke/service/admin/http";
import { BADGE_TONE, Badge, List, ListRow, TEXT_TONE, Text } from "@luke/ui";
import { formatNumber } from "@luke/ui/admin-format";
import { ACCOUNTS_TABLE_MIN_WIDTH, AccountsTable } from "../accounts-table/accounts-table";
import { RetentionGrid } from "../charts/retention-grid";
import { SignInMethodsChart, SignupsChart } from "../charts/signups-chart";
import { MetricCard, SectionHeading, StatCard, StatGroup } from "../charts/stat-card";
import { UsageChart } from "../charts/usage-chart";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, Refreshing, WindowSwitcher } from "../chrome/controls";
import { RetentionNote, TopAccountsNote } from "../chrome/notes";
import { AdminPage, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { METRICS_PATH, windowedReadPath } from "../routing";
import { SKELETON_PLOT, SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import {
  type AdminReader,
  type AdminReadHandle,
  adminReadFailure,
  useAdminRead,
} from "../use-admin-read";

const METRICS_ERROR = "The metrics endpoint did not answer.";

// SAFETY: a 200 from the admin metrics endpoint is an AdminMetrics body by its contract.
const readMetrics: AdminReader<AdminMetrics> = async (response) =>
  (await response.json()) as AdminMetrics;

/** The dashboard's own sections, in the order the loaded page states them. */
const DASHBOARD_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.HEADING, label: "User activity" },
  { kind: SKELETON_SHAPE.STAT_GROUP },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.SIGNUPS, SKELETON_PLOT.SIGN_IN_METHODS] },
  { kind: SKELETON_SHAPE.HEADING, label: "Signup retention · weekly cohorts" },
  { kind: SKELETON_SHAPE.RETENTION },
  { kind: SKELETON_SHAPE.STATIC, node: <RetentionNote /> },
  { kind: SKELETON_SHAPE.HEADING, label: "Feature usage · hosted tier" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 1, columns: 1 },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.USAGE] },
  { kind: SKELETON_SHAPE.HEADING, label: "Most active hosted-tier accounts" },
  { kind: SKELETON_SHAPE.TABLE, rows: 10, numericColumns: 3 },
  { kind: SKELETON_SHAPE.STATIC, node: <TopAccountsNote /> },
  { kind: SKELETON_SHAPE.HEADING, label: "Reliability" },
  { kind: SKELETON_SHAPE.LINES, bones: ["100%", "100%", "40%"] },
  { kind: SKELETON_SHAPE.HEADING, label: "System health" },
  { kind: SKELETON_SHAPE.HEALTH },
];

/** One integration in the health card's list: its name, and whether its keys are set. */
function IntegrationRow({ integration }: { integration: AdminIntegration }): React.JSX.Element {
  return (
    <ListRow
      title={integration.label}
      meta={
        <Badge tone={integration.configured ? BADGE_TONE.COMPLETE : BADGE_TONE.ATTENTION}>
          {integration.configured ? "Configured" : "Not configured"}
        </Badge>
      }
    />
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
  return useAdminRead(
    windowedReadPath(METRICS_PATH, hideAdmins, windowDays),
    readMetrics,
    METRICS_ERROR,
    { enabled },
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

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title="Dashboard"
          account={account}
          onSignOut={signOut}
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
      const db = metrics.systemHealth.database;

      return frame(
        <AdminPage
          title="Dashboard"
          account={account}
          onSignOut={signOut}
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
            <SectionHeading>User activity</SectionHeading>
            <StatGroup>
              <StatCard label="Total accounts" value={formatNumber(metrics.users.total)} grouped />
              {/* The hint already carries the window total, so the run this count
              is read against rides the title attribute instead. */}
              <StatCard
                label={`New · ${metrics.users.signupTrend.days} days`}
                value={formatNumber(metrics.users.signupTrend.recent)}
                hint={`${formatNumber(metrics.users.newInWindow)} in ${metrics.windowDays} days`}
                title={`against ${formatNumber(metrics.users.signupTrend.prior)} in the ${metrics.users.signupTrend.days} days before`}
                grouped
              />
              <StatCard
                label="Active today"
                value={formatNumber(metrics.featureUsage.activeUsersToday)}
                hint={`${formatNumber(metrics.featureUsage.activeUsersWindow)} accounts in ${metrics.windowDays} days`}
                grouped
              />
            </StatGroup>
            <div className="mt-3 grid gap-3 min-[720px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <SignupsChart
                daily={metrics.users.dailySignups}
                trend={metrics.users.signupTrend}
                generatedAt={metrics.generatedAt}
              />
              <SignInMethodsChart
                methods={metrics.users.signInMethods}
                totalAccounts={metrics.users.total}
              />
            </div>

            <SectionHeading>Signup retention · weekly cohorts</SectionHeading>
            <RetentionGrid retention={metrics.retention} />
            <RetentionNote />

            <SectionHeading>Feature usage · hosted tier</SectionHeading>
            <StatCard
              label="Hosted calls · today"
              value={formatNumber(metrics.featureUsage.callsToday)}
              hint={`${formatNumber(metrics.featureUsage.callsWindow)} in ${metrics.windowDays} days`}
            />
            <div className="mt-3">
              <UsageChart
                daily={metrics.featureUsage.daily}
                trend={metrics.featureUsage.usageTrend}
                label="Hosted-tier calls per day"
                generatedAt={metrics.generatedAt}
                onOpenDay={onOpenDay}
              />
            </div>
            <SectionHeading>Most active hosted-tier accounts</SectionHeading>
            <AccountsTable
              rows={metrics.featureUsage.topUsers}
              windowDays={metrics.windowDays}
              emptyText="No hosted-tier usage recorded in this window yet."
              minWidth={ACCOUNTS_TABLE_MIN_WIDTH.OVERVIEW}
              onOpen={onOpenAccount}
            />
            <TopAccountsNote />

            <SectionHeading>Reliability</SectionHeading>
            <Text tone={TEXT_TONE.MUTED}>
              The service's own tables hold no rejection signal: nothing is refused on the usage
              counts above. Per-request error rates and client-side failures are recorded as
              product-analytics events, which live with{" "}
              {metrics.reliability.analyticsConsoleUrl ? (
                <a
                  href={metrics.reliability.analyticsConsoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 transition-colors duration-150 hover:text-foreground"
                >
                  the analytics processor
                </a>
              ) : (
                "the analytics processor"
              )}{" "}
              rather than in this database.
            </Text>

            <SectionHeading>System health</SectionHeading>
            <div className="grid gap-3 min-[720px]:grid-cols-[1fr_1.4fr]">
              <MetricCard
                label="Database"
                hint={`probe round-trip ${formatNumber(db.latencyMs)} ms`}
              >
                <div>
                  <Badge tone={db.reachable ? BADGE_TONE.COMPLETE : BADGE_TONE.ATTENTION}>
                    {db.reachable ? "Reachable" : "Unreachable"}
                  </Badge>
                </div>
              </MetricCard>
              <MetricCard label="Integrations">
                <List label="Integrations">
                  {metrics.systemHealth.integrations.map((integration) => (
                    <IntegrationRow key={integration.key} integration={integration} />
                  ))}
                </List>
              </MetricCard>
            </div>
          </Refreshing>
        </AdminPage>,
      );
    }
  }
}
