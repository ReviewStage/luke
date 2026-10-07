/**
 * What the launch environment overrides about the settings the store answers,
 * each value read by its variable's own name out of the `Environment` seam's
 * `ConfigProvider` rather than off a record the store holds. A composition
 * handed a provider that holds none — `ConfigProvider.fromEnvRecord({})` —
 * resolves every override absent, and the store answers from its own file and
 * this build's defaults alone.
 */
import type { LiveVoice } from "@sidecar/live";
import { environmentLiveVoice, LIVE_ENVIRONMENT } from "@sidecar/voice";
import { Config, Effect, Option } from "effect";
import { Environment } from "./seams.js";

/** Every variable the settings store's own overrides are read from, by name. */
export const SETTINGS_OVERRIDE_VARIABLE = {
  LIVE_VOICE: LIVE_ENVIRONMENT.VOICE,
} as const;

/** What the environment answered, resolved into what the store reads it for. */
export interface SettingsEnvironmentOverrides {
  /** The launch voice, already held to the ones the API speaks. */
  readonly voice: LiveVoice | undefined;
}

/** Every override, read out of the provider the `Environment` seam holds. */
export const settingsOverrides: Effect.Effect<SettingsEnvironmentOverrides, never, Environment> =
  Effect.gen(function* () {
    const environment = yield* Environment;
    const voice = yield* Effect.orDie(
      Config.option(Config.String(SETTINGS_OVERRIDE_VARIABLE.LIVE_VOICE)).parse(environment),
    );
    // Which voices the API speaks is still answered by the package that owns them.
    return {
      voice: environmentLiveVoice({
        [SETTINGS_OVERRIDE_VARIABLE.LIVE_VOICE]: Option.getOrUndefined(voice),
      }),
    };
  });
