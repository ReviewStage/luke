/**
 * `LiveVoiceBridge` restated as a service, for a caller that reaches for it
 * through `Effect`'s environment rather than the orchestrator's constructor
 * argument. `../orchestrator/live-voice-orchestrator.js`'s interface is
 * untouched, and so is `LiveVoiceOrchestrator` itself, so this is a second
 * door onto the same value, not a replacement for the first.
 *
 * It is one tag for the whole bridge, not one per verb, because the bridge
 * is not independent capabilities a `Layer` could each supply on its own:
 * `reportView`, `requestMicrophone`, `hostedUnavailableNote`, and
 * `stopSpeaking` all close over the one process the orchestrator is
 * embedded in, so splitting them would only add tags a caller could never
 * provide separately from the others — the microphone the talk key opens
 * (its "ear") and the model the stop key silences (its "mouth") are two
 * verbs of the one seam a host composes whole.
 *
 * `liveVoiceBridgeLayer` is a strangler shim: P7-07 (compose-speech) deletes
 * it once the host hands the orchestrator its bridge as a `Layer` directly,
 * rather than through the constructor argument it stands in for.
 */
import { Context, Layer } from "effect";
import type { LiveVoiceBridge } from "../orchestrator/live-voice-orchestrator.js";

export class LiveVoiceBridgeTag extends Context.Tag("@sidecar/voice/LiveVoiceBridge")<
  LiveVoiceBridgeTag,
  LiveVoiceBridge
>() {}

/** @deprecated Wraps the existing bridge object as a `Layer`; P7-07 deletes it with the constructor argument it stands in for. */
export const liveVoiceBridgeLayer = (bridge: LiveVoiceBridge): Layer.Layer<LiveVoiceBridgeTag> =>
  Layer.succeed(LiveVoiceBridgeTag, bridge);
