import { Schema as EffectSchema, Option } from "effect";
import {
  INTEGRATION_ACCOUNTS_MAX,
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationStatus,
  integrationConnectionNameSchema,
  integrationConnectionOf,
  integrationProviderSchema,
  type integrationStatusesAnswerSchema,
} from "./integration-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";

export const integrationStatusesLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ connections: sealedLiveQuerySchema }),
  offered: EffectSchema.Array(EffectSchema.String),
  multiple: EffectSchema.Array(EffectSchema.String),
});

export type IntegrationStatusesLiveAnswer = typeof integrationStatusesLiveAnswerSchema.Type;

export type IntegrationStatusesAnswer = typeof integrationStatusesAnswerSchema.Type;

const rowStatusSchema = EffectSchema.Literals([
  INTEGRATION_STATUS.CONNECTED,
  INTEGRATION_STATUS.PENDING,
  INTEGRATION_STATUS.EXPIRED,
  INTEGRATION_STATUS.DISCONNECTED,
]);

const integrationLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  connection: integrationConnectionNameSchema,
  provider: integrationProviderSchema,
  label: EffectSchema.NullOr(EffectSchema.String),
  status: rowStatusSchema,
});

export type IntegrationLiveRow = typeof integrationLiveRowSchema.Type;

const readRow = EffectSchema.decodeUnknownOption(integrationLiveRowSchema);

export function integrationLiveRowsOf(rows: readonly unknown[]): readonly IntegrationLiveRow[] {
  return rows.flatMap((row) => Option.toArray(readRow(row)));
}

const readProvider = EffectSchema.decodeUnknownOption(integrationProviderSchema);

function providersOf(words: readonly string[]): ReadonlySet<IntegrationProvider> {
  return new Set(words.flatMap((word) => Option.toArray(readProvider(word))));
}

function placeOf(row: IntegrationLiveRow): number {
  return integrationConnectionOf(row.connection)?.place ?? Number.POSITIVE_INFINITY;
}

function accountOf(row: IntegrationLiveRow): IntegrationAccount {
  return {
    provider: row.provider,
    connection: row.connection,
    ...(row.label !== null && row.label !== "" ? { label: row.label } : undefined),
    status: row.status,
  };
}

export function integrationStatusesOfLive(
  rows: readonly IntegrationLiveRow[],
  offered: readonly string[],
  multiple: readonly string[],
  github: IntegrationStatus,
): IntegrationStatusesAnswer {
  const offeredProviders = providersOf(offered);
  const multipleProviders = providersOf(multiple);
  const standings = INTEGRATION_PROVIDER_LIST.map((provider) => {
    if (INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN) {
      return { provider, status: github, accounts: [] };
    }
    if (!offeredProviders.has(provider)) {
      return { provider, status: INTEGRATION_STATUS.UNAVAILABLE, accounts: [] };
    }
    const held = rows
      .filter((row) => row.provider === provider)
      .toSorted((a, b) => placeOf(a) - placeOf(b));
    const first = held.find((row) => row.connection === provider);
    return {
      provider,
      status: first?.status ?? INTEGRATION_STATUS.DISCONNECTED,
      accounts: held.filter((row) => row.status !== INTEGRATION_STATUS.DISCONNECTED).map(accountOf),
    };
  });
  const integrations = Object.fromEntries(
    standings.map(({ provider, status }) => [provider, status]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
  const accounts = standings.flatMap((standing) => standing.accounts);
  const addable = standings
    .filter(
      ({ provider, accounts: held }) =>
        offeredProviders.has(provider) &&
        multipleProviders.has(provider) &&
        held.length < INTEGRATION_ACCOUNTS_MAX,
    )
    .map(({ provider }) => provider);
  return {
    integrations,
    ...(accounts.length > 0 ? { accounts } : undefined),
    ...(addable.length > 0 ? { addable } : undefined),
  };
}
