import assert from "node:assert/strict";
import test from "node:test";
import { remoteRealtimeToolDefinitions } from "./actions.js";
import {
  ASK_BRAIN_TOOL,
  introductionSessionConfig,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  mouthToolDefinitions,
  REALTIME_DEFAULTS,
  REALTIME_SCENE,
  REALTIME_TRUNCATION,
  REALTIME_VOICE_LIST,
  REALTIME_VOICE_SPEED_LIST,
  realtimeClientSecretRequest,
  realtimeSessionConfig,
  realtimeSessionInstructions,
  remoteRealtimeClientSecretRequest,
} from "./remote-mint-legacy.js";

test("the minted session closes the microphone until a press opens it", () => {
  const config = realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions());

  assert.equal(config.type, "realtime");
  assert.equal(REALTIME_DEFAULTS.MODEL, "gpt-realtime-2.1");
  assert.equal(config.model, REALTIME_DEFAULTS.MODEL);
  assert.deepEqual(config.reasoning, { effort: "low" });
  assert.equal(config.audio.output.voice, REALTIME_DEFAULTS.VOICE);
  assert.equal(config.audio.input.turn_detection, null);
  assert.equal(realtimeClientSecretRequest().session.type, "realtime");
});

test("the minted session asks for the caller's spoken words back as text", () => {
  assert.equal(REALTIME_DEFAULTS.TRANSCRIPTION_MODEL, "gpt-live-transcribe");
  assert.deepEqual(
    realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions()).audio.input.transcription,
    { model: REALTIME_DEFAULTS.TRANSCRIPTION_MODEL },
  );
});

test("a model override receives no unsupported reasoning configuration", () => {
  assert.equal(
    realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions(), {
      model: "gpt-realtime-preview",
    }).reasoning,
    undefined,
  );
});

test("the minted session chooses how it gives way at the edge of the window", () => {
  const config = realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions());

  assert.equal(config.truncation.type, REALTIME_TRUNCATION.TYPE);
  assert.equal(config.truncation.retention_ratio, REALTIME_TRUNCATION.RETENTION_RATIO);
  assert.ok(config.truncation.retention_ratio > 0 && config.truncation.retention_ratio <= 1);
  assert.equal(realtimeClientSecretRequest().session.truncation.type, REALTIME_TRUNCATION.TYPE);
});

test("the default voice is what the session is minted with, and one the phone offers", () => {
  assert.equal(REALTIME_DEFAULTS.VOICE, "echo");
  assert.equal(
    realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions()).audio.output.voice,
    "echo",
  );
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
  assert.equal(
    realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions()).audio.output.speed,
    1,
  );
  assert.equal(
    realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions(), { speed: 1.25 }).audio
      .output.speed,
    1.25,
  );
});

test("a pace that is not a usable number falls back rather than minting a refusal", () => {
  for (const speed of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.equal(
      realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions(), { speed }).audio.output
        .speed,
      REALTIME_DEFAULTS.SPEED,
    );
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
  const config = realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions());

  assert.deepEqual(
    config.tools.map((tool) => tool.name),
    [ASK_BRAIN_TOOL.name],
  );
  assert.equal(config.tool_choice, "auto");
});

test("the phone's mint carries the phone's own acts and roster rules", () => {
  const request = remoteRealtimeClientSecretRequest();
  const remoteNames = remoteRealtimeToolDefinitions().map((tool) => tool.name);

  assert.ok(remoteNames.length > 0);
  assert.deepEqual(
    request.session.tools.map((tool) => tool.name),
    remoteNames,
  );
  assert.equal(remoteNames.includes(ASK_BRAIN_TOOL.name), false);
  assert.equal(request.session.instructions, realtimeSessionInstructions(REALTIME_SCENE.PHONE));
});

test("the minted introduction session declares no tools and no way to choose one", () => {
  const config = introductionSessionConfig({ voice: "marin", speed: 1.2 });
  assert.deepEqual(config.tools, []);
  assert.equal(config.tool_choice, "none");
  const ordinary = realtimeSessionConfig(REALTIME_SCENE.DESKTOP, mouthToolDefinitions(), {
    voice: "marin",
    speed: 1.2,
  });
  assert.equal(config.model, ordinary.model);
  assert.deepEqual(config.reasoning, ordinary.reasoning);
  assert.deepEqual(config.audio, ordinary.audio);
  assert.equal(config.audio.input.turn_detection, null);
  assert.equal(config.instructions, realtimeSessionInstructions(REALTIME_SCENE.INTRODUCTION));
});
