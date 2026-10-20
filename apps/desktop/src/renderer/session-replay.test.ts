import assert from "node:assert/strict";
import { test } from "vitest";
import { withoutLocalAddress } from "./session-replay";

/**
 * The renderer is a `file://` page, so its address is a path on the
 * developer's own disk and a packaged install sits under `/Users/<name>/`.
 * Switching pageviews off stops it reaching one event; this is what stops it
 * reaching everything else the library puts it in.
 */
const LOCAL = "file:///Users/someone/Applications/Luke.app/renderer/index.html";
/** What the scrub puts in the address's place, as the library will report it. */
const PANEL = "app://luke/panel";

test("the address goes from an event's own properties", () => {
  const scrubbed = withoutLocalAddress({ $current_url: LOCAL, $browser: "Chrome" });
  // What is not the address is left exactly as the library reported it.
  assert.deepEqual(scrubbed, { $current_url: "app://luke/panel", $browser: "Chrome" });
});

test("the address goes from the frames the recorder opens with", () => {
  assert.deepEqual(
    withoutLocalAddress([
      { type: 4, data: { href: LOCAL, width: 640 }, timestamp: 1 },
      { type: 5, data: { tag: "$url_changed", payload: { href: LOCAL } }, timestamp: 2 },
    ]),
    [
      { type: 4, data: { href: PANEL, width: 640 }, timestamp: 1 },
      { type: 5, data: { tag: "$url_changed", payload: { href: PANEL } }, timestamp: 2 },
    ],
  );
});
