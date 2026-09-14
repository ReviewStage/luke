import assert from "node:assert/strict";
import { LIVE_SESSION_OUTCOME, LIVE_VOICE } from "@sidecar/live";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { Effect } from "effect";
import { test } from "vitest";
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

test("a signed-in account stands the set: the hosted live source, on the voice it prefers", async () => {
  const reports: string[] = [];
  const assembler = new VoiceCapabilityAssembler(
    seamsFor({
      openSocket: scriptedOpenSocket([]).openSocket,
      settings: settingsFor({ voice: LIVE_VOICE.MARIN }),
      report: (message) => reports.push(message),
    }),
  );

  await Effect.runPromise(assembler.apply());
  assert.ok(assembler.liveSessions);
  assert.equal(assembler.liveSessions.diagnostics().voice, LIVE_VOICE.MARIN);
  assert.ok(reports.some((report) => report.startsWith("Luke voice: enabled (hosted")));
});

test("signing out clears the whole set as one unit, and the absence is diagnosed as the missing account, not a fixture run", async () => {
  const gate = { signedIn: true };
  const assembler = new VoiceCapabilityAssembler(
    seamsFor({
      openSocket: scriptedOpenSocket([]).openSocket,
      accountSignedIn: () => gate.signedIn,
    }),
  );
  await Effect.runPromise(assembler.apply());
  assert.ok(assembler.liveSessions);

  gate.signedIn = false;
  await Effect.runPromise(assembler.apply());
  assert.equal(assembler.liveSessions, undefined);
  assert.equal(assembler.unavailableLiveDiagnostics.fixtureMode, false);
  assert.equal(assembler.unavailableLiveDiagnostics.lastOutcome, LIVE_SESSION_OUTCOME.NO_ACCOUNT);
});

test("a closed credential gate stands nothing, even for a signed-in account", async () => {
  const reports: string[] = [];
  const assembler = new VoiceCapabilityAssembler(
    seamsFor({
      openSocket: scriptedOpenSocket([]).openSocket,
      credentialsUsable: () => false,
      report: (message) => reports.push(message),
    }),
  );
  await Effect.runPromise(assembler.apply());
  assert.equal(assembler.liveSessions, undefined);
  assert.equal(assembler.unavailableLiveDiagnostics.lastOutcome, LIVE_SESSION_OUTCOME.NO_ACCOUNT);
  assert.ok(reports.some((report) => report.startsWith("Luke voice: unavailable")));
});

test("a fixture run is diagnosed as the fixture, apart from a run that merely lacks an account", async () => {
  const assembler = new VoiceCapabilityAssembler(
    seamsFor({
      openSocket: scriptedOpenSocket([]).openSocket,
      credentialsUsable: () => false,
      fixtureRun: () => true,
    }),
  );
  await Effect.runPromise(assembler.apply());
  assert.equal(assembler.liveSessions, undefined);
  assert.equal(assembler.unavailableLiveDiagnostics.fixtureMode, true);
  assert.equal(
    assembler.unavailableLiveDiagnostics.lastOutcome,
    LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE,
  );
});

test("live sessions stand only where a socket seam was handed", async () => {
  const withoutSeam = new VoiceCapabilityAssembler(seamsFor({}));
  await Effect.runPromise(withoutSeam.apply());
  assert.equal(withoutSeam.liveSessions, undefined);
});
