import { AUTOMATION_RUN_REASON, type AutomationRunReason } from "@luke/features/automation-wire";
import { CODING_AGENT_FAILURE, type CodingAgentFailure } from "@luke/features/coding-agent-wire";
import { INTEGRATION_NAME } from "@luke/features/integration-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import type { AdminIntegration } from "@luke/service/admin/admin-health";
import type {
  AdminAttentionAccount,
  AdminAttentionProblem,
  AdminReliability,
} from "@luke/service/admin/admin-reliability";
import {
  ADMIN_ATTENTION_AGENT_DAYS,
  ADMIN_ATTENTION_KIND,
  ADMIN_RELIABILITY_WINDOWS,
  type AdminMetricsWindow,
} from "@luke/service/admin/http";
import {
  BADGE_TONE,
  Badge,
  Card,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  Inline,
  List,
  ListRow,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  Text,
  TextLink,
} from "@luke/ui";
import { formatDate, formatNumber, formatShare } from "@luke/ui/admin-format";
import { AccountCell } from "../accounts-table/accounts-table";
import { BreakdownChart, type BreakdownSeries } from "../charts/breakdown-chart";
import { FailureRatesChart } from "../charts/failure-rates-chart";
import { MetricCard, SectionHeading, StatCard, StatGroup } from "../charts/stat-card";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, Refreshing, WindowSwitcher } from "../chrome/controls";
import { AdminPage, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { RELIABILITY_PATH, reliabilityWindow, windowedReadPath } from "../routing";
import { CHART_PAIR_EVEN, SKELETON_PLOT, SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { type AdminReader, adminReadFailure, useAdminRead } from "../use-admin-read";

/**
 * reliability.tsx -- the admin Reliability screen: how often the service's
 * own work failed, why, which accounts hold something broken, and what the
 * deployment is configured with. It draws counts, rates, and fixed words
 * alone; no failure's detail reaches it.
 */

const RELIABILITY_ERROR = "The reliability endpoint did not answer.";

// SAFETY: a 200 from the admin reliability endpoint is an AdminReliability body by its contract.
const readReliability: AdminReader<AdminReliability> = async (response) =>
  (await response.json()) as AdminReliability;

/** How many providers the health list's bones stand for, about the list a deployment draws. */
const HEALTH_BONE_ROWS = 12;

const RELIABILITY_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.HEADING, label: "Failures" },
  { kind: SKELETON_SHAPE.STAT_GROUP, cards: 5 },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.FAILURE_RATES] },
  { kind: SKELETON_SHAPE.HEADING, label: "Why work failed" },
  {
    kind: SKELETON_SHAPE.CHART,
    plots: [SKELETON_PLOT.BREAKDOWN, SKELETON_PLOT.BREAKDOWN],
    even: true,
  },
  { kind: SKELETON_SHAPE.HEADING, label: "Accounts that need attention" },
  { kind: SKELETON_SHAPE.TABLE, rows: 5, numericColumns: 2 },
  { kind: SKELETON_SHAPE.HEADING, label: "System health" },
  { kind: SKELETON_SHAPE.HEALTH, rows: HEALTH_BONE_ROWS },
];

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
  [AUTOMATION_RUN_REASON.GITHUB_SIGN_IN]: "GitHub sign-in lapsed",
  [AUTOMATION_RUN_REASON.MODEL]: "Model no longer offered",
  [AUTOMATION_RUN_REASON.UNAVAILABLE]: "Agents unreachable",
  [AUTOMATION_RUN_REASON.REPOSITORY_CHANGED]: "Repository changed",
  [AUTOMATION_RUN_REASON.PAUSED]: "Paused before start",
  [AUTOMATION_RUN_REASON.MISSED]: "Missed its hour",
  [AUTOMATION_RUN_REASON.AGENT_GONE]: "Agent gone",
} as const satisfies Record<AutomationRunReason, string>;

const NO_REASON_LABEL = "No reason recorded";

const AGENT_FAILURES_SERIES: readonly BreakdownSeries[] = [
  { key: "count", label: "Failed runs", color: "var(--luke-color-identity-2)" },
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
} as const;

/** One broken thing, by its kind and status alone. */
function problemLabel(problem: AdminAttentionProblem): string {
  switch (problem.kind) {
    case ADMIN_ATTENTION_KIND.PROVIDER_KEY:
      return `${KEY_PROVIDER_LABEL[problem.provider]} key · ${KEY_STATUS_LABEL[problem.status]}`;
    case ADMIN_ATTENTION_KIND.INTEGRATION:
      return `${INTEGRATION_NAME[problem.provider]} · ${problem.status}`;
    case ADMIN_ATTENTION_KIND.GITHUB_INSTALLATION:
      return `GitHub App · ${problem.status}`;
  }
}

/** One provider in the health card's list: its name, and whether its keys are set. */
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

/** "412 of 29,880 turns", or that nothing of the kind ended in the window. */
function ofHint(count: { failed: number; total: number }, noun: string, windowDays: number) {
  return count.total === 0
    ? `no ${noun} ended in ${windowDays} days`
    : `${formatNumber(count.failed)} of ${formatNumber(count.total)} ${noun}`;
}

function share(count: { failed: number; total: number }): number | null {
  return count.total === 0 ? null : count.failed / count.total;
}

function attentionColumns(
  onOpen: (id: string) => void,
): readonly DataTableColumn<AdminAttentionAccount>[] {
  return [
    {
      key: "account",
      label: "Account",
      cell: (row) => <AccountCell account={row} onOpen={onOpen} />,
    },
    {
      key: "problems",
      label: "Broken",
      cell: (row) => (
        <Inline>
          {row.problems.map((problem) => (
            <Badge key={problemLabel(problem)} tone={BADGE_TONE.ATTENTION}>
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
      cell: (row) => formatNumber(row.failedAgents),
    },
  ];
}

/**
 * What the read found in the service's own rows: the failures, why they
 * happened, and the accounts that need attention. Drawn only where the
 * database answered, since its silence says nothing about failures.
 */
function ReliabilityRecords({
  reliability,
  onOpenAccount,
}: {
  reliability: AdminReliability;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  const { headline, windowDays } = reliability;
  const automations = headline.automationRuns;
  const skippedShare =
    automations.total === 0
      ? undefined
      : `+ ${formatShare(automations.skipped / automations.total)} skipped`;

  return (
    <>
      <SectionHeading>Failures</SectionHeading>
      <StatGroup>
        <StatCard
          label="Luke turns failed"
          value={formatShare(share(headline.lukeTurns))}
          hint={ofHint(headline.lukeTurns, "turns", windowDays)}
          grouped
        />
        <StatCard
          label="Coding-agent runs failed"
          value={formatShare(share(headline.agentRuns))}
          hint={ofHint(headline.agentRuns, "runs", windowDays)}
          grouped
        />
        <StatCard
          label="Abandoned by the sweep"
          value={formatNumber(headline.abandonedTurns)}
          hint="turns past their bound"
          grouped
        />
        <StatCard
          label="Calls dropped"
          value={formatShare(share(headline.calls))}
          hint={ofHint(headline.calls, "calls", windowDays)}
          grouped
        />
        <StatCard
          label="Automation runs failed"
          value={formatShare(share(automations))}
          hint={skippedShare ?? ofHint(automations, "runs", windowDays)}
          title={ofHint(automations, "runs", windowDays)}
          grouped
        />
      </StatGroup>
      <div className="mt-3">
        <FailureRatesChart daily={reliability.daily} generatedAt={reliability.generatedAt} />
      </div>
      <div className="mt-3">
        <Text tone={TEXT_TONE.MUTED}>
          Per-request HTTP error rates live in{" "}
          {reliability.analyticsConsoleUrl ? (
            <TextLink
              href={reliability.analyticsConsoleUrl}
              look={TEXT_LINK_LOOK.UNDERLINED}
              external
              newTab
            >
              product analytics
            </TextLink>
          ) : (
            "product analytics"
          )}
          , not this database.
        </Text>
      </div>

      <SectionHeading>Why work failed</SectionHeading>
      <div className={CHART_PAIR_EVEN}>
        <BreakdownChart
          title="Coding-agent failures by class"
          series={AGENT_FAILURES_SERIES}
          rows={reliability.agentFailures.map((row) => ({
            label: AGENT_FAILURE_LABEL[row.failure],
            counts: { count: row.count },
          }))}
          empty="No coding-agent run failed in this window."
        />
        <BreakdownChart
          title="Automation skips and failures by reason"
          series={AUTOMATION_REASONS_SERIES}
          rows={reliability.automationReasons.map((row) => ({
            label: row.reason === null ? NO_REASON_LABEL : AUTOMATION_REASON_LABEL[row.reason],
            counts: { skipped: row.skipped, failed: row.failed },
          }))}
          empty="No automation run was skipped or failed in this window."
        />
      </div>

      <SectionHeading>Accounts that need attention</SectionHeading>
      <DataTable
        label="Accounts that need attention"
        columns={attentionColumns(onOpenAccount)}
        rows={reliability.attention.accounts}
        rowKey={(row) => row.id}
        empty="No account holds a broken key, integration, or GitHub installation."
        minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
        onRowPress={(row) => onOpenAccount(row.id)}
      />
      <div className="mt-3">
        <Text tone={TEXT_TONE.MUTED}>
          A broken key, integration, or GitHub installation fails the account's agents quietly. Last
          changed is when the newest broken row last changed: a key's last answer from its provider,
          or an integration's or installation's last update, which a sign-in retried and not
          finished also moves. Agents failed counts the account's coding agents with a failed run in
          the last {ADMIN_ATTENTION_AGENT_DAYS} days.
          {reliability.attention.total > reliability.attention.accounts.length
            ? ` Only the ${formatNumber(reliability.attention.accounts.length)} newest of ${formatNumber(reliability.attention.total)} are listed.`
            : ""}
        </Text>
      </div>
    </>
  );
}

/**
 * The page under its header, once the read has answered: the records where
 * the database answered its probe, and a plain word that nothing could be
 * read where it did not, with System health beneath either way.
 */
function ReliabilityBody({
  reliability,
  onOpenAccount,
}: {
  reliability: AdminReliability;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  const db = reliability.systemHealth.database;

  return (
    <>
      {db.reachable ? (
        <ReliabilityRecords reliability={reliability} onOpenAccount={onOpenAccount} />
      ) : (
        <>
          <SectionHeading>Failures</SectionHeading>
          <Card>
            <Text tone={TEXT_TONE.MUTED}>
              The database did not answer its probe, so no failure count and no account is shown:
              nothing read is nothing known, not nothing failed. System health below still reads the
              deployment's own configuration.
            </Text>
          </Card>
        </>
      )}

      <SectionHeading>System health</SectionHeading>
      <div className="grid gap-3 min-[720px]:grid-cols-[1fr_1.4fr]">
        <MetricCard label="Database" hint={`probe round-trip ${formatNumber(db.latencyMs)} ms`}>
          <div>
            <Badge tone={db.reachable ? BADGE_TONE.COMPLETE : BADGE_TONE.ATTENTION}>
              {db.reachable ? "Reachable" : "Unreachable"}
            </Badge>
          </div>
        </MetricCard>
        <MetricCard label="Integrations">
          <List label="Integrations">
            {reliability.systemHealth.integrations.map((integration) => (
              <IntegrationRow key={integration.key} integration={integration} />
            ))}
          </List>
        </MetricCard>
      </div>
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
  const { state, refreshing, reload, withdraw } = useAdminRead(
    windowedReadPath(RELIABILITY_PATH, hideAdmins, shownWindow),
    readReliability,
    RELIABILITY_ERROR,
  );
  const signOut = () => void withdraw(onSignOut);
  const controls = (
    <>
      <WindowSwitcher
        value={shownWindow}
        onChange={onWindowDaysChange}
        windows={ADMIN_RELIABILITY_WINDOWS}
      />
      <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
    </>
  );

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title="Reliability"
          account={account}
          onSignOut={signOut}
          controls={controls}
          shapes={RELIABILITY_SHAPES}
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
          detail={adminReadFailure(state, RELIABILITY_ERROR)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case "ready":
      return frame(
        <AdminPage title="Reliability" account={account} onSignOut={signOut} controls={controls}>
          <Refreshing failure={state.refreshFailure} refreshing={refreshing} onRetry={reload}>
            <ReliabilityBody reliability={state.value} onOpenAccount={onOpenAccount} />
          </Refreshing>
        </AdminPage>,
      );
  }
}
