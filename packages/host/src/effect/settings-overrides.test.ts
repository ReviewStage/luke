import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDER_LIST,
  type CredentialProviderId,
} from "@sidecar/credentials";
import { LIVE_VOICE } from "@sidecar/live";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { Environment } from "./seams.js";
import {
  SETTINGS_OVERRIDE_VARIABLE,
  SETTINGS_OVERRIDE_VARIABLE_NAMES,
  settingsOverrides,
} from "./settings-overrides.js";

const CONDUCTOR = CREDENTIAL_PROVIDER_ID.CONDUCTOR;
const CONDUCTOR_KEY = "conductor-live-key";
const CONDUCTOR_TOKEN = "conductor-live-token";

const environmentOf = (entries: Record<string, string>) =>
  Layer.succeed(Environment, ConfigProvider.fromMap(new Map(Object.entries(entries))));

const read = (entries: Record<string, string>) =>
  Effect.provide(settingsOverrides, environmentOf(entries));

const keyOf = (
  apiKeys: ReadonlyMap<CredentialProviderId, Redacted.Redacted<string>>,
  provider: CredentialProviderId,
): string | undefined => {
  const held = apiKeys.get(provider);
  return held ? Redacted.value(held) : undefined;
};

describe("the settings store's environment overrides", () => {
  it("are read from exactly these variables", () => {
    assert.deepEqual(SETTINGS_OVERRIDE_VARIABLE_NAMES, [
      "LUKE_LIVE_VOICE",
      "GOOGLE_CALENDAR_OAUTH_CLIENT_ID",
      "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
      "LINEAR_OAUTH_CLIENT_ID",
      "CONDUCTOR_API_KEY",
      "CONDUCTOR_API_TOKEN",
    ]);
    assert.deepEqual(
      CREDENTIAL_PROVIDER_LIST.flatMap((provider) => provider.environmentVariables),
      ["CONDUCTOR_API_KEY", "CONDUCTOR_API_TOKEN"],
    );
  });

  it.effect("resolve from the provider the environment seam holds", () =>
    Effect.gen(function* () {
      const overrides = yield* read({
        [SETTINGS_OVERRIDE_VARIABLE.LIVE_VOICE]: LIVE_VOICE.SAGE,
        [SETTINGS_OVERRIDE_VARIABLE.GOOGLE_CALENDAR_CLIENT_ID]: "client-id",
        [SETTINGS_OVERRIDE_VARIABLE.GOOGLE_CALENDAR_CLIENT_SECRET]: "client-secret",
        [SETTINGS_OVERRIDE_VARIABLE.LINEAR_CLIENT_ID]: "linear-client-id",
        CONDUCTOR_API_KEY: CONDUCTOR_KEY,
      });

      assert.equal(overrides.voice, LIVE_VOICE.SAGE);
      assert.deepEqual(overrides.googleCalendarSignIn, {
        clientId: "client-id",
        clientSecret: "client-secret",
      });
      assert.deepEqual(overrides.linearSignIn, { clientId: "linear-client-id" });
      assert.equal(keyOf(overrides.apiKeys, CONDUCTOR), CONDUCTOR_KEY);
    }),
  );

  it.effect("resolve absent from a provider that holds none", () =>
    Effect.gen(function* () {
      const overrides = yield* Effect.provide(
        settingsOverrides,
        Layer.succeed(Environment, ConfigProvider.fromMap(new Map())),
      );

      assert.equal(overrides.voice, undefined);
      // No override names a registration, so the sign-in this build offers is
      // whatever stands in source: Linear's client id, and no Google secret.
      assert.deepEqual(overrides.linearSignIn?.clientId.length !== 0, true);
      assert.equal(overrides.googleCalendarSignIn, undefined);
      assert.equal(overrides.apiKeys.size, 0);
    }),
  );

  it.effect("hold a voice this build does not offer to nothing", () =>
    Effect.gen(function* () {
      const overrides = yield* read({ [SETTINGS_OVERRIDE_VARIABLE.LIVE_VOICE]: "baritone" });

      assert.equal(overrides.voice, undefined);
    }),
  );

  it.effect("take a provider's variables in the order its registration lists them", () =>
    Effect.gen(function* () {
      const both = yield* read({
        CONDUCTOR_API_KEY: CONDUCTOR_KEY,
        CONDUCTOR_API_TOKEN: CONDUCTOR_TOKEN,
      });
      const second = yield* read({ CONDUCTOR_API_TOKEN: `  ${CONDUCTOR_TOKEN}  ` });

      assert.equal(keyOf(both.apiKeys, CONDUCTOR), CONDUCTOR_KEY);
      assert.equal(keyOf(second.apiKeys, CONDUCTOR), CONDUCTOR_TOKEN);
    }),
  );

  it.effect("pass over a key this build could never send", () =>
    Effect.gen(function* () {
      const tooShort = yield* read({ CONDUCTOR_API_KEY: "short" });
      const unsendable = yield* read({ CONDUCTOR_API_KEY: "key with spaces" });
      const blank = yield* read({ CONDUCTOR_API_KEY: "   " });
      const passedOver = yield* read({
        CONDUCTOR_API_KEY: "short",
        CONDUCTOR_API_TOKEN: CONDUCTOR_TOKEN,
      });

      assert.equal(tooShort.apiKeys.size, 0);
      assert.equal(unsendable.apiKeys.size, 0);
      assert.equal(blank.apiKeys.size, 0);
      assert.equal(keyOf(passedOver.apiKeys, CONDUCTOR), CONDUCTOR_TOKEN);
    }),
  );
});
