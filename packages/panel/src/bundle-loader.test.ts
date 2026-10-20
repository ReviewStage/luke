import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { sideBundles, TERMINAL_LOAD_FAILED } from "./bundle-loader.js";
import type { TerminalModule } from "./terminal/contract.js";

/**
 * bundle-loader.test.ts -- a bundle whose import failed, as one does over a
 * connection that dropped for a moment, is imported again by the next
 * surface to read it, rather than answering the failure for the window's
 * life; and one that landed is had by every later reader. The bundle is a stand-in, failing until the connection is back.
 */

/** The Terminal tab's bundle as it lands; nothing reads past who it is. */
// SAFETY: a stand-in compared by identity alone, never drawn.
const TERMINAL = { stand: "terminal" } as unknown as TerminalModule;

/** A registry that lets go of an atom as soon as the reader holding it last has let go, where a window's does so a task later. */
function registry(): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({
    scheduleTask: (task) => {
      queueMicrotask(task);
      return () => undefined;
    },
  });
}

it.effect("a bundle whose import failed is imported again by its next reader", () =>
  Effect.gen(function* () {
    let online = false;
    const bundles = sideBundles({
      terminal: () => (online ? Promise.resolve(TERMINAL) : Promise.reject(new Error("offline"))),
    });
    const window = registry();

    const failed = yield* Effect.flip(AtomRegistry.getResult(window, bundles.terminal));
    assert.equal(failed.message, TERMINAL_LOAD_FAILED);

    online = true;
    // The registry lets go of what no reader holds once the fiber yields.
    yield* Effect.yieldNow;
    assert.equal(yield* AtomRegistry.getResult(window, bundles.terminal), TERMINAL);
  }),
);

it.effect("a bundle that landed is had by a later reader though its import would fail now", () =>
  Effect.gen(function* () {
    let online = true;
    const bundles = sideBundles({
      terminal: () => (online ? Promise.resolve(TERMINAL) : Promise.reject(new Error("offline"))),
    });
    const window = registry();
    assert.equal(yield* AtomRegistry.getResult(window, bundles.terminal), TERMINAL);

    online = false;
    yield* Effect.yieldNow;
    assert.equal(yield* AtomRegistry.getResult(window, bundles.terminal), TERMINAL);
  }),
);
