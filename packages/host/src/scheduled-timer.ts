/**
 * What a scheduler hands back so the same schedule can be cancelled. A
 * browser answers with a number, Node with a timer object, and a test with
 * whatever it keys its own map by — so the handle is only ever handed back,
 * never read.
 */
export type ScheduledTimer = number | object;
