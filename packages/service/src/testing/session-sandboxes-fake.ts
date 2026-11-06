import { Effect, Layer, Queue } from "effect";
import type { SandboxStopReach } from "../agents/session-sandboxes.js";
import { SessionSandboxes } from "../agents/session-sandboxes.js";
import type { SandboxUnavailable } from "../agents/vercel-sandbox-api.js";

export function scriptedSessionSandboxes(
  answer: (sessionId: string) => Effect.Effect<number, SandboxUnavailable> = () =>
    Effect.succeed(1),
) {
  return Effect.gen(function* () {
    const stops = yield* Queue.unbounded<string>();
    const layer = Layer.succeed(SessionSandboxes, {
      deleteFor: () => Effect.die("an archive deleted a session's sandbox"),
      keepAliveFor: () => Effect.die("an archive kept a session's sandbox alive"),
      stopFor: (sessionId) => Effect.andThen(Queue.offer(stops, sessionId), answer(sessionId)),
    });
    return { layer, stops };
  });
}

export const keepAwakeDetached: SandboxStopReach["keepAwake"] = (work) =>
  Effect.asVoid(Effect.forkDetach(work));
