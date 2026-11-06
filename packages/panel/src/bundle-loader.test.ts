import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { sideBundles, TERMINAL_LOAD_FAILED } from "./bundle-loader.js";
import type { TerminalModule } from "./terminal/contract.js";

const TERMINAL = { stand: "terminal" } as unknown as TerminalModule;

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
    assert.ok(failed.cause instanceof Error);
    assert.equal(failed.cause.message, "offline");

    online = true;
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
