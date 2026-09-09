import assert from "node:assert/strict";
import test from "node:test";
import { remoteRealtimeToolDefinitions } from "@sidecar/acts";
import { realtimeCredentialIsUsable } from "@sidecar/hosted";
import type { UnparsedWireValue } from "@sidecar/wire";
import {
  REALTIME_TRUNCATION,
  realtimeClientSecretRequest,
  realtimeCredentialFromResponse,
  realtimeSessionConfig,
  remoteRealtimeClientSecretRequest,
} from "./realtime-credentials.js";
import { REALTIME_SESSION_TYPE } from "./realtime-events.js";
import { ASK_BRAIN_TOOL, remoteRealtimeInstructions } from "./realtime-instructions.js";
import {
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  REALTIME_DEFAULTS,
  REALTIME_VOICE_LIST,
  REALTIME_VOICE_SPEED_LIST,
} from "./realtime-voice-settings.js";

const EXPIRES_AT_SECONDS = 1_800_000_060;

test("the minted session closes the microphone until push-to-talk opens it", () => {
  const config = realtimeSessionConfig();

  assert.equal(config.type, REALTIME_SESSION_TYPE);
  assert.equal(REALTIME_DEFAULTS.MODEL, "gpt-realtime-2.1");
  assert.equal(config.model, REALTIME_DEFAULTS.MODEL);
  assert.deepEqual(config.reasoning, { effort: "low" });
  assert.equal(config.audio.output.voice, REALTIME_DEFAULTS.VOICE);
  // An always-open microphone is the one thing a desk-side sidecar must not have.
  assert.equal(config.audio.input.turn_detection, null);
  assert.equal(realtimeClientSecretRequest().session.type, REALTIME_SESSION_TYPE);
});

test("the minted session asks for the developer's spoken words back as text", () => {
  // The audio already travels to this same service to be heard at all; the
  // transcription only hands the text back, so the history can hold both
  // halves of the exchange.
  assert.equal(REALTIME_DEFAULTS.TRANSCRIPTION_MODEL, "gpt-live-transcribe");
  assert.deepEqual(realtimeSessionConfig().audio.input.transcription, {
    model: REALTIME_DEFAULTS.TRANSCRIPTION_MODEL,
  });
});

test("a model override receives no unsupported reasoning configuration", () => {
  assert.equal(realtimeSessionConfig({ model: "gpt-realtime-preview" }).reasoning, undefined);
});

test("the minted session chooses how it gives way at the edge of the window", () => {
  const config = realtimeSessionConfig();

  // Eviction happens either way; left unset the service trims the least it can,
  // which means trimming again on every turn once the ceiling is reached and
  // moving the cached prefix every time. One larger trim is one cache miss.
  assert.equal(config.truncation.type, REALTIME_TRUNCATION.TYPE);
  assert.equal(config.truncation.retention_ratio, REALTIME_TRUNCATION.RETENTION_RATIO);
  assert.ok(config.truncation.retention_ratio > 0 && config.truncation.retention_ratio <= 1);
  assert.equal(realtimeClientSecretRequest().session.truncation.type, REALTIME_TRUNCATION.TYPE);
});

test("a mint response yields a credential with a millisecond expiry", () => {
  const credential = realtimeCredentialFromResponse({
    value: "ek_test_secret",
    expires_at: EXPIRES_AT_SECONDS,
    session: { model: "gpt-realtime-2.1" },
  });

  assert.ok(credential);
  assert.equal(credential.value, "ek_test_secret");
  assert.equal(credential.expiresAt, EXPIRES_AT_SECONDS * 1000);
  assert.equal(credential.model, "gpt-realtime-2.1");
  assert.equal(realtimeCredentialIsUsable(credential, EXPIRES_AT_SECONDS * 1000 - 1), true);
  assert.equal(realtimeCredentialIsUsable(credential, EXPIRES_AT_SECONDS * 1000), false);
});

test("a mint response outside the contract yields no credential", () => {
  const payloads: UnparsedWireValue[] = [
    undefined,
    null,
    "ek_test_secret",
    {},
    { value: "   ", expires_at: EXPIRES_AT_SECONDS },
    { value: "ek_test_secret" },
    { value: "ek_test_secret", expires_at: "soon" },
    { value: "ek_test_secret", expires_at: 0 },
    { value: "ek_test_secret", expires_at: Number.NaN },
  ];
  for (const payload of payloads) {
    assert.equal(realtimeCredentialFromResponse(payload), undefined);
  }
});

test("a mint response without a session model falls back to the requested model", () => {
  const credential = realtimeCredentialFromResponse(
    { value: "ek_test_secret", expires_at: EXPIRES_AT_SECONDS },
    "gpt-realtime-preview",
  );

  assert.equal(credential?.model, "gpt-realtime-preview");
});

test("a male voice is what the session is minted with", () => {
  assert.equal(REALTIME_DEFAULTS.VOICE, "echo");
  assert.equal(realtimeSessionConfig().audio.output.voice, "echo");
});

test("the default voice is one the settings can offer", () => {
  assert.equal(isRealtimeVoice(REALTIME_DEFAULTS.VOICE), true);
});

test("every offered voice is recognized and anything else is refused", () => {
  for (const voice of REALTIME_VOICE_LIST) assert.equal(isRealtimeVoice(voice), true);
  for (const value of ["baritone", "", "  cedar  ", undefined, null, 3]) {
    assert.equal(isRealtimeVoice(value), false);
  }
});

test("the session is minted at the voice's natural pace unless asked otherwise", () => {
  assert.equal(REALTIME_DEFAULTS.SPEED, 1);
  assert.equal(realtimeSessionConfig().audio.output.speed, 1);
  assert.equal(realtimeSessionConfig({ speed: 1.25 }).audio.output.speed, 1.25);
});

test("a pace that is not a usable number falls back rather than minting a refusal", () => {
  for (const speed of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.equal(realtimeSessionConfig({ speed }).audio.output.speed, REALTIME_DEFAULTS.SPEED);
  }
});

test("every offered pace is recognized and anything else is refused", () => {
  assert.equal(isRealtimeVoiceSpeed(REALTIME_DEFAULTS.SPEED), true);
  for (const speed of REALTIME_VOICE_SPEED_LIST) assert.equal(isRealtimeVoiceSpeed(speed), true);
  for (const value of [0.5, 2, 0, -1, "1", "", undefined, null]) {
    assert.equal(isRealtimeVoiceSpeed(value), false);
  }
});

test("the desktop session is minted with the one ask and nothing wider", () => {
  const config = realtimeSessionConfig();

  assert.deepEqual(
    config.tools.map((tool) => tool.name),
    ["ask_brain"],
  );
  assert.equal(ASK_BRAIN_TOOL.name, "ask_brain");
  // Auto for the conversation: the voice decides when to ask the brain, and
  // each briefing narrows itself to none.
  assert.equal(config.tool_choice, "auto");
});

test("the remote mint still carries the phone's own acts and roster rules", () => {
  const request = remoteRealtimeClientSecretRequest();
  const remoteNames = remoteRealtimeToolDefinitions().map((tool) => tool.name);

  assert.ok(remoteNames.length > 0);
  assert.deepEqual(
    request.session.tools.map((tool) => tool.name),
    remoteNames,
  );
  assert.equal(remoteNames.includes(ASK_BRAIN_TOOL.name), false);
  // The mint trims the standing text; the rules it carries are what matter.
  assert.match(request.session.instructions, /\[observed session status\]/);
  assert.equal(request.session.instructions, remoteRealtimeInstructions().trim());
});
