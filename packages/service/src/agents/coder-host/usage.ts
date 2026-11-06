import type { TurnUsageRow } from "@repo/database/models/agent-store";
import type { AgentUsage } from "@repo/features/agent-wire";
import { standardModelIdOf } from "@repo/features/models-wire";
import type { RunUsage } from "../../core.js";
import { type OfferedModel, tokensCostUsd } from "../../providers/model-catalog.js";

const USD_DECIMALS = 6;

type UsageShare = RunUsage & { readonly model?: string };

function sharesOf(row: TurnUsageRow): readonly UsageShare[] {
  const { byModel, ...whole } = row.usage;
  const shares: readonly UsageShare[] =
    byModel !== undefined && byModel.length > 0
      ? byModel
      : [row.model === null ? whole : { model: row.model, ...whole }];
  if (!row.fastRefused) return shares;
  return shares.map((share) =>
    share.model === undefined ? share : { ...share, model: standardModelIdOf(share.model) },
  );
}

export function costOfTurns(
  rows: readonly TurnUsageRow[],
  offered: readonly OfferedModel[],
): number | undefined {
  let costUsd = 0;
  for (const row of rows) {
    for (const share of sharesOf(row)) {
      const pricing = offered.find((model) => model.id === share.model)?.pricing;
      if (pricing === undefined) return undefined;
      costUsd += tokensCostUsd(pricing, share);
    }
  }
  return costUsd;
}

export function usageOfTurns(
  rows: readonly TurnUsageRow[],
  offered: readonly OfferedModel[],
): AgentUsage | undefined {
  if (rows.length === 0) return undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  for (const row of rows) {
    inputTokens += row.usage.inputTokens;
    outputTokens += row.usage.outputTokens;
    cachedInputTokens += row.usage.cachedInputTokens;
  }
  const costUsd = costOfTurns(rows, offered);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    ...(costUsd === undefined ? undefined : { costUsd: Number(costUsd.toFixed(USD_DECIMALS)) }),
  };
}
