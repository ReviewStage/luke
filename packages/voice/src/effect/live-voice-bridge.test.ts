import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { LiveVoiceBridge } from "../orchestrator/live-voice-orchestrator.js";
import { LiveVoiceBridgeTag, liveVoiceBridgeLayer } from "./live-voice-bridge.js";

const fakeBridge: LiveVoiceBridge = {
  reportView: () => undefined,
  requestMicrophone: () => Promise.resolve(true),
  hostedUnavailableNote: () => Promise.resolve(undefined),
  stopSpeaking: () => Promise.resolve(false),
};

describe("liveVoiceBridgeLayer", () => {
  it.effect("hands the same bridge object back through the tag", () =>
    Effect.gen(function* () {
      const bridge = yield* LiveVoiceBridgeTag;
      assert.equal(bridge, fakeBridge);
    }).pipe(Effect.provide(liveVoiceBridgeLayer(fakeBridge))),
  );
});
