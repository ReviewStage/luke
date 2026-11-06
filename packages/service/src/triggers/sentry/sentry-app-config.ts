import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect";
import { text } from "../../core.js";

export const SENTRY_APP_ENVIRONMENT = {
  SLUG: "SENTRY_APP_SLUG",
  CLIENT_ID: "SENTRY_APP_CLIENT_ID",
  CLIENT_SECRET: "SENTRY_APP_CLIENT_SECRET",
} as const;

export interface SentryAppSettings {
  readonly slug: string;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
}

class SentryAppNotConfigured extends Data.TaggedError("SentryAppNotConfigured")<{
  readonly missing: readonly string[];
}> {
  override get message(): string {
    return `The Sentry integration is not configured on this deployment: ${this.missing.join(", ")}`;
  }
}

export interface SentryAppService {
  readonly settings: Effect.Effect<SentryAppSettings, SentryAppNotConfigured>;
}

export class SentryApp extends Context.Service<SentryApp, SentryAppService>()("SentryApp") {}

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
