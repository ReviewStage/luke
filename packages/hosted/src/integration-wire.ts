import { Schema as EffectSchema } from "effect";

/**
 * integration-wire.ts -- the account's integrations, as the desktop reads and changes them.
 *
 * An integration is a service an account connects so Luke's agents can use
 * it on the account's behalf, each through its own hosted MCP server and a
 * grant Vercel Connect holds. `GET /api/account/integrations` answers where
 * every provider's connection stands, one word each.
 * `POST /api/account/integrations/{provider}/connect` begins a browser
 * sign-in through Vercel Connect and answers the address the browser opens,
 * which the desktop opens and never draws.
 * `POST /api/account/integrations/{provider}/disconnect` ends the connection
 * and answers its word. The browser returns from a sign-in to the service's
 * own callback, which settles it and sends the browser on to the landing
 * page below with the provider and one word of its own. No answer carries a
 * token or an identity at the provider.
 */

/**
 * The services an account may connect. A provider's value is also the name
 * its eve connection is registered under, which is its file's name in every
 * agent's `connections/`, and the path segment its routes are addressed by.
 */
export const INTEGRATION_PROVIDER = {
  LINEAR: "linear",
  NOTION: "notion",
  SENTRY: "sentry",
} as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDER)[keyof typeof INTEGRATION_PROVIDER];

/** Every provider, in the order a list of them is drawn. */
export const INTEGRATION_PROVIDER_LIST: readonly IntegrationProvider[] =
  Object.values(INTEGRATION_PROVIDER);

/** What each provider is called wherever Luke names it, to the developer and to a model alike. */
export const INTEGRATION_NAME = {
  [INTEGRATION_PROVIDER.LINEAR]: "Linear",
  [INTEGRATION_PROVIDER.NOTION]: "Notion",
  [INTEGRATION_PROVIDER.SENTRY]: "Sentry",
} as const satisfies Record<IntegrationProvider, string>;

const PROVIDERS: ReadonlySet<string> = new Set(INTEGRATION_PROVIDER_LIST);

/** A provider as an address or a query spells it; anything else is no provider. */
export function integrationProviderFromWire(value: string | null): IntegrationProvider | undefined {
  // SAFETY: membership in the set built from INTEGRATION_PROVIDER's values is what the union names.
  return value !== null && PROVIDERS.has(value) ? (value as IntegrationProvider) : undefined;
}

export const integrationProviderSchema = EffectSchema.Literals(INTEGRATION_PROVIDER_LIST);

/** Where an account's connection to one provider stands. */
export const INTEGRATION_STATUS = {
  /** Luke's agents may use the account's grant. */
  CONNECTED: "connected",
  /** A sign-in was begun and has not completed. */
  PENDING: "pending",
  /** The account was connected, and the provider's grant has since stopped working; connect again. */
  EXPIRED: "expired",
  /** The account has no connection. */
  DISCONNECTED: "disconnected",
  /** This deployment of Luke offers no connection to the provider at all. */
  UNAVAILABLE: "unavailable",
} as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUS)[keyof typeof INTEGRATION_STATUS];

const integrationStatusSchema = EffectSchema.Literals(Object.values(INTEGRATION_STATUS));

/** Where every provider's connection stands (GET). */
export const integrationStatusesAnswerSchema = EffectSchema.Struct({
  integrations: EffectSchema.Record(integrationProviderSchema, integrationStatusSchema),
});

/** What a Disconnect leaves of the one provider it ended (POST). */
export const integrationStatusAnswerSchema = EffectSchema.Struct({
  status: integrationStatusSchema,
});

/** The address a sign-in opens in the browser (POST): https, and nothing else. */
export const integrationConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isPattern(/^https:\/\/\S+$/)),
});

export type IntegrationConnectAnswer = typeof integrationConnectAnswerSchema.Type;

/** The page the browser lands on once a sign-in settled, and what its address carries. */
export const INTEGRATION_LANDING = {
  PATH: "/integration-connected.html",
  PROVIDER_PARAM: "provider",
  STATUS_PARAM: "status",
} as const;

/** How a browser sign-in settled, as the landing page says it. */
export const INTEGRATION_LANDING_STATUS = {
  /** The account is connected. */
  CONNECTED: "connected",
  /** The sign-in did not give Luke a grant: declined, cancelled, or abandoned. */
  NOT_COMPLETED: "not-completed",
  /** The sign-in's link was not one Luke issued, or it is too old to finish. */
  EXPIRED: "expired",
  /** Luke could not reach Vercel Connect to settle the sign-in. */
  UNAVAILABLE: "unavailable",
} as const;

export type IntegrationLandingStatus =
  (typeof INTEGRATION_LANDING_STATUS)[keyof typeof INTEGRATION_LANDING_STATUS];

const LANDING_STATUSES: ReadonlySet<string> = new Set(Object.values(INTEGRATION_LANDING_STATUS));

/** The landing's status as the address spells it; anything else is no status. */
export function integrationLandingStatusFromWire(
  value: string | null,
): IntegrationLandingStatus | undefined {
  // SAFETY: membership in the set built from INTEGRATION_LANDING_STATUS's values is what the union names.
  return value !== null && LANDING_STATUSES.has(value)
    ? (value as IntegrationLandingStatus)
    : undefined;
}

/**
 * The landing page's path for one settled sign-in, relative so it lands on
 * whichever host the browser is on. A sign-in whose state named no row has
 * no provider to say, and the page then names none.
 */
export function integrationLandingPath(
  provider: IntegrationProvider | undefined,
  status: IntegrationLandingStatus,
): string {
  const query = new URLSearchParams();
  if (provider !== undefined) query.set(INTEGRATION_LANDING.PROVIDER_PARAM, provider);
  query.set(INTEGRATION_LANDING.STATUS_PARAM, status);
  return `${INTEGRATION_LANDING.PATH}?${query}`;
}
