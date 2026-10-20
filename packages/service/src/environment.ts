import { timingSafeEqual } from "node:crypto";
import { PROVIDER_KEY_ENCRYPTION_ENVIRONMENT } from "@luke/database/models/provider-key-seal";
import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted } from "effect";
import { BRAIN_HOST_ENVIRONMENT } from "./agents/brain-host/bounds.js";
import { GITHUB_APP_ENVIRONMENT } from "./auth/auth-deployment.js";
import { text } from "./core.js";
import { CRON_ENVIRONMENT } from "./maintenance/maintenance-bounds.js";
import { HOSTED_ANTHROPIC_ENVIRONMENT } from "./providers/anthropic.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "./providers/openai.js";
import { POSTHOG_ENVIRONMENT } from "./providers/posthog.js";

/**
 * What the deployment's environment says about the hosted tier, read once as
 * the services are built rather than at each invocation's `process.env`.
 *
 * A blank value is dropped here rather than at the endpoints: an absent key
 * and a whitespace one both mean the tier is off, which is the kill switch
 * this deployment is configured with, so the endpoints see one absence.
 */
export interface HostedEnvironmentValues {
  /** Luke's own OpenAI key; absent means the hosted tier is off and every endpoint answers 503. */
  readonly openAiKey: Redacted.Redacted | undefined;
  /** Luke's own Anthropic key, which a coding agent on an Anthropic model runs on; absent means those agents cannot run. */
  readonly anthropicKey: Redacted.Redacted | undefined;
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
  /** Vercel's own bearer on every scheduled call, which the maintenance routes asked by hand take too and eve's door never does; absent refuses every sweep. */
  readonly cronSecret: Redacted.Redacted | undefined;
  /** The deployment's own bearer at eve's door, sent by every caller acting for an account and admitted by both eve services; absent, blank, or the cron's own value refuses every delegation. */
  readonly eveDeploymentSecret: Redacted.Redacted | undefined;
  /** The secret GitHub signs the Luke GitHub App's webhook deliveries with; absent refuses every delivery. */
  readonly githubWebhookSecret: Redacted.Redacted | undefined;
  /** The versioned keys an account's own provider keys are sealed under (`provider-key-seal.ts`); absent refuses every save and leaves every agent on Luke's keys. */
  readonly providerKeyEncryptionKeys: Redacted.Redacted | undefined;
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

/** What the log says, once a build, where the eve secret is read as unset for holding the cron's value: the two names, never a value. */
const EVE_SECRET_SHARED =
  "EVE_DEPLOYMENT_SECRET holds the same value as CRON_SECRET, so it is read as unset: no deployment request reaches eve until it holds a value of its own.";

/**
 * The deployment's own secret at eve's door, read beside the cron's: nothing
 * where the two hold one value, because the bearer Vercel's scheduler sends
 * would then open eve's door again, the master key the separate secret keeps
 * apart. Both arrive trimmed with a blank one dropped, so one value is one
 * run of bytes, compared in constant time as every secret here is.
 */
function eveSecretApart(
  eve: Redacted.Redacted | undefined,
  cron: Redacted.Redacted | undefined,
): Redacted.Redacted | undefined {
  if (eve === undefined || cron === undefined) return eve;
  const offered = Buffer.from(Redacted.value(eve));
  const held = Buffer.from(Redacted.value(cron));
  return offered.length === held.length && timingSafeEqual(offered, held) ? undefined : eve;
}

/** A secret an environment record names, under `presentRedacted`'s rule: trimmed, and nothing where it is blank. */
function namedIn(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): Redacted.Redacted | undefined {
  const value = text(environment[name]);
  return value === undefined ? undefined : Redacted.make(value);
}

/**
 * `EVE_DEPLOYMENT_SECRET` as an environment record holds it, under the rule
 * the layer below reads it by, for a reader that holds the record rather
 * than the service: the voice function's exchange and the admin dashboard's
 * health list. Nothing where it is unset, blank, or the cron's own value.
 */
export function eveDeploymentSecretIn(
  environment: Readonly<Record<string, string | undefined>>,
): Redacted.Redacted | undefined {
  return eveSecretApart(
    namedIn(environment, BRAIN_HOST_ENVIRONMENT.DEPLOYMENT_SECRET),
    namedIn(environment, CRON_ENVIRONMENT.CRON_SECRET),
  );
}

/**
 * The values as this deployment's own environment holds them. The provider is
 * named rather than inherited so the read is the process environment wherever
 * the layer is built, and read inside an `Effect.sync` rather than beside the
 * pipe so that "wherever" stays the build: `fromEnv` copies `process.env` out
 * into a record of its own, so a provider constructed as this module loads
 * would be this process's first environment forever. A key travels as a
 * `Redacted` so a log line or an error that folded a service into it still
 * says nothing. An eve secret that is the cron's value is read as unset, and
 * the build says so once, by name.
 */
export const hostedEnvironment = Layer.effect(
  HostedEnvironment,
  Effect.flatMap(
    Config.all({
      apiKey: Config.option(Config.Redacted(HOSTED_OPENAI_ENVIRONMENT.API_KEY)),
      anthropicKey: Config.option(Config.Redacted(HOSTED_ANTHROPIC_ENVIRONMENT.API_KEY)),
      posthogPersonalApiKey: Config.option(Config.Redacted(POSTHOG_ENVIRONMENT.PERSONAL_API_KEY)),
      posthogProjectId: Config.option(Config.String(POSTHOG_ENVIRONMENT.PROJECT_ID)),
      posthogApiHost: Config.option(Config.String(POSTHOG_ENVIRONMENT.API_HOST)),
      posthogProjectApiKey: Config.option(Config.Redacted(POSTHOG_ENVIRONMENT.PROJECT_API_KEY)),
      posthogIngestHost: Config.option(Config.String(POSTHOG_ENVIRONMENT.HOST)),
      cronSecret: Config.option(Config.Redacted(CRON_ENVIRONMENT.CRON_SECRET)),
      eveDeploymentSecret: Config.option(Config.Redacted(BRAIN_HOST_ENVIRONMENT.DEPLOYMENT_SECRET)),
      githubWebhookSecret: Config.option(Config.Redacted(GITHUB_APP_ENVIRONMENT.WEBHOOK_SECRET)),
      providerKeyEncryptionKeys: Config.option(
        Config.Redacted(PROVIDER_KEY_ENCRYPTION_ENVIRONMENT.KEYS),
      ),
    }),
    (read) => {
      const cronSecret = presentRedacted(read.cronSecret);
      const namedEveSecret = presentRedacted(read.eveDeploymentSecret);
      const eveDeploymentSecret = eveSecretApart(namedEveSecret, cronSecret);
      const values: HostedEnvironmentValues = {
        openAiKey: presentRedacted(read.apiKey),
        anthropicKey: presentRedacted(read.anthropicKey),
        posthogPersonalApiKey: presentRedacted(read.posthogPersonalApiKey),
        posthogProjectId: present(read.posthogProjectId),
        posthogApiHost: present(read.posthogApiHost),
        posthogProjectApiKey: presentRedacted(read.posthogProjectApiKey),
        posthogIngestHost: present(read.posthogIngestHost),
        cronSecret,
        eveDeploymentSecret,
        githubWebhookSecret: presentRedacted(read.githubWebhookSecret),
        providerKeyEncryptionKeys: presentRedacted(read.providerKeyEncryptionKeys),
      };
      // Note that the warning names the two variables alone, because a value in a log line is a leaked secret.
      return eveDeploymentSecret === namedEveSecret
        ? Effect.succeed(values)
        : Effect.as(Effect.logWarning(EVE_SECRET_SHARED), values);
    },
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);
