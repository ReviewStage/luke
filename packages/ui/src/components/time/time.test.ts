import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { TIME_LOOK, Time } from "./time.js";

/** Oct 14, 2026, 6:00 PM, on the machine's own clock. */
const NOW = new Date(2026, 9, 14, 18, 0).getTime();
const AT = new Date(2026, 9, 14, 15, 42).getTime();

function drawn(look: (typeof TIME_LOOK)[keyof typeof TIME_LOOK], at = AT): string {
  return renderToStaticMarkup(createElement(Time, { at, look, now: NOW }));
}

test("a time says its age in letters, in words, as a day, or as the moment itself", () => {
  assert.match(drawn(TIME_LOOK.SINCE), />2h<\/time>/u);
  assert.match(drawn(TIME_LOOK.AGO), />2h ago<\/time>/u);
  assert.match(drawn(TIME_LOOK.DAY), />Today, 3:42 PM<\/time>/u);
  assert.match(drawn(TIME_LOOK.MOMENT), />Oct 14, 2026, 3:42 PM<\/time>/u);
});

test("a time is a <time> naming its moment, and a run's length a timer naming its duration", () => {
  assert.match(drawn(TIME_LOOK.SINCE), new RegExp(`dateTime="${new Date(AT).toISOString()}"`, "u"));
  const run = drawn(TIME_LOOK.DURATION, NOW - 72_000);
  assert.match(run, /dateTime="PT72S"/u);
  assert.match(run, /role="timer"/u);
  assert.match(run, />1m 12s<\/time>/u);
});
