import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { LIVE_VOICE } from "@sidecar/live";
import { ConfigProvider, Effect, Layer } from "effect";
import { Environment } from "./seams.js";
import { SETTINGS_OVERRIDE_VARIABLE, settingsOverrides } from "./settings-overrides.js";

const read = (entries: Record<string, string>) =>
  Effect.provide(
    settingsOverrides,
    Layer.succeed(Environment, ConfigProvider.fromEnvRecord(entries)),
  );

describe("the settings store's environment overrides", () => {
  it.effect("resolve from the provider the environment seam holds", () =>
    Effect.gen(function* () {
      const overrides = yield* read({ [SETTINGS_OVERRIDE_VARIABLE.LIVE_VOICE]: LIVE_VOICE.SAGE });

      assert.equal(overrides.voice, LIVE_VOICE.SAGE);
    }),
  );

  it.effect("resolve absent from a provider that holds none", () =>
    Effect.gen(function* () {
      const overrides = yield* read({});

      assert.equal(overrides.voice, undefined);
    }),
  );

  it.effect("hold a voice this build does not offer to nothing", () =>
    Effect.gen(function* () {
      const overrides = yield* read({ [SETTINGS_OVERRIDE_VARIABLE.LIVE_VOICE]: "baritone" });

      assert.equal(overrides.voice, undefined);
    }),
  );
});
