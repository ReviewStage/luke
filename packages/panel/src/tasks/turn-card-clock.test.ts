import assert from "node:assert/strict";
import { callHeading } from "@repo/features/time-format";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test, vi } from "vitest";
import { TurnCard } from "./turn-card.js";

const MAC_REGION = "en-GB";

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

test("a turn's heading and the card it hangs read one clock on a Mac set to 24 hours", () => {
  onMacRegion();
  const now = new Date(2026, 9, 8, 18, 0).getTime();
  const startedAt = new Date(2026, 9, 8, 14, 32).getTime();
  const endedAt = new Date(2026, 9, 8, 15, 42).getTime();

  const card = renderToStaticMarkup(
    createElement(TurnCard, { startedAt, endedAt, now, record: {}, models: [] }),
  );

  assert.equal(callHeading(endedAt, now), "Today, 3:42 PM");
  assert.match(card, /Today, 2:32 – 3:42 PM · 1h 10m/u);
});
