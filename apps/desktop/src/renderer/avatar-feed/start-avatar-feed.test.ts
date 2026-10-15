import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PCM_SAMPLE_RATE } from "@luke/voice/avatar-pcm";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import { startAvatarFeed } from "./start-avatar-feed";

/**
 * start-avatar-feed.test.ts -- the tee over a fake Web Audio, which node has none of: it answers whether the context it opened will run.
 */

/** How the fake context answers `resume()`: it runs, it stays suspended, or it refuses. */
const RESUME = {
  RUNS: "runs",
  STAYS_SUSPENDED: "stays-suspended",
  REFUSES: "refuses",
} as const;

type Resume = (typeof RESUME)[keyof typeof RESUME];

/** A node as the tee wires one: connected, disconnected, and a port it listens on. */
class FakeNode {
  readonly port = { onmessage: null };
  connect(): void {}
  disconnect(): void {}
}

/** Web Audio as Chromium answers it at the edges the tee reaches. */
function stubAudio(resume: Resume): void {
  class FakeAudioContext {
    readonly sampleRate = PCM_SAMPLE_RATE;
    state: AudioContextState = "suspended";
    readonly audioWorklet = { addModule: () => Promise.resolve() };
    createMediaStreamSource(): FakeNode {
      return new FakeNode();
    }
    resume(): Promise<void> {
      if (resume === RESUME.REFUSES) return Promise.reject(new Error("not allowed to start"));
      if (resume === RESUME.RUNS) this.state = "running";
      return Promise.resolve();
    }
    close(): Promise<void> {
      this.state = "closed";
      return Promise.resolve();
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeNode);
}

// SAFETY: the tee only hands the stream to the context's source, which the fake ignores.
const STREAM = {} as MediaStream;

const started = (resume: Resume) =>
  Effect.gen(function* () {
    stubAudio(resume);
    return yield* startAvatarFeed({ stream: STREAM, onFeed: () => {} });
  }).pipe(Effect.scoped);

afterEach(() => {
  vi.unstubAllGlobals();
});

it.effect("a context that runs stands the tee", () =>
  Effect.gen(function* () {
    assert.equal(yield* started(RESUME.RUNS), true);
  }),
);

it.effect("a context that refuses to resume answers as a tee that did not start", () =>
  Effect.gen(function* () {
    assert.equal(yield* started(RESUME.REFUSES), false);
  }),
);

it.effect("a context still suspended after resuming answers as a tee that did not start", () =>
  Effect.gen(function* () {
    assert.equal(yield* started(RESUME.STAYS_SUSPENDED), false);
  }),
);
