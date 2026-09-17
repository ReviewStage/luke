/**
 * delay-ladder.ts -- a finite sequence of delays as one Schedule.
 *
 * One `Schedule.duration` per delay, sequenced with `Schedule.concat`: each
 * recurs once after its own delay and then hands over, so the chain recurs as
 * many times as there are delays and then completes. The budget a caller
 * spends is data a schedule steps through rather than an index counted by
 * hand.
 */
import { type Duration, Schedule } from "effect";

/** The delays in order, non-empty since an empty ladder would have nothing to recur on. */
export type DelayLadder = readonly [Duration.Duration, ...Duration.Duration[]];

/** The ladder as a schedule whose output is the delay it decided on. */
export function delayLadder(delays: DelayLadder): Schedule.Schedule<Duration.Duration, undefined> {
  return delays
    .map((delay) => Schedule.duration(delay))
    .reduce((earlier, later) => Schedule.concat(earlier, later));
}
