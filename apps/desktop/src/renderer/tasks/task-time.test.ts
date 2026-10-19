import assert from "node:assert/strict";
import { callHeading } from "@luke/panel/tasks/task-time";
import { TurnCard } from "@luke/panel/tasks/turn-card";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test, vi } from "vitest";

/** The Mac's own region, read by a time asked for in no locale of its own: one that sets the clock on 24 hours. */
const MAC_REGION = "en-GB";

/** Has every time asked for in no locale of its own read the Mac's region as `MAC_REGION`, as macOS hands it to the window. */
function onMacRegion(): void {
  for (const method of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"] as const) {
    const says = Date.prototype[method];
    vi.spyOn(Date.prototype, method).mockImplementation(function (this: Date, locales, options) {
      return says.call(this, locales ?? MAC_REGION, options);
    });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("a call's header names its day as today, yesterday, a weekday this week, or a date", () => {
  const now = new Date(2026, 9, 8, 18, 0).getTime();
  const at = (month: number, day: number, year = 2026) =>
    new Date(year, month, day, 15, 42).getTime();

  assert.equal(callHeading(at(9, 8), now), "Today, 3:42 PM");
  assert.equal(callHeading(at(9, 7), now), "Yesterday, 3:42 PM");
  assert.equal(callHeading(at(9, 5), now), "Monday, 3:42 PM");
  assert.equal(callHeading(at(8, 21), now), "Sep 21, 3:42 PM");
  assert.equal(callHeading(at(11, 30, 2025), now), "Dec 30, 2025, 3:42 PM");
});

test("a turn's heading and the card it hangs read one clock on a Mac set to 24 hours", () => {
  onMacRegion();
  const now = new Date(2026, 9, 8, 18, 0).getTime();
  const startedAt = new Date(2026, 9, 8, 14, 32).getTime();
  const endedAt = new Date(2026, 9, 8, 15, 42).getTime();

  const card = renderToStaticMarkup(
    createElement(TurnCard, { startedAt, endedAt, record: {}, models: [] }),
  );

  assert.equal(callHeading(endedAt, now), "Today, 3:42 PM");
  assert.match(card, /Oct 8, 2026, 2:32 PM → 3:42 PM/u);
});
