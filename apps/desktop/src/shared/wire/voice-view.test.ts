import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_STATUS } from "@sidecar/realtime";
import { isRealtimeStatus, isVoiceCommand, VOICE_COMMAND } from "./voice-view";

test("every realtime status is recognized and nothing else is", () => {
  for (const status of Object.values(REALTIME_STATUS)) {
    assert.equal(isRealtimeStatus(status), true);
  }
  assert.equal(isRealtimeStatus("speaking"), false);
  assert.equal(isRealtimeStatus(1), false);
});

test("the five voice commands are the whole set", () => {
  const commands = Object.values(VOICE_COMMAND);
  assert.equal(commands.length, 5);
  for (const command of commands) assert.equal(isVoiceCommand(command), true);
  assert.equal(isVoiceCommand("stop-microphone"), false);
});
