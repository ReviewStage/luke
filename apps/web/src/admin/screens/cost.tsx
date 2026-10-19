/**
 * cost.tsx -- the Cost screen: what the hosted service spends, priced at list price from the usage its tables keep.
 */

import type {
  AdminCost,
  AdminCostAccount,
  AdminCostModel,
} from "@luke/service/admin/admin-cost-wire";
import type { AdminMetricsWindow } from "@luke/service/admin/http";
import {
  BADGE_TONE,
  Badge,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  TEXT_ELEMENT,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { formatCompact, formatNumber, formatTrendMove, formatUsd } from "@luke/ui/admin-format";
import { AccountCell } from "../accounts-table/accounts-table";
import { CostChart } from "../charts/cost-chart";
import { SectionHeading, StatCard, StatGroup } from "../charts/stat-card";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, Refreshing, WindowSwitcher } from "../chrome/controls";
import { AdminPage, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { COST_PATH, windowedReadPath } from "../routing";
import { SKELETON_PLOT, SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { type AdminReader, adminReadFailure, useAdminRead } from "../use-admin-read";

const COST_ERROR = "The cost endpoint did not answer.";

// SAFETY: a 200 from the admin cost endpoint is an AdminCost body by its contract.
const readCost: AdminReader<AdminCost> = async (response) => (await response.json()) as AdminCost;

/** What every figure on the screen is, said once under the title. */
const COST_DESCRIPTION = "List price for all model tokens and metered seconds, whichever key paid.";

/** The screen's own sections, in the order the loaded page states them. */
const COST_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.STAT_GROUP },
  { kind: SKELETON_SHAPE.HEADING, label: "Daily spend" },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.USAGE] },
  { kind: SKELETON_SHAPE.HEADING, label: "Spend by model" },
  { kind: SKELETON_SHAPE.TABLE, rows: 5, numericColumns: 2 },
  { kind: SKELETON_SHAPE.HEADING, label: "Most expensive accounts" },
  { kind: SKELETON_SHAPE.TABLE, rows: 10, numericColumns: 3 },
];

/** The figure a dollar amount that has nothing to divide by stands as. */
const NO_FIGURE = "—";

function usdOrNone(value: number | null): string {
  return value === null ? NO_FIGURE : formatUsd(value);
}

/** The headline spend's comparison with the window before it, which says nothing where there was none. */
function spendMove(cost: AdminCost): string {
  const { trend } = cost.totals;
  if (trend.prior === 0) return `nothing priced in the ${trend.days} days before`;
  return `${formatTrendMove(trend)} vs the ${trend.days} days before`;
}

function spendHint(cost: AdminCost): string {
  const unpriced = cost.totals.unpricedTokens;
  return unpriced === 0
    ? spendMove(cost)
    : `${spendMove(cost)} · plus ${formatCompact(unpriced)} unpriced tokens`;
}

/** The two tables' column keys. */
const MODEL_COLUMN = { MODEL: "model", SPEND: "spend", TOKENS: "tokens" } as const;

const ACCOUNT_COLUMN = {
  ACCOUNT: "account",
  SPEND: "spend",
  MERGED: "merged",
  PER_MERGED: "per-merged",
} as const;

const MODEL_COLUMNS: readonly DataTableColumn<AdminCostModel>[] = [
  {
    key: MODEL_COLUMN.MODEL,
    label: "Model",
    cell: (row) => row.model ?? "No model recorded",
  },
  {
    key: MODEL_COLUMN.SPEND,
    label: "Spend",
    kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
    cell: (row) =>
      row.spendUsd === null ? (
        <Badge tone={BADGE_TONE.ATTENTION}>Unpriced</Badge>
      ) : (
        formatUsd(row.spendUsd)
      ),
  },
  {
    key: MODEL_COLUMN.TOKENS,
    label: "Tokens",
    kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
    cell: (row) => (
      <>
        {formatCompact(row.pricedTokens + row.unpricedTokens)}
        {row.unpricedTokens > 0 && row.pricedTokens > 0 ? (
          <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
            {" "}
            · {formatCompact(row.unpricedTokens)} unpriced
          </Text>
        ) : null}
      </>
    ),
  },
];

function accountColumns(
  onOpen: (id: string) => void,
): readonly DataTableColumn<AdminCostAccount>[] {
  return [
    {
      key: ACCOUNT_COLUMN.ACCOUNT,
      label: "Account",
      cell: (row) => <AccountCell account={row} onOpen={onOpen} />,
    },
    {
      key: ACCOUNT_COLUMN.SPEND,
      label: "Spend",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      cell: (row) => (
        <>
          {formatUsd(row.spendUsd)}
          {row.unpricedTokens > 0 ? (
            <Text as={TEXT_ELEMENT.DIV} tone={TEXT_TONE.MUTED}>
              + {formatCompact(row.unpricedTokens)} unpriced tokens
            </Text>
          ) : null}
        </>
      ),
    },
    {
      key: ACCOUNT_COLUMN.MERGED,
      label: "PRs merged",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      cell: (row) => formatNumber(row.mergedPullRequests),
    },
    {
      key: ACCOUNT_COLUMN.PER_MERGED,
      label: "Per merged PR",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      cell: (row) => usdOrNone(row.spendPerMergedPullRequestUsd),
    },
  ];
}

/** A list price per minute as its provider writes it, to the fraction of a cent it names. */
function perMinute(usd: number): string {
  return `$${usd}`;
}

/** What the figures leave out and how the seconds are priced, under the tables. */
function CostBasisNote({ cost }: { cost: AdminCost }): React.JSX.Element {
  const { prices } = cost;
  return (
    <div className="mt-3">
      <Text tone={TEXT_TONE.MUTED}>
        Tokens are priced at AI Gateway's catalog as it stands now. No turn records whether Luke's
        key or the account's own key paid, so every total counts all model tokens at list price
        whichever key paid. A model the catalog does not price is counted as unpriced tokens and
        left out of every dollar figure. Voice is priced at {prices.voice.model}'s{" "}
        {perMinute(prices.voice.usdPerMinute)} a minute, dictation at {prices.dictation.model}'s{" "}
        {perMinute(prices.dictation.usdPerMinute)}, and the video avatar at{" "}
        {perMinute(prices.avatar.usdPerMinute)}. A merged PR counts on the day GitHub merged it, for
        the account that started its agent.
        {cost.catalogAvailable
          ? ""
          : " The catalog could not be read for this answer, so no model token is priced."}
      </Text>
    </div>
  );
}

export function CostScreen({
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
  const { state, refreshing, reload, withdraw } = useAdminRead(
    windowedReadPath(COST_PATH, hideAdmins, windowDays),
    readCost,
    COST_ERROR,
  );
  const signOut = () => void withdraw(onSignOut);
  const controls = (
    <>
      <WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />
      <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
    </>
  );

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title="Cost"
          description={COST_DESCRIPTION}
          account={account}
          onSignOut={signOut}
          controls={controls}
          shapes={COST_SHAPES}
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
          detail={adminReadFailure(state, COST_ERROR)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case "ready": {
      const cost = state.value;
      return frame(
        <AdminPage
          title="Cost"
          description={COST_DESCRIPTION}
          account={account}
          onSignOut={signOut}
          controls={controls}
        >
          <Refreshing failure={state.refreshFailure} refreshing={refreshing} onRetry={reload}>
            <StatGroup>
              <StatCard
                label={`Spend · ${cost.windowDays} days`}
                value={formatUsd(cost.totals.spendUsd)}
                hint={spendHint(cost)}
                title={`against ${formatUsd(cost.totals.trend.prior)} in the ${cost.totals.trend.days} days before`}
                grouped
              />
              <StatCard
                label="Per active account"
                value={usdOrNone(cost.perAccount.meanUsd)}
                hint={`median ${usdOrNone(cost.perAccount.medianUsd)} · ${formatNumber(cost.perAccount.accounts)} accounts`}
                grouped
              />
              <StatCard
                label="Per merged PR"
                value={usdOrNone(cost.perMergedPullRequest.spendUsd)}
                hint={`all spend over ${formatNumber(cost.perMergedPullRequest.mergedPullRequests)} PRs merged`}
                grouped
              />
              <StatCard
                label="Voice minutes"
                value={formatNumber(Math.round(cost.voice.minutes))}
                hint={
                  cost.voice.unpricedMinutes === 0
                    ? `${formatUsd(cost.voice.spendUsd)} · ${cost.prices.voice.model}`
                    : `${formatUsd(cost.voice.spendUsd)} · ${formatNumber(Math.round(cost.voice.unpricedMinutes))} min on an unpriced model`
                }
                grouped
              />
            </StatGroup>

            <SectionHeading>Daily spend</SectionHeading>
            <CostChart daily={cost.daily} generatedAt={cost.generatedAt} />

            <SectionHeading>Spend by model</SectionHeading>
            <DataTable
              label="Spend by model"
              columns={MODEL_COLUMNS}
              rows={cost.byModel}
              rowKey={(row) => row.model ?? ""}
              empty="No model tokens recorded in this window yet."
              minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
            />

            <SectionHeading>Most expensive accounts</SectionHeading>
            <DataTable
              label="Most expensive accounts"
              columns={accountColumns(onOpenAccount)}
              rows={cost.topAccounts}
              rowKey={(row) => row.id}
              empty="No spend recorded in this window yet."
              minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
              onRowPress={(row) => onOpenAccount(row.id)}
            />
            <CostBasisNote cost={cost} />
          </Refreshing>
        </AdminPage>,
      );
    }
  }
}
