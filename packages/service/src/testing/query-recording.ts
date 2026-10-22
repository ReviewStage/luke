/**
 * query-recording.ts -- every SQL statement an effect runs, read off the spans its SQL client opens.
 *
 * `effect/sql` opens a span for each statement it runs and writes the
 * statement's text on it (`db.query.text`), so a test that runs an effect
 * under this tracer reads which statements it ran, in order, on either
 * dialect, the transactions and the fibers it forked included.
 */

import { Effect, Tracer } from "effect";

/** The attribute a statement's span carries its text under, as OpenTelemetry's database conventions name it. */
const QUERY_TEXT = "db.query.text";

/** A tracer that writes down each statement's text beside the one it stands over, and the way to run an effect under it. */
export const queryRecorder = Effect.map(Effect.tracer, (base) => {
  const queries: string[] = [];
  const tracer = Tracer.make({
    span: (options) =>
      new Proxy(base.span(options), {
        get: (span, key, receiver) =>
          key === "attribute"
            ? (name: string, value: unknown) => {
                if (name === QUERY_TEXT) queries.push(String(value));
                span.attribute(name, value);
              }
            : Reflect.get(span, key, receiver),
      }),
    ...(base.context === undefined ? undefined : { context: base.context }),
  });
  const record = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.withTracer(effect, tracer);
  return { queries, record };
});
