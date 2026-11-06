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
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

/**
 * integration-live.ts -- the account's integrations as the host follows them over the service's held poll: the read declared, and where every provider and account stands as its rows say.
 *
 * The service answers one statement, every integration row the account
 * holds, each where it stands as stored, with the providers the account is
 * offered and those that take several accounts beside it, which no
 * statement carries since they come from the deployment and the account's
 * email. GitHub's standing comes from the account's GitHub sign-in rather
 * than a row, so the host fetches it beside the read
 * (`ACCOUNT_INTEGRATIONS_GITHUB`). The rows, the providers, and GitHub's
 * standing are drawn into the same answer the statuses read gives
 * (`integrationStatusesAnswerSchema`), a row naming a provider or a status
 * this build does not know read as no row, as that read is read leniently.
 */

/** Where every provider stands, each account, and where another may be added, as the statuses read answers it. */
export type IntegrationStatusesAnswer = typeof integrationStatusesAnswerSchema.Type;

/** A row's standing as the statement words it, which a row of no other standing says. */
const rowStatusSchema = EffectSchema.Literals([
  INTEGRATION_STATUS.CONNECTED,
  INTEGRATION_STATUS.PENDING,
  INTEGRATION_STATUS.EXPIRED,
  INTEGRATION_STATUS.DISCONNECTED,
]);

/**
 * The account's integrations as the host follows them: one part, every
 * integration row the account holds, each where it stands as stored, and
 * the providers it is offered and those that take several accounts beside
 * it, each kept in words so one this build does not know hides none of the
 * others. The sign-in window a row's standing is read against is the
 * service's, from its clock (`issuedSince`). The rows are read each alone
 * (`integrationLiveRowsOf`), so one naming a provider or a status this
 * build does not know hides none of the others.
 */
export const INTEGRATION_STATUSES_READ = liveRead({
  name: LIVE_READ.INTEGRATIONS,
  path: HOSTED_SERVICE_PATH.LIVE_INTEGRATION_STATUSES,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, issuedSince: LIVE_PARAM.SERVED },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    connections: liveRows({
      row: EffectSchema.Struct({
        id: EffectSchema.String,
        connection: integrationConnectionNameSchema,
        provider: integrationProviderSchema,
        label: EffectSchema.NullOr(EffectSchema.String),
        status: rowStatusSchema,
      }),
      key: "id",
      order: [["id", ORDER.ASC]],
    }),
  },
  beside: {
    offered: EffectSchema.Array(EffectSchema.String),
    multiple: EffectSchema.Array(EffectSchema.String),
  },
});

export type IntegrationStatusesLiveAnswer = LiveReadAnswer<typeof INTEGRATION_STATUSES_READ>;

/** One integration row as the statement delivers it, by its id. */
export type IntegrationLiveRow = LiveRowOf<typeof INTEGRATION_STATUSES_READ.parts.connections>;

const readRow = EffectSchema.decodeUnknownOption(INTEGRATION_STATUSES_READ.parts.connections.row);

/** The rows this build reads, each alone, so one naming a provider or a status it does not know hides none of the others. */
export function integrationLiveRowsOf(rows: readonly unknown[]): readonly IntegrationLiveRow[] {
  return rows.flatMap((row) => Option.toArray(readRow(row)));
}

const readProvider = EffectSchema.decodeUnknownOption(integrationProviderSchema);

/** The providers this build knows among `words`. */
function providersOf(words: readonly string[]): ReadonlySet<IntegrationProvider> {
  return new Set(words.flatMap((word) => Option.toArray(readProvider(word))));
}

/** A row's place among its provider's accounts, the first's being its provider's own; last where its name says none. */
function placeOf(row: IntegrationLiveRow): number {
  return integrationConnectionOf(row.connection)?.place ?? Number.POSITIVE_INFINITY;
}

/** One row as an account, its label kept where the grant or the developer gave it a name. */
function accountOf(row: IntegrationLiveRow): IntegrationAccount {
  return {
    provider: row.provider,
    connection: row.connection,
    // An empty label marks an account whose grant named nothing, which is called by its place.
    ...(row.label !== null && row.label !== "" ? { label: row.label } : undefined),
    status: row.status,
  };
}

/**
 * Where every provider and account stands as the rows say, as the statuses
 * read that settles nothing answers it (`integrations-procedures.ts`): a
 * provider the account's GitHub sign-in grants stands as `github` does; one
 * not offered stands unavailable, its rows read as none; any other stands
 * as its first account does, disconnected with none. Every account of an
 * offered provider is listed in its place's order, but one disconnected,
 * as a first sign-in that lapsed is, which stands for nothing; and another
 * may be added where the provider takes several and holds fewer than the
 * most.
 */
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
  // SAFETY: the entries are one per provider of INTEGRATION_PROVIDER_LIST, which is every provider.
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
