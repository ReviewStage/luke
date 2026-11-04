import { Schema as EffectSchema } from "effect";
import { CONTEXT_WINDOW } from "./agent-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import {
  AGENT_DEFAULT_CHOICE,
  agentFallbackChoice,
  type CatalogModel,
  type ModelChoice,
} from "./models-wire.js";

/**
 * account-preferences-live.ts -- the account's preferences row as the host follows it over the service's held poll: the statement the service answers, the row it delivers, and the choices every surface draws from it.
 *
 * The service answers one statement, the account's own row as stored, or
 * none for an account that stored nothing: the coding agents' default as
 * its three columns stand and whether our Slack bot writes the account. Each is read here as the preferences snapshot reads
 * it (`account-store.ts`'s `snapshotOf` calls `storedAgentChoice`), so the
 * live read and `/api/account/preferences` never disagree. Where the account
 * stored no default, the default a surface draws is worked out from the
 * models it is offered by the service's own rule (`agentDefaultOf`).
 */

/** The account's preferences sealed for following: the address, and one statement. */
export const accountPreferencesLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ preferences: sealedLiveQuerySchema }),
});

export type AccountPreferencesLiveAnswer = typeof accountPreferencesLiveAnswerSchema.Type;

/**
 * The account's row as the statement delivers it, each column as stored and
 * null where never chosen. Note that the context window is read as text,
 * because a value a later build adds or an older one dropped reads as the
 * default rather than failing the row.
 */
const accountPreferencesLiveRowSchema = EffectSchema.Struct({
  agentModel: EffectSchema.NullOr(EffectSchema.String),
  agentEffort: EffectSchema.NullOr(EffectSchema.String),
  agentContextWindow: EffectSchema.NullOr(EffectSchema.String),
  slackNotifications: EffectSchema.NullOr(EffectSchema.Boolean),
});

export type AccountPreferencesLiveRow = typeof accountPreferencesLiveRowSchema.Type;

/** The account's row as Realtime delivers it, decoded at the boundary before anything reads it: none for an account that stored nothing. */
export const accountPreferencesLiveRowsSchema = EffectSchema.Struct({
  preferences: EffectSchema.Array(accountPreferencesLiveRowSchema),
});

/** The account's choices as the row holds them, each read as the preferences snapshot reads it. */
export interface AccountPreferencesLive {
  /** The coding agents' default the account stored; none until it chooses, where a surface draws the fallback (`agentDefaultOf`). */
  readonly agent: ModelChoice | undefined;
  /** Whether our Slack bot writes the account the threads that wait on it; on until the account chooses. */
  readonly slackNotifications: boolean;
}

/** The models as a read of them stands, as the host holds it: its answer once it answered, and whether it said it could not before it ever had. */
interface OfferedModelsRead {
  readonly rows?: {
    readonly models: readonly Pick<CatalogModel, "id" | "provider" | "credentialMissing">[];
  };
  readonly failed?: true;
}

/**
 * The coding agents' default a row holds. It stands only with both halves
 * written; one half alone is no choice the catalog could have accepted, so
 * it reads as none stored, as a row never written does. The context window
 * is named only where it is the standard one, as the wire names it.
 */
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

/** The account's choices as its row holds them; each choice's default where the account stored no row. */
export function accountPreferencesOfLiveRows(
  rows: readonly AccountPreferencesLiveRow[],
): AccountPreferencesLive {
  const [row] = rows;
  return {
    agent: row === undefined ? undefined : storedAgentChoice(row),
    // Note that a switch never chosen reads as on, as the Slack bot reads it (`slackNotificationsOn`).
    slackNotifications: row?.slackNotifications !== false,
  };
}

/**
 * The default every surface draws, as the preferences snapshot answers it
 * (`account-procedures.ts`'s `snapshotAgent`): the stored choice where there
 * is one; otherwise the fallback the models the account is offered mark as
 * paid for (`agentFallbackChoice`), once they answered; otherwise
 * Anthropic's, where the models could not be read, as the service answers
 * when its catalog cannot be. None while nothing is stored and the models
 * have not answered yet.
 */
export function agentDefaultOf(
  stored: ModelChoice | undefined,
  models: OfferedModelsRead,
): ModelChoice | undefined {
  if (stored !== undefined) return stored;
  if (models.rows !== undefined) return agentFallbackChoice(models.rows.models);
  return models.failed === true ? AGENT_DEFAULT_CHOICE : undefined;
}
