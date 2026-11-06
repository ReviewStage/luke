import { PROVIDER_KEY_ENCRYPTION_ENVIRONMENT } from "@repo/database/models/provider-key-seal";
import { PROVIDER_KEY_PROVIDER, type ProviderKeyProvider } from "@repo/features/provider-key-wire";
import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted } from "effect";
import {
  AUTH_DEPLOYMENT_ENVIRONMENT,
  DEPLOYMENT_ENVIRONMENT,
  GITHUB_APP_ENVIRONMENT,
} from "./auth/auth-deployment.js";
import { text } from "./core.js";
import { CRON_ENVIRONMENT } from "./maintenance/maintenance-bounds.js";
import { POSTHOG_ENVIRONMENT } from "./providers/posthog.js";

/** The variable our own key for titles is read from, an Anthropic API key spent on every title and nothing else. */
const TITLE_MODEL_ENVIRONMENT = {
  ANTHROPIC_API_KEY: "TITLE_ANTHROPIC_API_KEY",
} as const;

/** The variables a Preview's stand-in API keys are read from, one per provider; no other deployment reads them. */
const PREVIEW_API_KEY_ENVIRONMENT = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: "PREVIEW_ANTHROPIC_API_KEY",
  [PROVIDER_KEY_PROVIDER.OPENAI]: "PREVIEW_OPENAI_API_KEY",
} as const satisfies Record<ProviderKeyProvider, string>;

/** A Preview's stand-in API key for each provider it holds one for; none on any other deployment. */
export type PreviewApiKeys = Readonly<Partial<Record<ProviderKeyProvider, Redacted.Redacted>>>;

/**
 * What the deployment's environment says about the hosted tier, read once as
 * the services are built rather than at each invocation's `process.env`.
 *
 * A blank value is dropped here rather than at the endpoints: an absent
 * value and a whitespace one both mean it is unset, so the endpoints see one
 * absence. The deployment holds one model provider key of its own, for
 * titles alone (`titleAnthropicApiKey`); every other model call runs on the
 * account's own key, sealed under `providerKeyEncryptionKeys`, or on a
 * Preview, its stand-in where that key is missing or unreadable
 * (`previewApiKeys`).
 */
export interface HostedEnvironmentValues {
  /** The analytics processor's own deletion key; absent means there is no person to erase. */
  readonly posthogPersonalApiKey: Redacted.Redacted | undefined;
  /** The analytics project the personal key deletes from; absent means there is nothing to erase it with. */
  readonly posthogProjectId: string | undefined;
  /** The private API host deletion is asked of, which is not the ingestion host. */
  readonly posthogApiHost: string | undefined;
  /** The analytics project's own ingestion token, for the desktop's counted-event batch; absent means recording is off. */
  readonly posthogProjectApiKey: Redacted.Redacted | undefined;
  /** A deployment-configured ingestion host; the shared default otherwise. */
  readonly posthogIngestHost: string | undefined;
  /** Vercel's own bearer on every scheduled call, which the maintenance routes asked by hand take too; absent refuses every sweep. */
  readonly cronSecret: Redacted.Redacted | undefined;
  /** The secret GitHub signs our GitHub App's webhook deliveries with; absent refuses every delivery. */
  readonly githubWebhookSecret: Redacted.Redacted | undefined;
  /** The versioned keys an account's own provider keys are sealed under (`provider-key-seal.ts`); absent refuses every save and leaves every model call on an account's key unmade, since no key of ours stands in. */
  readonly providerKeyEncryptionKeys: Redacted.Redacted | undefined;
  /** our own Anthropic API key, which every title is generated on (`agents/coder-host/model.ts`) and nothing else; absent names each from its first words, with no model. */
  readonly titleAnthropicApiKey: Redacted.Redacted | undefined;
  /**
   * A Preview's stand-in API key for each provider, spent where an account's
   * own key for that provider is missing or does not open
   * (`accounts/own-api-key.ts`), since a Preview's database is copied from
   * production's with every key sealed under production's ring, which a
   * Preview never holds. Read only where `VERCEL_ENV` is `preview`, so
   * production and a local run never spend one, set or not.
   */
  readonly previewApiKeys: PreviewApiKeys;
}

export class HostedEnvironment extends Context.Service<
  HostedEnvironment,
  HostedEnvironmentValues
>()("HostedEnvironment") {}

function present(value: Option.Option<string>): string | undefined {
  return text(Option.getOrUndefined(value));
}

/**
 * A secret under the same rule as a plain value: trimmed, and a blank one is
 * dropped. The trimming is the one reveal on the way in, so every reveal on
 * the way out — a bearer, a key — sees the same bytes a compare does.
 */
function presentRedacted(value: Option.Option<Redacted.Redacted>): Redacted.Redacted | undefined {
  return Option.getOrUndefined(
    Option.flatMap(value, (secret) =>
      Option.map(Option.fromNullishOr(text(Redacted.value(secret))), Redacted.make),
    ),
  );
}

/** The stand-in keys a Preview holds, or none where the deployment is no Preview. */
function previewApiKeysOf(
  environment: string | undefined,
  read: Record<ProviderKeyProvider, Option.Option<Redacted.Redacted>>,
): PreviewApiKeys {
  if (environment !== DEPLOYMENT_ENVIRONMENT.PREVIEW) return {};
  const keys: Partial<Record<ProviderKeyProvider, Redacted.Redacted>> = {};
  for (const provider of Object.values(PROVIDER_KEY_PROVIDER)) {
    const key = presentRedacted(read[provider]);
    if (key !== undefined) keys[provider] = key;
  }
  return keys;
}

/**
 * The values as this deployment's own environment holds them. The provider is
 * named rather than inherited so the read is the process environment wherever
 * the layer is built, and read inside an `Effect.sync` rather than beside the
 * pipe so that "wherever" stays the build: `fromEnv` copies `process.env` out
 * into a record of its own, so a provider constructed as this module loads
 * would be this process's first environment forever. A key travels as a
 * `Redacted` so a log line or an error that folded a service into it still
 * says nothing.
 */
export const hostedEnvironment = Layer.effect(
  HostedEnvironment,
  Effect.flatMap(
    Config.all({
      posthogPersonalApiKey: Config.option(Config.Redacted(POSTHOG_ENVIRONMENT.PERSONAL_API_KEY)),
      posthogProjectId: Config.option(Config.String(POSTHOG_ENVIRONMENT.PROJECT_ID)),
      posthogApiHost: Config.option(Config.String(POSTHOG_ENVIRONMENT.API_HOST)),
      posthogProjectApiKey: Config.option(Config.Redacted(POSTHOG_ENVIRONMENT.PROJECT_API_KEY)),
      posthogIngestHost: Config.option(Config.String(POSTHOG_ENVIRONMENT.HOST)),
      cronSecret: Config.option(Config.Redacted(CRON_ENVIRONMENT.CRON_SECRET)),
      githubWebhookSecret: Config.option(Config.Redacted(GITHUB_APP_ENVIRONMENT.WEBHOOK_SECRET)),
      providerKeyEncryptionKeys: Config.option(
        Config.Redacted(PROVIDER_KEY_ENCRYPTION_ENVIRONMENT.KEYS),
      ),
      titleAnthropicApiKey: Config.option(
        Config.Redacted(TITLE_MODEL_ENVIRONMENT.ANTHROPIC_API_KEY),
      ),
      deployment: Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)),
      previewApiKeys: Config.all({
        [PROVIDER_KEY_PROVIDER.ANTHROPIC]: Config.option(
          Config.Redacted(PREVIEW_API_KEY_ENVIRONMENT[PROVIDER_KEY_PROVIDER.ANTHROPIC]),
        ),
        [PROVIDER_KEY_PROVIDER.OPENAI]: Config.option(
          Config.Redacted(PREVIEW_API_KEY_ENVIRONMENT[PROVIDER_KEY_PROVIDER.OPENAI]),
        ),
      }),
    }),
    (read) => {
      const cronSecret = presentRedacted(read.cronSecret);
      const values: HostedEnvironmentValues = {
        posthogPersonalApiKey: presentRedacted(read.posthogPersonalApiKey),
        posthogProjectId: present(read.posthogProjectId),
        posthogApiHost: present(read.posthogApiHost),
        posthogProjectApiKey: presentRedacted(read.posthogProjectApiKey),
        posthogIngestHost: present(read.posthogIngestHost),
        cronSecret,
        githubWebhookSecret: presentRedacted(read.githubWebhookSecret),
        providerKeyEncryptionKeys: presentRedacted(read.providerKeyEncryptionKeys),
        titleAnthropicApiKey: presentRedacted(read.titleAnthropicApiKey),
        previewApiKeys: previewApiKeysOf(present(read.deployment), read.previewApiKeys),
      };
      return Effect.succeed(values);
    },
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);
