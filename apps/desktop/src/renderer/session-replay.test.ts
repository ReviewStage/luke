import assert from "node:assert/strict";
import { test } from "vitest";
import { withoutLocalAddress } from "./session-replay";

const LOCAL = "file:///Users/someone/Applications/Vespin.app/renderer/index.html";
const PANEL = "app://desktop/panel";

test("the address goes from an event's own properties", () => {
  const scrubbed = withoutLocalAddress({ $current_url: LOCAL, $browser: "Chrome" });
  assert.deepEqual(scrubbed, { $current_url: "app://desktop/panel", $browser: "Chrome" });
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
