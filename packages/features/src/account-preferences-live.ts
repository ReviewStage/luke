import { Schema as EffectSchema } from "effect";
import { CONTEXT_WINDOW } from "./agent-wire.js";
import { type ChaptersModelId, chaptersModelFrom } from "./chapters-model-choice.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import {
  AGENT_DEFAULT_CHOICE,
  agentFallbackChoice,
  type CatalogModel,
  type ModelChoice,
} from "./models-wire.js";

export const accountPreferencesLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ preferences: sealedLiveQuerySchema }),
});

export type AccountPreferencesLiveAnswer = typeof accountPreferencesLiveAnswerSchema.Type;

const accountPreferencesLiveRowSchema = EffectSchema.Struct({
  agentModel: EffectSchema.NullOr(EffectSchema.String),
  agentEffort: EffectSchema.NullOr(EffectSchema.String),
  agentContextWindow: EffectSchema.NullOr(EffectSchema.String),
  chaptersModel: EffectSchema.NullOr(EffectSchema.String),
  slackNotifications: EffectSchema.NullOr(EffectSchema.Boolean),
});

export type AccountPreferencesLiveRow = typeof accountPreferencesLiveRowSchema.Type;

export const accountPreferencesLiveRowsSchema = EffectSchema.Struct({
  preferences: EffectSchema.Array(accountPreferencesLiveRowSchema),
});

export interface AccountPreferencesLive {
  readonly agent: ModelChoice | undefined;
  readonly chaptersModel: ChaptersModelId;
  readonly slackNotifications: boolean;
}

interface OfferedModelsRead {
  readonly rows?: {
    readonly models: readonly Pick<CatalogModel, "id" | "provider" | "credentialMissing">[];
  };
  readonly failed?: true;
}

export function storedAgentChoice(
  row: Pick<AccountPreferencesLiveRow, "agentModel" | "agentEffort" | "agentContextWindow">,
): ModelChoice | undefined {
  if (row.agentModel === null || row.agentEffort === null) return undefined;
  const standard = row.agentContextWindow === CONTEXT_WINDOW.STANDARD;
  return {
    model: row.agentModel,
    effort: row.agentEffort,
    ...(standard ? { contextWindow: CONTEXT_WINDOW.STANDARD } : undefined),
  };
}

export function accountPreferencesOfLiveRows(
  rows: readonly AccountPreferencesLiveRow[],
): AccountPreferencesLive {
  const [row] = rows;
  return {
    agent: row === undefined ? undefined : storedAgentChoice(row),
    chaptersModel: chaptersModelFrom(row?.chaptersModel),
    slackNotifications: row?.slackNotifications !== false,
  };
}

export function agentDefaultOf(
  stored: ModelChoice | undefined,
  models: OfferedModelsRead,
): ModelChoice | undefined {
  if (stored !== undefined) return stored;
  if (models.rows !== undefined) return agentFallbackChoice(models.rows.models);
  return models.failed === true ? AGENT_DEFAULT_CHOICE : undefined;
}
