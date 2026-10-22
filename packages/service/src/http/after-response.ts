/**
 * after-response.ts -- work a request hands on to run once its answer has left.
 *
 * A request whose answer does not wait on some of its work, such as the
 * notices a chat post tells or an analytics event it counts, hands that work
 * here. Where the runtime provides `AfterResponse` (the web's, over Vercel's
 * `waitUntil`, `apps/web/server/runtime.ts`), the work runs past the answer
 * with every service the request had, and the instance is kept awake until
 * it ends. A runtime that provides none, an eve root's or a test's, runs it
 * in place, as the request's own work, which is what it did before.
 */

import { Cause, Context, Effect, Layer, Option } from "effect";

interface AfterResponseValues {
  /** Starts the work, which never fails, so that it runs past the answer; returns at once. */
  readonly keep: (work: Effect.Effect<void>) => Effect.Effect<void>;
}

/** How the runtime runs work past a request's answer. */
export class AfterResponse extends Context.Service<AfterResponse, AfterResponseValues>()(
  "AfterResponse",
) {}

/**
 * Runs the work once the request's answer has left, as the header says.
 * What it fails or dies with is logged rather than answered, because the
 * answer has gone by then; an interruption is nothing to say.
 */
export function afterResponse<E, R>(
  label: string,
  work: Effect.Effect<void, E, R>,
): Effect.Effect<void, never, R> {
  return Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const settled = work.pipe(
      Effect.provideContext(context),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning(`${label} failed after the answer: ${Cause.pretty(cause)}`),
      ),
    );
    const after = yield* Effect.serviceOption(AfterResponse);
    if (Option.isNone(after)) return yield* settled;
    yield* after.value.keep(settled);
  });
}

/**
 * Work kept rather than run, for a test that asserts what a request
 * answered before its after-response work ran: `run` runs everything kept
 * so far, in order, and keeps nothing more of it.
 */
export function keptAfterResponse() {
  const kept: Effect.Effect<void>[] = [];
  const layer = Layer.succeed(AfterResponse, {
    keep: (work) => Effect.sync(() => void kept.push(work)),
  });
  const run = Effect.suspend(() =>
    Effect.forEach(kept.splice(0), (work) => work, { discard: true }),
  );
  return { layer, run };
}
