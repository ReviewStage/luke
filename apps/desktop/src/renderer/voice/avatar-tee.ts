/**
 * avatar-tee.ts -- a copy of Luke's voice as the avatar's 24 kHz PCM16 chunks.
 *
 * The voice window plays Luke's remote WebRTC track through its own element;
 * the tee listens to the same stream beside it, in a context of its own made
 * at the avatar's rate so the browser resamples rather than this code, and
 * hands each 100 ms chunk the worklet completes to `onChunk`. Nothing it
 * reads is drawn, counted, or kept. The graph is acquired into the caller's
 * `Scope` and goes when that scope closes.
 *
 * The tee is written over the narrowest slice of the audio graph it touches,
 * so a test can stand a fake in for the context without a browser. Note that
 * Chromium renders a remote WebRTC stream into an audio graph only while the
 * stream is also attached to a media element, so the voice window's element
 * stays attached, muted when it must be silent, for as long as the tee runs.
 */

import { Effect, type Scope } from "effect";
import { AVATAR_PCM, AVATAR_TEE_PROCESSOR } from "./pcm-chunker";

/** The worklet's bundle, beside `voice.html` (`scripts/build.mjs`). */
const AVATAR_TEE_WORKLET_URL = "avatar-tee-worklet.js";

export interface AvatarTeePort {
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

/** The stream wired through the worklet: the port it posts chunks on, and the wiring's undoing. */
interface AvatarTeeGraph {
  readonly port: AvatarTeePort;
  disconnect(): void;
}

export interface AvatarTeeContext {
  readonly sampleRate: number;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  connectTee(stream: MediaStream): AvatarTeeGraph;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface AvatarTeeOptions {
  /** Luke's remote stream, the one the voice window's element plays. */
  stream: MediaStream;
  /** One 100 ms chunk of 24 kHz PCM16 mono, little-endian, over a buffer of its own. */
  onChunk: (pcm: Uint8Array) => void;
  createContext?: () => AvatarTeeContext;
}

/**
 * The browser's context at the avatar's rate. The node has no output, which
 * Chromium pulls on its own, and one input channel, explicitly, so a stereo
 * track reaches the worklet mixed down.
 */
function createBrowserContext(): AvatarTeeContext {
  const context = new AudioContext({
    sampleRate: AVATAR_PCM.SAMPLE_RATE,
    latencyHint: "interactive",
  });
  return {
    get sampleRate() {
      return context.sampleRate;
    },
    audioWorklet: context.audioWorklet,
    connectTee: (stream) => {
      const node = new AudioWorkletNode(context, AVATAR_TEE_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      const source = context.createMediaStreamSource(stream);
      source.connect(node);
      return {
        port: node.port,
        disconnect: () => {
          source.disconnect();
          node.disconnect();
        },
      };
    },
    resume: () => context.resume(),
    close: () => context.close(),
  };
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Wires the source through the worklet. A worklet that will not load, or a
 * context the system made at another rate, leaves the tee silent rather than
 * failing: the call goes on as voice, and the avatar shows no lips.
 */
const wireTee = Effect.fn("desktop/wireAvatarTee")(function* (
  context: AvatarTeeContext,
  options: AvatarTeeOptions,
): Effect.fn.Return<void, string, Scope.Scope> {
  if (context.sampleRate !== AVATAR_PCM.SAMPLE_RATE) {
    return yield* Effect.fail(`the audio context runs at ${context.sampleRate} Hz`);
  }
  yield* Effect.tryPromise({
    try: () => context.audioWorklet.addModule(AVATAR_TEE_WORKLET_URL),
    catch: messageOf,
  });
  yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const graph = context.connectTee(options.stream);
        graph.port.onmessage = (event: MessageEvent) => {
          if (event.data instanceof ArrayBuffer) options.onChunk(new Uint8Array(event.data));
        };
        return graph;
      },
      catch: messageOf,
    }),
    (graph) =>
      Effect.sync(() => {
        graph.disconnect();
        graph.port.onmessage = null;
        graph.port.close();
      }),
  );
  // A suspended context renders nothing, and no gesture in a hidden window
  // has vouched for this one; the resume is not waited on, as the voice
  // level meter's is not.
  void context.resume().catch(() => undefined);
});

/**
 * Tees `stream` into `onChunk` until the caller's scope closes, which
 * disconnects the graph and closes the context.
 */
export const startAvatarTee = Effect.fn("desktop/startAvatarTee")(
  function* (options: AvatarTeeOptions): Effect.fn.Return<void, string, Scope.Scope> {
    const createContext = options.createContext ?? createBrowserContext;
    const context = yield* Effect.acquireRelease(
      Effect.try({ try: () => createContext(), catch: messageOf }),
      (context) => Effect.promise(() => context.close().catch(() => undefined)),
    );
    yield* wireTee(context, options);
  },
  Effect.catch((message) => Effect.logWarning(`avatar tee: ${message}`)),
);
