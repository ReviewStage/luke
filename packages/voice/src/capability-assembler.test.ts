import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_SESSION_OUTCOME, LIVE_VOICE } from "@sidecar/live";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { Effect } from "effect";
import { VoiceCapabilityAssembler, type VoiceSettings } from "./capability-assembler.js";
import { scriptedOpenSocket } from "./testing.js";

function settingsFor(options: { voice?: string } = {}): VoiceSettings {
  return {
    // The stored preferences, or the schema default where a test stores none.
    // SAFETY: the schema's own default for the field being read.
    get: (field) =>
      Effect.succeed(
        (field === APP_SETTING_SCHEMA.voice.field && options.voice !== undefined
          ? options.voice
          : APP_SETTING_SCHEMA[field].default) as never,
      ),
    readAccount: () => Effect.succeed({ accessToken: "account-token" }),
  };
}

function seamsFor(overrides: Partial<ConstructorParameters<typeof VoiceCapabilityAssembler>[0]>) {
  return {
    settings: settingsFor(),
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => true,
    refreshAccount: () => Effect.void,
    report: () => undefined,
    ...overrides,
  };
}

it.effect(
  "a signed-in account stands the set: the hosted live source, on the voice it prefers",
  () =>
    Effect.gen(function* () {
      const reports: string[] = [];
      const assembler = new VoiceCapabilityAssembler(
        seamsFor({
          openSocket: scriptedOpenSocket([]).openSocket,
          settings: settingsFor({ voice: LIVE_VOICE.MARIN }),
          report: (message) => reports.push(message),
        }),
      );

      yield* assembler.apply();
      assert.ok(assembler.liveSessions);
      assert.equal(assembler.liveSessions.diagnostics().voice, LIVE_VOICE.MARIN);
      assert.ok(reports.some((report) => report.startsWith("Luke voice: enabled (hosted")));
    }),
);

it.effect(
  "signing out clears the whole set as one unit, and the absence is diagnosed as the missing account, not a fixture run",
  () =>
    Effect.gen(function* () {
      const gate = { signedIn: true };
      const assembler = new VoiceCapabilityAssembler(
        seamsFor({
          openSocket: scriptedOpenSocket([]).openSocket,
          accountSignedIn: () => gate.signedIn,
        }),
      );
      yield* assembler.apply();
      assert.ok(assembler.liveSessions);

      gate.signedIn = false;
      yield* assembler.apply();
      assert.equal(assembler.liveSessions, undefined);
      assert.equal(assembler.unavailableLiveDiagnostics.fixtureMode, false);
      assert.equal(
        assembler.unavailableLiveDiagnostics.lastOutcome,
        LIVE_SESSION_OUTCOME.NO_ACCOUNT,
      );
    }),
);

it.effect("a closed credential gate stands nothing, even for a signed-in account", () =>
  Effect.gen(function* () {
    const reports: string[] = [];
    const assembler = new VoiceCapabilityAssembler(
      seamsFor({
        openSocket: scriptedOpenSocket([]).openSocket,
        credentialsUsable: () => false,
        report: (message) => reports.push(message),
      }),
    );
    yield* assembler.apply();
    assert.equal(assembler.liveSessions, undefined);
    assert.equal(assembler.unavailableLiveDiagnostics.lastOutcome, LIVE_SESSION_OUTCOME.NO_ACCOUNT);
    assert.ok(reports.some((report) => report.startsWith("Luke voice: unavailable")));
  }),
);

it.effect(
  "a fixture run is diagnosed as the fixture, apart from a run that merely lacks an account",
  () =>
    Effect.gen(function* () {
      const assembler = new VoiceCapabilityAssembler(
        seamsFor({
          openSocket: scriptedOpenSocket([]).openSocket,
          credentialsUsable: () => false,
          fixtureRun: () => true,
        }),
      );
      yield* assembler.apply();
      assert.equal(assembler.liveSessions, undefined);
      assert.equal(assembler.unavailableLiveDiagnostics.fixtureMode, true);
      assert.equal(
        assembler.unavailableLiveDiagnostics.lastOutcome,
        LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE,
      );
    }),
);

it.effect("live sessions stand only where a socket seam was handed", () =>
  Effect.gen(function* () {
    const withoutSeam = new VoiceCapabilityAssembler(seamsFor({}));
    yield* withoutSeam.apply();
    assert.equal(withoutSeam.liveSessions, undefined);
  }),
);
