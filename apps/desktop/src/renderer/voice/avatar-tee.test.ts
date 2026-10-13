import { expect, it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { type AvatarTeeContext, type AvatarTeePort, startAvatarTee } from "./avatar-tee";

/** A context the tee can wire, whose worklet posts what the test hands it. */
function fakeContext(overrides: { sampleRate?: number; loads?: boolean } = {}) {
  const port: AvatarTeePort = { onmessage: null, close: () => undefined };
  const state = { closed: false };
  const context: AvatarTeeContext = {
    sampleRate: overrides.sampleRate ?? 24_000,
    audioWorklet: {
      addModule: () =>
        overrides.loads === false ? Promise.reject(new Error("no module")) : Promise.resolve(),
    },
    connectTee: () => ({ port, disconnect: () => undefined }),
    resume: () => Promise.resolve(),
    close: () => {
      state.closed = true;
      return Promise.resolve();
    },
  };
  const post = (data: ArrayBuffer) => port.onmessage?.(new MessageEvent("message", { data }));
  return { context, state, post };
}

// SAFETY: the fake context never reads the stream it is handed; it only passes through.
const STREAM = {} as MediaStream;

it.effect("hands each chunk the worklet posts to onChunk", () =>
  Effect.gen(function* () {
    const fake = fakeContext();
    const chunks: Uint8Array[] = [];
    const scope = yield* Scope.make();
    yield* startAvatarTee({
      stream: STREAM,
      onChunk: (pcm) => chunks.push(pcm),
      createContext: () => fake.context,
    }).pipe(Scope.provide(scope));
    fake.post(Uint8Array.of(1, 0, 2, 0).buffer);
    expect(chunks.map((chunk) => Array.from(chunk))).toEqual([[1, 0, 2, 0]]);
    yield* Scope.close(scope, Exit.void);
    expect(fake.state.closed).toBe(true);
    fake.post(Uint8Array.of(3, 0).buffer);
    expect(chunks).toHaveLength(1);
  }),
);

it.effect("stays silent rather than failing when the worklet will not load", () =>
  Effect.gen(function* () {
    const fake = fakeContext({ loads: false });
    const chunks: Uint8Array[] = [];
    const scope = yield* Scope.make();
    const exit = yield* startAvatarTee({
      stream: STREAM,
      onChunk: (pcm) => chunks.push(pcm),
      createContext: () => fake.context,
    }).pipe(Scope.provide(scope), Effect.exit);
    expect(Exit.isSuccess(exit)).toBe(true);
    fake.post(Uint8Array.of(1, 0).buffer);
    expect(chunks).toEqual([]);
    yield* Scope.close(scope, Exit.void);
    expect(fake.state.closed).toBe(true);
  }),
);

it.effect("stays silent on a context the system made at another rate", () =>
  Effect.gen(function* () {
    const fake = fakeContext({ sampleRate: 48_000 });
    const chunks: Uint8Array[] = [];
    yield* startAvatarTee({
      stream: STREAM,
      onChunk: (pcm) => chunks.push(pcm),
      createContext: () => fake.context,
    }).pipe(Effect.scoped);
    fake.post(Uint8Array.of(1, 0).buffer);
    expect(chunks).toEqual([]);
  }),
);
