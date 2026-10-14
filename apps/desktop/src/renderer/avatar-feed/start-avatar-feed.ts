/**
 * start-avatar-feed.ts -- tees Luke's remote track into the avatar feed for as long as the caller's scope stands.
 *
 * The voice window already reads this track through Web Audio for its
 * speaking meter, so the tee rides a path that already ships: a context
 * opened at `PCM_SAMPLE_RATE`, the track as its source, and the worklet as
 * the one node it feeds, which posts PCM16 chunks that the turn gate turns
 * into `audio` and `turn_end`. The context, the nodes, and an open turn are
 * released when the scope closes. A tee that cannot stand up leaves the feed
 * dark and the call on voice, so the effect never fails.
 *
 * Note that the remote stream must stay attached to a playing `<audio>`
 * element, muted or not, for as long as the tee stands: Spike 0 found that
 * without one Chromium hands every context reading the track nothing but
 * zeros. The same spike found a 24 kHz context takes the 48 kHz track and
 * resamples it cleanly (Pearson 0.9916 against a decimated 48 kHz copy, no
 * lag), so the worklet carries no filter of its own.
 *
 * Its caller is #10, which runs it from `use-voice-session.ts`.
 */

import { Effect, type Scope } from "effect";
import { PCM_SAMPLE_RATE, PCM_TEE } from "./contract";
import type { AvatarFeed } from "./feed";
import { closeTurnGate, stepTurnGate, TURN_GATE_IDLE } from "./turn-gate";

export interface AvatarFeedOptions {
  /** Luke's remote WebRTC stream, the one his `<audio>` element plays. */
  readonly stream: MediaStream;
  readonly onFeed: (feed: AvatarFeed) => void;
}

/** The context the tee runs in, closed with the scope. */
const acquireContext = Effect.acquireRelease(
  Effect.try(() => new AudioContext({ sampleRate: PCM_SAMPLE_RATE, latencyHint: "interactive" })),
  (context) => Effect.ignore(Effect.tryPromise(() => context.close())),
);

/**
 * The source and the tee, wired. The node takes one input mixed down to mono
 * and has no output: a node with none is pulled by the graph without reaching
 * the speakers, so nothing is heard twice. The gate is held here, between
 * chunks, because each chunk arrives on a port callback no fiber owns.
 */
function acquireTee(context: AudioContext, options: AvatarFeedOptions) {
  return Effect.acquireRelease(
    Effect.try(() => {
      const source = context.createMediaStreamSource(options.stream);
      const tee = new AudioWorkletNode(context, PCM_TEE.PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      let gate = TURN_GATE_IDLE;
      tee.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!(event.data instanceof Int16Array)) return;
        const step = stepTurnGate(gate, event.data);
        gate = step.gate;
        for (const feed of step.feeds) options.onFeed(feed);
      };
      source.connect(tee);
      return { source, tee, gate: () => gate };
    }),
    ({ source, tee, gate }) =>
      Effect.sync(() => {
        tee.port.onmessage = null;
        source.disconnect();
        tee.disconnect();
        for (const feed of closeTurnGate(gate())) options.onFeed(feed);
      }),
  );
}

export function startAvatarFeed(
  options: AvatarFeedOptions,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const context = yield* acquireContext;
    // Note that a context that would not open at the rate is left dark rather
    // than fed, because Keyframe reads every chunk at 24 kHz whatever it was.
    if (context.sampleRate !== PCM_SAMPLE_RATE) {
      return yield* Effect.logWarning("avatar feed: the audio context refused 24 kHz", {
        sampleRate: context.sampleRate,
      });
    }
    yield* Effect.tryPromise(() => context.audioWorklet.addModule(PCM_TEE.SCRIPT));
    yield* acquireTee(context, options);
    // A suspended context pulls nothing, and no gesture in a hidden window has vouched for it.
    yield* Effect.ignore(Effect.tryPromise(() => context.resume()));
  }).pipe(
    Effect.catch((error) => Effect.logWarning("avatar feed: the tee did not start", { error })),
  );
}
