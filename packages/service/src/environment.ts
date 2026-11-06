import { PROVIDER_KEY_ENCRYPTION_ENVIRONMENT } from "@repo/database/models/provider-key-seal";
import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted } from "effect";
import { GITHUB_APP_ENVIRONMENT } from "./auth/auth-deployment.js";
import { text } from "./core.js";
import { CRON_ENVIRONMENT } from "./maintenance/maintenance-bounds.js";
import { POSTHOG_ENVIRONMENT } from "./providers/posthog.js";

const TITLE_MODEL_ENVIRONMENT = {
  ANTHROPIC_API_KEY: "TITLE_ANTHROPIC_API_KEY",
} as const;

export interface HostedEnvironmentValues {
  readonly posthogPersonalApiKey: Redacted.Redacted | undefined;
  readonly posthogProjectId: string | undefined;
  readonly posthogApiHost: string | undefined;
  readonly posthogProjectApiKey: Redacted.Redacted | undefined;
  readonly posthogIngestHost: string | undefined;
  readonly cronSecret: Redacted.Redacted | undefined;
  readonly githubWebhookSecret: Redacted.Redacted | undefined;
  readonly providerKeyEncryptionKeys: Redacted.Redacted | undefined;
  readonly titleAnthropicApiKey: Redacted.Redacted | undefined;
}

export class HostedEnvironment extends Context.Service<
  HostedEnvironment,
  HostedEnvironmentValues
>()("HostedEnvironment") {}

function present(value: Option.Option<string>): string | undefined {
  return text(Option.getOrUndefined(value));
}

function presentRedacted(value: Option.Option<Redacted.Redacted>): Redacted.Redacted | undefined {
  return Option.getOrUndefined(
    Option.flatMap(value, (secret) =>
      Option.map(Option.fromNullishOr(text(Redacted.value(secret))), Redacted.make),
    ),
  );
}

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
