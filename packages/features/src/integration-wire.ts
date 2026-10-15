import { WireValueSchema } from "@luke/wire";
import { verbatimJsonSchema } from "@luke/wire/effect";
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
  EXECUTOR: "executor",
  GITHUB: "github",
  GRANOLA: "granola",
  LINEAR: "linear",
  MERCURY: "mercury",
  NEON: "neon",
  NOTION: "notion",
  POSTHOG: "posthog",
  SENTRY: "sentry",
  SLACK: "slack",
  SUPABASE: "supabase",
  VERCEL: "vercel",
  YCOMBINATOR: "ycombinator",
} as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDER)[keyof typeof INTEGRATION_PROVIDER];

/** Every provider, in the order a list of them is drawn. */
export const INTEGRATION_PROVIDER_LIST: readonly IntegrationProvider[] =
  Object.values(INTEGRATION_PROVIDER);

/** What each provider is called wherever Luke names it, to the developer and to a model alike. */
export const INTEGRATION_NAME = {
  [INTEGRATION_PROVIDER.EXECUTOR]: "Executor",
  [INTEGRATION_PROVIDER.GITHUB]: "GitHub",
  [INTEGRATION_PROVIDER.GRANOLA]: "Granola",
  [INTEGRATION_PROVIDER.LINEAR]: "Linear",
  [INTEGRATION_PROVIDER.MERCURY]: "Mercury",
  [INTEGRATION_PROVIDER.NEON]: "Neon",
  [INTEGRATION_PROVIDER.NOTION]: "Notion",
  [INTEGRATION_PROVIDER.POSTHOG]: "PostHog",
  [INTEGRATION_PROVIDER.SENTRY]: "Sentry",
  [INTEGRATION_PROVIDER.SLACK]: "Slack",
  [INTEGRATION_PROVIDER.SUPABASE]: "Supabase",
  [INTEGRATION_PROVIDER.VERCEL]: "Vercel",
  [INTEGRATION_PROVIDER.YCOMBINATOR]: "Y Combinator",
} as const satisfies Record<IntegrationProvider, string>;

/** How an account grants Luke's agents a provider. */
export const INTEGRATION_GRANT = {
  /** A sign-in to the provider through Vercel Connect, begun from Settings › Integrations and ended there. */
  CONNECT: "connect",
  /**
   * The account's own sign-in to Luke with GitHub, whose GitHub App user
   * token the provider's server takes: the provider stands connected
   * whenever that sign-in does, and is connected by signing in with GitHub.
   */
  GITHUB_SIGN_IN: "github-sign-in",
} as const;

export type IntegrationGrant = (typeof INTEGRATION_GRANT)[keyof typeof INTEGRATION_GRANT];

/** How each provider is granted. */
export const INTEGRATION_GRANT_OF = {
  [INTEGRATION_PROVIDER.EXECUTOR]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.GITHUB]: INTEGRATION_GRANT.GITHUB_SIGN_IN,
  [INTEGRATION_PROVIDER.GRANOLA]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.LINEAR]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.MERCURY]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.NEON]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.NOTION]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.POSTHOG]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.SENTRY]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.SLACK]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.SUPABASE]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.VERCEL]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.YCOMBINATOR]: INTEGRATION_GRANT.CONNECT,
} as const satisfies Record<IntegrationProvider, IntegrationGrant>;

/**
 * The web hosts each provider's own pages stand on, which a link is known to
 * be the provider's by: the host itself or any host under it
 * (`acme.slack.com`, `us.posthog.com`). A provider whose pages have no host
 * of their own has none.
 */
const INTEGRATION_HOSTS = {
  [INTEGRATION_PROVIDER.EXECUTOR]: [],
  [INTEGRATION_PROVIDER.GITHUB]: ["github.com"],
  [INTEGRATION_PROVIDER.GRANOLA]: ["granola.ai"],
  [INTEGRATION_PROVIDER.LINEAR]: ["linear.app"],
  [INTEGRATION_PROVIDER.MERCURY]: ["mercury.com"],
  [INTEGRATION_PROVIDER.NEON]: ["neon.tech"],
  [INTEGRATION_PROVIDER.NOTION]: ["notion.so", "notion.site"],
  [INTEGRATION_PROVIDER.POSTHOG]: ["posthog.com"],
  [INTEGRATION_PROVIDER.SENTRY]: ["sentry.io"],
  [INTEGRATION_PROVIDER.SLACK]: ["slack.com"],
  [INTEGRATION_PROVIDER.SUPABASE]: ["supabase.com"],
  [INTEGRATION_PROVIDER.VERCEL]: ["vercel.com"],
  [INTEGRATION_PROVIDER.YCOMBINATOR]: ["ycombinator.com"],
} as const satisfies Record<IntegrationProvider, readonly string[]>;

/** The provider whose pages the host stands among; nothing for a host no provider's. */
export function integrationOfHost(host: string): IntegrationProvider | undefined {
  const asked = host.toLowerCase();
  return INTEGRATION_PROVIDER_LIST.find((provider) =>
    INTEGRATION_HOSTS[provider].some((own) => asked === own || asked.endsWith(`.${own}`)),
  );
}

const PROVIDERS: ReadonlySet<string> = new Set(INTEGRATION_PROVIDER_LIST);

/** A provider as an address or a query spells it; anything else is no provider. */
export function integrationProviderFromWire(value: string | null): IntegrationProvider | undefined {
  // SAFETY: membership in the set built from INTEGRATION_PROVIDER's values is what the union names.
  return value !== null && PROVIDERS.has(value) ? (value as IntegrationProvider) : undefined;
}

export const integrationProviderSchema = EffectSchema.Literals(INTEGRATION_PROVIDER_LIST);

/**
 * The fixed name a nested call of each provider's own MCP tools is stored
 * under in an agent's transcript, whatever the provider's server names the
 * tool itself: the service records the call under it
 * (`packages/service/src/integrations/connection-tools.ts`), and the desktop
 * draws the provider's mark on its row.
 */
export const INTEGRATION_REMOTE_TOOL = {
  [INTEGRATION_PROVIDER.EXECUTOR]: "executor_remote",
  [INTEGRATION_PROVIDER.GITHUB]: "github_remote",
  [INTEGRATION_PROVIDER.GRANOLA]: "granola_remote",
  [INTEGRATION_PROVIDER.LINEAR]: "linear_remote",
  [INTEGRATION_PROVIDER.MERCURY]: "mercury_remote",
  [INTEGRATION_PROVIDER.NEON]: "neon_remote",
  [INTEGRATION_PROVIDER.NOTION]: "notion_remote",
  [INTEGRATION_PROVIDER.POSTHOG]: "posthog_remote",
  [INTEGRATION_PROVIDER.SENTRY]: "sentry_remote",
  [INTEGRATION_PROVIDER.SLACK]: "slack_remote",
  [INTEGRATION_PROVIDER.SUPABASE]: "supabase_remote",
  [INTEGRATION_PROVIDER.VERCEL]: "vercel_remote",
  [INTEGRATION_PROVIDER.YCOMBINATOR]: "ycombinator_remote",
} as const satisfies Record<IntegrationProvider, string>;

/** The provider a stored call's tool name is the remote name of; nothing for any other tool. */
export function integrationOfRemoteTool(tool: string): IntegrationProvider | undefined {
  return INTEGRATION_PROVIDER_LIST.find((provider) => INTEGRATION_REMOTE_TOOL[provider] === tool);
}

/**
 * A remote tool's own name as a stored call keeps it: the characters MCP
 * allows a tool's name, dots among them (Y Combinator's `hiring.list_jobs`),
 * and nothing shaped like a sentence.
 */
const REMOTE_TOOL_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * A nested call of an integration's tool as a transcript stores it, under
 * its provider's `INTEGRATION_REMOTE_TOOL`: the service holds the call it
 * records to this schema, and the desktop reads the stored part back
 * through it, so the two read one envelope.
 */
export const integrationRemoteCallSchema = EffectSchema.Struct({
  /** The provider's own name for the tool, without the connection's. */
  remoteTool: EffectSchema.String.check(EffectSchema.isPattern(REMOTE_TOOL_PATTERN)),
  /** The `connection_execute` call it ran under. */
  parentCallId: EffectSchema.String,
  /** The input eve validated against the tool's schema and sent; empty where it sent none. */
  input: verbatimJsonSchema(WireValueSchema, { type: "object", additionalProperties: true }),
});

export type IntegrationRemoteCall = typeof integrationRemoteCallSchema.Type;

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

/** How a sign-in the browser never brought back to Luke ended, as Vercel Connect tells it. */
export const INTEGRATION_SIGN_IN_FAILURE = {
  /** The developer cancelled it on Connect's own page. */
  CANCELED: "canceled",
  /** Connect or the provider refused it; Connect's own line says why where it is safe to keep. */
  ERROR: "error",
} as const;

/** One provider's sign-in that ended without a grant, and why, with Connect's own line where it carried no credential. */
export const integrationSignInFailureSchema = EffectSchema.Struct({
  provider: integrationProviderSchema,
  reason: EffectSchema.Literals(Object.values(INTEGRATION_SIGN_IN_FAILURE)),
  message: EffectSchema.optionalKey(EffectSchema.String),
});

export type IntegrationSignInFailure = typeof integrationSignInFailureSchema.Type;

/**
 * Where every provider's connection stands (GET), and each sign-in this
 * read found ended without a grant: a read says so once, as it ends it.
 */
export const integrationStatusesAnswerSchema = EffectSchema.Struct({
  integrations: EffectSchema.Record(integrationProviderSchema, integrationStatusSchema),
  signInFailures: EffectSchema.optionalKey(EffectSchema.Array(integrationSignInFailureSchema)),
});

/** What a Disconnect leaves of the one provider it ended (POST). */
export const integrationStatusAnswerSchema = EffectSchema.Struct({
  status: integrationStatusSchema,
});

/** Why a connected provider's server listed no tools when the service asked it. */
export const INTEGRATION_TOOLS_PROBLEM = {
  /** The server refused the account's sign-in. */
  REFUSED: "refused",
  /** The server answered with an error of its own, whose message is kept where it sent one. */
  REJECTED: "rejected",
  /** The server never answered, or answered with an error status and no message. */
  UNREACHABLE: "unreachable",
  /** The server answered what no MCP client reads. */
  UNREADABLE: "unreadable",
} as const;

export type IntegrationToolsProblemReason =
  (typeof INTEGRATION_TOOLS_PROBLEM)[keyof typeof INTEGRATION_TOOLS_PROBLEM];

/**
 * The hints an MCP server gives of what one of its tools does, the spec's
 * `ToolAnnotations`: whether it only reads, whether a write it makes
 * destroys, whether calling it again changes nothing more, and whether it
 * reaches past the server's own world. Each stands only where the server
 * sent it, so an absent hint is never read as its spec default.
 */
export const integrationToolAnnotationsSchema = EffectSchema.Struct({
  readOnlyHint: EffectSchema.optionalKey(EffectSchema.Boolean),
  destructiveHint: EffectSchema.optionalKey(EffectSchema.Boolean),
  idempotentHint: EffectSchema.optionalKey(EffectSchema.Boolean),
  openWorldHint: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type IntegrationToolAnnotations = typeof integrationToolAnnotationsSchema.Type;

/**
 * One argument a tool takes, as its server's input schema declares it, for a
 * person to read: its name, its type in a few words (`string`, `string[]`,
 * `string | null`, `enum`, `object`), whether a call must give it, and, where
 * the schema says, what it is, the values it may take, and its default, each
 * value written as the JSON it is unless it is a string.
 */
export const integrationToolParameterSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  type: EffectSchema.String,
  required: EffectSchema.Boolean,
  description: EffectSchema.optionalKey(EffectSchema.String),
  values: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  default: EffectSchema.optionalKey(EffectSchema.String),
});

export type IntegrationToolParameter = typeof integrationToolParameterSchema.Type;

/**
 * The tools one provider's server offers the account's agents (GET): each
 * one's name, the title a person reads where its server gave one, what it
 * does as its server wrote it, the hints its server annotated it with where
 * it sent any, and the arguments it takes where its server's input schema
 * was readable; or why the server listed none, with the server's own
 * one-line message where it sent one.
 */
export const integrationToolsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    tools: EffectSchema.Array(
      EffectSchema.Struct({
        name: EffectSchema.String,
        title: EffectSchema.optionalKey(EffectSchema.String),
        description: EffectSchema.String,
        annotations: EffectSchema.optionalKey(integrationToolAnnotationsSchema),
        parameters: EffectSchema.optionalKey(EffectSchema.Array(integrationToolParameterSchema)),
      }),
    ),
  }),
  EffectSchema.Struct({
    problem: EffectSchema.Struct({
      reason: EffectSchema.Literals(Object.values(INTEGRATION_TOOLS_PROBLEM)),
      message: EffectSchema.optionalKey(EffectSchema.String),
    }),
  }),
]);

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
