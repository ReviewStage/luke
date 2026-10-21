/**
 * session-sandboxes-fake.ts -- a session's sandboxes as a suite scripts them, for the suites that archive an agent and read what was asked of its sandbox.
 *
 * The double is a layer on `SessionSandboxes`: every stop is written down
 * in the order asked and answered as the suite scripts it, and a delete
 * dies, since an archive keeps the sandbox's snapshot for an unarchive, as
 * does a keep-alive, which no archive asks.
 */

import { Effect, Layer, Queue } from "effect";
import { SessionSandboxes } from "../agents/session-sandboxes.js";
import type { SandboxUnavailable } from "../agents/vercel-sandbox-api.js";

/** The stops asked of the sandboxes, each session named in the order the stops were asked, and the layer that answers them. */
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
