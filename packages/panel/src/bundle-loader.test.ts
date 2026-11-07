import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { sideBundles, TERMINAL_LOAD_FAILED } from "./bundle-loader.js";
import type { TerminalModule } from "./terminal/contract.js";
import { bundleLanded } from "./testing/side-bundles.js";

/**
 * bundle-loader.test.ts -- a bundle whose import failed, as one does over a
 * connection that dropped for a moment, is imported again by the next
 * surface to read it, rather than answering the failure for the window's
 * life, its own error kept as the failure's cause; and one that landed is had by every later reader. The bundle is a stand-in, failing until the connection is back.
 */

/** The Terminal tab's bundle as it lands; nothing reads past who it is. */
// SAFETY: a stand-in compared by identity alone, never drawn.
const TERMINAL = { stand: "terminal" } as unknown as TerminalModule;

it.effect("a bundle whose import failed is imported again by its next reader", () =>
  Effect.gen(function* () {
    let online = false;
    const bundles = sideBundles({
      terminal: () => (online ? Promise.resolve(TERMINAL) : Promise.reject(new Error("offline"))),
    });

    const failed = yield* Effect.flip(bundleLanded(bundles.terminal));
    assert.equal(failed.message, TERMINAL_LOAD_FAILED);
    // The import's own error rides along, so a report names the chunk that failed.
    assert.ok(failed.cause instanceof Error);
    assert.equal(failed.cause.message, "offline");

    online = true;
    assert.equal(yield* bundleLanded(bundles.terminal), TERMINAL);
  }),
);

it.effect("a bundle that landed is had by a later reader though its import would fail now", () =>
  Effect.gen(function* () {
    let online = true;
    const bundles = sideBundles({
      terminal: () => (online ? Promise.resolve(TERMINAL) : Promise.reject(new Error("offline"))),
    });
    assert.equal(yield* bundleLanded(bundles.terminal), TERMINAL);

    online = false;
    assert.equal(yield* bundleLanded(bundles.terminal), TERMINAL);
  }),
);
