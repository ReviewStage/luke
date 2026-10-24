/**
 * cost.tsx -- the Cost screen: what the hosted service spends, priced at list price from the usage its tables keep.
 */

import {
  ADMIN_COST_TOP_ACCOUNTS_LIMIT,
  type AdminCost,
  type AdminCostAccount,
  type AdminCostModel,
} from "@luke/features/admin-cost-wire";
import { ADMIN_READ, type AdminMetricsWindow } from "@luke/features/admin-wire";
import { formatCompact, formatCount, formatUsd } from "@luke/features/number-format";
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
import { formatTrendMove } from "@luke/ui/admin-format";
import { AccountCell, AccountCellSkeleton } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminReadView } from "../admin-read-view.js";
import { CostChart, CostChartSkeleton } from "../charts/cost-chart.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { AdminViewOptions, windowWords } from "../chrome/controls.js";
import { PageNote } from "../chrome/notes.js";
import { AdminPage, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { DataTableSkeleton } from "../chrome/table-skeleton.js";
import { windowedReadQuery } from "../routing.js";
import { useAdminRead } from "../use-admin-read.js";

const COST_ERROR = "The cost endpoint did not answer.";

/** What every figure on the screen is, said once at the top of the page. */
const COST_DESCRIPTION =
  "Every model token and metered second at its public list price: a list-price equivalent, not what Luke pays.";

/** The screen's dollar measure, named once so every label says the same thing. */
const LIST_PRICE = "List-price equivalent";

/** How many models the by-model table's skeleton stands a row for, about the models a window prices. */
const MODEL_SKELETON_ROWS = 5;

/** The figure a dollar amount that has nothing to divide by stands as. */
const NO_FIGURE = "—";

/** Whole minutes, and a positive part of one as under one rather than a zero that hides it. */
function wholeMinutes(minutes: number): string {
  return minutes > 0 && minutes < 1 ? "<1" : formatCount(Math.round(minutes));
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
    <Text tone={TEXT_TONE.MUTED}>
      List prices leave out discounts, credits, plan fees, and which key paid.
    </Text>
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

/** The headline cards, in the order they stand. */
const COST_STATS: readonly StatSpec<AdminCost>[] = [
  {
    key: "spend",
    label: (cost) => `${LIST_PRICE} · ${cost.windowDays} days`,
    value: (cost) => formatUsd(cost.totals.spendUsd),
    hint: spendHint,
    title: (cost) =>
      `${LIST_PRICE.toLowerCase()} against ${formatUsd(cost.totals.trend.prior)} in the ${cost.totals.trend.days} days before`,
  },
  {
    key: "per-account",
    label: () => `${LIST_PRICE} per active account`,
    value: (cost) => usdOrNone(cost.perAccount.meanUsd),
    hint: (cost) =>
      `median ${usdOrNone(cost.perAccount.medianUsd)} · ${formatCount(cost.perAccount.accounts)} accounts`,
  },
  {
    key: "per-merged",
    label: () => `${LIST_PRICE} per merged PR`,
    value: (cost) => usdOrNone(cost.perMergedPullRequest.spendUsd),
    hint: (cost) =>
      `the window's whole figure over ${formatCount(cost.perMergedPullRequest.mergedPullRequests)} PRs merged`,
  },
  {
    key: "voice",
    label: () => "Voice minutes",
    value: (cost) => wholeMinutes(cost.voice.minutes),
    hint: (cost) =>
      cost.voice.unpricedMinutes === 0
        ? `${formatUsd(cost.voice.spendUsd)} at ${cost.prices.voice.model}'s list price`
        : `${formatUsd(cost.voice.spendUsd)} at list price · ${wholeMinutes(cost.voice.unpricedMinutes)} min on an unpriced model`,
  },
];

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
      cell: (row) => formatCount(row.mergedPullRequests),
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
  );
}

/**
 * The screen's sections under its toolbar, drawn from `cost` once it is
 * read and as their skeletons until then, so the loading page is this page
 * with bones where the answer lands.
 */
function CostSections({
  cost,
  onOpenAccount,
}: {
  cost: AdminCost | undefined;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      <AdminSection>
        <PageNote>{COST_DESCRIPTION}</PageNote>
        <StatCards layout={STAT_LAYOUT.GROUP} stats={COST_STATS} data={cost} />
        <ListPriceNote />
      </AdminSection>

      <AdminSection title={`Daily ${LIST_PRICE.toLowerCase()}`}>
        {cost === undefined ? (
          <CostChartSkeleton />
        ) : (
          <CostChart daily={cost.daily} generatedAt={cost.generatedAt} />
        )}
      </AdminSection>

      <AdminSection title={`${LIST_PRICE} by model`}>
        {cost === undefined ? (
          <DataTableSkeleton
            label={`${LIST_PRICE} by model`}
            columns={MODEL_COLUMNS}
            rows={MODEL_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          />
        ) : (
          <DataTable
            label={`${LIST_PRICE} by model`}
            columns={MODEL_COLUMNS}
            rows={cost.byModel}
            rowKey={(row) => row.model ?? ""}
            empty="No model tokens recorded in this window yet."
            minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          />
        )}
      </AdminSection>

      <AdminSection title={`Accounts with the highest ${LIST_PRICE.toLowerCase()}`}>
        {cost === undefined ? (
          <DataTableSkeleton
            label={`Accounts with the highest ${LIST_PRICE.toLowerCase()}`}
            columns={accountColumns(onOpenAccount)}
            rows={ADMIN_COST_TOP_ACCOUNTS_LIMIT}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            cells={{ [ACCOUNT_COLUMN.ACCOUNT]: <AccountCellSkeleton /> }}
          />
        ) : (
          <>
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
          </>
        )}
      </AdminSection>
    </>
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
  const { reads, gate } = useAdminDoors();
  const query = windowedReadQuery(hideAdmins, windowDays);
  const { state, refreshing, reload, withdraw } = useAdminRead(
    { procedure: ADMIN_READ.COST, query: query },
    (signal) => reads.cost(query, signal),
    COST_ERROR,
  );
  const signOut = () => void withdraw(onSignOut);
  const controls = (
    <AdminViewOptions
      windowDays={windowDays}
      onWindowDaysChange={onWindowDaysChange}
      hideAdmins={hideAdmins}
      onHideAdminsChange={onHideAdminsChange}
    />
  );

  return adminReadView({
    read: { state, refreshing, reload },
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: COST_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title="Cost" note={windowWords(windowDays)} controls={controls}>
          <CostSections cost={undefined} onOpenAccount={onOpenAccount} />
        </PageSkeleton>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title="Cost" note={windowWords(windowDays)} controls={controls}>
          {error}
        </AdminPage>,
      ),
    ready: (cost, refreshed) =>
      frame(
        <AdminPage title="Cost" note={windowWords(windowDays)} controls={controls}>
          {refreshed(<CostSections cost={cost} onOpenAccount={onOpenAccount} />)}
        </AdminPage>,
      ),
  });
}
