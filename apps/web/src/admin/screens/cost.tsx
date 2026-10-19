import { browserClient } from "@luke/features/contract/browser-client";
/**
 * cost.tsx -- the Cost screen: what the hosted service spends, priced at list price from the usage its tables keep.
 */

import type {
  AdminCost,
  AdminCostAccount,
  AdminCostModel,
} from "@luke/service/admin/admin-cost-wire";
import type { AdminMetricsWindow, AdminWindowedQuery } from "@luke/service/admin/http";
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
import { windowedReadQuery } from "../routing";
import { SKELETON_PLOT, SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { type AdminReader, adminQuestion, adminReadFailure, useAdminRead } from "../use-admin-read";

const COST_ERROR = "The cost endpoint did not answer.";

/** The window's spend, as the admin cost procedure answers it. */
const readCost =
  (query: AdminWindowedQuery): AdminReader<AdminCost> =>
  async (signal) =>
    // SAFETY: the admin cost procedure answers an AdminCost (`@luke/service/admin/admin-cost-wire`), which the contract cannot name.
    (await browserClient.admin.cost(query, { signal })) as AdminCost;

/** What every figure on the screen is, said once under the title. */
const COST_DESCRIPTION =
  "Every model token and metered second at its public list price: a list-price equivalent, not what Luke pays.";

/** The screen's dollar measure, named once so every label says the same thing. */
const LIST_PRICE = "List-price equivalent";

/** The screen's own sections, in the order the loaded page states them. */
const COST_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.STAT_GROUP },
  { kind: SKELETON_SHAPE.STATIC, node: <ListPriceNote /> },
  { kind: SKELETON_SHAPE.HEADING, label: `Daily ${LIST_PRICE.toLowerCase()}` },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.USAGE] },
  { kind: SKELETON_SHAPE.HEADING, label: `${LIST_PRICE} by model` },
  { kind: SKELETON_SHAPE.TABLE, rows: 5, numericColumns: 2 },
  { kind: SKELETON_SHAPE.HEADING, label: `Accounts with the highest ${LIST_PRICE.toLowerCase()}` },
  { kind: SKELETON_SHAPE.TABLE, rows: 10, numericColumns: 3 },
];

/** The figure a dollar amount that has nothing to divide by stands as. */
const NO_FIGURE = "—";

/** Whole minutes, and a positive part of one as under one rather than a zero that hides it. */
function wholeMinutes(minutes: number): string {
  return minutes > 0 && minutes < 1 ? "<1" : formatNumber(Math.round(minutes));
}

function usdOrNone(value: number | null): string {
  return value === null ? NO_FIGURE : formatUsd(value);
}

/**
 * What every dollar on the screen is and is not, said once under the
 * headline: a comparison and a trend at public prices, never Luke's bill.
 */
function ListPriceNote(): React.JSX.Element {
  return (
    <div className="mt-3">
      <Text tone={TEXT_TONE.MUTED}>
        List prices leave out discounts, credits, plan fees, and which key paid.
      </Text>
    </div>
  );
}

/** The headline figure's comparison with the window before it, which says nothing where there was none. */
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
    label: LIST_PRICE,
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
      label: LIST_PRICE,
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
        Tokens are priced at AI Gateway's catalog as it stands now, every model token counted
        whichever key ran it. A model the catalog does not price is counted as unpriced tokens and
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
  const query = windowedReadQuery(hideAdmins, windowDays);
  const { state, refreshing, reload, withdraw } = useAdminRead(
    adminQuestion("cost", query),
    readCost(query),
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
                label={`${LIST_PRICE} · ${cost.windowDays} days`}
                value={formatUsd(cost.totals.spendUsd)}
                hint={spendHint(cost)}
                title={`${LIST_PRICE.toLowerCase()} against ${formatUsd(cost.totals.trend.prior)} in the ${cost.totals.trend.days} days before`}
                grouped
              />
              <StatCard
                label={`${LIST_PRICE} per active account`}
                value={usdOrNone(cost.perAccount.meanUsd)}
                hint={`median ${usdOrNone(cost.perAccount.medianUsd)} · ${formatNumber(cost.perAccount.accounts)} accounts`}
                grouped
              />
              <StatCard
                label={`${LIST_PRICE} per merged PR`}
                value={usdOrNone(cost.perMergedPullRequest.spendUsd)}
                hint={`the window's whole figure over ${formatNumber(cost.perMergedPullRequest.mergedPullRequests)} PRs merged`}
                grouped
              />
              <StatCard
                label="Voice minutes"
                value={wholeMinutes(cost.voice.minutes)}
                hint={
                  cost.voice.unpricedMinutes === 0
                    ? `${formatUsd(cost.voice.spendUsd)} at ${cost.prices.voice.model}'s list price`
                    : `${formatUsd(cost.voice.spendUsd)} at list price · ${wholeMinutes(cost.voice.unpricedMinutes)} min on an unpriced model`
                }
                grouped
              />
            </StatGroup>
            <ListPriceNote />

            <SectionHeading>Daily {LIST_PRICE.toLowerCase()}</SectionHeading>
            <CostChart daily={cost.daily} generatedAt={cost.generatedAt} />

            <SectionHeading>{LIST_PRICE} by model</SectionHeading>
            <DataTable
              label={`${LIST_PRICE} by model`}
              columns={MODEL_COLUMNS}
              rows={cost.byModel}
              rowKey={(row) => row.model ?? ""}
              empty="No model tokens recorded in this window yet."
              minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
            />

            <SectionHeading>Accounts with the highest {LIST_PRICE.toLowerCase()}</SectionHeading>
            <DataTable
              label={`Accounts with the highest ${LIST_PRICE.toLowerCase()}`}
              columns={accountColumns(onOpenAccount)}
              rows={cost.topAccounts}
              rowKey={(row) => row.id}
              empty="No priced usage recorded in this window yet."
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
