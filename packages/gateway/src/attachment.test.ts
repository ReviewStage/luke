import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Exit, Scope, TestClock } from "effect";
import { retryAttachWhileDetachedEffect } from "./attachment.js";

/** A client stand-in: it announces changes in whether a host stands, never the standing state. */
function client() {
  const listeners = new Set<(attached: boolean) => void>();
  return {
    onAttachedChanged: (listener: (attached: boolean) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    announce: (attached: boolean) => {
      for (const listener of [...listeners]) listener(attached);
    },
  };
}

it.effect(
  "a failed attach is tried again after a growing pause until one attaches, and never after the scope closes",
  () =>
    Effect.gen(function* () {
      const c = client();
      let attaches = 0;
      const reports: string[] = [];
      const scope = yield* Scope.make();
      yield* Effect.fork(
        Effect.provideService(
          retryAttachWhileDetachedEffect({
            onAttachedChanged: c.onAttachedChanged,
            // The first attach already failed before the retries began: they begin at once.
            attached: () => false,
            attach: async () => {
              attaches += 1;
            },
            initialDelayMs: 100,
            maximumDelayMs: 250,
            report: (message) => reports.push(message),
          }),
          Scope.Scope,
          scope,
        ),
      );

      yield* TestClock.adjust(0);
      assert.equal(reports.length, 1);

      // A further detachment while a retry already waits schedules nothing new.
      c.announce(false);
      yield* TestClock.adjust(0);
      assert.equal(reports.length, 1);

      // The first pause, 100ms, elapses: the attach runs and the next pause doubles to 200ms.
      yield* TestClock.adjust(100);
      assert.equal(attaches, 1);
      c.announce(false);
      c.announce(false);
      yield* TestClock.adjust(0);
      assert.equal(reports.length, 2);

      // The second pause, 200ms, elapses: the next pause doubles again to 250ms, the cap.
      yield* TestClock.adjust(200);
      assert.equal(attaches, 2);
      c.announce(false);
      yield* TestClock.adjust(0);
      assert.equal(reports.length, 3);

      // An attachment resets the pause for the next schedule, but does not
      // cancel the one already pending.
      c.announce(true);

      // The third pause, capped at 250ms, elapses: the pause after it is the
      // reset initial pause rather than another doubling.
      yield* TestClock.adjust(250);
      assert.equal(attaches, 3);
      c.announce(false);
      yield* TestClock.adjust(0);
      assert.equal(reports.length, 4);

      // Closing the scope interrupts the pending attempt: it never attaches again.
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust(1_000);
      assert.equal(attaches, 3);
    }),
);
