import type {
  AdminAttentionAccount,
  AdminAttentionProblem,
  AdminIntegration,
  AdminReliability,
} from "@repo/features/admin-answer-wire";
import {
  ADMIN_ATTENTION_AGENT_DAYS,
  ADMIN_ATTENTION_KIND,
  ADMIN_RELIABILITY_WINDOWS,
  type AdminMetricsWindow,
} from "@repo/features/admin-wire";
import { AGENT_FAILURE, type AgentFailure } from "@repo/features/agent-wire";
import { AUTOMATION_RUN_REASON, type AutomationRunReason } from "@repo/features/automation-wire";
import { INTEGRATION_NAME } from "@repo/features/integration-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { formatCount, formatPercent } from "@repo/features/number-format";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { PROVIDER_KEY_STATUS } from "@repo/features/provider-key-wire";
import { formatDate } from "@repo/features/time-format";
import { readFailedWords } from "@repo/features/words";
import {
  Card,
  Inline,
  List,
  ListRow,
  QUIET_MARK,
  QuietWords,
  Skeleton,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  Text,
  TextLink,
} from "@repo/ui";
import { RATE_PLACES } from "@repo/ui/admin-format";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumns,
  DataTableSkeleton,
} from "@repo/ui/data-table";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { AccountCell, AccountCellSkeleton } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminReliabilityQuery, useAdminSignOut } from "../admin-queries.js";
import { adminReadView } from "../admin-read-view.js";
import {
  BreakdownChart,
  BreakdownChartSkeleton,
  type BreakdownRow,
  type BreakdownSeries,
} from "../charts/breakdown-chart.js";
import { CHART_PAIR_EVEN } from "../charts/chart-frame.js";
import { FailureRatesChart, FailureRatesChartSkeleton } from "../charts/failure-rates-chart.js";
import {
  AdminSection,
  CARD_GAP,
  MetricCard,
  MetricCardSkeleton,
  STAT_LAYOUT,
  StatCards,
  type StatSpec,
} from "../charts/stat-card.js";
import { AdminViewOptions, windowWords } from "../chrome/controls.js";
import { AppTurnsNote, retiredTitle } from "../chrome/notes.js";
import { AdminPage, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { reliabilityWindow, windowedReadQuery } from "../routing.js";
import { connectionWord, INSTALLATION_LABEL } from "../status-words.js";

const RELIABILITY_ERROR = readFailedWords("reliability");

const HEALTH_SKELETON_ROWS = 12;

const ATTENTION_SKELETON_ROWS = 5;

const ATTENTION_ACCOUNT_COLUMN = "account";

const SKELETON_STATUS_WIDTH = "64px";

const SKELETON_PROVIDER_WIDTH = "192px";

const AGENT_FAILURE_LABEL = {
  [AGENT_FAILURE.MODEL]: "Model call",
  [AGENT_FAILURE.SANDBOX]: "Sandbox or checkout",
  [AGENT_FAILURE.GITHUB]: "GitHub",
  [AGENT_FAILURE.ABANDONED]: "Abandoned by the sweep",
  [AGENT_FAILURE.PROVIDER_KEY]: "Account's own API key",
  [AGENT_FAILURE.NOT_STARTED]: "Never started",
  [AGENT_FAILURE.FAST_ON_OWN_KEY]: "Fast on own key",
  [AGENT_FAILURE.FAST_NOT_ENABLED]: "Fast not enabled",
  [AGENT_FAILURE.CONTEXT_OVERFLOW]: "Context too long",
  [AGENT_FAILURE.SESSION_ENDED]: "Session ended",
  [AGENT_FAILURE.OTHER]: "Other",
} as const satisfies Record<AgentFailure, string>;

const AUTOMATION_REASON_LABEL = {
  [AUTOMATION_RUN_REASON.CONCURRENCY]: "Agents still at work",
  [AUTOMATION_RUN_REASON.DAILY_CAP]: "Daily cap reached",
  [AUTOMATION_RUN_REASON.TASK_UNREACHABLE]: "Task unreachable",
  [AUTOMATION_RUN_REASON.CREATOR_LEFT]: "Creator left workspace",
  [AUTOMATION_RUN_REASON.NO_REPOSITORY]: "No repository",
  [AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE]: "Repository unreachable",
  [AUTOMATION_RUN_REASON.GITHUB_SIGN_IN]: "GitHub sign-in expired",
  [AUTOMATION_RUN_REASON.MODEL]: "Model no longer offered",
  [AUTOMATION_RUN_REASON.CREDENTIAL_MISSING]: "No credential connected",
  [AUTOMATION_RUN_REASON.UNAVAILABLE]: "Agents unreachable",
  [AUTOMATION_RUN_REASON.REPOSITORY_CHANGED]: "Repository changed",
  [AUTOMATION_RUN_REASON.PAUSED]: "Turned off",
  [AUTOMATION_RUN_REASON.MISSED]: "Missed its hour",
  [AUTOMATION_RUN_REASON.AGENT_GONE]: "Agent gone",
  [AUTOMATION_RUN_REASON.SAME_SUBJECT]: "Same issue in cooldown",
  [AUTOMATION_RUN_REASON.AGENT_REPLACED]: "Agent replaced",
} as const satisfies Record<AutomationRunReason, string>;

const NO_REASON_LABEL = "No reason recorded";

const RETIRED_AGENT_FAILURES: readonly AgentFailure[] = [AGENT_FAILURE.FAST_ON_OWN_KEY];

const RETIRED_AUTOMATION_REASONS: readonly AutomationRunReason[] = [
  AUTOMATION_RUN_REASON.NO_REPOSITORY,
  AUTOMATION_RUN_REASON.GITHUB_SIGN_IN,
  AUTOMATION_RUN_REASON.AGENT_GONE,
];

function retiredLast<Row>(
  rows: readonly Row[],
  retired: (row: Row) => boolean,
  toBreakdown: (row: Row) => BreakdownRow,
): BreakdownRow[] {
  const live = rows.filter((row) => !retired(row)).map(toBreakdown);
  const old = rows
    .filter(retired)
    .map(toBreakdown)
    .map((row) => ({ ...row, label: retiredTitle(row.label) }));
  return [...live, ...old];
}

const AGENT_FAILURES_SERIES: readonly BreakdownSeries[] = [
  { key: "count", label: "Failed runs", color: "var(--ui-color-danger)" },
];

const AUTOMATION_REASONS_SERIES: readonly BreakdownSeries[] = [
  { key: "skipped", label: "Skipped", color: "var(--ui-color-chart-1)" },
  { key: "failed", label: "Failed", color: "var(--ui-color-danger)" },
];

const KEY_PROVIDER_LABEL = {
  [MODEL_PROVIDER.ANTHROPIC]: "Anthropic",
  [MODEL_PROVIDER.OPENAI]: "OpenAI",
} as const;

const KEY_STATUS_LABEL = {
  [PROVIDER_KEY_STATUS.VERIFIED]: "verified",
  [PROVIDER_KEY_STATUS.INVALID]: "invalid",
  [PROVIDER_KEY_STATUS.QUOTA_EXCEEDED]: "quota exceeded",
  [PROVIDER_KEY_STATUS.UNREADABLE]: "unreadable",
  [PROVIDER_KEY_STATUS.UNVERIFIED]: "unverified",
  [PROVIDER_KEY_STATUS.LIMIT_REACHED]: "limit reached",
  [PROVIDER_KEY_STATUS.INELIGIBLE]: "ineligible",
} as const;

function problemLabel(problem: AdminAttentionProblem): string {
  switch (problem.kind) {
    case ADMIN_ATTENTION_KIND.PROVIDER_KEY:
      return `${KEY_PROVIDER_LABEL[problem.provider]} key · ${KEY_STATUS_LABEL[problem.status]}`;
    case ADMIN_ATTENTION_KIND.INTEGRATION:
      return `${INTEGRATION_NAME[problem.provider]} · ${connectionWord(problem.status)}`;
    case ADMIN_ATTENTION_KIND.GITHUB_INSTALLATION:
      return `GitHub App · ${INSTALLATION_LABEL[problem.status]}`;
  }
}

function IntegrationRow({ integration }: { integration: AdminIntegration }): React.JSX.Element {
  return (
    <ListRow
      title={integration.label}
      meta={<QuietWords>{integration.configured ? "Configured" : "Not configured"}</QuietWords>}
    />
  );
}

function ofHint(count: { failed: number; total: number }, noun: string, windowDays: number) {
  return count.total === 0
    ? `no ${noun} ended in ${windowDays} days`
    : `${formatCount(count.failed)} of ${formatCount(count.total)} ${noun}`;
}

function share(count: { failed: number; total: number }): number | null {
  return count.total === 0 ? null : count.failed / count.total;
}

const attentionColumn = createDataTableColumnHelper<AdminAttentionAccount>();

function attentionColumns(onOpen: (id: string) => void): DataTableColumns<AdminAttentionAccount> {
  return attentionColumn.columns([
    attentionColumn.display({
      id: ATTENTION_ACCOUNT_COLUMN,
      header: "Account",
      cell: ({ row: { original: row } }) => <AccountCell account={row} onOpen={onOpen} />,
    }),
    attentionColumn.display({
      id: "problems",
      header: "Broken",
      cell: ({ row: { original: row } }) => (
        <Inline>
          {row.problems.map((problem) => (
            <QuietWords key={problemLabel(problem)}>{problemLabel(problem)}</QuietWords>
          ))}
        </Inline>
      ),
    }),
    attentionColumn.display({
      id: "since",
      header: "Last changed",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: row } }) => formatDate(row.brokenSince),
    }),
    attentionColumn.display({
      id: "failed-agents",
      header: `Agents failed · ${ADMIN_ATTENTION_AGENT_DAYS}d`,
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: row } }) => formatCount(row.failedAgents),
    }),
  ]);
}

const APP_TURN_STATS: readonly StatSpec<AdminReliability>[] = [
  {
    key: "app-turns",
    label: () => `${PRODUCT_NAME} turns failed`,
    value: ({ headline }) => formatPercent(share(headline.appTurns), RATE_PLACES),
    hint: ({ headline, windowDays }) => ofHint(headline.appTurns, "turns", windowDays),
  },
];

const FAILURE_STATS: readonly StatSpec<AdminReliability>[] = [
  {
    key: "agent-runs",
    label: () => "Agent runs failed",
    value: ({ headline }) => formatPercent(share(headline.agentRuns), RATE_PLACES),
    hint: ({ headline, windowDays }) => ofHint(headline.agentRuns, "runs", windowDays),
  },
  {
    key: "abandoned",
    label: () => "Abandoned by the sweep",
    value: ({ headline }) => formatCount(headline.abandonedTurns),
    hint: () => "turns past their bound",
  },
  {
    key: "automation-runs",
    label: () => "Automation runs failed",
    value: ({ headline }) => formatPercent(share(headline.automationRuns), RATE_PLACES),
    hint: ({ headline, windowDays }) => {
      const automations = headline.automationRuns;
      return automations.total === 0
        ? ofHint(automations, "runs", windowDays)
        : `+ ${formatPercent(automations.skipped / automations.total, RATE_PLACES)} skipped`;
    },
    title: ({ headline, windowDays }) => ofHint(headline.automationRuns, "runs", windowDays),
  },
];

interface Breakdown {
  title: string;
  series: readonly BreakdownSeries[];
  rows: (reliability: AdminReliability) => readonly BreakdownRow[];
  empty: string;
}

const BREAKDOWNS: readonly Breakdown[] = [
  {
    title: "Agent failures by class",
    series: AGENT_FAILURES_SERIES,
    rows: (reliability) =>
      retiredLast(
        reliability.agentFailures,
        (row) => RETIRED_AGENT_FAILURES.includes(row.failure),
        (row) => ({ label: AGENT_FAILURE_LABEL[row.failure], counts: { count: row.count } }),
      ),
    empty: "No agent run failed in this window.",
  },
  {
    title: "Automation skips and failures by reason",
    series: AUTOMATION_REASONS_SERIES,
    rows: (reliability) =>
      retiredLast(
        reliability.automationReasons,
        (row) => row.reason !== null && RETIRED_AUTOMATION_REASONS.includes(row.reason),
        (row) => ({
          label: row.reason === null ? NO_REASON_LABEL : AUTOMATION_REASON_LABEL[row.reason],
          counts: { skipped: row.skipped, failed: row.failed },
        }),
      ),
    empty: "No automation run was skipped or failed in this window.",
  },
];

function AnalyticsNote({
  consoleUrl,
}: {
  consoleUrl: string | null | undefined;
}): React.JSX.Element {
  return (
    <Text tone={TEXT_TONE.MUTED}>
      Per-request HTTP error rates live in{" "}
      {consoleUrl ? (
        <TextLink href={consoleUrl} look={TEXT_LINK_LOOK.UNDERLINED} external newTab>
          product analytics
        </TextLink>
      ) : (
        "product analytics"
      )}
      , not this database.
    </Text>
  );
}

function AttentionNote({
  attention,
}: {
  attention: AdminReliability["attention"] | undefined;
}): React.JSX.Element {
  return (
    <Text tone={TEXT_TONE.MUTED}>
      A broken key, integration, or GitHub installation fails the account's agents quietly. Last
      changed is when the newest broken row last changed: a key's last answer from its provider, or
      an integration's or installation's last update, which a sign-in retried and not finished also
      moves. Agents failed counts the account's agents with a failed run in the last{" "}
      {ADMIN_ATTENTION_AGENT_DAYS} days.
      {attention !== undefined && attention.total > attention.accounts.length
        ? ` Only the ${formatCount(attention.accounts.length)} newest of ${formatCount(attention.total)} are listed.`
        : ""}
    </Text>
  );
}

function ReliabilityRecords({
  reliability,
  onOpenAccount,
}: {
  reliability: AdminReliability | undefined;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  const attentionTableColumns = useMemo(() => attentionColumns(onOpenAccount), [onOpenAccount]);
  return (
    <>
      <AdminSection title="Failures">
        <StatCards layout={STAT_LAYOUT.GROUP} stats={FAILURE_STATS} data={reliability} />
        {reliability === undefined ? (
          <FailureRatesChartSkeleton />
        ) : (
          <FailureRatesChart daily={reliability.daily} generatedAt={reliability.generatedAt} />
        )}
        <AnalyticsNote consoleUrl={reliability?.analyticsConsoleUrl} />
      </AdminSection>

      <AdminSection title="Why work failed">
        <div className={CHART_PAIR_EVEN}>
          {BREAKDOWNS.map((breakdown) =>
            reliability === undefined ? (
              <BreakdownChartSkeleton
                key={breakdown.title}
                title={breakdown.title}
                series={breakdown.series}
              />
            ) : (
              <BreakdownChart
                key={breakdown.title}
                title={breakdown.title}
                series={breakdown.series}
                rows={breakdown.rows(reliability)}
                empty={breakdown.empty}
              />
            ),
          )}
        </div>
      </AdminSection>

      <AdminSection title="Accounts that need attention">
        {reliability === undefined ? (
          <DataTableSkeleton
            label="Accounts that need attention"
            columns={attentionTableColumns}
            rows={ATTENTION_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            cells={{ [ATTENTION_ACCOUNT_COLUMN]: <AccountCellSkeleton /> }}
          />
        ) : (
          <DataTable
            label="Accounts that need attention"
            columns={attentionTableColumns}
            rows={reliability.attention.accounts}
            getRowId={(row) => row.id}
            empty="No account holds a broken key, integration, or GitHub installation."
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            onRowPress={(row) => onOpenAccount(row.id)}
          />
        )}
        <AttentionNote attention={reliability?.attention} />
      </AdminSection>
    </>
  );
}

function StatusWordsSkeleton(): React.JSX.Element {
  return (
    <Inline>
      <QuietWords>
        <Skeleton width={SKELETON_STATUS_WIDTH} />
      </QuietWords>
    </Inline>
  );
}

function DatabaseCardSkeleton(): React.JSX.Element {
  return (
    <MetricCardSkeleton>
      <StatusWordsSkeleton />
    </MetricCardSkeleton>
  );
}

function IntegrationsCardSkeleton(): React.JSX.Element {
  return (
    <MetricCardSkeleton hint={false}>
      <List label="Integrations">
        {Array.from({ length: HEALTH_SKELETON_ROWS }, (_, row) => (
          <ListRow
            key={row}
            title={<Skeleton width={SKELETON_PROVIDER_WIDTH} />}
            meta={<StatusWordsSkeleton />}
          />
        ))}
      </List>
    </MetricCardSkeleton>
  );
}

function SystemHealth({
  health,
}: {
  health: AdminReliability["systemHealth"] | undefined;
}): React.JSX.Element {
  return (
    <AdminSection title="System health">
      <div className={`grid ${CARD_GAP} @min-[720px]/admin-section:grid-cols-[1fr_1.4fr]`}>
        {health === undefined ? (
          <DatabaseCardSkeleton />
        ) : (
          <MetricCard
            label="Database"
            hint={`probe round-trip ${formatCount(health.database.latencyMs)} ms`}
          >
            <Inline>
              <QuietWords mark={health.database.reachable ? undefined : QUIET_MARK.FAILED}>
                {health.database.reachable ? "Reachable" : "Unreachable"}
              </QuietWords>
            </Inline>
          </MetricCard>
        )}
        {health === undefined ? (
          <IntegrationsCardSkeleton />
        ) : (
          <MetricCard label="Integrations">
            <List label="Integrations">
              {health.integrations.map((integration) => (
                <IntegrationRow key={integration.key} integration={integration} />
              ))}
            </List>
          </MetricCard>
        )}
      </div>
    </AdminSection>
  );
}

function ReliabilityBody({
  reliability,
  onOpenAccount,
}: {
  reliability: AdminReliability | undefined;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      {reliability === undefined || reliability.systemHealth.database.reachable ? (
        <ReliabilityRecords reliability={reliability} onOpenAccount={onOpenAccount} />
      ) : (
        <AdminSection title="Failures">
          <Card>
            <Text tone={TEXT_TONE.MUTED}>
              The database did not answer its probe, so no failure count or account could be read.
            </Text>
          </Card>
        </AdminSection>
      )}
      <SystemHealth health={reliability?.systemHealth} />
      {reliability === undefined || reliability.systemHealth.database.reachable ? (
        <AdminSection title={retiredTitle(`${PRODUCT_NAME} turns`)}>
          <StatCards layout={STAT_LAYOUT.ROW} stats={APP_TURN_STATS} data={reliability} />
          <AppTurnsNote />
        </AdminSection>
      ) : null}
    </>
  );
}

export function ReliabilityScreen({
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
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const shownWindow = reliabilityWindow(windowDays);
  const { reads, gate } = useAdminDoors();
  const query = windowedReadQuery(hideAdmins, shownWindow);
  const read = useQuery({ ...adminReliabilityQuery(reads, query), enabled: !gate.heldAtGate() });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();
  const controls = (
    <AdminViewOptions
      windowDays={shownWindow}
      onWindowDaysChange={onWindowDaysChange}
      windows={ADMIN_RELIABILITY_WINDOWS}
      hideAdmins={hideAdmins}
      onHideAdminsChange={onHideAdminsChange}
    />
  );

  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: RELIABILITY_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title="Reliability" note={windowWords(shownWindow)} controls={controls}>
          <ReliabilityBody reliability={undefined} onOpenAccount={onOpenAccount} />
        </PageSkeleton>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title="Reliability" note={windowWords(shownWindow)} controls={controls}>
          {error}
        </AdminPage>,
      ),
    ready: (reliability, refreshed) =>
      frame(
        <AdminPage title="Reliability" note={windowWords(shownWindow)} controls={controls}>
          {refreshed(<ReliabilityBody reliability={reliability} onOpenAccount={onOpenAccount} />)}
        </AdminPage>,
      ),
  });
}
