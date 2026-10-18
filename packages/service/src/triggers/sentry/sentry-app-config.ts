import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect";
import { text } from "../../core.js";

/**
 * sentry-app-config.ts -- Luke's Sentry public integration as this deployment's environment configures it.
 *
 * Automations fire on Sentry's events through Luke's own Sentry public
 * integration, which a Sentry organization installs on a workspace. Its
 * slug names the install address, and its client id and secret exchange the
 * code an install returns with and sign every webhook Sentry delivers. A
 * deployment missing any of them still builds the service, because every
 * function bundle loads this layer and a bundle must load with nothing
 * configured; every read of it then answers `SentryAppNotConfigured`
 * naming what was missing, and the Sentry routes answer unavailable.
 */

/** The variables the Sentry integration is read from; a blank value is absent. */
export const SENTRY_APP_ENVIRONMENT = {
  /** The integration's slug, which its install address names. */
  SLUG: "SENTRY_APP_SLUG",
  CLIENT_ID: "SENTRY_APP_CLIENT_ID",
  /** The integration's client secret, which also signs its webhook deliveries. */
  CLIENT_SECRET: "SENTRY_APP_CLIENT_SECRET",
} as const;

/** The integration as a configured deployment holds it. */
export interface SentryAppSettings {
  readonly slug: string;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
}

/** The deployment holds no Sentry integration, or not all of it. */
export class SentryAppNotConfigured extends Data.TaggedError("SentryAppNotConfigured")<{
  /** The variables that were missing, by name alone. */
  readonly missing: readonly string[];
}> {
  override get message(): string {
    return `The Sentry integration is not configured on this deployment: ${this.missing.join(", ")}`;
  }
}

/** The integration's settings, or why this deployment has none. */
export interface SentryAppService {
  readonly settings: Effect.Effect<SentryAppSettings, SentryAppNotConfigured>;
}

export class SentryApp extends Context.Service<SentryApp, SentryAppService>()("SentryApp") {}

/** The service over settings read, or over the names of what was missing. */
export function sentryAppService(
  settings: SentryAppSettings | undefined,
  missing: readonly string[],
): SentryAppService {
  return {
    settings:
      settings === undefined
        ? Effect.fail(new SentryAppNotConfigured({ missing }))
        : Effect.succeed(settings),
  };
}

/** The integration as this deployment's environment configures it, read as the services are built. */
export const sentryAppFromEnvironment: Layer.Layer<SentryApp, Config.ConfigError> = Layer.effect(
  SentryApp,
  Effect.map(
    Config.all({
      slug: Config.option(Config.String(SENTRY_APP_ENVIRONMENT.SLUG)),
      clientId: Config.option(Config.String(SENTRY_APP_ENVIRONMENT.CLIENT_ID)),
      clientSecret: Config.option(Config.Redacted(SENTRY_APP_ENVIRONMENT.CLIENT_SECRET)),
    }),
    (read) => {
      const slug = text(Option.getOrUndefined(read.slug));
      const clientId = text(Option.getOrUndefined(read.clientId));
      const clientSecret = text(
        Option.getOrUndefined(Option.map(read.clientSecret, Redacted.value)),
      );
      const missing = [
        [SENTRY_APP_ENVIRONMENT.SLUG, slug],
        [SENTRY_APP_ENVIRONMENT.CLIENT_ID, clientId],
        [SENTRY_APP_ENVIRONMENT.CLIENT_SECRET, clientSecret],
      ]
        .filter(([, value]) => value === undefined)
        .map(([name]) => String(name));
      return sentryAppService(
        slug !== undefined && clientId !== undefined && clientSecret !== undefined
          ? { slug, clientId, clientSecret: Redacted.make(clientSecret) }
          : undefined,
        missing,
      );
    },
  ),
);
