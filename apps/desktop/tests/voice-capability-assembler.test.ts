import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { VOICE_SOURCE } from "../src/shared/contracts";
import {
  resolveVoiceCapability,
  VoiceCapabilityAssembler,
} from "../src/voice-capability-assembler";

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
}) {
  return {
    readVoiceSource: () => Effect.succeed(options.source),
    readApiKey: () => Effect.succeed(options.key),
    get: () => Effect.succeed(undefined),
    readAccount: () => Effect.succeed(undefined),
  };
}

function runApply(assembler: VoiceCapabilityAssembler): Promise<void> {
  return Effect.runPromise(assembler.apply());
}

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("the assembler builds and clears the keyed voice capabilities as one unit", async () => {
  let key: string | undefined = "test-key";
  const reports: string[] = [];
  const assembler = new VoiceCapabilityAssembler({
    settings: {
      ...settingsFor({ source: VOICE_SOURCE.KEY }),
      readApiKey: () => Effect.succeed(key),
    },
    credentialsUsable: () => true,
    accountSignedIn: () => false,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: () => Effect.void,
    currentSession: () => undefined,
    noticeRequestFor: () => undefined,
    report: (message) => reports.push(message),
  });

  await runApply(assembler);
  assert.ok(assembler.realtimeCredentials);
  assert.ok(assembler.attentionReviewer);
  assert.equal(assembler.hostedUsageReader, undefined);

  key = undefined;
  await runApply(assembler);
  assert.equal(assembler.realtimeCredentials, undefined);
  assert.equal(assembler.attentionReviewer, undefined);
  assert.match(reports.at(-1) ?? "", /unavailable/);
});

test("the assembler keeps fixture runs credential-free without reading a key", async () => {
  let keyReads = 0;
  const assembler = new VoiceCapabilityAssembler({
    settings: {
      ...settingsFor({ source: VOICE_SOURCE.KEY }),
      readApiKey: () =>
        Effect.sync(() => {
          keyReads += 1;
          return "must-not-be-read";
        }),
    },
    credentialsUsable: () => false,
    accountSignedIn: () => true,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: () => Effect.void,
    currentSession: () => undefined,
    noticeRequestFor: () => undefined,
    report: () => undefined,
  });

  await runApply(assembler);
  assert.equal(keyReads, 0);
  assert.equal(assembler.realtimeCredentials, undefined);
  assert.equal(assembler.hostedUsageReader, undefined);
});
