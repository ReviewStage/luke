import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted } from "effect";
import { text } from "../core.js";
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
  /** The analytics processor's own deletion key; absent means there is no person to erase. */
  readonly posthogPersonalApiKey: Redacted.Redacted | undefined;
  /** The analytics project the personal key deletes from; absent means there is nothing to erase it with. */
  readonly posthogProjectId: string | undefined;
  /** The private API host deletion is asked of, which is not the ingestion host. */
  readonly posthogApiHost: string | undefined;
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
      posthogPersonalApiKey: Config.option(Config.redacted(POSTHOG_ENVIRONMENT.PERSONAL_API_KEY)),
      posthogProjectId: Config.option(Config.string(POSTHOG_ENVIRONMENT.PROJECT_ID)),
      posthogApiHost: Config.option(Config.string(POSTHOG_ENVIRONMENT.API_HOST)),
    }),
    (read) => ({
      openAiKey: presentRedacted(read.apiKey),
      brainModel: present(read.brainModel),
      posthogPersonalApiKey: presentRedacted(read.posthogPersonalApiKey),
      posthogProjectId: present(read.posthogProjectId),
      posthogApiHost: present(read.posthogApiHost),
    }),
  ).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv())),
);
