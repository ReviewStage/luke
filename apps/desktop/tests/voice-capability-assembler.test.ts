import assert from "node:assert/strict";
import test from "node:test";
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
    readVoiceSource: async () => options.source,
    readApiKey: async () => options.key,
    get: async () => undefined,
    readAccount: async () => undefined,
  };
}

test("the assembler builds and clears the keyed voice capabilities as one unit", async () => {
  let key: string | undefined = "test-key";
  const reports: string[] = [];
  const assembler = new VoiceCapabilityAssembler({
    settings: {
      ...settingsFor({ source: VOICE_SOURCE.KEY }),
      readApiKey: async () => key,
    },
    credentialsUsable: () => true,
    accountSignedIn: () => false,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: async () => undefined,
    currentSession: () => undefined,
    noticeRequestFor: () => undefined,
    report: (message) => reports.push(message),
  });

  await assembler.apply();
  assert.ok(assembler.realtimeCredentials);
  assert.ok(assembler.attentionReviewer);
  assert.equal(assembler.hostedUsageReader, undefined);

  key = undefined;
  await assembler.apply();
  assert.equal(assembler.realtimeCredentials, undefined);
  assert.equal(assembler.attentionReviewer, undefined);
  assert.match(reports.at(-1) ?? "", /unavailable/);
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
    accountSignedIn: () => true,
    hostedServiceBaseUrl: "https://example.test",
    refreshAccount: async () => undefined,
    currentSession: () => undefined,
    noticeRequestFor: () => undefined,
    report: () => undefined,
  });

  await assembler.apply();
  assert.equal(keyReads, 0);
  assert.equal(assembler.realtimeCredentials, undefined);
  assert.equal(assembler.hostedUsageReader, undefined);
});
