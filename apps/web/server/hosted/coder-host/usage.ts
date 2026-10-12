import type { StoredTurnUsage } from "@sidecar/database/schemas/storage";
import type { CodingAgentUsage } from "@sidecar/hosted/coding-agent-wire";
import type { BrainRunUsage } from "../../core.js";
import type { TurnUsageRow } from "../coding-agent-store.js";
import { type OfferedModel, tokensCostUsd } from "../model-catalog.js";

/**
 * usage.ts -- what a coding agent has cost: its turns' tokens summed, and their price where the catalog lists one for every model they ran on.
 *
 * A turn's row keeps its counts whole and, since the model can change
 * between steps, the same counts by the model each step ran on; a row from
 * before that breakdown was kept ran every step on the model the row
 * names. Each share is priced at its own model's catalog prices, and the
 * price is answered only when every share has one: a model the catalog no
 * longer lists, or lists without prices, leaves the tokens alone to tell.
 * The catalog's prices are per token to many places, so the dollars are
 * rounded to the cent's hundredth once summed, which is also what keeps a
 * float sum off the wire.
 */

/** How many decimals of a dollar the wire carries. */
const USD_DECIMALS = 6;

/** The turn's counts by model: the breakdown its row keeps, or the whole at the row's model, which is nothing to price where the row names none. */
function sharesOf(row: TurnUsageRow): readonly (BrainRunUsage & { readonly model?: string })[] {
  const { byModel, ...whole } = row.usage;
  if (byModel !== undefined && byModel.length > 0) return byModel;
  return [row.model === null ? whole : { model: row.model, ...whole }];
}

/** The tokens of every turn summed, and their price where every share of them has one. */
export function usageOfTurns(
  rows: readonly TurnUsageRow[],
  offered: readonly OfferedModel[],
): CodingAgentUsage | undefined {
  if (rows.length === 0) return undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let costUsd: number | undefined = 0;
  for (const row of rows) {
    inputTokens += row.usage.inputTokens;
    outputTokens += row.usage.outputTokens;
    cachedInputTokens += row.usage.cachedInputTokens;
    for (const share of sharesOf(row)) {
      const pricing = offered.find((model) => model.id === share.model)?.pricing;
      costUsd =
        pricing === undefined || costUsd === undefined
          ? undefined
          : costUsd + tokensCostUsd(pricing, share);
    }
  }
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    ...(costUsd === undefined ? undefined : { costUsd: Number(costUsd.toFixed(USD_DECIMALS)) }),
  };
}

/** One turn's usage as the wire carries it, or nothing for a turn with none recorded yet. */
export function usageOfTurn(
  turn: { readonly model: string | null; readonly usage: StoredTurnUsage | null } | undefined,
  offered: readonly OfferedModel[],
): CodingAgentUsage | undefined {
  if (turn === undefined || turn.usage === null) return undefined;
  return usageOfTurns([{ model: turn.model, usage: turn.usage }], offered);
}
