/**
 * What a scheduler hands back so the same schedule can be cancelled. A
 * browser answers with a number, Node with a timer object, and a test with
 * whatever it keys its own map by — so the handle is only ever handed back,
 * never read. One type at the bottom of the graph, so a schedule made in one
 * package is cancellable in another.
 *
 * @deprecated Effect's `Clock` and a fiber forked into a `Scope` say all of
 * this, and `@sidecar/runtime/effect`'s `timersFromRuntime` answers the seam
 * from a runtime while its callers migrate; P12-03 deletes this type, that
 * bridge, and the `FakeClock` beside them.
 */
export type ScheduledTimer = number | object;

/** One day in milliseconds, for every age, half-life, and lookback measured in days. */
export const DAY_MS = 24 * 60 * 60 * 1000;
