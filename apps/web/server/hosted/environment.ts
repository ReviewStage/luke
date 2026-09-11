import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted } from "effect";
import { text } from "../core.js";
import { APNS_ENVIRONMENT, type ApnsCredentials, apnsCredentialsFromEnvironment } from "./apns.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "./encryption.js";
import { OBSERVATION_ENVIRONMENT } from "./observation-tick.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "./openai.js";
import { POSTHOG_ENVIRONMENT } from "./posthog.js";

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
  /** A deployment-configured brain model override; the contract's default otherwise. */
  readonly brainModel: string | undefined;
  /** A deployment-configured Realtime model override, under the name the desktop honours. */
  readonly realtimeModel: string | undefined;
  /** The analytics processor's own deletion key; absent means there is no person to erase. */
  readonly posthogPersonalApiKey: Redacted.Redacted | undefined;
  /** The analytics project the personal key deletes from; absent means there is nothing to erase it with. */
  readonly posthogProjectId: string | undefined;
  /** The private API host deletion is asked of, which is not the ingestion host. */
  readonly posthogApiHost: string | undefined;
  /** The provider key vault's AES-256-GCM secret; absent means the vault is off. */
  readonly providerKeyEncryptionSecret: Redacted.Redacted | undefined;
  /** The analytics project's own ingestion token, for the desktop's counted-event batch; absent means recording is off. */
  readonly posthogProjectApiKey: Redacted.Redacted | undefined;
  /** A deployment-configured ingestion host; the shared default otherwise. */
  readonly posthogIngestHost: string | undefined;
  /** Vercel's own bearer on every scheduled observation call; absent refuses every tick. */
  readonly cronSecret: Redacted.Redacted | undefined;
  /** The deployment's Apple push credential; absent means no notification is ever sent. */
  readonly apnsCredentials: ApnsCredentials | undefined;
}

export class HostedEnvironment extends Context.Tag("HostedEnvironment")<
  HostedEnvironment,
  HostedEnvironmentValues
>() {}

function present(value: Option.Option<string>): string | undefined {
  return text(Option.getOrUndefined(value));
}

function presentRedacted(value: Option.Option<Redacted.Redacted>): Redacted.Redacted | undefined {
  const revealed = present(Option.map(value, Redacted.value));
  return revealed === undefined ? undefined : Redacted.make(revealed);
}

/** The four APNs values as {@link apnsCredentialsFromEnvironment} takes them, read through `Config` rather than `process.env` directly. */
function apnsRecord(
  read: Record<
    "apnsTeamId" | "apnsKeyId" | "apnsPrivateKey" | "apnsBundleId",
    Option.Option<string>
  >,
) {
  return {
    [APNS_ENVIRONMENT.TEAM_ID]: present(read.apnsTeamId),
    [APNS_ENVIRONMENT.KEY_ID]: present(read.apnsKeyId),
    [APNS_ENVIRONMENT.PRIVATE_KEY]: present(read.apnsPrivateKey),
    [APNS_ENVIRONMENT.BUNDLE_ID]: present(read.apnsBundleId),
  } as const;
}

/**
 * The values as this deployment's own environment holds them. The provider is
 * named rather than inherited so the read is the process environment wherever
 * the layer is built, and a key travels as a `Redacted` so a log line or an
 * error that folded a service into it still says nothing.
 */
export const hostedEnvironment = Layer.effect(
  HostedEnvironment,
  Effect.map(
    Config.all({
      apiKey: Config.option(Config.redacted(HOSTED_OPENAI_ENVIRONMENT.API_KEY)),
      brainModel: Config.option(Config.string(HOSTED_OPENAI_ENVIRONMENT.BRAIN_MODEL)),
      realtimeModel: Config.option(Config.string(HOSTED_OPENAI_ENVIRONMENT.REALTIME_MODEL)),
      posthogPersonalApiKey: Config.option(Config.redacted(POSTHOG_ENVIRONMENT.PERSONAL_API_KEY)),
      posthogProjectId: Config.option(Config.string(POSTHOG_ENVIRONMENT.PROJECT_ID)),
      posthogApiHost: Config.option(Config.string(POSTHOG_ENVIRONMENT.API_HOST)),
      providerKeyEncryptionSecret: Config.option(
        Config.redacted(VAULT_ENCRYPTION_ENVIRONMENT.SECRET),
      ),
      posthogProjectApiKey: Config.option(Config.redacted(POSTHOG_ENVIRONMENT.PROJECT_API_KEY)),
      posthogIngestHost: Config.option(Config.string(POSTHOG_ENVIRONMENT.HOST)),
      cronSecret: Config.option(Config.redacted(OBSERVATION_ENVIRONMENT.CRON_SECRET)),
      apnsTeamId: Config.option(Config.string(APNS_ENVIRONMENT.TEAM_ID)),
      apnsKeyId: Config.option(Config.string(APNS_ENVIRONMENT.KEY_ID)),
      apnsPrivateKey: Config.option(Config.string(APNS_ENVIRONMENT.PRIVATE_KEY)),
      apnsBundleId: Config.option(Config.string(APNS_ENVIRONMENT.BUNDLE_ID)),
    }),
    (read) => ({
      openAiKey: presentRedacted(read.apiKey),
      brainModel: present(read.brainModel),
      realtimeModel: present(read.realtimeModel),
      posthogPersonalApiKey: presentRedacted(read.posthogPersonalApiKey),
      posthogProjectId: present(read.posthogProjectId),
      posthogApiHost: present(read.posthogApiHost),
      providerKeyEncryptionSecret: presentRedacted(read.providerKeyEncryptionSecret),
      posthogProjectApiKey: presentRedacted(read.posthogProjectApiKey),
      posthogIngestHost: present(read.posthogIngestHost),
      cronSecret: presentRedacted(read.cronSecret),
      apnsCredentials: apnsCredentialsFromEnvironment(apnsRecord(read)),
    }),
  ).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv())),
);
