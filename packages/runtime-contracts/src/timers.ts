/**
 * What a scheduler hands back so the same schedule can be cancelled. A
 * browser answers with a number, Node with a timer object, and a test with
 * whatever it keys its own map by — so the handle is only ever handed back,
 * never read. One type at the bottom of the graph, so a schedule made in one
 * package is cancellable in another.
 */
export type ScheduledTimer = number | object;
