import { WireValueSchema } from "@repo/wire";
import { verbatimJsonSchema } from "@repo/wire/effect";
import { Schema as EffectSchema } from "effect";

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

export const INTEGRATION_PROVIDER_LIST: readonly IntegrationProvider[] =
  Object.values(INTEGRATION_PROVIDER);

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

export const INTEGRATION_GRANT = {
  CONNECT: "connect",
  GITHUB_SIGN_IN: "github-sign-in",
} as const;

export type IntegrationGrant = (typeof INTEGRATION_GRANT)[keyof typeof INTEGRATION_GRANT];

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

export function integrationOfHost(host: string): IntegrationProvider | undefined {
  const asked = host.toLowerCase();
  return INTEGRATION_PROVIDER_LIST.find((provider) =>
    INTEGRATION_HOSTS[provider].some((own) => asked === own || asked.endsWith(`.${own}`)),
  );
}

const PROVIDERS: ReadonlySet<string> = new Set(INTEGRATION_PROVIDER_LIST);

export function integrationProviderFromWire(value: string | null): IntegrationProvider | undefined {
  return value !== null && PROVIDERS.has(value) ? (value as IntegrationProvider) : undefined;
}

export const integrationProviderSchema = EffectSchema.Literals(INTEGRATION_PROVIDER_LIST);

const CONNECTION_NAME_PATTERN = new RegExp(
  `^(${INTEGRATION_PROVIDER_LIST.join("|")})(?:-([2-9]|[1-9][0-9]{1,2}))?$`,
  "u",
);

export const integrationConnectionNameSchema = EffectSchema.String.check(
  EffectSchema.isPattern(CONNECTION_NAME_PATTERN),
);

export function integrationConnectionOf(
  name: string,
): { readonly provider: IntegrationProvider; readonly place: number } | undefined {
  const match = CONNECTION_NAME_PATTERN.exec(name);
  const provider = integrationProviderFromWire(match?.[1] ?? null);
  if (match === null || provider === undefined) return undefined;
  return { provider, place: match[2] === undefined ? 1 : Number(match[2]) };
}

export function mintIntegrationConnectionName(
  provider: IntegrationProvider,
  taken: readonly string[],
): string {
  if (!taken.includes(provider)) return provider;
  let place = 2;
  while (taken.includes(`${provider}-${place}`)) place += 1;
  return `${provider}-${place}`;
}

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

export function integrationOfRemoteTool(tool: string): IntegrationProvider | undefined {
  return INTEGRATION_PROVIDER_LIST.find((provider) => INTEGRATION_REMOTE_TOOL[provider] === tool);
}

const REMOTE_TOOL_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

export const integrationRemoteCallSchema = EffectSchema.Struct({
  remoteTool: EffectSchema.String.check(EffectSchema.isPattern(REMOTE_TOOL_PATTERN)),
  parentCallId: EffectSchema.String,
  input: verbatimJsonSchema(WireValueSchema, { type: "object", additionalProperties: true }),
  connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
});

export type IntegrationRemoteCall = typeof integrationRemoteCallSchema.Type;

export const INTEGRATION_STATUS = {
  CONNECTED: "connected",
  PENDING: "pending",
  EXPIRED: "expired",
  DISCONNECTED: "disconnected",
  UNAVAILABLE: "unavailable",
} as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUS)[keyof typeof INTEGRATION_STATUS];

const integrationStatusSchema = EffectSchema.Literals(Object.values(INTEGRATION_STATUS));

export const INTEGRATION_QUERY = {
  CONNECTION: "connection",
  ADD: "add",
} as const;

export const INTEGRATION_ADD_ACCOUNT = "true";

export const INTEGRATION_ACCOUNTS_MAX = 5;

export const INTEGRATION_LABEL_MAX = 64;

export function integrationLabelUnread(
  provider: IntegrationProvider,
  label: string | null | undefined,
): boolean {
  return (
    label === null || label === undefined || (label === "" && INTEGRATION_NAMES_ACCOUNT[provider])
  );
}

const integrationAccountSchema = EffectSchema.Struct({
  provider: integrationProviderSchema,
  connection: integrationConnectionNameSchema,
  label: EffectSchema.optionalKey(EffectSchema.String),
  status: integrationStatusSchema,
});

export type IntegrationAccount = typeof integrationAccountSchema.Type;

export function integrationAccountLabel(account: {
  readonly connection: string;
  readonly label?: string | undefined;
}): string {
  if (account.label !== undefined && account.label.trim() !== "") return account.label;
  return `Account ${integrationConnectionOf(account.connection)?.place ?? 1}`;
}

function sharedNames(called: readonly (readonly [string, string])[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const [, name] of called) (seen.has(name) ? shared : seen).add(name);
  return shared;
}

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

export const integrationRenameRequestSchema = EffectSchema.Struct({
  label: EffectSchema.Trim.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(INTEGRATION_LABEL_MAX),
  ),
});

const writtenTxid = EffectSchema.optionalKey(EffectSchema.String);

export const integrationAccountAnswerSchema = EffectSchema.Struct({
  account: integrationAccountSchema,
  txid: writtenTxid,
});

export const INTEGRATION_SIGN_IN_FAILURE = {
  CANCELED: "canceled",
  ERROR: "error",
} as const;

const integrationSignInFailureSchema = EffectSchema.Struct({
  provider: integrationProviderSchema,
  connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  reason: EffectSchema.Literals(Object.values(INTEGRATION_SIGN_IN_FAILURE)),
  message: EffectSchema.optionalKey(EffectSchema.String),
});

export type IntegrationSignInFailure = typeof integrationSignInFailureSchema.Type;

export const integrationStatusesAnswerSchema = EffectSchema.Struct({
  integrations: EffectSchema.Record(integrationProviderSchema, integrationStatusSchema),
  accounts: EffectSchema.optionalKey(EffectSchema.Array(integrationAccountSchema)),
  addable: EffectSchema.optionalKey(EffectSchema.Array(integrationProviderSchema)),
  signInFailures: EffectSchema.optionalKey(EffectSchema.Array(integrationSignInFailureSchema)),
});

export const integrationStatusAnswerSchema = EffectSchema.Struct({
  status: integrationStatusSchema,
  txid: writtenTxid,
});

export const INTEGRATION_TOOLS_PROBLEM = {
  REFUSED: "refused",
  REJECTED: "rejected",
  UNREACHABLE: "unreachable",
  UNREADABLE: "unreadable",
} as const;

export type IntegrationToolsProblemReason =
  (typeof INTEGRATION_TOOLS_PROBLEM)[keyof typeof INTEGRATION_TOOLS_PROBLEM];

export const integrationToolAnnotationsSchema = EffectSchema.Struct({
  readOnlyHint: EffectSchema.optionalKey(EffectSchema.Boolean),
  destructiveHint: EffectSchema.optionalKey(EffectSchema.Boolean),
  idempotentHint: EffectSchema.optionalKey(EffectSchema.Boolean),
  openWorldHint: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type IntegrationToolAnnotations = typeof integrationToolAnnotationsSchema.Type;

const integrationToolParameterSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  type: EffectSchema.String,
  required: EffectSchema.Boolean,
  description: EffectSchema.optionalKey(EffectSchema.String),
  values: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  default: EffectSchema.optionalKey(EffectSchema.String),
});

export type IntegrationToolParameter = typeof integrationToolParameterSchema.Type;

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

export type IntegrationToolsAnswer = typeof integrationToolsAnswerSchema.Type;

export const integrationConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isPattern(/^https:\/\/\S+$/)),
  connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  txid: writtenTxid,
});

export type IntegrationConnectAnswer = typeof integrationConnectAnswerSchema.Type;

export const INTEGRATION_LANDING = {
  PATH: "/integration-connected",
  PROVIDER_PARAM: "provider",
  STATUS_PARAM: "status",
} as const;

export const INTEGRATION_LANDING_STATUS = {
  CONNECTED: "connected",
  NOT_COMPLETED: "not-completed",
  EXPIRED: "expired",
  UNAVAILABLE: "unavailable",
  ALREADY_CONNECTED: "already-connected",
} as const;

export type IntegrationLandingStatus =
  (typeof INTEGRATION_LANDING_STATUS)[keyof typeof INTEGRATION_LANDING_STATUS];

const LANDING_STATUSES: ReadonlySet<string> = new Set(Object.values(INTEGRATION_LANDING_STATUS));

export function integrationLandingStatusFromWire(
  value: string | null,
): IntegrationLandingStatus | undefined {
  return value !== null && LANDING_STATUSES.has(value)
    ? (value as IntegrationLandingStatus)
    : undefined;
}

export function integrationLandingPath(
  provider: IntegrationProvider | undefined,
  status: IntegrationLandingStatus,
): string {
  const query = new URLSearchParams();
  if (provider !== undefined) query.set(INTEGRATION_LANDING.PROVIDER_PARAM, provider);
  query.set(INTEGRATION_LANDING.STATUS_PARAM, status);
  return `${INTEGRATION_LANDING.PATH}?${query}`;
}
