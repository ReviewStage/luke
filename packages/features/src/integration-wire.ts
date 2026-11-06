import { WireValueSchema } from "@repo/wire";
import { verbatimJsonSchema } from "@repo/wire/effect";
import { Schema as EffectSchema } from "effect";

/**
 * integration-wire.ts -- the account's integrations, as the desktop reads and changes them.
 *
 * An integration is a service an account connects so our agents can use
 * it on the account's behalf, each through its own hosted MCP server and a
 * grant Vercel Connect holds. A user account may connect more than one
 * account at a provider (two Notion workspaces), each its own grant under
 * its own connection name. `GET /api/account/integrations` answers where
 * every provider's first account stands, one word each, and every account
 * the account holds with its name, label, and standing.
 * `POST /api/account/integrations/{provider}/connect` begins a browser
 * sign-in through Vercel Connect, for the account a `connection` query names
 * or for a new one with `add=true`, and answers the address the browser
 * opens, which the desktop opens and never draws.
 * `POST /api/account/integrations/{provider}/disconnect` ends one account's
 * connection and answers its word; `…/rename` names one. The browser
 * returns from a sign-in to the
 * service's own callback, which settles it and sends the browser on to the
 * landing page below with the provider and one word of its own. No answer
 * carries a token. An account's label is its name at the provider (a
 * workspace's, an organization's), or the developer's own for it: it is an
 * identity at the provider, never a credential, and it is answered to the
 * desktop alone, never to a log line, a span, a counted event, or a fixture.
 */

/**
 * The services an account may connect. A provider's value is also the name
 * its MCP server is handed to an agent under, and the path segment its
 * routes are addressed by.
 */
export const INTEGRATION_PROVIDER = {
  EXECUTOR: "executor",
  GITHUB: "github",
  GMAIL: "gmail",
  GOOGLE_CALENDAR: "google-calendar",
  GOOGLE_DRIVE: "google-drive",
  GRANOLA: "granola",
  LINEAR: "linear",
  MERCURY: "mercury",
  NEON: "neon",
  NOTION: "notion",
  POSTHOG: "posthog",
  RESEND: "resend",
  SENTRY: "sentry",
  SLACK: "slack",
  STRIPE: "stripe",
  SUPABASE: "supabase",
  VERCEL: "vercel",
  YCOMBINATOR: "ycombinator",
} as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDER)[keyof typeof INTEGRATION_PROVIDER];

/** Every provider, in the order a list of them is drawn. */
export const INTEGRATION_PROVIDER_LIST: readonly IntegrationProvider[] =
  Object.values(INTEGRATION_PROVIDER);

/** What each provider is called wherever the app names it, to the developer and to a model alike. */
export const INTEGRATION_NAME = {
  [INTEGRATION_PROVIDER.EXECUTOR]: "Executor",
  [INTEGRATION_PROVIDER.GITHUB]: "GitHub",
  [INTEGRATION_PROVIDER.GMAIL]: "Gmail",
  [INTEGRATION_PROVIDER.GOOGLE_CALENDAR]: "Google Calendar",
  [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: "Google Drive",
  [INTEGRATION_PROVIDER.GRANOLA]: "Granola",
  [INTEGRATION_PROVIDER.LINEAR]: "Linear",
  [INTEGRATION_PROVIDER.MERCURY]: "Mercury",
  [INTEGRATION_PROVIDER.NEON]: "Neon",
  [INTEGRATION_PROVIDER.NOTION]: "Notion",
  [INTEGRATION_PROVIDER.POSTHOG]: "PostHog",
  [INTEGRATION_PROVIDER.RESEND]: "Resend",
  [INTEGRATION_PROVIDER.SENTRY]: "Sentry",
  [INTEGRATION_PROVIDER.SLACK]: "Slack",
  [INTEGRATION_PROVIDER.STRIPE]: "Stripe",
  [INTEGRATION_PROVIDER.SUPABASE]: "Supabase",
  [INTEGRATION_PROVIDER.VERCEL]: "Vercel",
  [INTEGRATION_PROVIDER.YCOMBINATOR]: "Y Combinator",
} as const satisfies Record<IntegrationProvider, string>;

/**
 * What each provider gives agents, as a row that is not connected says it
 * under the provider's name, so a developer knows what a Connect grants
 * before pressing it.
 */
export const INTEGRATION_PURPOSE = {
  [INTEGRATION_PROVIDER.EXECUTOR]: "The apps, APIs, and skills you set up in Executor",
  [INTEGRATION_PROVIDER.GITHUB]: "Issues, pull requests, and code, as you",
  [INTEGRATION_PROVIDER.GMAIL]: "Read mail and write drafts",
  [INTEGRATION_PROVIDER.GOOGLE_CALENDAR]: "Events, invitations, and free time",
  [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: "Docs, sheets, and files",
  [INTEGRATION_PROVIDER.GRANOLA]: "Meeting notes and transcripts",
  [INTEGRATION_PROVIDER.LINEAR]: "Issues, projects, and cycles",
  [INTEGRATION_PROVIDER.MERCURY]: "Accounts, transactions, and payments",
  [INTEGRATION_PROVIDER.NEON]: "Postgres projects, branches, and SQL",
  [INTEGRATION_PROVIDER.NOTION]: "Pages, databases, and comments",
  [INTEGRATION_PROVIDER.POSTHOG]: "Analytics, feature flags, and experiments",
  [INTEGRATION_PROVIDER.RESEND]: "Send email and read delivery logs",
  [INTEGRATION_PROVIDER.SENTRY]: "Errors, traces, and releases",
  [INTEGRATION_PROVIDER.SLACK]: "Messages, channels, and threads",
  [INTEGRATION_PROVIDER.STRIPE]: "Payments, customers, and subscriptions",
  [INTEGRATION_PROVIDER.SUPABASE]: "Postgres, auth, storage, and edge functions",
  [INTEGRATION_PROVIDER.VERCEL]: "Deployments, logs, and domains",
  [INTEGRATION_PROVIDER.YCOMBINATOR]: "Bookface companies, founders, and investors",
} as const satisfies Record<IntegrationProvider, string>;

/** How an account grants our agents a provider. */
export const INTEGRATION_GRANT = {
  /** A sign-in to the provider through Vercel Connect, begun from Settings › Integrations and ended there. */
  CONNECT: "connect",
  /**
   * The account's own sign-in to the app with GitHub, whose GitHub App user
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
  [INTEGRATION_PROVIDER.GMAIL]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.GOOGLE_CALENDAR]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.GRANOLA]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.LINEAR]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.MERCURY]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.NEON]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.NOTION]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.POSTHOG]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.RESEND]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.SENTRY]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.SLACK]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.STRIPE]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.SUPABASE]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.VERCEL]: INTEGRATION_GRANT.CONNECT,
  [INTEGRATION_PROVIDER.YCOMBINATOR]: INTEGRATION_GRANT.CONNECT,
} as const satisfies Record<IntegrationProvider, IntegrationGrant>;

/**
 * Whether each provider answers whose account a token is, so an account
 * whose grant named nothing is still called by its name there; the
 * service's table gives a provider its read (`integrations.ts`'s
 * `ACCOUNT_NAME`) exactly where this says so.
 */
export const INTEGRATION_NAMES_ACCOUNT = {
  [INTEGRATION_PROVIDER.EXECUTOR]: false,
  [INTEGRATION_PROVIDER.GITHUB]: false,
  [INTEGRATION_PROVIDER.GMAIL]: true,
  [INTEGRATION_PROVIDER.GOOGLE_CALENDAR]: true,
  [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: true,
  [INTEGRATION_PROVIDER.GRANOLA]: true,
  [INTEGRATION_PROVIDER.LINEAR]: false,
  [INTEGRATION_PROVIDER.MERCURY]: true,
  [INTEGRATION_PROVIDER.NEON]: true,
  [INTEGRATION_PROVIDER.NOTION]: true,
  [INTEGRATION_PROVIDER.POSTHOG]: true,
  [INTEGRATION_PROVIDER.RESEND]: false,
  [INTEGRATION_PROVIDER.SENTRY]: true,
  [INTEGRATION_PROVIDER.SLACK]: false,
  [INTEGRATION_PROVIDER.STRIPE]: false,
  [INTEGRATION_PROVIDER.SUPABASE]: true,
  [INTEGRATION_PROVIDER.VERCEL]: true,
  [INTEGRATION_PROVIDER.YCOMBINATOR]: true,
} as const satisfies Record<IntegrationProvider, boolean>;

/**
 * The web hosts each provider's own pages stand on, which a link is known to
 * be the provider's by: the host itself or any host under it
 * (`acme.slack.com`, `us.posthog.com`). A provider whose pages have no host
 * of their own has none.
 */
const INTEGRATION_HOSTS = {
  [INTEGRATION_PROVIDER.EXECUTOR]: [],
  [INTEGRATION_PROVIDER.GITHUB]: ["github.com"],
  [INTEGRATION_PROVIDER.GMAIL]: ["mail.google.com"],
  [INTEGRATION_PROVIDER.GOOGLE_CALENDAR]: ["calendar.google.com", "calendar.app.google"],
  [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: ["drive.google.com"],
  [INTEGRATION_PROVIDER.GRANOLA]: ["granola.ai"],
  [INTEGRATION_PROVIDER.LINEAR]: ["linear.app"],
  [INTEGRATION_PROVIDER.MERCURY]: ["mercury.com"],
  [INTEGRATION_PROVIDER.NEON]: ["neon.tech"],
  [INTEGRATION_PROVIDER.NOTION]: ["notion.com", "notion.so", "notion.site"],
  [INTEGRATION_PROVIDER.POSTHOG]: ["posthog.com"],
  [INTEGRATION_PROVIDER.RESEND]: ["resend.com"],
  [INTEGRATION_PROVIDER.SENTRY]: ["sentry.io"],
  [INTEGRATION_PROVIDER.SLACK]: ["slack.com"],
  [INTEGRATION_PROVIDER.STRIPE]: ["stripe.com"],
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
 * The name one account at a provider goes by everywhere: the MCP server
 * an agent reaches it through, a coding agent's switch and mention, and the
 * routes' `connection` query. The first account at a provider is named after
 * the provider (`notion`), so every name stored before a second account was
 * possible keeps naming it; another is the provider and its place, `notion-2`.
 * A connection's name is lowercase letters, digits, and dashes, from a
 * letter, up to 64 characters, and a tool's name was qualified with two
 * underscores, which this grammar never spells.
 */
const CONNECTION_NAME_PATTERN = new RegExp(
  `^(${INTEGRATION_PROVIDER_LIST.join("|")})(?:-([2-9]|[1-9][0-9]{1,2}))?$`,
  "u",
);

export const integrationConnectionNameSchema = EffectSchema.String.check(
  EffectSchema.isPattern(CONNECTION_NAME_PATTERN),
);

/** The provider a connection name is an account at, and its place there (1 for the first); nothing for any other string. */
export function integrationConnectionOf(
  name: string,
): { readonly provider: IntegrationProvider; readonly place: number } | undefined {
  const match = CONNECTION_NAME_PATTERN.exec(name);
  const provider = integrationProviderFromWire(match?.[1] ?? null);
  if (match === null || provider === undefined) return undefined;
  return { provider, place: match[2] === undefined ? 1 : Number(match[2]) };
}

/**
 * The name a new account at the provider takes: the provider's own while no
 * account holds it, else the lowest free place. Note that this is the one
 * place a name is spelled from its parts, because an agent is handed a
 * connection by one flat name; everywhere else reads it back from the row it was minted on.
 */
export function mintIntegrationConnectionName(
  provider: IntegrationProvider,
  taken: readonly string[],
): string {
  // Note that the grammar caps a place at three digits, far past any account count the routes allow.
  if (!taken.includes(provider)) return provider;
  let place = 2;
  while (taken.includes(`${provider}-${place}`)) place += 1;
  return `${provider}-${place}`;
}

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
  [INTEGRATION_PROVIDER.GMAIL]: "gmail_remote",
  [INTEGRATION_PROVIDER.GOOGLE_CALENDAR]: "google_calendar_remote",
  [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: "google_drive_remote",
  [INTEGRATION_PROVIDER.GRANOLA]: "granola_remote",
  [INTEGRATION_PROVIDER.LINEAR]: "linear_remote",
  [INTEGRATION_PROVIDER.MERCURY]: "mercury_remote",
  [INTEGRATION_PROVIDER.NEON]: "neon_remote",
  [INTEGRATION_PROVIDER.NOTION]: "notion_remote",
  [INTEGRATION_PROVIDER.POSTHOG]: "posthog_remote",
  [INTEGRATION_PROVIDER.RESEND]: "resend_remote",
  [INTEGRATION_PROVIDER.SENTRY]: "sentry_remote",
  [INTEGRATION_PROVIDER.SLACK]: "slack_remote",
  [INTEGRATION_PROVIDER.STRIPE]: "stripe_remote",
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
  /** The input the call sent the tool; empty where it sent none. */
  input: verbatimJsonSchema(WireValueSchema, { type: "object", additionalProperties: true }),
  /** The account it ran against, by connection name, where it was not the provider's first. */
  connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
});

export type IntegrationRemoteCall = typeof integrationRemoteCallSchema.Type;

/** Where an account's connection to one provider stands. */
export const INTEGRATION_STATUS = {
  /** Our agents may use the account's grant. */
  CONNECTED: "connected",
  /** A sign-in was begun and has not completed. */
  PENDING: "pending",
  /** The account was connected, and the provider's grant has since stopped working; connect again. */
  EXPIRED: "expired",
  /** The account has no connection. */
  DISCONNECTED: "disconnected",
  /** This deployment of the service offers no connection to the provider at all. */
  UNAVAILABLE: "unavailable",
} as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUS)[keyof typeof INTEGRATION_STATUS];

const integrationStatusSchema = EffectSchema.Literals(Object.values(INTEGRATION_STATUS));

/**
 * The queries a provider's routes read beside the provider the rewrite
 * moves into its own: the account a call is about, by its connection name
 * (the provider's first account where none is named), and, on a Connect, a
 * new account to sign in rather than one that stands.
 */
export const INTEGRATION_QUERY = {
  CONNECTION: "connection",
  ADD: "add",
} as const;

/** The value of `INTEGRATION_QUERY.ADD` that asks for a new account. */
export const INTEGRATION_ADD_ACCOUNT = "true";

/** The most accounts a user account may hold at one provider. */
export const INTEGRATION_ACCOUNTS_MAX = 5;

/** The longest label an account may carry, in characters. */
export const INTEGRATION_LABEL_MAX = 64;

/**
 * Whether an account's label is still to be read from its grant or its
 * provider: one never read, or one a grant that named nothing left empty at
 * a provider that answers whose account a token is
 * (`INTEGRATION_NAMES_ACCOUNT`). The service reads such a label on every
 * read that settles (`integrations-procedures.ts`'s `labeledRow`), and the
 * host asks for one.
 */
export function integrationLabelUnread(
  provider: IntegrationProvider,
  label: string | null | undefined,
): boolean {
  return (
    label === null || label === undefined || (label === "" && INTEGRATION_NAMES_ACCOUNT[provider])
  );
}

/** One account the user account holds at a provider, as the statuses read answers it. */
const integrationAccountSchema = EffectSchema.Struct({
  provider: integrationProviderSchema,
  connection: integrationConnectionNameSchema,
  /** Its name at the provider, or the developer's own for it, where either is known. */
  label: EffectSchema.optionalKey(EffectSchema.String),
  status: integrationStatusSchema,
});

export type IntegrationAccount = typeof integrationAccountSchema.Type;

/**
 * What an account is called where the app names it among its provider's
 * others: its label, or "Account 2" by its place while it has none.
 */
export function integrationAccountLabel(account: {
  readonly connection: string;
  readonly label?: string | undefined;
}): string {
  if (account.label !== undefined && account.label.trim() !== "") return account.label;
  return `Account ${integrationConnectionOf(account.connection)?.place ?? 1}`;
}

/** The names more than one account would be called. */
function sharedNames(called: readonly (readonly [string, string])[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const [, name] of called) (seen.has(name) ? shared : seen).add(name);
  return shared;
}

/**
 * What each of a provider's accounts is called among the others, by its
 * connection name: its label, or "Account 2" by its place, and where two
 * would be called alike, each of those with its place after ("Work (2)"),
 * so no two accounts at a provider ever read the same. Note that the places
 * are added until no name is shared, because a label may itself read like a
 * name told apart ("Work (1)").
 */
export function integrationAccountNames(
  accounts: readonly { readonly connection: string; readonly label?: string | undefined }[],
): ReadonlyMap<string, string> {
  const placeOf = (connection: string) => integrationConnectionOf(connection)?.place ?? 1;
  let called = accounts.map(
    (account) => [account.connection, integrationAccountLabel(account)] as const,
  );
  for (let shared = sharedNames(called); shared.size > 0; shared = sharedNames(called)) {
    const alike = shared;
    called = called.map(
      ([connection, name]) =>
        [connection, alike.has(name) ? `${name} (${placeOf(connection)})` : name] as const,
    );
  }
  return new Map(called);
}

/** A label as the developer names an account (POST): trimmed, never blank, and bounded. */
export const integrationRenameRequestSchema = EffectSchema.Struct({
  label: EffectSchema.Trim.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(INTEGRATION_LABEL_MAX),
  ),
});

/**
 * The transaction a write committed in, where it wrote, which the account's
 * live read of its integrations says it carries (`integration-live.ts`); a
 * desktop that follows no such read ignores it.
 */
const writtenTxid = EffectSchema.optionalKey(EffectSchema.String);

/** One account as a rename leaves it (POST), and the transaction it was named in. */
export const integrationAccountAnswerSchema = EffectSchema.Struct({
  account: integrationAccountSchema,
  txid: writtenTxid,
});

/** How a sign-in the browser never brought back to the app ended, as Vercel Connect tells it. */
export const INTEGRATION_SIGN_IN_FAILURE = {
  /** The developer canceled it on Connect's own page. */
  CANCELED: "canceled",
  /** Connect or the provider refused it; Connect's own line says why where it is safe to keep. */
  ERROR: "error",
} as const;

/** One provider's sign-in that ended without a grant, and why, with Connect's own line where it carried no credential. */
const integrationSignInFailureSchema = EffectSchema.Struct({
  provider: integrationProviderSchema,
  /** The account whose sign-in it was, where the service names one. */
  connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  reason: EffectSchema.Literals(Object.values(INTEGRATION_SIGN_IN_FAILURE)),
  message: EffectSchema.optionalKey(EffectSchema.String),
});

export type IntegrationSignInFailure = typeof integrationSignInFailureSchema.Type;

/**
 * Where every provider's connection stands (GET): its first account's word,
 * which a desktop that predates more than one account reads alone; every
 * account the user account holds; the providers it may add another account
 * at; and each sign-in this read found ended without a grant, which a read
 * says so once, as it ends it.
 */
export const integrationStatusesAnswerSchema = EffectSchema.Struct({
  integrations: EffectSchema.Record(integrationProviderSchema, integrationStatusSchema),
  accounts: EffectSchema.optionalKey(EffectSchema.Array(integrationAccountSchema)),
  addable: EffectSchema.optionalKey(EffectSchema.Array(integrationProviderSchema)),
  signInFailures: EffectSchema.optionalKey(EffectSchema.Array(integrationSignInFailureSchema)),
});

/** What a Disconnect or a Cancel leaves of the one account it ended (POST), and the transaction it ended it in where it wrote. */
export const integrationStatusAnswerSchema = EffectSchema.Struct({
  status: integrationStatusSchema,
  txid: writtenTxid,
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
 * The tools one provider's server offers the account's agents (GET): each
 * one's name, which a mention of it carries, and what it does as its server
 * wrote it, which a released desktop still requires; or why the server
 * listed none, with the server's own one-line message where it sent one.
 */
export const integrationToolsAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    tools: EffectSchema.Array(
      EffectSchema.Struct({
        name: EffectSchema.String,
        description: EffectSchema.String,
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

export type IntegrationToolsAnswer = typeof integrationToolsAnswerSchema.Type;

/** The address a sign-in opens in the browser (POST): https, and nothing else; the account it signs in, where the service names one; and the transaction it was begun in. */
export const integrationConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isPattern(/^https:\/\/\S+$/)),
  connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  txid: writtenTxid,
});

export type IntegrationConnectAnswer = typeof integrationConnectAnswerSchema.Type;

/** The page the browser lands on once a sign-in settled, and what its address carries. */
export const INTEGRATION_LANDING = {
  PATH: "/integration-connected",
  PROVIDER_PARAM: "provider",
  STATUS_PARAM: "status",
} as const;

/** How a browser sign-in settled, as the landing page says it. */
export const INTEGRATION_LANDING_STATUS = {
  /** The account is connected. */
  CONNECTED: "connected",
  /** The sign-in did not give us a grant: declined, canceled, or abandoned. */
  NOT_COMPLETED: "not-completed",
  /** The sign-in's link was not one we issued, or it is too old to finish. */
  EXPIRED: "expired",
  /** We could not reach Vercel Connect to settle the sign-in. */
  UNAVAILABLE: "unavailable",
  /** The provider's account is already installed for another workspace, which keeps it. */
  ALREADY_CONNECTED: "already-connected",
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
