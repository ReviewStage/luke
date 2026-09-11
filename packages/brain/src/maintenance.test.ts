import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { MEMORY_FLUSH_DEFAULTS } from "@sidecar/memory";
import { Effect } from "effect";
import type { BrainFlushMarkerStore } from "./maintenance.js";
import { writeFlushMarkerEffect } from "./maintenance.js";

describe("writeFlushMarkerEffect", () => {
  it.effect("succeeds on the first attempt when the store accepts the write", () =>
    Effect.gen(function* () {
      let calls = 0;
      const store: BrainFlushMarkerStore = {
        read: () => Promise.resolve(undefined),
        write: () => {
          calls += 1;
          return Promise.resolve();
        },
      };

      yield* writeFlushMarkerEffect(store, "generation-1", 2, new AbortController().signal);

      assert.equal(calls, 1);
    }),
  );

  it.effect("retries exactly the port's marker-write attempts and fails with the last reason", () =>
    Effect.gen(function* () {
      let calls = 0;
      const store: BrainFlushMarkerStore = {
        read: () => Promise.resolve(undefined),
        write: () => {
          calls += 1;
          return Promise.reject(new Error(`disk full (${calls})`));
        },
      };

      const refusal = yield* Effect.flip(
        writeFlushMarkerEffect(store, "generation-1", 2, new AbortController().signal),
      );

      assert.equal(calls, MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS);
      assert.equal(refusal.revoked, false);
      assert.equal(refusal.reason, `disk full (${MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS})`);
    }),
  );

  it.effect("fails at once, without writing, once the turn's signal is already aborted", () =>
    Effect.gen(function* () {
      let calls = 0;
      const store: BrainFlushMarkerStore = {
        read: () => Promise.resolve(undefined),
        write: () => {
          calls += 1;
          return Promise.resolve();
        },
      };
      const controller = new AbortController();
      controller.abort();

      const refusal = yield* Effect.flip(
        writeFlushMarkerEffect(store, "generation-1", 2, controller.signal),
      );

      assert.equal(calls, 0);
      assert.equal(refusal.revoked, true);
      assert.equal(refusal.reason, "the turn was revoked");
    }),
  );
});
