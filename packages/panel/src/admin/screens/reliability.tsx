import type {
  AdminAttentionAccount,
  AdminAttentionProblem,
  AdminIntegration,
  AdminReliability,
} from "@luke/features/admin-answer-wire";
import {
  ADMIN_ATTENTION_AGENT_DAYS,
  ADMIN_ATTENTION_KIND,
  ADMIN_READ,
  ADMIN_RELIABILITY_WINDOWS,
  type AdminMetricsWindow,
} from "@luke/features/admin-wire";
import { AUTOMATION_RUN_REASON, type AutomationRunReason } from "@luke/features/automation-wire";
import { CODING_AGENT_FAILURE, type CodingAgentFailure } from "@luke/features/coding-agent-wire";
import { INTEGRATION_NAME } from "@luke/features/integration-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { formatCount, formatPercent } from "@luke/features/number-format";
import { PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import { formatDate } from "@luke/features/time-format";
import {
  Badge,
  Card,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  Inline,
  List,
  ListRow,
  Skeleton,
  STATUS_TONE,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  Text,
  TextLink,
} from "@luke/ui";
import { RATE_PLACES } from "@luke/ui/admin-format";
import { AccountCell, AccountCellSkeleton } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
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
import { AdminPage, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { DataTableSkeleton } from "../chrome/table-skeleton.js";
import { reliabilityWindow, windowedReadQuery } from "../routing.js";
import { connectionWord, INSTALLATION_LABEL } from "../status-words.js";
import { useAdminRead } from "../use-admin-read.js";

/**
 * reliability.tsx -- the admin Reliability screen: how often the service's
 * own work failed, why, which accounts hold something broken, and what the
 * deployment is configured with. It draws counts, rates, and fixed words
 * alone; no failure's detail reaches it.
 */

const RELIABILITY_ERROR = "The reliability endpoint did not answer.";

/** How many providers the health list's skeleton stands a row for, about the list a deployment draws. */
const HEALTH_SKELETON_ROWS = 12;

/** How many accounts the attention table's skeleton stands a row for, about a usual week's. */
const ATTENTION_SKELETON_ROWS = 5;

/** The attention table's account column, the one whose cell is an account's. */
const ATTENTION_ACCOUNT_COLUMN = "account";

/** The bones standing for a badge's words and a provider's name. */
const SKELETON_BADGE_WIDTH = "64px";

const SKELETON_PROVIDER_WIDTH = "192px";

/** A coding agent's failure class, as the breakdown names it. */
const AGENT_FAILURE_LABEL = {
  [CODING_AGENT_FAILURE.MODEL]: "Model call",
  [CODING_AGENT_FAILURE.SANDBOX]: "Sandbox or checkout",
  [CODING_AGENT_FAILURE.GITHUB]: "GitHub",
  [CODING_AGENT_FAILURE.ABANDONED]: "Abandoned by the sweep",
  [CODING_AGENT_FAILURE.PROVIDER_KEY]: "Account's own API key",
  [CODING_AGENT_FAILURE.NOT_STARTED]: "Never started",
  [CODING_AGENT_FAILURE.FAST_ON_OWN_KEY]: "Fast on own key",
  [CODING_AGENT_FAILURE.FAST_NOT_ENABLED]: "Fast not enabled",
  [CODING_AGENT_FAILURE.CONTEXT_OVERFLOW]: "Context too long",
  [CODING_AGENT_FAILURE.SESSION_ENDED]: "Session ended",
  [CODING_AGENT_FAILURE.OTHER]: "Other",
} as const satisfies Record<CodingAgentFailure, string>;

/** An automation run's skip or failure reason, as the breakdown names it. */
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
} as const satisfies Record<AutomationRunReason, string>;

const NO_REASON_LABEL = "No reason recorded";

const AGENT_FAILURES_SERIES: readonly BreakdownSeries[] = [
  { key: "count", label: "Failed runs", color: "var(--luke-color-danger)" },
];

const AUTOMATION_REASONS_SERIES: readonly BreakdownSeries[] = [
  { key: "skipped", label: "Skipped", color: "var(--luke-color-chart-1)" },
  { key: "failed", label: "Failed", color: "var(--luke-color-danger)" },
];

/** The model providers an account's own key is for, as a problem names them. */
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

/** One broken thing, by its kind and status alone. */
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

/** One provider in the health card's list: its name, and whether its keys are set. */
function IntegrationRow({ integration }: { integration: AdminIntegration }): React.JSX.Element {
  return (
    <ListRow
      title={integration.label}
      meta={
        <Badge tone={integration.configured ? STATUS_TONE.COMPLETE : STATUS_TONE.ATTENTION}>
          {integration.configured ? "Configured" : "Not configured"}
        </Badge>
      }
    />
  );
}

/** "412 of 29,880 turns", or that nothing of the kind ended in the window. */
function ofHint(count: { failed: number; total: number }, noun: string, windowDays: number) {
  return count.total === 0
    ? `no ${noun} ended in ${windowDays} days`
    : `${formatCount(count.failed)} of ${formatCount(count.total)} ${noun}`;
}

function share(count: { failed: number; total: number }): number | null {
  return count.total === 0 ? null : count.failed / count.total;
}

function attentionColumns(
  onOpen: (id: string) => void,
): readonly DataTableColumn<AdminAttentionAccount>[] {
  return [
    {
      key: ATTENTION_ACCOUNT_COLUMN,
      label: "Account",
      cell: (row) => <AccountCell account={row} onOpen={onOpen} />,
    },
    {
      key: "problems",
      label: "Broken",
      cell: (row) => (
        <Inline>
          {row.problems.map((problem) => (
            <Badge key={problemLabel(problem)} tone={STATUS_TONE.ATTENTION}>
              {problemLabel(problem)}
            </Badge>
          ))}
        </Inline>
      ),
    },
    {
      key: "since",
      label: "Last changed",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      cell: (row) => formatDate(row.brokenSince),
    },
    {
      key: "failed-agents",
      label: `Agents failed · ${ADMIN_ATTENTION_AGENT_DAYS}d`,
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      cell: (row) => formatCount(row.failedAgents),
    },
  ];
}

/** The headline failure cards, in the order they stand. */
const FAILURE_STATS: readonly StatSpec<AdminReliability>[] = [
  {
    key: "luke-turns",
    label: () => "Luke turns failed",
    value: ({ headline }) => formatPercent(share(headline.lukeTurns), RATE_PLACES),
    hint: ({ headline, windowDays }) => ofHint(headline.lukeTurns, "turns", windowDays),
  },
  {
    key: "agent-runs",
    label: () => "Coding-agent runs failed",
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
    key: "calls",
    label: () => "Calls dropped",
    value: ({ headline }) => formatPercent(share(headline.calls), RATE_PLACES),
    hint: ({ headline, windowDays }) => ofHint(headline.calls, "calls", windowDays),
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

/** One breakdown of why work failed: its heading, its series, and its rows as the answer counts them. */
interface Breakdown {
  title: string;
  series: readonly BreakdownSeries[];
  rows: (reliability: AdminReliability) => readonly BreakdownRow[];
  empty: string;
}

/** The two breakdowns, side by side in this order. */
const BREAKDOWNS: readonly Breakdown[] = [
  {
    title: "Coding-agent failures by class",
    series: AGENT_FAILURES_SERIES,
    rows: (reliability) =>
      reliability.agentFailures.map((row) => ({
        label: AGENT_FAILURE_LABEL[row.failure],
        counts: { count: row.count },
      })),
    empty: "No coding-agent run failed in this window.",
  },
  {
    title: "Automation skips and failures by reason",
    series: AUTOMATION_REASONS_SERIES,
    rows: (reliability) =>
      reliability.automationReasons.map((row) => ({
        label: row.reason === null ? NO_REASON_LABEL : AUTOMATION_REASON_LABEL[row.reason],
        counts: { skipped: row.skipped, failed: row.failed },
      })),
    empty: "No automation run was skipped or failed in this window.",
  },
];

/**
 * Where per-request error rates live, a link to the product analytics where
 * the deployment names its console and the plain words where it does not
 * or before the answer says.
 */
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

/** What the attention table's figures mean, and where its bound cut it once the answer says so. */
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
      moves. Agents failed counts the account's coding agents with a failed run in the last{" "}
      {ADMIN_ATTENTION_AGENT_DAYS} days.
      {attention !== undefined && attention.total > attention.accounts.length
        ? ` Only the ${formatCount(attention.accounts.length)} newest of ${formatCount(attention.total)} are listed.`
        : ""}
    </Text>
  );
}

/**
 * What the read found in the service's own rows: the failures, why they
 * happened, and the accounts that need attention, drawn from `reliability`
 * once it is read and as their skeletons until then. Drawn only where the
 * database answered, since its silence says nothing about failures.
 */
function ReliabilityRecords({
  reliability,
  onOpenAccount,
}: {
  reliability: AdminReliability | undefined;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
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
            columns={attentionColumns(onOpenAccount)}
            rows={ATTENTION_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            cells={{ [ATTENTION_ACCOUNT_COLUMN]: <AccountCellSkeleton /> }}
          />
        ) : (
          <DataTable
            label="Accounts that need attention"
            columns={attentionColumns(onOpenAccount)}
            rows={reliability.attention.accounts}
            rowKey={(row) => row.id}
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

/**
 * A badge while its words are read: the badge itself with a bone for its
 * words. Note that it stands in a row of its own, whose foot is the badge's,
 * because a bone gives the badge no words' baseline to sit on, and a badge
 * set on its line's baseline would stand the line taller than its words do.
 */
function BadgeSkeleton(): React.JSX.Element {
  return (
    <Inline>
      <Badge>
        <Skeleton width={SKELETON_BADGE_WIDTH} />
      </Badge>
    </Inline>
  );
}

/** The database's card while the probe's answer is read: bones for its badge and its round-trip. */
function DatabaseCardSkeleton(): React.JSX.Element {
  return (
    <MetricCardSkeleton>
      <BadgeSkeleton />
    </MetricCardSkeleton>
  );
}

/** The integrations' card while their list is read: a row of bones for each provider a deployment lists. */
function IntegrationsCardSkeleton(): React.JSX.Element {
  return (
    <MetricCardSkeleton hint={false}>
      <List label="Integrations">
        {Array.from({ length: HEALTH_SKELETON_ROWS }, (_, row) => (
          <ListRow
            key={row}
            title={<Skeleton width={SKELETON_PROVIDER_WIDTH} />}
            meta={<BadgeSkeleton />}
          />
        ))}
      </List>
    </MetricCardSkeleton>
  );
}

/** The deployment's health, the database's probe beside its integrations, once read and as skeletons until then. */
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
              <Badge
                tone={health.database.reachable ? STATUS_TONE.COMPLETE : STATUS_TONE.ATTENTION}
              >
                {health.database.reachable ? "Reachable" : "Unreachable"}
              </Badge>
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

/**
 * The page under its header: the records where the database answered its
 * probe, or before any answer, and a plain word that nothing could be read
 * where it did not, with System health beneath either way.
 */
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
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const shownWindow = reliabilityWindow(windowDays);
  const { reads, gate } = useAdminDoors();
  const query = windowedReadQuery(hideAdmins, shownWindow);
  const { state, refreshing, reload, withdraw } = useAdminRead(
    { procedure: ADMIN_READ.RELIABILITY, query: query },
    (signal) => reads.reliability(query, signal),
    RELIABILITY_ERROR,
  );
  const signOut = () => void withdraw(onSignOut);
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
    read: { state, refreshing, reload },
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
