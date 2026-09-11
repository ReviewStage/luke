import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_SESSION_OUTCOME } from "@sidecar/live";
import { APP_SETTING_SCHEMA, VOICE_SOURCE } from "@sidecar/settings";
import {
  resolveVoiceCapability,
  VoiceCapabilityAssembler,
  type VoiceSettings,
} from "./capability-assembler.js";
import { scriptedOpenSocket } from "./testing.js";

test("fixture runs never expose or select a credential", () => {
  assert.deepEqual(
    resolveVoiceCapability({
      credentialsUsable: false,
      keyConfigured: true,
      accountSignedIn: true,
      chosenSource: VOICE_SOURCE.KEY,
    }),
    { available: false, source: VOICE_SOURCE.ACCOUNT, useKey: false, useHosted: false },
  );
});

test("a chosen hosted allowance is honored only while signed in", () => {
  assert.equal(
    resolveVoiceCapability({
      credentialsUsable: true,
      keyConfigured: true,
      accountSignedIn: true,
      chosenSource: VOICE_SOURCE.ACCOUNT,
    }).useHosted,
    true,
  );
  assert.equal(
    resolveVoiceCapability({
      credentialsUsable: true,
      keyConfigured: true,
      accountSignedIn: false,
      chosenSource: VOICE_SOURCE.ACCOUNT,
    }).useKey,
    true,
  );
});

test("an account is the only non-key source and absence stays unavailable", () => {
  assert.deepEqual(
    resolveVoiceCapability({
      credentialsUsable: true,
      keyConfigured: false,
      accountSignedIn: false,
      chosenSource: undefined,
    }),
    { available: false, source: VOICE_SOURCE.ACCOUNT, useKey: false, useHosted: false },
  );
});

function settingsFor(options: {
  source: typeof VOICE_SOURCE.KEY | typeof VOICE_SOURCE.ACCOUNT;
  key?: string;
}): VoiceSettings {
  return {
    readVoiceSource: async () => options.source,
    readApiKey: async () => options.key,
    // Nothing stored, which is what the schema default already says.
    // SAFETY: the schema's own default for the field being read.
    get: async (field) => APP_SETTING_SCHEMA[field].default as never,
    readAccount: async () => undefined,
  };
}

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("the assembler builds and clears the keyed voice capabilities as one unit", async () => {
  let key: string | undefined = "test-key";
  const reports: string[] = [];
  const assembler = new VoiceCapabilityAssembler({
    settings: {
      ...settingsFor({ source: VOICE_SOURCE.KEY }),
      readApiKey: async () => key,
    },
    openSocket: scriptedOpenSocket([]).openSocket,
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => false,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: async () => undefined,
    report: (message) => reports.push(message),
  });

  await assembler.apply();
  assert.ok(assembler.liveSessions);
  assert.ok(assembler.brainModel);

  key = undefined;
  await assembler.apply();
  assert.equal(assembler.liveSessions, undefined);
  assert.equal(assembler.brainModel, undefined);
});

test("a wrapped brain model stands where the built one would, and only when one was built", async () => {
  const wrapped: string[] = [];
  let key: string | undefined = "test-key";
  const assembler = new VoiceCapabilityAssembler({
    settings: {
      ...settingsFor({ source: VOICE_SOURCE.KEY }),
      readApiKey: async () => key,
    },
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => false,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: async () => undefined,
    report: () => undefined,
    wrapBrainModel: (model) => {
      wrapped.push(model.model ?? "unnamed");
      return model;
    },
  });

  await assembler.apply();
  assert.ok(assembler.brainModel);
  assert.deepEqual(wrapped, ["gpt-5.6-terra"]);

  // No client, nothing to decorate: the wrapper must not conjure one.
  key = undefined;
  await assembler.apply();
  assert.equal(assembler.brainModel, undefined);
  assert.deepEqual(wrapped, ["gpt-5.6-terra"]);
});

test("the assembler keeps fixture runs credential-free without reading a key", async () => {
  let keyReads = 0;
  const assembler = new VoiceCapabilityAssembler({
    settings: {
      ...settingsFor({ source: VOICE_SOURCE.KEY }),
      readApiKey: async () => {
        keyReads += 1;
        return "must-not-be-read";
      },
    },
    credentialsUsable: () => false,
    fixtureRun: () => true,
    accountSignedIn: () => true,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: async () => undefined,
    report: () => undefined,
  });

  await assembler.apply();
  assert.equal(keyReads, 0);
  assert.equal(assembler.liveSessions, undefined);
  assert.equal(
    assembler.unavailableLiveDiagnostics.lastOutcome,
    LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE,
  );
});

test("a signed-out live run is diagnosed as missing credentials, not as a fixture run", async () => {
  const reports: string[] = [];
  const assembler = new VoiceCapabilityAssembler({
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT }),
    credentialsUsable: () => false,
    fixtureRun: () => false,
    accountSignedIn: () => false,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: async () => undefined,
    report: (message) => reports.push(message),
  });

  await assembler.apply();
  assert.equal(assembler.liveSessions, undefined);
  assert.equal(assembler.unavailableLiveDiagnostics.fixtureMode, false);
  assert.equal(assembler.unavailableLiveDiagnostics.lastOutcome, LIVE_SESSION_OUTCOME.NO_API_KEY);
});

test("the brain follows the voice source: hosted on an account, direct on a key, none in a fixture run", async () => {
  const seams = {
    openSocket: scriptedOpenSocket([]).openSocket,
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => true,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: async () => undefined,
    report: () => undefined,
    fetch: async () => new Response(null, { status: 204 }),
  };
  const hosted = new VoiceCapabilityAssembler({
    ...seams,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT, key: "stored-but-unchosen" }),
  });
  await hosted.apply();
  assert.ok(hosted.liveSessions);
  // The service names the model, and the stored key is never read for it.
  assert.ok(hosted.brainModel);
  assert.equal(hosted.brainModel?.model, undefined);

  const keyed = new VoiceCapabilityAssembler({
    ...seams,
    settings: settingsFor({ source: VOICE_SOURCE.KEY, key: "test-key" }),
  });
  await keyed.apply();
  assert.ok(keyed.brainModel?.model);

  const signedOut = new VoiceCapabilityAssembler({
    ...seams,
    accountSignedIn: () => false,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT }),
  });
  await signedOut.apply();
  assert.equal(signedOut.brainModel, undefined);

  const fixture = new VoiceCapabilityAssembler({
    ...seams,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT }),
    credentialsUsable: () => false,
    fixtureRun: () => true,
  });
  await fixture.apply();
  assert.equal(fixture.brainModel, undefined);
});

test("live sessions follow the voice source, and stand only where a socket seam was handed", async () => {
  const { openSocket } = scriptedOpenSocket([]);
  const seams = {
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => true,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: async () => undefined,
    report: () => undefined,
    fetch: async () => new Response(null, { status: 204 }),
  };

  const keyed = new VoiceCapabilityAssembler({
    ...seams,
    openSocket,
    settings: settingsFor({ source: VOICE_SOURCE.KEY, key: "test-key" }),
  });
  await keyed.apply();
  assert.equal(keyed.liveSessions?.diagnostics().apiKeyConfigured, true);
  assert.equal(keyed.liveSessions?.diagnostics().hosted, undefined);

  const hosted = new VoiceCapabilityAssembler({
    ...seams,
    openSocket,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT, key: "stored-but-unchosen" }),
  });
  await hosted.apply();
  assert.equal(hosted.liveSessions?.diagnostics().hosted, true);
  assert.equal(hosted.liveSessions?.diagnostics().apiKeyConfigured, false);

  const signedOut = new VoiceCapabilityAssembler({
    ...seams,
    openSocket,
    accountSignedIn: () => false,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT }),
  });
  await signedOut.apply();
  assert.equal(signedOut.liveSessions, undefined);
  assert.equal(signedOut.unavailableLiveDiagnostics.lastOutcome, LIVE_SESSION_OUTCOME.NO_API_KEY);

  const fixture = new VoiceCapabilityAssembler({
    ...seams,
    openSocket,
    credentialsUsable: () => false,
    fixtureRun: () => true,
    settings: settingsFor({ source: VOICE_SOURCE.KEY, key: "must-not-be-used" }),
  });
  await fixture.apply();
  assert.equal(fixture.liveSessions, undefined);
  assert.equal(
    fixture.unavailableLiveDiagnostics.lastOutcome,
    LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE,
  );

  const withoutSeam = new VoiceCapabilityAssembler({
    ...seams,
    settings: settingsFor({ source: VOICE_SOURCE.KEY, key: "test-key" }),
  });
  await withoutSeam.apply();
  assert.ok(withoutSeam.brainModel);
  assert.equal(withoutSeam.liveSessions, undefined);
});
