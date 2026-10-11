import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { minuteTicks, sinceText } from "./plan-time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Noon on a day of 2026, so no zone the test runs in moves it to another date. */
const NOON = Date.UTC(2026, 9, 11, 12);

it("a row says now inside a minute, then minutes, hours, days, and weeks, then the date", () => {
  const ago = (elapsed: number) => sinceText(NOON - elapsed, NOON);

  assert.deepEqual(
    [
      ago(0),
      ago(59_999),
      ago(5 * MINUTE),
      ago(22 * MINUTE + 59_000),
      ago(3 * HOUR),
      ago(2 * DAY),
      ago(3 * 7 * DAY),
      ago(4 * 7 * DAY + 6 * DAY),
      ago(40 * DAY),
      ago(400 * DAY),
    ],
    ["now", "now", "5m", "22m", "3h", "2d", "3w", "4w", "Sep 1", "Sep 6, 2025"],
  );
  assert.equal(sinceText(NOON + MINUTE, NOON), "now", "a clock behind the service says now");
});

it.effect("the rows' time is read now and again on every minute of the clock", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOON);
    const reading = yield* Effect.forkChild(Stream.runCollect(Stream.take(minuteTicks, 3)));

    yield* TestClock.adjust("1 minute");
    yield* TestClock.adjust("1 minute");
    const read = yield* Fiber.join(reading);

    assert.deepEqual(
      read.map((now) => sinceText(NOON, now)),
      ["now", "1m", "2m"],
    );
  }),
);
