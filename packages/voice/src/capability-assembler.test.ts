import assert from "node:assert/strict";
import { LIVE_SESSION_OUTCOME } from "@sidecar/live";
import { APP_SETTING_SCHEMA, VOICE_SOURCE } from "@sidecar/settings";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { test } from "vitest";
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
    readVoiceSource: () => Effect.succeed(options.source),
    readApiKey: () => Effect.succeed(options.key),
    // Nothing stored, which is what the schema default already says.
    // SAFETY: the schema's own default for the field being read.
    get: (field) => Effect.succeed(APP_SETTING_SCHEMA[field].default as never),
    readAccount: () => Effect.succeed(undefined),
  };
}

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a key of the developer's own stands nothing: no live session opens on it, and no brain", async () => {
  let key: string | undefined = "test-key";
  const reports: string[] = [];
  const assembler = new VoiceCapabilityAssembler({
    settings: {
      ...settingsFor({ source: VOICE_SOURCE.KEY }),
      readApiKey: () => Effect.succeed(key),
    },
    openSocket: scriptedOpenSocket([]).openSocket,
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => false,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: () => Effect.void,
    report: (message) => reports.push(message),
  });

  await Effect.runPromise(assembler.apply());
  assert.equal(assembler.liveSessions, undefined);
  assert.equal(assembler.brainModel, undefined);
  assert.equal(assembler.prefetchModel, undefined);
  assert.equal(assembler.unavailableLiveDiagnostics.lastOutcome, LIVE_SESSION_OUTCOME.NO_ACCOUNT);
  assert.ok(
    reports.some((report) => report.startsWith("Luke voice: unavailable")),
    "the key's run says voice is unavailable rather than enabled",
  );

  key = undefined;
  await Effect.runPromise(assembler.apply());
  assert.equal(assembler.liveSessions, undefined);
  assert.equal(assembler.brainModel, undefined);
});

test("a wrapped brain model stands where the built one would, and only when one was built", async () => {
  const wrapped: number[] = [];
  const gate = { signedIn: true };
  const assembler = new VoiceCapabilityAssembler({
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT }),
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => gate.signedIn,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: () => Effect.void,
    report: () => undefined,
    wrapBrainModel: (model) => {
      wrapped.push(1);
      return model;
    },
  });

  await Effect.runPromise(assembler.apply());
  assert.ok(assembler.brainModel);
  assert.ok(assembler.prefetchModel);
  // The brain's model and the prefetch's small one are each wrapped once.
  assert.equal(wrapped.length, 2);

  // No client, nothing to decorate: the wrapper must not conjure one.
  gate.signedIn = false;
  await Effect.runPromise(assembler.apply());
  assert.equal(assembler.brainModel, undefined);
  assert.equal(assembler.prefetchModel, undefined);
  assert.equal(wrapped.length, 2);
});

test("the assembler keeps fixture runs credential-free without reading a key", async () => {
  let keyReads = 0;
  const assembler = new VoiceCapabilityAssembler({
    settings: {
      ...settingsFor({ source: VOICE_SOURCE.KEY }),
      readApiKey: () => {
        keyReads += 1;
        return Effect.succeed("must-not-be-read");
      },
    },
    credentialsUsable: () => false,
    fixtureRun: () => true,
    accountSignedIn: () => true,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: () => Effect.void,
    report: () => undefined,
  });

  await Effect.runPromise(assembler.apply());
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
    refreshAccount: () => Effect.void,
    report: (message) => reports.push(message),
  });

  await Effect.runPromise(assembler.apply());
  assert.equal(assembler.liveSessions, undefined);
  assert.equal(assembler.unavailableLiveDiagnostics.fixtureMode, false);
  assert.equal(assembler.unavailableLiveDiagnostics.lastOutcome, LIVE_SESSION_OUTCOME.NO_ACCOUNT);
});

test("the brain stands on the signed-in account alone: none on a key, none signed out, none in a fixture run", async () => {
  const seams = {
    openSocket: scriptedOpenSocket([]).openSocket,
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => true,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: () => Effect.void,
    report: () => undefined,
    httpClient: fakeHttpClientLayer(async () => new Response(null, { status: 204 })),
  };
  const hosted = new VoiceCapabilityAssembler({
    ...seams,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT, key: "stored-but-unchosen" }),
  });
  await Effect.runPromise(hosted.apply());
  assert.ok(hosted.liveSessions);
  // The service names the model, and the stored key is never read for it.
  assert.ok(hosted.brainModel);
  assert.equal(hosted.brainModel?.model, undefined);

  // A key of the developer's own stands nothing, whatever the account beside
  // it: no session opens on it, and no brain answers one.
  const keyed = new VoiceCapabilityAssembler({
    ...seams,
    settings: settingsFor({ source: VOICE_SOURCE.KEY, key: "test-key" }),
  });
  await Effect.runPromise(keyed.apply());
  assert.equal(keyed.liveSessions, undefined);
  assert.equal(keyed.brainModel, undefined);
  assert.equal(keyed.prefetchModel, undefined);

  const signedOut = new VoiceCapabilityAssembler({
    ...seams,
    accountSignedIn: () => false,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT }),
  });
  await Effect.runPromise(signedOut.apply());
  assert.equal(signedOut.brainModel, undefined);

  const fixture = new VoiceCapabilityAssembler({
    ...seams,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT }),
    credentialsUsable: () => false,
    fixtureRun: () => true,
  });
  await Effect.runPromise(fixture.apply());
  assert.equal(fixture.brainModel, undefined);
});

test("live sessions stand on the account alone, and only where a socket seam was handed", async () => {
  const { openSocket } = scriptedOpenSocket([]);
  const seams = {
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => true,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: () => Effect.void,
    report: () => undefined,
    httpClient: fakeHttpClientLayer(async () => new Response(null, { status: 204 })),
  };

  const keyed = new VoiceCapabilityAssembler({
    ...seams,
    openSocket,
    settings: settingsFor({ source: VOICE_SOURCE.KEY, key: "test-key" }),
  });
  await Effect.runPromise(keyed.apply());
  assert.equal(keyed.liveSessions, undefined);

  const hosted = new VoiceCapabilityAssembler({
    ...seams,
    openSocket,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT, key: "stored-but-unchosen" }),
  });
  await Effect.runPromise(hosted.apply());
  assert.ok(hosted.liveSessions);
  assert.equal(hosted.liveSessions.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_ATTEMPTED);

  const signedOut = new VoiceCapabilityAssembler({
    ...seams,
    openSocket,
    accountSignedIn: () => false,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT }),
  });
  await Effect.runPromise(signedOut.apply());
  assert.equal(signedOut.liveSessions, undefined);
  assert.equal(signedOut.unavailableLiveDiagnostics.lastOutcome, LIVE_SESSION_OUTCOME.NO_ACCOUNT);

  const fixture = new VoiceCapabilityAssembler({
    ...seams,
    openSocket,
    credentialsUsable: () => false,
    fixtureRun: () => true,
    settings: settingsFor({ source: VOICE_SOURCE.KEY, key: "must-not-be-used" }),
  });
  await Effect.runPromise(fixture.apply());
  assert.equal(fixture.liveSessions, undefined);
  assert.equal(
    fixture.unavailableLiveDiagnostics.lastOutcome,
    LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE,
  );

  const withoutSeam = new VoiceCapabilityAssembler({
    ...seams,
    settings: settingsFor({ source: VOICE_SOURCE.ACCOUNT }),
  });
  await Effect.runPromise(withoutSeam.apply());
  assert.ok(withoutSeam.brainModel);
  assert.equal(withoutSeam.liveSessions, undefined);
});
