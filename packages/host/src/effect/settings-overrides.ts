/**
 * What the launch environment overrides about the settings the store answers,
 * each value read by its variable's own name out of the `Environment` seam's
 * `ConfigProvider` rather than off a record the store holds. A composition
 * handed a provider that holds none — `ConfigProvider.fromMap(new Map())` —
 * resolves every override absent, and the store answers from its own file and
 * this build's defaults alone.
 *
 * Which packaged build honours which override is decided where the override is
 * derived, not here: the account service's is refused at the packaging
 * boundary by `accountBaseUrlFor`, and a provider key this machine's shell
 * exported is read in a packaged build exactly as it always was.
 */
import {
  GOOGLE_CALENDAR_SIGN_IN_ENVIRONMENT,
  type GoogleCalendarSignInConfig,
  googleCalendarSignInConfig,
} from "@sidecar/calendar";
import {
  CREDENTIAL_PROVIDER_LIST,
  type CredentialProvider,
  type CredentialProviderId,
  LINEAR_SIGN_IN_ENVIRONMENT,
  type LinearSignInConfig,
  linearSignInConfig,
} from "@sidecar/credentials";
import type { LiveVoice } from "@sidecar/live";
import { environmentLiveVoice, LIVE_ENVIRONMENT } from "@sidecar/voice";
import { Config, Effect, Option, Redacted } from "effect";
import { apiKeyRejection } from "../settings-store.js";
import { Environment } from "./seams.js";

/** Every variable the settings store's own overrides are read from, by name. */
export const SETTINGS_OVERRIDE_VARIABLE = {
  LIVE_VOICE: LIVE_ENVIRONMENT.VOICE,
  GOOGLE_CALENDAR_CLIENT_ID: GOOGLE_CALENDAR_SIGN_IN_ENVIRONMENT.CLIENT_ID,
  GOOGLE_CALENDAR_CLIENT_SECRET: GOOGLE_CALENDAR_SIGN_IN_ENVIRONMENT.CLIENT_SECRET,
  LINEAR_CLIENT_ID: LINEAR_SIGN_IN_ENVIRONMENT.CLIENT_ID,
} as const;

/**
 * The whole set of names the store reads, the credential providers' own key
 * variables included, in the order each registration lists them.
 */
export const SETTINGS_OVERRIDE_VARIABLE_NAMES: readonly string[] = [
  ...Object.values(SETTINGS_OVERRIDE_VARIABLE),
  ...CREDENTIAL_PROVIDER_LIST.flatMap((provider) => provider.environmentVariables),
];

/** What the environment answered, resolved into what the store reads it for. */
export interface SettingsEnvironmentOverrides {
  /** The launch voice, already held to the ones the API speaks. */
  readonly voice: LiveVoice | undefined;
  readonly googleCalendarSignIn: GoogleCalendarSignInConfig | undefined;
  readonly linearSignIn: LinearSignInConfig | undefined;
  /**
   * The key this machine's shell exported for a provider, sendable as an
   * authorization header, by the provider it authenticates. Redacted because
   * the store hands it on to that provider's adapter and to nothing else.
   */
  readonly apiKeys: ReadonlyMap<CredentialProviderId, Redacted.Redacted<string>>;
}

/** The values read, before what each of them means has been decided. */
interface OverrideValues {
  readonly voice: Option.Option<string>;
  readonly googleCalendarClientId: Option.Option<string>;
  readonly googleCalendarClientSecret: Option.Option<Redacted.Redacted<string>>;
  readonly linearClientId: Option.Option<string>;
  readonly apiKeys: ReadonlyMap<CredentialProviderId, Redacted.Redacted<string>>;
}

/**
 * What each read value means is still answered by the package that owns it —
 * which voices the API speaks, which registration stands behind a sign-in when
 * no override names one — so the three read values are handed back in the
 * record shape those three functions take. Nothing reads an environment here:
 * the record carries what a `Config` already answered and nothing else.
 */
function overridesFrom(values: OverrideValues): SettingsEnvironmentOverrides {
  const read: NodeJS.ProcessEnv = {
    [SETTINGS_OVERRIDE_VARIABLE.LIVE_VOICE]: Option.getOrUndefined(values.voice),
    [SETTINGS_OVERRIDE_VARIABLE.GOOGLE_CALENDAR_CLIENT_ID]: Option.getOrUndefined(
      values.googleCalendarClientId,
    ),
    [SETTINGS_OVERRIDE_VARIABLE.GOOGLE_CALENDAR_CLIENT_SECRET]: Option.getOrUndefined(
      Option.map(values.googleCalendarClientSecret, Redacted.value),
    ),
    [SETTINGS_OVERRIDE_VARIABLE.LINEAR_CLIENT_ID]: Option.getOrUndefined(values.linearClientId),
  };
  return {
    voice: environmentLiveVoice(read),
    googleCalendarSignIn: googleCalendarSignInConfig(read),
    linearSignIn: linearSignInConfig(read),
    apiKeys: values.apiKeys,
  };
}

/**
 * One provider's key, the first of its variables that answered a value this
 * build could actually send: a key that would only ever be refused is passed
 * over here rather than resolved and quietly unused.
 */
function usableApiKey(
  provider: CredentialProvider,
  read: readonly Option.Option<Redacted.Redacted<string>>[],
): Option.Option<Redacted.Redacted<string>> {
  for (const value of read) {
    const trimmed = Option.map(value, (secret) => Redacted.value(secret).trim());
    if (Option.isNone(trimmed) || !trimmed.value) continue;
    if (apiKeyRejection(trimmed.value, provider.keyFormat)) continue;
    return Option.some(Redacted.make(trimmed.value));
  }
  return Option.none();
}

const optional = (name: string): Config.Config<Option.Option<string>> =>
  Config.option(Config.string(name));

const optionalSecret = (name: string): Config.Config<Option.Option<Redacted.Redacted<string>>> =>
  Config.option(Config.redacted(name));

/** Every override, read out of the provider the `Environment` seam holds. */
export const settingsOverrides: Effect.Effect<SettingsEnvironmentOverrides, never, Environment> =
  Effect.gen(function* () {
    const environment = yield* Environment;
    const load = <A>(config: Config.Config<A>): Effect.Effect<A> =>
      Effect.orDie(environment.load(config));

    const apiKeys = new Map<CredentialProviderId, Redacted.Redacted<string>>();
    for (const provider of CREDENTIAL_PROVIDER_LIST) {
      const read = yield* Effect.all(
        provider.environmentVariables.map((variable) => load(optionalSecret(variable))),
      );
      const usable = usableApiKey(provider, read);
      if (Option.isSome(usable)) apiKeys.set(provider.id, usable.value);
    }

    return overridesFrom({
      voice: yield* load(optional(SETTINGS_OVERRIDE_VARIABLE.LIVE_VOICE)),
      googleCalendarClientId: yield* load(
        optional(SETTINGS_OVERRIDE_VARIABLE.GOOGLE_CALENDAR_CLIENT_ID),
      ),
      googleCalendarClientSecret: yield* load(
        optionalSecret(SETTINGS_OVERRIDE_VARIABLE.GOOGLE_CALENDAR_CLIENT_SECRET),
      ),
      linearClientId: yield* load(optional(SETTINGS_OVERRIDE_VARIABLE.LINEAR_CLIENT_ID)),
      apiKeys,
    });
  });

const held = (environment: NodeJS.ProcessEnv, name: string): Option.Option<string> =>
  Option.fromNullable(environment[name]);

/**
 * The same overrides from the record the desktop's one `HostSeams` object
 * still carries, for the composers and the store's own tests that hand one in.
 *
 * @deprecated The `Layer.succeed(oldObject)` shim at the settings store's own
 * door; P12-05 deletes it with `createHostKernel`.
 */
export function settingsOverridesFromEnvironment(
  environment: NodeJS.ProcessEnv,
): SettingsEnvironmentOverrides {
  const apiKeys = new Map<CredentialProviderId, Redacted.Redacted<string>>();
  for (const provider of CREDENTIAL_PROVIDER_LIST) {
    const usable = usableApiKey(
      provider,
      provider.environmentVariables.map((variable) =>
        Option.map(held(environment, variable), Redacted.make),
      ),
    );
    if (Option.isSome(usable)) apiKeys.set(provider.id, usable.value);
  }

  return overridesFrom({
    voice: held(environment, SETTINGS_OVERRIDE_VARIABLE.LIVE_VOICE),
    googleCalendarClientId: held(environment, SETTINGS_OVERRIDE_VARIABLE.GOOGLE_CALENDAR_CLIENT_ID),
    googleCalendarClientSecret: Option.map(
      held(environment, SETTINGS_OVERRIDE_VARIABLE.GOOGLE_CALENDAR_CLIENT_SECRET),
      Redacted.make,
    ),
    linearClientId: held(environment, SETTINGS_OVERRIDE_VARIABLE.LINEAR_CLIENT_ID),
    apiKeys,
  });
}
